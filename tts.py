"""
Step 4 - Text-to-Speech (TTS)

Primary (Arabic): ElevenLabs (eleven_multilingual_v2), using a voice chosen
and approved by ear for sounding natural and soft rather than robotic.
edge-tts's ar-SA voice was tried first and rejected - too robotic, bad
pronunciation, not trustworthy for blind/elderly users trusting this with
their bank account (see tts_compare.py for the comparison this decision
came from). Arabic text is diacritized (tashkeel added) via Claude before
synthesis, since undiacritized Arabic is genuinely ambiguous to pronounce -
also verified in that comparison.

Primary (English): edge-tts. English neural voices were never reported as
a problem, so there's no reason to spend ElevenLabs' free-tier quota
(10,000 characters/month) on English.

Fallback: if ElevenLabs fails for any reason (quota exceeded, network, bad
key), falls back to edge-tts's Arabic voice rather than raising - lower
quality, but a working demo beats a crashed one.

WHY NOT SAWTARABI - the original plan called for HUMAIN's SawtArabi, but it
turns out not to be usable: SawtArabi (HUMAIN + SDAIA, Interspeech 2025) is
an Arabic TTS *evaluation benchmark* - a scoring dataset and phonemizer, not
a speech synthesis API or deployable model. HUMAIN has no public self-serve
TTS API today - the same situation nlu.py already documents for ALLaM.
SawtArabi/HUMAIN's benchmark work can still be named in the pitch
narrative - it just isn't what's speaking here.
"""

import os
import sys
import tempfile
import asyncio
import requests  # type: ignore
import edge_tts  # type: ignore

# playsound is only required for local terminal playback, not server-side
# backend requests. Import lazily in speak() so the Railway container can
# skip audio output dependencies unless that code path is actually used.

ANTHROPIC_KEY   = os.getenv("ANTHROPIC_API_KEY", "").strip()
# Haiku 4.5: rephrasing + diacritization is a mechanical text transform that
# runs on every spoken response, so speed matters more than model size.
# Profiled 2026-07-16: claude-sonnet-4-6 took 3.9-5.2s per call here. Flip
# back to "claude-sonnet-4-6" if diacritization quality regresses.
ANTHROPIC_MODEL = "claude-haiku-4-5"

ELEVENLABS_API_KEY  = os.getenv("ELEVENLABS_API_KEY", "").strip()
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "LE1b8WpPSScCUklGPKzg").strip()
ELEVENLABS_MODEL    = "eleven_multilingual_v2"
ELEVENLABS_SPEED    = 1.2      # 1.0 = normal. 1.2 is the API's maximum - the
                               # ElevenLabs voice_settings speed range is 0.7-1.2,
                               # so faster than this needs client-side playbackRate.
ELEVENLABS_GREETING_SPEED = 1.0  # The greeting is the user's first impression and
                                 # plays before they have said anything - keep it
                                 # calm and unhurried relative to turn responses.

EDGE_VOICES = {
    "ar": "ar-SA-ZariyahNeural",  # fallback only, see module docstring
    "en": "en-US-JennyNeural",
}
EDGE_TTS_RATE    = "+0%"       # edge-tts prosody rate. "+0%" = normal speed.
                               # +25% was tried 2026-07-16 and reverted: too fast.
DEFAULT_LANGUAGE = "ar"

# One shared HTTP session so Claude and ElevenLabs calls reuse their TLS
# connections instead of paying a handshake on every turn. Retries cover the
# stale keep-alive case: a kept-alive connection the server already closed
# raises RemoteDisconnected on reuse, which without a retry knocked the
# whole synth call over to the edge-tts fallback voice mid-demo.
_http = requests.Session()
_retry = requests.adapters.Retry(
    total=2, connect=2, read=2, backoff_factor=0.2,
    allowed_methods=None,  # retry POST too - these calls are safe to reissue
)
_http.mount("https://", requests.adapters.HTTPAdapter(max_retries=_retry))


# -- Arabic speech preparation (dialect matching + diacritization) ----------

SPEECH_PREP_SYSTEM_PROMPT = """You prepare Arabic text for a bank's text-to-speech engine. You do two things in one pass:

1. DIALECT: When a target dialect is given (Saudi/Gulf, Egyptian, Levantine, Iraqi, Maghrebi, ...), you MUST rewrite the sentence the way a native speaker of that dialect would actually SAY it out loud - vocabulary, grammar, and phrasing, not just an accent. Returning the input's formal/MSA wording unchanged is wrong whenever a dialect is given; the bank's written templates are formal Arabic and your whole job is to turn them into that user's spoken dialect. For example an Egyptian speaker would hear "رصيدك في حسابك الجاري" phrased with Egyptian words like "اللي في حسابك", a Gulf speaker would hear Gulf phrasing - generate whatever is natural for the requested dialect, these are illustrations, not templates. Only when the target dialect is MSA or "none" do you keep the wording as written.
   Non-negotiable constraints while rephrasing:
   - NEVER change any number, amount, currency, account detail, or person's name - these must be preserved exactly. This is banking: a changed number is a wrong transaction.
   - Preserve the meaning exactly. A question stays a question, a confirmation prompt stays a confirmation prompt, an error stays an error.
2. TASHKEEL: Add Arabic diacritics (fatha, kasra, damma, sukun, shadda, tanwin) to the final text so the TTS engine pronounces it unambiguously, following the dialect's own pronunciation. Pay special attention to numbers spelled out as words and proper names.

Return ONLY the final diacritized text. No explanation, no markdown, no quotes."""

# Speech-prep results keyed by (text, dialect). Many responses repeat verbatim
# within a session (greetings, cancellations, unchanged balances, error
# messages), and each cache hit saves a full Claude round trip per turn.
_speech_prep_cache = {}
_SPEECH_PREP_CACHE_MAX = 256


def _prepare_arabic_speech(text: str, dialect: str = None) -> str:
    """Rephrases into the user's dialect (if known) and adds tashkeel, in a
    single model call. Best-effort - falls back to the original text if the
    API call fails, since a slightly worse pronunciation beats no speech."""
    if not ANTHROPIC_KEY:
        return text

    cache_key = (text, dialect or "")
    cached = _speech_prep_cache.get(cache_key)
    if cached is not None:
        return cached

    if dialect:
        user_content = f"Target dialect: {dialect}\n\nText:\n{text}"
    else:
        user_content = f"Target dialect: none (keep wording)\n\nText:\n{text}"

    try:
        resp = _http.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": 300,
                "system": SPEECH_PREP_SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": user_content}],
            },
            timeout=15,
        )
        resp.raise_for_status()
        prepared = resp.json()["content"][0]["text"].strip()
    except Exception:
        return text

    if len(_speech_prep_cache) >= _SPEECH_PREP_CACHE_MAX:
        _speech_prep_cache.clear()  # simple reset; entries are cheap to rebuild
    _speech_prep_cache[cache_key] = prepared
    return prepared


# -- Engines -----------------------------------------------------------

async def _edge_synthesize(text: str, voice: str, out_path: str):
    communicate = edge_tts.Communicate(text, voice, rate=EDGE_TTS_RATE)
    await communicate.save(out_path)


def _synth_edge_tts(text: str, language: str, out_path: str):
    voice = EDGE_VOICES.get(language, EDGE_VOICES[DEFAULT_LANGUAGE])
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        # No event loop in this thread (terminal scripts, worker threads).
        asyncio.run(_edge_synthesize(text, voice, out_path))
        return
    # Called from inside a running loop (e.g. a FastAPI startup hook):
    # asyncio.run() would raise, so run the coroutine in its own thread.
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(asyncio.run, _edge_synthesize(text, voice, out_path)).result()


def _synth_elevenlabs(text: str, out_path: str, speed: float = None):
    if not ELEVENLABS_API_KEY or not ELEVENLABS_VOICE_ID:
        raise RuntimeError("ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID not set")
    resp = _http.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}",
        headers={
            "xi-api-key": ELEVENLABS_API_KEY,
            "content-type": "application/json",
        },
        json={
            "text": text,
            "model_id": ELEVENLABS_MODEL,
            "voice_settings": {"speed": speed if speed is not None else ELEVENLABS_SPEED},
        },
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(f"{resp.status_code} {resp.reason}: {resp.text}")
    with open(out_path, "wb") as f:
        f.write(resp.content)


# -- Public API -----------------------------------------------------------

# Finished-audio cache: (text, language, dialect, speed) -> mp3 bytes. Bank
# responses repeat constantly (same balance readout, same confirmation
# wording, cancellations), and a hit turns the whole TTS stage - Claude
# speech prep plus ElevenLabs synthesis - into a single local file write.
# Only primary-engine output is cached: caching a fallback take would keep
# replaying the low-quality voice after the primary engine recovers.
_audio_cache = {}
_AUDIO_CACHE_MAX = 64


def _audio_cache_store(key, out_path: str):
    try:
        with open(out_path, "rb") as f:
            data = f.read()
    except OSError:
        return
    if len(_audio_cache) >= _AUDIO_CACHE_MAX:
        _audio_cache.clear()  # simple reset; entries are cheap to rebuild
    _audio_cache[key] = data


def synthesize_to_file(text: str, language: str = DEFAULT_LANGUAGE, dialect: str = None,
                       speed: float = None) -> str:
    """Generates speech audio for text and returns the path to the mp3 file.
    Caller is responsible for deleting it - speak() does this automatically.
    dialect (Arabic only): the user's detected dialect from nlu.py - the
    response is rephrased into it before synthesis. None keeps the wording
    as written (used for the fixed greeting, spoken before the user has
    said anything to detect a dialect from).
    speed: per-call ElevenLabs speed override (e.g. the slower greeting);
    None uses ELEVENLABS_SPEED."""
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        out_path = tmp.name

    key = (text, language, dialect or "", speed if speed is not None else ELEVENLABS_SPEED)
    cached = _audio_cache.get(key)
    if cached is not None:
        with open(out_path, "wb") as f:
            f.write(cached)
        return out_path

    if language == "ar":
        prepared = _prepare_arabic_speech(text, dialect)
        try:
            _synth_elevenlabs(prepared, out_path, speed)
            _audio_cache_store(key, out_path)
        except Exception as e:
            print(f"ElevenLabs failed ({e}), falling back to edge-tts.")
            _synth_edge_tts(prepared, "ar", out_path)
        return out_path

    _synth_edge_tts(text, language, out_path)
    _audio_cache_store(key, out_path)
    return out_path


def speak(text: str, language: str = DEFAULT_LANGUAGE, dialect: str = None):
    """Synthesizes and plays text out loud, then cleans up the temp file.
    This is what the Action Protocol's response message gets handed to."""
    if not text:
        return

    try:
        from playsound import playsound  # type: ignore
    except Exception:
        print("playsound unavailable; speaking output will not be played.")
        return

    print(f"Speaking ({language}): {text}")
    out_path = synthesize_to_file(text, language, dialect)
    try:
        playsound(out_path)
    finally:
        os.unlink(out_path)


# -- Main: test from terminal --------------------------------------------------

if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")

    args = sys.argv[1:]

    if args:
        language = args[-1] if args[-1] in ("ar", "en") else DEFAULT_LANGUAGE
        text_args = [a for a in args if a not in ("ar", "en")]
        speak(" ".join(text_args), language)
    else:
        test_phrases = [
            ("رصيد حسابك الجاري هو 5230.50 ريال", "ar"),
            ("Sent 500.00 SAR to Ahmed. New balance 4730.50 SAR.", "en"),
            ("فاتورتك التقديرية 220 ريال بناءً على آخر فاتورة. أدفع هذا المبلغ لشركة الكهرباء؟", "ar"),
        ]
        for text, lang in test_phrases:
            speak(text, lang)
