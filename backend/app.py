"""
FastAPI backend wrapping stt.py, nlu.py, action_protocol.py, tts.py behind
HTTP endpoints for the Next.js frontend. See ../main.py for the terminal
version of the same pipeline - this file follows the same call order
(stt -> nlu -> action_protocol -> tts) but splits it across HTTP turns
instead of blocking on local mic/speaker calls.

Two endpoints rather than one literal URL for both request shapes: FastAPI
can't cleanly validate two mutually exclusive body shapes (multipart audio
vs JSON confirm) on a single route. POST /api/turn (new voice turn) and
POST /api/turn/confirm (resolve a pending confirmation) together form the
one voice-pipeline entry point.

Deploy note: importing stt.py and tts.py pulls in sounddevice and
playsound respectively even though this backend never calls
record_until_silence() or speak() - both modules import those at the top
of the file unconditionally. Whatever host runs this needs those importable
(sounddevice needs the PortAudio system library) even though no audio
hardware is actually used server-side. faster-whisper also needs
ffmpeg/libav (via PyAV) to decode the webm audio the frontend sends.
"""

import os
import re
import sys
import copy
import tempfile
import asyncio
import uuid
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Windows consoles default to cp1252; any print() of Arabic text (nlu/tts
# debug output) would raise UnicodeEncodeError and 500 the request.
if sys.platform == "win32":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import stt
import tts
from nlu import extract_intent
from action_protocol import (
    process_intent,
    execute_action,
    build_confirmation_message,
    resolve_beneficiary,
)

from .session_store import create_session, get_session

app = FastAPI(title="wusa backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to the deployed frontend origin once hosting is chosen
    allow_methods=["*"],
    allow_headers=["*"],
)

GREETING_TEXT = "يا هلا بك في بنك تجريبي... كيف ممكن اساعدك اليوم؟"
# Fixed confirmation-flow prompts, synthesized once at startup like the
# greeting so the whole flow speaks with one voice and zero per-turn cost.
PIN_PROMPT_TEXT = "من فضلك انطق الرقم السري أو أدخله لتأكيد العملية"
FACEID_TEXT = "تم قبول الرقم السري. جاري التحقق من الوجه"
_greeting_audio_path = None
_pin_prompt_audio_path = None
_faceid_audio_path = None

# token -> (file path, reusable). Reusable entries (the greeting) are never
# deleted after being served; per-turn response audio is one-shot.
_audio_tokens: dict[str, dict[str, Any]] = {}


def _register_audio(path: str, reusable: bool = False) -> str:
    token = str(uuid.uuid4())
    _audio_tokens[token] = {
        "path": path,
        "reusable": reusable,
        "ready": True,
        "event": asyncio.Event(),
        "error": None,
    }
    _audio_tokens[token]["event"].set()
    return f"/api/audio/{token}"


def _register_pending_audio(reusable: bool = False) -> str:
    token = str(uuid.uuid4())
    _audio_tokens[token] = {
        "path": None,
        "reusable": reusable,
        "ready": False,
        "event": asyncio.Event(),
        "error": None,
    }
    return token


@app.on_event("startup")
def _startup():
    global _greeting_audio_path, _pin_prompt_audio_path, _faceid_audio_path

    # Load the Whisper model now rather than lazily on the first /api/turn -
    # the load takes multiple seconds (plus a download on a fresh machine)
    # and must not be paid by the first user turn of a live demo. Runs in a
    # thread so startup isn't blocked and a failed load only surfaces on the
    # first actual transcription.
    import threading
    threading.Thread(target=stt._get_model, daemon=True).start()

    try:
        # No dialect for the greeting: it plays before the user has spoken,
        # so there is nothing to detect yet - it stays fixed by design.
        # Synthesized at its own slower speed so the first thing users hear
        # is calm, while turn responses stay at the faster response speed.
        _greeting_audio_path = tts.synthesize_to_file(
            GREETING_TEXT, "ar", speed=tts.ELEVENLABS_GREETING_SPEED
        )
    except Exception as e:
        # A dead TTS engine must not take the whole backend down.
        print(f"greeting TTS failed ({e}); sessions will start without audio")
        _greeting_audio_path = None

    try:
        _pin_prompt_audio_path = tts.synthesize_to_file(PIN_PROMPT_TEXT, "ar")
        _faceid_audio_path = tts.synthesize_to_file(FACEID_TEXT, "ar")
    except Exception as e:
        # Missing prompts degrade to a silent-but-working confirmation flow.
        print(f"confirmation prompt TTS failed ({e}); flow will be silent")
        _pin_prompt_audio_path = None
        _faceid_audio_path = None


async def _run_tts_background(token: str, text: str, language: str, dialect: str = None) -> None:
    entry = _audio_tokens.get(token)
    if entry is None:
        return
    try:
        path = await asyncio.to_thread(tts.synthesize_to_file, text, language, dialect)
        entry["path"] = path
        entry["ready"] = True
    except Exception as e:
        print(f"Background TTS failed ({e})")
        entry["error"] = str(e)
    finally:
        entry["event"].set()


async def _tts_url(text: str, language: str, dialect: str = None) -> str:
    """Best-effort TTS: returns an audio URL token immediately."
    token = _register_pending_audio()
    asyncio.create_task(_run_tts_background(token, text, language, dialect))
    return f"/api/audio/{token}"


def _account_state(session) -> dict:
    """Fresh snapshot of the authoritative account state, built at response
    time from the live backend - never cached, never captured in a closure.
    Every response carries this so the UI can only ever render current data."""
    context = session.backend.to_account_context()
    return copy.deepcopy({
        "accounts": context.get("accounts", []),
        "beneficiaries": context.get("beneficiaries", []),
        "cards": context.get("cards", []),
        "transactions": session.backend.get_transactions(count=10),
    })


_ARABIC_CHARS = re.compile(r"[؀-ۿ]")


def _resolve_payment_creditor(intent: dict, session) -> tuple:
    """Resolves the NLU's CreditorAccount against the CURRENT beneficiary and
    biller lists BEFORE the payment becomes a pending confirmation. Returns
    (intent, None) with the creditor replaced by the matched record, or
    (intent, clarification_message) when nothing/too many match - in that
    case the caller must ask instead of queueing the payment."""
    params = intent.get("params", {})
    creditor = params.get("CreditorAccount", {}) or {}
    lang = intent.get("response_language", "ar")

    context = session.backend.to_account_context()
    payees = list(context.get("beneficiaries") or []) + list(context.get("billers") or [])
    match, candidates = resolve_beneficiary(
        payees,
        name=creditor.get("Name"),
        identification=creditor.get("Identification"),
    )

    if match is not None:
        params["CreditorAccount"] = {
            "Identification": match["account_number"],
            "Name": match["name"],
        }
        intent["params"] = params
        return intent, None

    if candidates:
        names = "، ".join(c["name"] for c in candidates) if lang == "ar" else ", ".join(c["name"] for c in candidates)
        question = (
            f"يوجد أكثر من مستفيد مطابق: {names}. من تقصد بالضبط؟"
            if lang == "ar" else
            f"More than one beneficiary matches: {names}. Which one do you mean?"
        )
    else:
        spoken_name = creditor.get("Name") or ("هذا الاسم" if lang == "ar" else "that name")
        question = (
            f"ما لقيت مستفيد باسم {spoken_name} في قائمة المستفيدين لديك. ممكن تقول الاسم مثل ما هو مسجل؟"
            if lang == "ar" else
            f"I couldn't find a beneficiary called {spoken_name} on your list. Could you say the name as it is saved?"
        )
    return intent, question


def _build_pending_screen_state(intent: dict) -> dict:
    action = intent["action"]
    params = intent.get("params", {})

    if action == "domesticPayment":
        amt = params["InstructedAmount"]
        creditor = params["CreditorAccount"]
        return {
            "type": "confirm_payment",
            "amount": float(amt["Amount"]),
            "currency": amt["Currency"],
            "recipient": creditor.get("Name"),
            "amount_source": params.get("amount_source"),
            "reference": params.get("Reference"),
        }

    return {"type": "confirm_action", "action": action, **params}


def _build_screen_state_from_response(intent: dict, response: dict) -> dict:
    if response.get("needs_clarification"):
        return {"type": "clarification", "message": response["message"]}
    if response.get("cancelled"):
        return {"type": "cancelled", "message": response["message"]}
    if not response["success"]:
        return {"type": "error", "message": response["message"], "error_code": response.get("error")}

    action = intent["action"]
    data = response.get("data", {})

    if action == "thanks":
        # Social close - no card to show, just the spoken reply.
        return {"type": "idle"}

    if action == "getBalances":
        account = data["accounts"][0]
        return {
            "type": "balance",
            "amount": account["balance"],
            "currency": account.get("currency", "SAR"),
            "account_type": account["type"],
        }
    if action == "getTransactions":
        return {"type": "transactions", "transactions": data["transactions"]}
    if action == "getBeneficiaries":
        return {"type": "beneficiaries", "beneficiaries": data["beneficiaries"]}
    if action == "getExchangeRate":
        return {
            "type": "exchange_rate",
            "source_currency": data["source_currency"],
            "target_currency": data["target_currency"],
            "rate": data["rate"],
        }

    # domesticPayment, freezeCard, unfreezeCard, addBeneficiary success
    return {"type": "success", "message": response["message"], "data": data}


class SessionResponse(BaseModel):
    session_id: str
    greeting_text: str
    greeting_audio_url: str
    # Fixed confirmation-flow prompts ("" when startup TTS failed): spoken
    # before the PIN card listens, and while the simulated Face ID runs.
    pin_prompt_audio_url: str
    faceid_audio_url: str
    account_state: dict


class ConfirmRequest(BaseModel):
    session_id: str
    confirmed: bool


class PaymentRequest(BaseModel):
    session_id: str
    amount: float
    currency: str = "SAR"
    creditor_account_number: str


class TurnResponse(BaseModel):
    transcript: str
    action: str
    params: dict
    requires_confirmation: bool
    screen_state: dict
    spoken_text: str
    audio_url: str
    account_state: dict


@app.post("/api/session", response_model=SessionResponse)
def new_session():
    session_id = create_session()
    return SessionResponse(
        session_id=session_id,
        greeting_text=GREETING_TEXT,
        greeting_audio_url=_register_audio(_greeting_audio_path, reusable=True) if _greeting_audio_path else "",
        pin_prompt_audio_url=_register_audio(_pin_prompt_audio_path, reusable=True) if _pin_prompt_audio_path else "",
        faceid_audio_url=_register_audio(_faceid_audio_path, reusable=True) if _faceid_audio_path else "",
        account_state=_account_state(get_session(session_id)),
    )


@app.get("/api/state")
def get_state(session_id: str):
    session = get_session(session_id)
    if session is None:
        raise HTTPException(404, "unknown session_id")
    return {"account_state": _account_state(session)}


@app.post("/api/turn", response_model=TurnResponse)
async def turn(
    session_id: str = Form(...),
    audio: UploadFile | None = File(None),
    text: str | None = Form(None),
):
    session = get_session(session_id)
    if session is None:
        raise HTTPException(404, "unknown session_id")

    if text is not None and text.strip():
        # Text bypass for development/testing the NLU->action->TTS chain
        # without recording audio. The deployed app always sends audio.
        transcript = text.strip()
        language = "ar" if _ARABIC_CHARS.search(transcript) else "en"
    elif audio is not None:
        suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(await audio.read())
            audio_path = tmp.name

        try:
            heard = await asyncio.to_thread(stt.transcribe_file, audio_path)
            transcript = heard["text"]
            language = heard["language"]
        except Exception as e:
            # Whisper can fail transiently on this RAM-starved machine
            # (mkl_malloc). Degrade to the ask-again path below instead of
            # 500ing the turn - the demo must keep flowing.
            print(f"STT failed ({e}); asking user to repeat")
            transcript = ""
            language = "ar"
        finally:
            os.unlink(audio_path)
    else:
        raise HTTPException(422, "either audio or text is required")

    if not transcript.strip():
        # Silence or noise-only audio transcribes to "". Don't send an empty
        # message to the NLU (the API rejects it) - just ask again.
        msg = "ما سمعتك، ممكن تعيد؟"
        return TurnResponse(
            transcript="",
            action="clarification",
            params={},
            requires_confirmation=False,
            screen_state={"type": "clarification", "message": msg},
            spoken_text=msg,
            audio_url=await _tts_url(msg, "ar", session.dialect),
            account_state=_account_state(session),
        )

    intent = await asyncio.to_thread(
        extract_intent, transcript, language, session.backend.to_account_context()
    )

    # Remember the user's dialect for the rest of the session so every spoken
    # response (including confirm/cancel turns with no new speech) matches it.
    if intent.get("dialect"):
        session.dialect = intent["dialect"]

    requires_confirmation = bool(intent.get("requires_confirmation"))
    clarification = None
    if requires_confirmation and intent["action"] == "domesticPayment":
        intent, clarification = _resolve_payment_creditor(intent, session)

    if clarification is not None:
        # Creditor could not be resolved against the current beneficiary or
        # biller lists - ask, never queue a payment to an unresolved target.
        session.pending_intent = None
        requires_confirmation = False
        spoken_text = clarification
        screen_state = {"type": "clarification", "message": clarification}
    elif requires_confirmation:
        session.pending_intent = intent
        spoken_text = build_confirmation_message(intent)
        screen_state = _build_pending_screen_state(intent)
    else:
        session.pending_intent = None
        response = process_intent(intent, session.backend)
        spoken_text = response["message"]
        screen_state = _build_screen_state_from_response(intent, response)

    audio_url = await _tts_url(spoken_text, intent.get("response_language", language), session.dialect)

    return TurnResponse(
        transcript=transcript,
        action=intent["action"],
        params=intent.get("params", {}),
        requires_confirmation=requires_confirmation,
        screen_state=screen_state,
        spoken_text=spoken_text,
        audio_url=audio_url,
        account_state=_account_state(session),
    )


@app.post("/api/payment", response_model=TurnResponse)
async def start_payment(body: PaymentRequest):
    """Touch-initiated transfer (amount screen's continue button). Goes
    through the exact same pending-intent + /api/turn/confirm machinery as a
    voice payment, so requires_confirmation stays enforced server-side for
    both input methods - execution only ever happens in turn_confirm."""
    session = get_session(body.session_id)
    if session is None:
        raise HTTPException(404, "unknown session_id")

    match, _ = resolve_beneficiary(
        session.backend.get_beneficiaries(),
        identification=body.creditor_account_number,
    )
    if match is None:
        raise HTTPException(404, "unknown beneficiary account")

    intent = {
        "action": "domesticPayment",
        "params": {
            "InstructedAmount": {"Amount": str(body.amount), "Currency": body.currency},
            "CreditorAccount": {"Identification": match["account_number"], "Name": match["name"]},
            "Reference": None,
            # The user typed the number themselves on the amount screen.
            "amount_source": "stated",
        },
        "response_language": "ar",
        "requires_confirmation": True,
    }

    session.pending_intent = intent
    spoken_text = build_confirmation_message(intent)
    screen_state = _build_pending_screen_state(intent)

    return TurnResponse(
        transcript="",
        action=intent["action"],
        params=intent["params"],
        requires_confirmation=True,
        screen_state=screen_state,
        spoken_text=spoken_text,
        audio_url=await _tts_url(spoken_text, "ar", session.dialect),
        account_state=_account_state(session),
    )


@app.post("/api/turn/confirm", response_model=TurnResponse)
async def turn_confirm(body: ConfirmRequest):
    session = get_session(body.session_id)
    if session is None:
        raise HTTPException(404, "unknown session_id")

    intent = session.pending_intent
    if intent is None:
        raise HTTPException(400, "no pending confirmation for this session")

    session.pending_intent = None  # clear immediately, prevents replay/double-execution
    language = intent.get("response_language", "ar")

    if body.confirmed:
        response = await asyncio.to_thread(execute_action, intent, session.backend)
        spoken_text = response["message"]
        screen_state = _build_screen_state_from_response(intent, response)
    else:
        spoken_text = "تم الإلغاء." if language == "ar" else "Cancelled."
        screen_state = {"type": "cancelled", "message": spoken_text}

    return TurnResponse(
        transcript="",
        action=intent["action"],
        params=intent.get("params", {}),
        requires_confirmation=False,
        screen_state=screen_state,
        spoken_text=spoken_text,
        audio_url=await _tts_url(spoken_text, language, session.dialect),
        account_state=_account_state(session),
    )


@app.post("/api/transcribe")
async def transcribe_only(audio: UploadFile = File(...)):
    """STT only - no NLU, no action. Used by the frontend's voice PIN entry,
    where the spoken digits must reach the SAME client-side validation the
    typed digits go through, never a separate interpretation path."""
    suffix = os.path.splitext(audio.filename or "")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await audio.read())
        audio_path = tmp.name
    try:
        heard = await asyncio.to_thread(stt.transcribe_file, audio_path)
    except Exception as e:
        print(f"transcribe failed ({e})")
        raise HTTPException(503, "transcription temporarily unavailable")
    finally:
        os.unlink(audio_path)
    return {"text": heard["text"], "language": heard["language"]}


@app.get("/api/audio/{token}")
async def get_audio(token: str, background_tasks: BackgroundTasks):
    entry = _audio_tokens.get(token)
    if entry is None:
        raise HTTPException(404, "audio not found or already served")

    if not entry["ready"]:
        try:
            await asyncio.wait_for(entry["event"].wait(), timeout=20)
        except asyncio.TimeoutError:
            raise HTTPException(503, "audio not ready")

    if entry["error"] is not None:
        raise HTTPException(503, "audio generation failed")

    path = entry["path"]
    if not path or not os.path.exists(path):
        raise HTTPException(404, "audio file missing")

    if not entry["reusable"]:
        del _audio_tokens[token]
        background_tasks.add_task(os.unlink, path)
    return FileResponse(path, media_type="audio/mpeg", filename="response.mp3")
