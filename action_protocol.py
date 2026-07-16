"""
Step 3 - Action Protocol

Takes the intent JSON produced by nlu.extract_intent() and actually does
something with it:

  1. If the intent is not executable (clarification / unsupported), it just
     returns a message to speak back.
  2. If requires_confirmation is true, it speaks/prints a confirmation
     prompt worded appropriately for the action, and waits for an explicit
     yes/no before doing anything. Actual biometric authentication (Face ID
     / fingerprint / device PIN) happens inside the user's own bank app,
     not here - this layer's only job is to get clear verbal consent before
     telling the backend to act. confirm_fn is a plug point: today it reads
     from the terminal, later it can be TTS-speak + STT-listen so the whole
     confirmation is voice-driven for users who can't read a screen.
  3. Runs the action against a BankBackend and returns a structured
     success/failure response with a human-readable message in the user's
     language, ready for tts.py to speak.

BankBackend is an interface. MockBankBackend is the only implementation for
now (in-memory fake account data) - a real bank integration would be a
second class implementing the same methods, swapped in without touching
anything above it.
"""

import re
from abc import ABC, abstractmethod
from datetime import date


# -- Backend interface ----------------------------------------------------

class BankBackend(ABC):
    @abstractmethod
    def get_balances(self):
        ...

    @abstractmethod
    def get_transactions(self, from_date=None, to_date=None, count=None):
        ...

    @abstractmethod
    def get_beneficiaries(self):
        ...

    @abstractmethod
    def domestic_payment(self, amount, currency, creditor_id, creditor_name, reference):
        ...

    @abstractmethod
    def freeze_card(self, card_last4=None):
        ...

    @abstractmethod
    def unfreeze_card(self, card_last4=None):
        ...

    @abstractmethod
    def add_beneficiary(self, name, identification):
        ...

    @abstractmethod
    def get_exchange_rate(self, source_currency, target_currency):
        ...

    @abstractmethod
    def to_account_context(self):
        """Return the current state in the same shape nlu.extract_intent expects
        as account_context, so each turn sees up-to-date balances/beneficiaries/etc."""
        ...


class BackendError(Exception):
    """Raised by a BankBackend for any domain-level failure (insufficient
    funds, unknown card, duplicate beneficiary, ...). The string message is
    an error code looked up in ERROR_MESSAGES for bilingual display."""


# -- Mock backend -----------------------------------------------------------

class MockBankBackend(BankBackend):
    def __init__(self):
        self.accounts = [
            {
                "type": "checking",
                "balance": 5230.50,
                "currency": "SAR",
                "last4": "5000",
                "holder_name": "نتولز",
            },
        ]
        # Seed data only - nothing anywhere may branch on a specific name or
        # account number in this list. All lookup goes through
        # resolve_beneficiary() against whatever this list currently holds.
        self.beneficiaries = [
            {"name": "أحمد الشمري", "relation": "أخي", "account_number": "SA4420000001234567891234", "bank": "بنك تجريبي"},
            {"name": "لمى الرشيدي", "relation": None, "account_number": "SA0380000000608010167519", "bank": "مصرف الراجحي"},
            {"name": "محمد القحطاني", "relation": None, "account_number": "SA6210000024567789123456", "bank": "البنك الأهلي"},
            {"name": "حلا المصري", "relation": "أختي", "account_number": "SA7130400108056056710038", "bank": "بنك الرياض"},
            {"name": "لينا الغامدي", "relation": None, "account_number": "SA2560100000789012345678", "bank": "بنك تجريبي"},
            {"name": "أرين الهديان", "relation": None, "account_number": "SA9045000000012345678901", "bank": "البنك السعودي الأول"},
            {"name": "عمر الحربي", "relation": None, "account_number": "SA1850000000987654321098", "bank": "بنك البلاد"},
        ]
        self.cards = [
            {"type": "debit", "last4": "4521", "status": "active"},
        ]
        self.billers = [
            {"name": "SEC", "type": "electricity", "account_number": "998877", "last_bill_amount": 220},
        ]
        self.transactions = [
            {"date": "2026-06-28", "description": "Panda Hypermarket", "amount": -145.50},
            {"date": "2026-06-25", "description": "Salary", "amount": 8500.00},
            {"date": "2026-06-20", "description": "STC Bill", "amount": -120.00},
            {"date": "2026-06-15", "description": "Transfer to Ahmed", "amount": -300.00},
        ]
        self.exchange_rates = {"USD": 3.75, "EUR": 4.05, "GBP": 4.72, "AED": 1.02}

    def get_balances(self):
        return self.accounts

    def get_transactions(self, from_date=None, to_date=None, count=None):
        txns = self.transactions
        if from_date:
            txns = [t for t in txns if t["date"] >= from_date]
        if to_date:
            txns = [t for t in txns if t["date"] <= to_date]
        if count:
            txns = txns[:count]
        return txns

    def get_beneficiaries(self):
        return self.beneficiaries

    def domestic_payment(self, amount, currency, creditor_id, creditor_name, reference):
        amount = float(amount)
        if amount <= 0:
            raise BackendError("invalid_amount")
        account = self.accounts[0]
        if amount > account["balance"]:
            raise BackendError("insufficient_funds")

        account["balance"] -= amount
        self.transactions.insert(0, {
            "date": date.today().isoformat(),
            "description": reference or creditor_name,
            "amount": -amount,
        })
        return {
            "new_balance": account["balance"],
            "creditor_name": creditor_name,
            "amount": amount,
            "currency": currency,
        }

    def freeze_card(self, card_last4=None):
        card = self._resolve_card(card_last4)
        card["status"] = "frozen"
        return {"last4": card["last4"]}

    def unfreeze_card(self, card_last4=None):
        card = self._resolve_card(card_last4)
        card["status"] = "active"
        return {"last4": card["last4"]}

    def _resolve_card(self, card_last4):
        if card_last4:
            for card in self.cards:
                if card["last4"] == card_last4:
                    return card
            raise BackendError("unknown_card")
        if len(self.cards) == 1:
            return self.cards[0]
        raise BackendError("ambiguous_card")

    def add_beneficiary(self, name, identification):
        if not identification:
            raise BackendError("missing_identification")
        if any(b["account_number"] == identification for b in self.beneficiaries):
            raise BackendError("duplicate_beneficiary")
        beneficiary = {"name": name, "relation": None, "account_number": identification}
        self.beneficiaries.append(beneficiary)
        return beneficiary

    def get_exchange_rate(self, source_currency, target_currency):
        source_currency = (source_currency or "").upper()
        if source_currency not in self.exchange_rates:
            raise BackendError("unknown_currency")
        if (target_currency or "SAR").upper() != "SAR":
            raise BackendError("unsupported_target_currency")
        return {
            "source_currency": source_currency,
            "target_currency": "SAR",
            "rate": self.exchange_rates[source_currency],
        }

    def to_account_context(self):
        return {
            "beneficiaries": self.beneficiaries,
            "cards": self.cards,
            "billers": self.billers,
            "accounts": self.accounts,
        }


# -- Beneficiary resolution -----------------------------------------------------
#
# Generic name matching against whatever beneficiary list the backend holds
# right now. No name, amount, or account number is special-cased anywhere -
# the same normalization and scoring applies to every record.

_ARABIC_NOISE = re.compile(r"[ً-ْٰـ]")  # tashkeel + tatweel


def _normalize_name(text) -> str:
    text = _ARABIC_NOISE.sub("", str(text or ""))
    text = re.sub("[إأآٱ]", "ا", text)
    text = text.replace("ة", "ه").replace("ى", "ي").replace("ؤ", "و").replace("ئ", "ي")
    return re.sub(r"\s+", " ", text).strip().lower()


def resolve_beneficiary(beneficiaries: list, name=None, identification=None):
    """
    Resolves a spoken/typed creditor reference against the CURRENT
    beneficiary list. Returns (match, candidates):
      - (record, [record])       exactly one match
      - (None, [r1, r2, ...])    ambiguous - caller should ask which one
      - (None, [])               nothing matched - caller should clarify/fail
    Identification (account number) wins outright when it matches; otherwise
    names are compared after Arabic normalization (tashkeel stripped, hamza
    forms unified) using exact > substring > shared-token scoring, with the
    stored relation ("أخي", ...) as a last resort.
    """
    if identification:
        ident = re.sub(r"\s", "", str(identification))
        if ident:
            for b in beneficiaries:
                if re.sub(r"\s", "", b.get("account_number") or "") == ident:
                    return b, [b]

    target = _normalize_name(name)
    if not target:
        return None, []
    target_tokens = set(target.split())

    scored = []
    for b in beneficiaries:
        full = _normalize_name(b.get("name"))
        relation = _normalize_name(b.get("relation"))
        tokens = set(full.split())
        if full == target:
            score = 100
        elif target in full or full in target:
            score = 80
        elif target_tokens & tokens:
            score = 50 + 10 * len(target_tokens & tokens)
        elif relation and (relation == target or relation in target or target in relation):
            score = 40
        else:
            continue
        scored.append((score, b))

    if not scored:
        return None, []
    best = max(s for s, _ in scored)
    candidates = [b for s, b in scored if s == best]
    if len(candidates) == 1:
        return candidates[0], candidates
    return None, candidates


# -- Confirmation wording -----------------------------------------------------

def _currency_word(currency, lang: str) -> str:
    """Arabic copy must not mix in English tokens - say "ريال" instead of
    "SAR". Non-SAR codes pass through (no Arabic name on file for them)."""
    if lang == "ar" and (currency or "SAR").upper() == "SAR":
        return "ريال"
    return currency


def build_confirmation_message(intent: dict) -> str:
    """Builds the prompt spoken/printed before a money-moving or account-
    changing action executes. domesticPayment is worded differently for
    amount_source == "inferred" (an estimate, must be flagged as such)
    vs "stated" (the user said the number themselves)."""
    action = intent["action"]
    params = intent.get("params", {})
    lang = intent.get("response_language", "ar")

    if action == "domesticPayment":
        amount = params["InstructedAmount"]["Amount"]
        currency = _currency_word(params["InstructedAmount"]["Currency"], lang)
        name = params["CreditorAccount"]["Name"]
        inferred = params.get("amount_source") == "inferred"
        if lang == "ar":
            if inferred:
                return f"فاتورتك التقديرية {amount} {currency} بناءً على آخر فاتورة. أدفع هذا المبلغ لـ {name}؟"
            return f"تحويل {amount} {currency} إلى {name}. تأكيد؟"
        if inferred:
            return f"Your estimated bill is {amount} {currency} based on your last bill, for {name}. Pay that amount?"
        return f"Transfer {amount} {currency} to {name}. Confirm?"

    if action == "freezeCard":
        last4 = params.get("cardLast4") or ("بطاقتك" if lang == "ar" else "your card")
        return f"تجميد البطاقة المنتهية بـ {last4}. تأكيد؟" if lang == "ar" else f"Freeze the card ending in {last4}. Confirm?"

    if action == "unfreezeCard":
        last4 = params.get("cardLast4") or ("بطاقتك" if lang == "ar" else "your card")
        return f"إلغاء تجميد البطاقة المنتهية بـ {last4}. تأكيد؟" if lang == "ar" else f"Unfreeze the card ending in {last4}. Confirm?"

    if action == "addBeneficiary":
        name = params.get("Name")
        ident = params.get("Identification") or ("غير محدد" if lang == "ar" else "not provided")
        return f"إضافة {name} كمستفيد جديد برقم حساب {ident}. تأكيد؟" if lang == "ar" else f"Add {name} as a new beneficiary with account {ident}. Confirm?"

    return "تأكيد؟" if lang == "ar" else "Confirm?"


AFFIRMATIVE = {"yes", "y", "yeah", "yep", "sure", "confirm", "نعم", "ايوه", "أيوه", "اي", "إي", "أكد", "تمام", "اكيد", "أكيد"}
NEGATIVE = {"no", "n", "nope", "cancel", "لا", "لأ", "كلا", "الغاء", "إلغاء"}


def terminal_confirm(intent: dict) -> bool:
    """Default confirm_fn: prints the prompt and reads yes/no from the
    terminal. Swap this for a TTS+STT version once tts.py exists."""
    prompt = build_confirmation_message(intent)
    print("\n[CONFIRMATION NEEDED]")
    print(prompt)
    while True:
        answer = input("> ").strip().lower()
        if answer in AFFIRMATIVE:
            return True
        if answer in NEGATIVE:
            return False
        print("Please answer yes/no (نعم / لا).")


# -- Error messages -----------------------------------------------------------

ERROR_MESSAGES = {
    "invalid_amount":              {"ar": "المبلغ غير صالح.",                                          "en": "That amount isn't valid."},
    "insufficient_funds":          {"ar": "الرصيد غير كافٍ لإتمام هذه العملية.",                          "en": "Insufficient balance to complete this transfer."},
    "unknown_card":                {"ar": "لم يتم العثور على بطاقة بهذا الرقم.",                          "en": "No card found with that number."},
    "ambiguous_card":              {"ar": "لديك أكثر من بطاقة، حدد آخر أربعة أرقام من البطاقة.",           "en": "You have more than one card — please specify the last 4 digits."},
    "missing_identification":      {"ar": "رقم الحساب أو الآيبان مطلوب لإضافة مستفيد.",                    "en": "An account number or IBAN is required to add a beneficiary."},
    "duplicate_beneficiary":       {"ar": "هذا المستفيد مضاف بالفعل.",                                    "en": "This beneficiary is already on file."},
    "unknown_currency":            {"ar": "هذه العملة غير مدعومة.",                                       "en": "That currency isn't supported."},
    "unknown_beneficiary":         {"ar": "لا يوجد مستفيد بهذا الاسم في قائمة المستفيدين لديك.",             "en": "There is no beneficiary by that name on your list."},
    "ambiguous_beneficiary":       {"ar": "يوجد أكثر من مستفيد مطابق، حدد الاسم الكامل.",                    "en": "More than one beneficiary matches - please say the full name."},
    "unsupported_target_currency": {"ar": "التحويل مدعوم فقط مقابل الريال السعودي.",                       "en": "Exchange rates are only available against SAR."},
    "unsupported_action":          {"ar": "هذا الإجراء غير مدعوم.",                                       "en": "This action isn't supported."},
}


def _failure(code: str, lang: str) -> dict:
    text = ERROR_MESSAGES.get(code, ERROR_MESSAGES["unsupported_action"])[lang]
    return {"success": False, "action_completed": False, "message": text, "error": code}


def _success(message: str, data: dict) -> dict:
    return {"success": True, "action_completed": True, "message": message, "data": data}


# -- Read-only formatting -----------------------------------------------------

ACCOUNT_TYPE_AR = {"checking": "الجاري", "savings": "التوفير"}


def _format_balances(accounts: list, lang: str) -> str:
    parts = []
    for a in accounts:
        if lang == "ar":
            account_type = ACCOUNT_TYPE_AR.get(a["type"], a["type"])
            parts.append(f"رصيد حسابك {account_type} هو {a['balance']:.2f} ريال")
        else:
            parts.append(f"Your {a['type']} account balance is {a['balance']:.2f} {a.get('currency', 'SAR')}")
    return ("، ".join(parts) if lang == "ar" else ". ".join(parts)) or ("لا توجد حسابات." if lang == "ar" else "No accounts found.")


def _format_transactions(txns: list, lang: str) -> str:
    if not txns:
        return "لا توجد عمليات." if lang == "ar" else "No transactions found."
    lines = []
    for t in txns[:5]:
        sign = "+" if t["amount"] >= 0 else ""
        lines.append(f"{t['date']}: {t['description']} {sign}{t['amount']:.2f}")
    return "، ".join(lines) if lang == "ar" else "; ".join(lines)


def _format_beneficiaries(beneficiaries: list, lang: str) -> str:
    if not beneficiaries:
        return "لا يوجد مستفيدون مسجلون." if lang == "ar" else "No beneficiaries on file."
    names = [b["name"] for b in beneficiaries]
    return "، ".join(names) if lang == "ar" else ", ".join(names)


# -- Action execution -----------------------------------------------------

def execute_action(intent: dict, backend: BankBackend) -> dict:
    action = intent["action"]
    params = intent.get("params", {})
    lang = intent.get("response_language", "ar")

    try:
        if action == "getBalances":
            accounts = backend.get_balances()
            return _success(_format_balances(accounts, lang), {"accounts": accounts})

        if action == "getTransactions":
            txns = backend.get_transactions(
                from_date=params.get("fromBookingDateTime"),
                to_date=params.get("toBookingDateTime"),
                count=params.get("count"),
            )
            return _success(_format_transactions(txns, lang), {"transactions": txns})

        if action == "getBeneficiaries":
            beneficiaries = backend.get_beneficiaries()
            return _success(_format_beneficiaries(beneficiaries, lang), {"beneficiaries": beneficiaries})

        if action == "domesticPayment":
            amt = params["InstructedAmount"]
            creditor = params["CreditorAccount"]
            # Hard rule: money only ever moves to a record on the CURRENT
            # beneficiary or biller list, resolved generically by account
            # number or normalized name - never to whatever free text the
            # NLU produced. (A bill payment is a domesticPayment whose
            # creditor is a biller, so billers are legitimate payees here.)
            context = backend.to_account_context()
            payees = list(context.get("beneficiaries") or []) + list(context.get("billers") or [])
            match, candidates = resolve_beneficiary(
                payees,
                name=creditor.get("Name"),
                identification=creditor.get("Identification"),
            )
            if match is None:
                return _failure("ambiguous_beneficiary" if candidates else "unknown_beneficiary", lang)
            result = backend.domestic_payment(
                amount=amt["Amount"],
                currency=amt["Currency"],
                creditor_id=match["account_number"],
                creditor_name=match["name"],
                reference=params.get("Reference"),
            )
            msg = (
                f"تم تحويل {result['amount']:.2f} {_currency_word(result['currency'], lang)} إلى {result['creditor_name']}. الرصيد الجديد {result['new_balance']:.2f} ريال."
                if lang == "ar" else
                f"Sent {result['amount']:.2f} {result['currency']} to {result['creditor_name']}. New balance {result['new_balance']:.2f} SAR."
            )
            return _success(msg, result)

        if action == "freezeCard":
            result = backend.freeze_card(params.get("cardLast4"))
            msg = f"تم تجميد البطاقة المنتهية بـ {result['last4']}." if lang == "ar" else f"Card ending in {result['last4']} is now frozen."
            return _success(msg, result)

        if action == "unfreezeCard":
            result = backend.unfreeze_card(params.get("cardLast4"))
            msg = f"تم إلغاء تجميد البطاقة المنتهية بـ {result['last4']}." if lang == "ar" else f"Card ending in {result['last4']} is now active."
            return _success(msg, result)

        if action == "addBeneficiary":
            result = backend.add_beneficiary(params.get("Name"), params.get("Identification"))
            msg = f"تمت إضافة {result['name']} كمستفيد جديد." if lang == "ar" else f"Added {result['name']} as a new beneficiary."
            return _success(msg, result)

        if action == "getExchangeRate":
            result = backend.get_exchange_rate(params.get("SourceCurrency"), params.get("TargetCurrency"))
            msg = (
                f"سعر صرف {result['source_currency']} اليوم هو {result['rate']} ريال."
                if lang == "ar" else
                f"Today's {result['source_currency']} exchange rate is {result['rate']} SAR."
            )
            return _success(msg, result)

        return _failure("unsupported_action", lang)

    except BackendError as e:
        return _failure(str(e), lang)


# -- Main entry point (called by orchestration layer) --------------------------

def process_intent(intent: dict, backend: BankBackend, confirm_fn=terminal_confirm) -> dict:
    """
    Main function. Takes the JSON from nlu.extract_intent() and a
    BankBackend, and returns a structured response ready for tts.py:
        {"success": bool, "action_completed": bool, "message": str, ...}

    confirm_fn(intent) -> bool is called for any action with
    requires_confirmation == True, BEFORE the backend is touched. Replace it
    with a voice-driven version later without changing anything else here.
    """
    action = intent.get("action")
    lang = intent.get("response_language", "ar")

    if action == "clarification":
        msg = intent.get("clarification_question") or ("ممكن توضح؟" if lang == "ar" else "Could you clarify?")
        return {"success": False, "action_completed": False, "needs_clarification": True, "message": msg}

    if action == "unsupported":
        msg = "عذرًا، هذا خارج نطاق ما أقدر أساعدك فيه." if lang == "ar" else "Sorry, that's outside what I can help with."
        return {"success": False, "action_completed": False, "message": msg}

    if action == "thanks":
        # Social close - the single template gets rephrased into the user's
        # dialect by the TTS speech-prep step like every other response.
        msg = "العفو! موجود دايم إذا احتجت أي شي." if lang == "ar" else "Anytime, always here to help."
        return {"success": True, "action_completed": True, "message": msg, "data": {}}

    if intent.get("requires_confirmation"):
        if not confirm_fn(intent):
            msg = "تم الإلغاء." if lang == "ar" else "Cancelled."
            return {"success": False, "action_completed": False, "cancelled": True, "message": msg}

    return execute_action(intent, backend)


# -- Main: test from terminal --------------------------------------------------

if __name__ == "__main__":
    import sys
    from nlu import extract_intent

    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")

    use_voice = "--voice" in sys.argv
    backend = MockBankBackend()

    print("Action Protocol - terminal test loop.")
    print("Type 'quit' to exit." if not use_voice else "Speak, or say 'quit' to exit.")

    if use_voice:
        import stt

    while True:
        if use_voice:
            audio = stt.record_until_silence()
            stt_result = stt.transcribe(audio)
            transcript = stt_result["text"]
            language = stt_result["language"]
            print(f"You said: {transcript}")
        else:
            transcript = input("\nYou: ").strip()
            language = "ar"

        if not transcript:
            continue
        if transcript.strip().lower() in ("quit", "exit", "خروج"):
            break

        intent = extract_intent(transcript, language=language, account_context=backend.to_account_context())
        print(f"[intent] action={intent['action']} confidence={intent.get('confidence')} requires_confirmation={intent.get('requires_confirmation')}")

        response = process_intent(intent, backend)
        print(f"\nBank: {response['message']}")
