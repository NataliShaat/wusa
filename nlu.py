"""
Step 2 - Natural Language Understanding (NLU)

Primary   : Claude API (Anthropic) - fast, reliable, works anywhere, deploys cleanly
Local demo: ALLaM (SDAIA) running LOCALLY via Ollama (quantized GGUF) - opt-in only,
            used to prove the "Saudi AI stack" story live during the pitch.
            NOT used in the deployed app - see notes below.

WHY CLAUDE IS PRIMARY (not ALLaM):
1. humain-ai/ALLaM-7B-Instruct-preview isn't deployed by any HF Inference Provider,
   so there's no hosted API for it - only raw weights.
2. HUMAIN doesn't currently offer a public self-serve developer API.
3. Running ALLaM yourself needs either a GPU or a heavily quantized CPU build
   (Ollama), neither of which is stable to deploy behind a public link.
So: Claude API runs the deployed app. ALLaM/Ollama stays local and optional -
flip it on with --local to demo it running live on your laptop.

ACTION NAMING - WHY IT LOOKS LIKE THIS:
SAMA's own Open Banking API spec is gated behind SAMA registration/approval -
it is not publicly readable, so this file cannot claim to match it exactly.
What IS public and verifiable: SAMA's Open Banking Lab was built starting from
the UK Open Banking Standard, and its Payment Initiation Service is aligned
with ISO 20022 message elements. So the actions below are split into two
honest categories:

  STANDARD actions - these map to real, regulated Open Banking scope
  (Account Information Services / Payment Initiation Services) and use the
  real UK Open Banking / ISO 20022 resource and field naming:
    getBalances, getTransactions, getBeneficiaries, domesticPayment

  CUSTOM actions - these are genuinely NOT part of any Open Banking standard
  anywhere (no regulator standardizes card freezing or beneficiary creation
  via API) - every bank does these differently through its own proprietary
  APIs, so these stay as clearly-labeled bank-specific extensions:
    freezeCard, unfreezeCard, addBeneficiary, getExchangeRate

This distinction is worth keeping in the pitch: it shows the design respects
the real regulatory boundary instead of pretending everything is "standard."


"""

import os
import json
import re
import requests

# -- Config -------------------------------------------------------------------

ANTHROPIC_KEY   = os.getenv("ANTHROPIC_API_KEY", "")
# Haiku 4.5: intent extraction is a constrained classification task, and it
# runs on every single voice turn, so per-turn latency matters more than raw
# model size here. Profiled 2026-07-16: claude-sonnet-4-6 took 3.1-4.6s per
# NLU call; Haiku cuts that substantially. Flip back to "claude-sonnet-4-6"
# if intent accuracy on dialectal Arabic ever regresses.
ANTHROPIC_MODEL = "claude-haiku-4-5"

# One shared HTTP session so repeated Claude calls reuse the TLS connection
# instead of paying a full handshake on every turn. Retries cover stale
# keep-alive connections (RemoteDisconnected on reuse) so a dropped socket
# degrades to a short retry instead of a failed turn.
_http = requests.Session()
_retry = requests.adapters.Retry(
    total=2, connect=2, read=2, backoff_factor=0.2,
    allowed_methods=None,  # retry POST too - intent extraction is safe to reissue
)
_http.mount("https://", requests.adapters.HTTPAdapter(max_retries=_retry))

OLLAMA_URL   = "http://localhost:11434/api/chat"
# Q2_K = fits on 8GB RAM laptops. If you have 16GB+ RAM, use instead:
# "hf.co/Omartificial-Intelligence-Space/ALLaM-7B-Instruct-preview-Q4_K_M-GGUF"
OLLAMA_MODEL = "hf.co/tensorblock/ALLaM-7B-Instruct-preview-GGUF:Q2_K"

# -- Supported actions ----------------------------------------------------------
#
# STANDARD = real UK Open Banking / ISO 20022 resource and field naming
#            (what SAMA's framework was built starting from - AIS + PIS scope).
# CUSTOM   = bank-specific extensions with no existing open standard anywhere.
#            Your Action Protocol still defines these, but they are not a
#            claim of Open Banking conformance.

STANDARD_ACTIONS = [
    "getBalances",        # no params - resolved via the account in context
    "getTransactions",    # params: fromBookingDateTime, toBookingDateTime, count (all optional)
    "getBeneficiaries",   # no params
    "domesticPayment",    # params: InstructedAmount {Amount, Currency}, CreditorAccount {Identification, Name}, Reference
                           # used for BOTH transfers and bill payments - a bill payment is just a
                           # domesticPayment where CreditorAccount is the biller's account
]

CUSTOM_ACTIONS = [
    "freezeCard",          # params: cardLast4 (optional if only one card on file)
    "unfreezeCard",        # params: cardLast4 (optional if only one card on file)
    "addBeneficiary",      # params: Name, Identification (account number / IBAN)
    "getExchangeRate",     # params: SourceCurrency, TargetCurrency
]

CONTROL_ACTIONS = [
    "clarification",       # used when intent is unclear - see clarification_question
    "unsupported",         # used when request is out of scope (e.g. "what's the weather")
    "thanks",              # user expressed gratitude or signaled they are done
]

ACTIONS = STANDARD_ACTIONS + CUSTOM_ACTIONS + CONTROL_ACTIONS


# Actions that move money or change account state - these must always be
# confirmed by the user before execution. This is a hard rule enforced in
# the output, not a suggestion the model can skip.
CONFIRMATION_REQUIRED_ACTIONS = {"domesticPayment", "freezeCard", "unfreezeCard", "addBeneficiary"}


BASE_SYSTEM_PROMPT = """You are the Natural Language Understanding (NLU) engine for a Saudi voice banking app.
Your job: convert the user's speech (Arabic or English, possibly imperfect speech-to-text output)
into JSON ONLY, no explanation, in exactly this shape:

{
  "action": "<one of: getBalances, getTransactions, getBeneficiaries, domesticPayment, freezeCard, unfreezeCard, addBeneficiary, getExchangeRate, clarification, unsupported, thanks>",
  "params": { },
  "confidence": <float 0-1>,
  "clarification_question": "<null, or a short question in the SAME language AND dialect as the user's input>",
  "response_language": "<ar or en>",
  "dialect": "<null for English; for Arabic, the dialect the user is speaking, e.g. "Saudi/Gulf", "Egyptian", "Levantine", "Iraqi", "Maghrebi", "MSA">"
}

CLASSIFY BY MEANING, NOT BY WORDING:
Users phrase the same intent in countless ways, across every Arabic dialect,
and the speech-to-text step often garbles words. Never require a specific
phrase or keyword - resolve whatever paraphrase, dialect, or slightly
misheard rendering the user produces to the action it means. Examples of
paraphrases that all map to the SAME action:
- getBalances: "كم رصيدي؟" / "كم في بحسابي؟" / "ابي اشوف رصيدي" / "بكم حسابي" / "معايا كام في الحساب؟" / "قديش صار معي؟" / "وش باقي عندي" / "how much do I have?"
- getTransactions: "وش آخر العمليات؟" / "ورني حركات حسابي" / "على ايه صرفت الشهر ده؟" / "شو المصاريف الأخيرة؟" / "what did I spend lately?"
- domesticPayment: "حول مية ريال لأخوي" / "ابعت لأحمد ٥٠٠" / "ادفع فاتورة الكهرباء" / "سدد فاتورتي" / "طيرلي ٢٠٠ لمحمد" / "send my brother 100"
- freezeCard: "جمد بطاقتي" / "وقف البطاقة" / "اقفل الكرت حقي" / "عطل بطاقتي مؤقتا" / "block my card"
- thanks: "شكرا" / "يعطيك العافية" / "مشكور" / "تسلم" / "خلاص بس" / "هذا كل شي" / "بس كذا" / "متشكر اوي" / "thanks, that's it"
  Use thanks (params = {}) whenever the user is expressing gratitude or signaling
  the conversation is over, with no new banking request attached.
- getExchangeRate: "كم سعر الدولار؟" / "بكم اليورو اليوم؟" / "الدولار وصل كام؟" / "what's the dollar at?"
The same principle applies to every action, including the ones not listed
here - these are illustrations of variety, not templates to match against.

DIALECT: detect which Arabic dialect the user is speaking from their wording
(Saudi/Gulf, Egyptian, Levantine, Iraqi, Maghrebi, MSA, ...) and report it in
the "dialect" field. Write clarification_question naturally in that same
dialect - never answer a Gulf speaker in Egyptian or force MSA on anyone.

Action reference (params to use for each action):
- getBalances: params = {} (empty - resolved from the account context)
- getTransactions: params = {"fromBookingDateTime": <ISO date or null>, "toBookingDateTime": <ISO date or null>, "count": <int or null>}
- getBeneficiaries: params = {} (empty)
- domesticPayment: params = {"InstructedAmount": {"Amount": <string number>, "Currency": "SAR"}, "CreditorAccount": {"Identification": <account number/IBAN>, "Name": <recipient or biller name>}, "Reference": <string or null>, "amount_source": "<stated or inferred>"}
  Use domesticPayment for BOTH money transfers to a person AND bill payments to a biller -
  a bill payment is simply a domesticPayment whose CreditorAccount is the biller's account.
  amount_source MUST be "stated" if the user spoke the amount themselves, or "inferred" if
  you filled it in from account context (e.g. a biller's last_bill_amount) because the user
  did not state a number. This distinction matters: an inferred amount is an estimate, not
  a confirmed instruction, and must be presented to the user as such before anything executes.
- freezeCard / unfreezeCard: params = {"cardLast4": <string or null>}
- addBeneficiary: params = {"Name": <string>, "Identification": <account number/IBAN or null>}
- getExchangeRate: params = {"SourceCurrency": <3-letter code>, "TargetCurrency": "SAR"}

Rules:
- Extract amounts as plain numeric strings (no currency words) into InstructedAmount.Amount.
- You will sometimes be given the user's ACCOUNT CONTEXT (beneficiaries, cards, billers,
  balances already on file). ALWAYS check this data first before asking a clarifying
  question. For example: if the user says "my brother" or "my electricity bill" and
  the account context has exactly one matching beneficiary or biller, resolve it
  directly and fill CreditorAccount.Identification / CreditorAccount.Name from that
  record - do not ask the user to repeat information that is already on file.
- Only use action="clarification" when the request is genuinely ambiguous or missing
  information that is NOT resolvable from the account context (e.g. multiple beneficiaries
  match, or nothing on file, or the transfer amount was never stated AND no relevant
  history exists to estimate from).
- If the request is out of scope for banking, use action="unsupported".
- Return JSON only, no text before or after it, no Markdown fences.
"""


def _build_system_prompt(account_context: dict = None) -> str:
    if not account_context:
        return BASE_SYSTEM_PROMPT
    context_json = json.dumps(account_context, ensure_ascii=False)
    return (
        BASE_SYSTEM_PROMPT
        + "\n\nACCOUNT CONTEXT (use this to resolve references before asking questions):\n"
        + context_json
    )


def _extract_json(text: str) -> dict:
    """Claude/Ollama sometimes wrap JSON in code fences or add stray text - strip that."""
    text = text.strip()
    text = re.sub(r"^```(json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("No JSON object found in model output: " + text[:200])
    return json.loads(match.group(0))


def _default_clarification(language: str) -> dict:
    return {
        "action": "clarification",
        "params": {},
        "confidence": 0.0,
        "clarification_question": (
            "ممكن تعيد؟" if language == "ar" else "Sorry, I didn't understand. Could you repeat?"
        ),
        "response_language": language,
        "dialect": None,
        "requires_confirmation": False,
    }


def _enforce_confirmation_flag(result: dict) -> dict:
    """
    Hard rule, enforced here rather than trusted to the model: any action that
    moves money or changes account state must be flagged for confirmation
    before execution. This runs on every result regardless of which model
    produced it, so a prompt-following slip never lets an unconfirmed payment
    or card action through silently.
    """
    action = result.get("action")
    result["requires_confirmation"] = action in CONFIRMATION_REQUIRED_ACTIONS

    if action == "domesticPayment":
        params = result.get("params", {})
        # If the model forgot to set amount_source, default to the safer
        # assumption ("inferred") rather than silently treating it as
        # user-stated - this only affects how the confirmation is worded,
        # never whether confirmation happens.
        params.setdefault("amount_source", "inferred")
        result["params"] = params

    return result


# -- Primary: Claude API -------------------------------------------------------

def extract_intent_claude(transcript: str, account_context: dict = None) -> dict:
    if not ANTHROPIC_KEY:
        raise ValueError("ANTHROPIC_API_KEY not set")

    system_prompt = _build_system_prompt(account_context)

    resp = _http.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": ANTHROPIC_MODEL,
            "max_tokens": 500,
            "system": system_prompt,
            "messages": [{"role": "user", "content": transcript}],
        },
        timeout=30,
    )
    resp.raise_for_status()
    content = resp.json()["content"][0]["text"]
    result = _extract_json(content)
    result.setdefault("params", {})
    result.setdefault("clarification_question", None)
    result.setdefault("confidence", 0.8)
    result.setdefault("dialect", None)
    result = _enforce_confirmation_flag(result)
    return result


# -- Local demo only: ALLaM via Ollama -----------------------------------------

def extract_intent_allam(transcript: str, account_context: dict = None, timeout: int = 60) -> dict:
    system_prompt = _build_system_prompt(account_context)

    resp = requests.post(
        OLLAMA_URL,
        json={
            "model": OLLAMA_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": transcript},
            ],
            "stream": False,
            "format": "json",     # ask Ollama to constrain output to valid JSON
            "options": {"temperature": 0.1},
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    content = resp.json()["message"]["content"]
    result = _extract_json(content)
    result.setdefault("params", {})
    result.setdefault("clarification_question", None)
    result.setdefault("confidence", 0.8)
    result.setdefault("dialect", None)
    result = _enforce_confirmation_flag(result)
    return result


# -- Main entry point (called by orchestration layer) --------------------------

def extract_intent(
    transcript: str,
    language: str = "ar",
    account_context: dict = None,
    use_local: bool = False,
) -> dict:
    """
    Main function.

    Args:
        transcript:      text from stt.py
        language:        detected language from stt.py ("ar" or "en")
        account_context: dict with the user's known account data, e.g.:
                          {
                            "beneficiaries": [
                              {"name": "Ahmed", "relation": "brother", "account_number": "SA1234567890"}
                            ],
                            "cards": [
                              {"type": "debit", "last4": "4521", "status": "active"}
                            ],
                            "billers": [
                              {"name": "SEC", "type": "electricity",
                               "account_number": "998877", "last_bill_amount": 220}
                            ],
                            "accounts": [
                              {"type": "checking", "balance": 5230.50}
                            ]
                          }
                          Pass whatever subset is available - the model uses it
                          to resolve references instead of asking questions.
        use_local:       if True, try ALLaM via local Ollama first (for live demo),
                          falling back to Claude if Ollama isn't running.
                          If False (default), use Claude directly - this is what
                          the deployed app should use.

    Returns:
        intent dict with action, params, confidence, clarification_question
    """
    print("Extracting intent from: '" + transcript + "'")

    if use_local:
        try:
            result = extract_intent_allam(transcript, account_context=account_context)
            result["_model"] = "ALLaM (local via Ollama)"
            return result
        except requests.exceptions.ConnectionError:
            print("Ollama isn't running (or ALLaM model not pulled). Falling back to Claude...")
        except Exception as e:
            print("ALLaM failed (" + str(e) + "), falling back to Claude...")

    try:
        result = extract_intent_claude(transcript, account_context=account_context)
        result["_model"] = "Claude"
        return result
    except Exception as e:
        print("Claude failed (" + str(e) + "). Returning clarification.")
        result = _default_clarification(language)
        result["_model"] = "none (failed)"
        return result


# -- Main: test from terminal --------------------------------------------------

if __name__ == "__main__":
    import sys

    # A mock account context to show the "smarter" resolution in action.
    # In the real app this comes from your bank's Action Protocol / accounts API.
    MOCK_ACCOUNT_CONTEXT = {
        "beneficiaries": [
            {"name": "Ahmed", "relation": "brother", "account_number": "SA1234567890"},
            {"name": "محمد", "relation": "friend", "account_number": "SA9988776655"},
        ],
        "cards": [
            {"type": "debit", "last4": "4521", "status": "active"},
        ],
        "billers": [
            {"name": "SEC", "type": "electricity", "account_number": "998877", "last_bill_amount": 220},
        ],
        "accounts": [
            {"type": "checking", "balance": 5230.50},
        ],
    }

    test_phrases = [
        "حول مية ريال لأخوي",
        "ابي اشوف رصيدي",
        "I want to pay my electricity bill",
        "جمّد بطاقتي الحين",
        "كم سعر الدولار اليوم؟",
        "transfer 500 riyals to my friend Ahmed",
        "ابي اضيف مستفيد جديد اسمه محمد",
    ]

    # testy test
    #   python nlu.py                        
    #   python nlu.py --local              
    #   python nlu.py --no-context           
    #   python nlu.py حول مية ريال لأخوي     
    args = sys.argv[1:]
    use_local = "--local" in args
    no_context = "--no-context" in args
    args = [a for a in args if a not in ("--local", "--no-context")]

    phrases = [" ".join(args)] if args else test_phrases
    context = None if no_context else MOCK_ACCOUNT_CONTEXT

    for phrase in phrases:
        print("\n" + "-" * 50)
        result = extract_intent(phrase, account_context=context, use_local=use_local)
        print("Input      : " + phrase)
        print("Model      : " + str(result.get("_model", "unknown")))
        print("Action     : " + str(result["action"]))
        print("Params     : " + json.dumps(result["params"], ensure_ascii=False))
        print("Confirm?   : " + str(result.get("requires_confirmation")))
        print("Clarify    : " + str(result.get("clarification_question") or "None"))
        print("Confidence : " + str(result["confidence"]))