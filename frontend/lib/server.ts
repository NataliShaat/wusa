// Serverless port of the Python backend (stt.py / nlu.py / action_protocol.py /
// tts.py) that runs inside Next.js API routes on Vercel.
//
// STATELESS BY DESIGN: Vercel runs each request on whichever serverless
// instance is available - module-level session stores silently lose state
// between calls (the classic "unknown session_id" failure). So no state
// lives here: the client sends its account_state (and any pending intent)
// with every request, and every response returns the updated state. Audio
// is returned as inline data: URLs instead of server-held tokens for the
// same reason.
//
// The Python FastAPI backend remains the richer local option (real Whisper
// STT); the frontend picks it via NEXT_PUBLIC_API_BASE_URL. This port keeps
// the same wire contract so both backends are interchangeable.

import type { AccountState, ScreenState, SessionResponse, TurnResponse } from "./types";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
// Haiku: intent extraction and speech prep are per-turn latency-critical
// classification/transform tasks - same model choice as the Python backend.
const ANTHROPIC_MODEL = "claude-haiku-4-5";
const OPENAI_KEY = process.env.OPENAI_API_KEY?.trim() ?? "";
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY?.trim() ?? "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID?.trim() ?? "LE1b8WpPSScCUklGPKzg";
const ELEVENLABS_MODEL = "eleven_multilingual_v2";
const ELEVENLABS_SPEED = 1.2;
const ELEVENLABS_GREETING_SPEED = 1.0;

export const GREETING_TEXT = "يا هلا بك في بنك تجريبي... كيف ممكن اساعدك اليوم؟";
export const PIN_PROMPT_TEXT = "من فضلك انطق الرقم السري أو أدخله لتأكيد العملية";
export const FACEID_TEXT = "تم قبول الرقم السري. جاري التحقق من الوجه";

export type Intent = {
  action: string;
  params: Record<string, any>;
  confidence: number;
  clarification_question: string | null;
  response_language: "ar" | "en";
  dialect: string | null;
  requires_confirmation: boolean;
};

type TranscriptResult = { text: string; language: "ar" | "en" };

const CONFIRMATION_REQUIRED_ACTIONS = ["domesticPayment", "freezeCard", "unfreezeCard", "addBeneficiary"];

// Best-effort caches. On a warm serverless instance they save the Claude
// speech-prep call and the ElevenLabs synthesis for repeated responses; on
// a cold one everything still works, just slower.
const speechPrepCache = new Map<string, string>();
const audioDataUrlCache = new Map<string, string>();

class BackendError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

// -- Mock bank backend, seeded from the client's account_state --------------

const DEFAULT_ACCOUNT_STATE: AccountState = {
  accounts: [
    { type: "checking", balance: 5230.5, currency: "SAR", last4: "5000", holder_name: "نتولز" },
  ],
  beneficiaries: [
    { name: "أحمد الشمري", relation: "أخي", account_number: "SA4420000001234567891234", bank: "بنك تجريبي" },
    { name: "لمى الرشيدي", relation: null, account_number: "SA0380000000608010167519", bank: "مصرف الراجحي" },
    { name: "محمد القحطاني", relation: null, account_number: "SA6210000024567789123456", bank: "البنك الأهلي" },
    { name: "حلا المصري", relation: "أختي", account_number: "SA7130400108056056710038", bank: "بنك الرياض" },
    { name: "لينا الغامدي", relation: null, account_number: "SA2560100000789012345678", bank: "بنك تجريبي" },
    { name: "أرين الهديان", relation: null, account_number: "SA9045000000012345678901", bank: "البنك السعودي الأول" },
    { name: "عمر الحربي", relation: null, account_number: "SA1850000000987654321098", bank: "بنك البلاد" },
  ],
  cards: [{ type: "debit", last4: "4521", status: "active" }],
  transactions: [
    { date: "2026-06-28", description: "Panda Hypermarket", amount: -145.5 },
    { date: "2026-06-25", description: "Salary", amount: 8500.0 },
    { date: "2026-06-20", description: "STC Bill", amount: -120.0 },
    { date: "2026-06-15", description: "Transfer to Ahmed", amount: -300.0 },
  ],
};

const BILLERS = [{ name: "SEC", type: "electricity", account_number: "998877", last_bill_amount: 220 }];
const EXCHANGE_RATES: Record<string, number> = { USD: 3.75, EUR: 4.05, GBP: 4.72, AED: 1.02 };

export function defaultAccountState(): AccountState {
  return JSON.parse(JSON.stringify(DEFAULT_ACCOUNT_STATE));
}

export function parseAccountState(raw: unknown): AccountState {
  if (raw && typeof raw === "object" && Array.isArray((raw as AccountState).accounts)) {
    const state = raw as AccountState;
    return {
      accounts: state.accounts ?? [],
      beneficiaries: state.beneficiaries ?? [],
      cards: state.cards ?? [],
      transactions: state.transactions ?? [],
    };
  }
  return defaultAccountState();
}

class MockBankBackend {
  state: AccountState;

  constructor(state: AccountState) {
    this.state = state;
  }

  domestic_payment(amount: number, currency: string, creditor_name: string) {
    if (!Number.isFinite(amount) || amount <= 0) throw new BackendError("invalid_amount");
    const account = this.state.accounts[0];
    if (!account || amount > account.balance) throw new BackendError("insufficient_funds");
    account.balance = Math.round((account.balance - amount) * 100) / 100;
    this.state.transactions.unshift({
      date: new Date().toISOString().slice(0, 10),
      description: creditor_name,
      amount: -amount,
    });
    return { new_balance: account.balance, creditor_name, amount, currency };
  }

  resolve_card(cardLast4?: string | null) {
    if (cardLast4) {
      const card = this.state.cards.find((c) => c.last4 === cardLast4);
      if (!card) throw new BackendError("unknown_card");
      return card;
    }
    if (this.state.cards.length === 1) return this.state.cards[0];
    throw new BackendError("ambiguous_card");
  }

  add_beneficiary(name: string, identification: string | null) {
    if (!identification) throw new BackendError("missing_identification");
    if (this.state.beneficiaries.some((b) => b.account_number === identification)) {
      throw new BackendError("duplicate_beneficiary");
    }
    const beneficiary = { name, relation: null, account_number: identification, bank: "بنك تجريبي" };
    this.state.beneficiaries.push(beneficiary);
    return beneficiary;
  }

  get_exchange_rate(source: string, target: string) {
    const code = (source || "").toUpperCase();
    if (!(code in EXCHANGE_RATES)) throw new BackendError("unknown_currency");
    if ((target || "SAR").toUpperCase() !== "SAR") throw new BackendError("unsupported_target_currency");
    return { source_currency: code, target_currency: "SAR", rate: EXCHANGE_RATES[code] };
  }
}

// -- Beneficiary resolution (mirrors action_protocol.resolve_beneficiary) ---

const TASHKEEL = /[ً-ْٰـ]/g;

function normalizeName(text: string | null | undefined): string {
  let value = String(text ?? "").replace(TASHKEEL, "");
  value = value.replace(/[إأآٱ]/g, "ا");
  value = value.replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

type Payee = { name: string; account_number: string; relation?: string | null };

export function resolveBeneficiary(
  payees: Payee[],
  name?: string | null,
  identification?: string | null,
): { match: Payee | null; candidates: Payee[] } {
  if (identification) {
    const ident = String(identification).replace(/\s/g, "");
    if (ident) {
      for (const p of payees) {
        if (String(p.account_number ?? "").replace(/\s/g, "") === ident) {
          return { match: p, candidates: [p] };
        }
      }
    }
  }

  const target = normalizeName(name);
  if (!target) return { match: null, candidates: [] };
  const targetTokens = new Set(target.split(" "));

  const scored: Array<{ score: number; payee: Payee }> = [];
  for (const p of payees) {
    const full = normalizeName(p.name);
    const relation = normalizeName(p.relation ?? "");
    const tokens = new Set(full.split(" "));
    const shared = [...targetTokens].filter((t) => tokens.has(t));
    let score = 0;
    if (full === target) score = 100;
    else if (full.includes(target) || target.includes(full)) score = 80;
    else if (shared.length) score = 50 + 10 * shared.length;
    else if (relation && (relation === target || relation.includes(target) || target.includes(relation))) score = 40;
    else continue;
    scored.push({ score, payee: p });
  }

  if (!scored.length) return { match: null, candidates: [] };
  const best = Math.max(...scored.map((s) => s.score));
  const candidates = scored.filter((s) => s.score === best).map((s) => s.payee);
  return { match: candidates.length === 1 ? candidates[0] : null, candidates };
}

// -- NLU (Claude) ------------------------------------------------------------

const NLU_SYSTEM_PROMPT = `You are the Natural Language Understanding (NLU) engine for a Saudi voice banking app.
Your job: convert the user's speech (Arabic or English, possibly imperfect speech-to-text output)
into JSON ONLY, no explanation, in exactly this shape:

{
  "action": "<one of: getBalances, getTransactions, getBeneficiaries, domesticPayment, freezeCard, unfreezeCard, addBeneficiary, getExchangeRate, clarification, unsupported, thanks>",
  "params": { },
  "confidence": <float 0-1>,
  "clarification_question": "<null, or a short question in the SAME language AND dialect as the user's input>",
  "response_language": "<ar or en>",
  "dialect": "<null for English; for Arabic, the dialect the user is speaking, e.g. Saudi/Gulf, Egyptian, Levantine, Iraqi, Maghrebi, MSA>"
}

Action reference (params to use for each action):
- getBalances: params = {}
- getTransactions: params = {"count": <int or null>}
- getBeneficiaries: params = {}
- domesticPayment: params = {"InstructedAmount": {"Amount": <string number>, "Currency": "SAR"}, "CreditorAccount": {"Identification": <account number or null>, "Name": <recipient or biller name>}, "Reference": <string or null>, "amount_source": "<stated or inferred>"}
  Use domesticPayment for BOTH transfers and bill payments. amount_source MUST be "stated" when
  the user spoke the amount themselves, "inferred" when you filled it from account context.
- freezeCard / unfreezeCard: params = {"cardLast4": <string or null>}
- addBeneficiary: params = {"Name": <string>, "Identification": <account number or null>}
- getExchangeRate: params = {"SourceCurrency": <3-letter code>, "TargetCurrency": "SAR"}
- thanks: params = {} (user expressed gratitude or signaled they are done)

CLASSIFY BY MEANING, NOT BY WORDING:
Users phrase the same intent in countless ways, across every Arabic dialect, and speech-to-text
often garbles words. Never require a specific phrase - resolve whatever paraphrase, dialect, or
slightly misheard rendering the user produces to the action it means. Examples of paraphrases
that all map to the SAME action:
- getBalances: "كم رصيدي؟" / "كم في بحسابي؟" / "ابي اشوف رصيدي" / "معايا كام في الحساب؟" / "وش باقي عندي"
- domesticPayment: "حول مية ريال لأخوي" / "ابعت لأحمد ٥٠٠" / "سدد فاتورة الكهرباء" / "طيرلي ٢٠٠ لمحمد"
- freezeCard: "جمد بطاقتي" / "وقف البطاقة" / "اقفل الكرت حقي"
- thanks: "شكرا" / "يعطيك العافية" / "مشكور" / "خلاص بس" / "هذا كل شي"
These are illustrations of variety, not templates to match against.

Rules:
- ALWAYS check the ACCOUNT CONTEXT first before asking a clarifying question. If the user says
  "my brother" and exactly one beneficiary matches, resolve it directly.
- Use clarification only when genuinely ambiguous. Out of scope requests use "unsupported".
- Detect the user's Arabic dialect from their wording and report it in "dialect"; write
  clarification_question naturally in that same dialect.
- Return JSON only, no text before or after it, no Markdown fences.`;

function extractJson(text: string): Record<string, any> {
  const cleaned = text.trim().replace(/^```(json)?/, "").replace(/```$/, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in model output");
  return JSON.parse(match[0]);
}

export async function extractIntent(
  transcript: string,
  language: "ar" | "en",
  accountContext: AccountState,
): Promise<Intent> {
  const fallback: Intent = {
    action: "clarification",
    params: {},
    confidence: 0,
    clarification_question: language === "ar" ? "ممكن تعيد؟" : "Sorry, could you repeat?",
    response_language: language,
    dialect: null,
    requires_confirmation: false,
  };
  if (!ANTHROPIC_KEY) return fallback;

  try {
    const context = { ...accountContext, billers: BILLERS };
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 500,
        system:
          NLU_SYSTEM_PROMPT +
          "\n\nACCOUNT CONTEXT (use this to resolve references before asking questions):\n" +
          JSON.stringify(context),
        messages: [{ role: "user", content: transcript }],
      }),
    });
    if (!resp.ok) throw new Error(`NLU failed: ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    const parsed = extractJson(String(data?.content?.[0]?.text ?? ""));
    const intent: Intent = {
      action: String(parsed.action ?? "unsupported"),
      params: (parsed.params ?? {}) as Record<string, any>,
      confidence: Number(parsed.confidence ?? 0.8),
      clarification_question: parsed.clarification_question ?? null,
      response_language: parsed.response_language === "en" ? "en" : "ar",
      dialect: parsed.dialect ?? null,
      // Hard rule enforced in code, never trusted to the model: any action
      // that moves money or changes account state must be confirmed.
      requires_confirmation: false,
    };
    intent.requires_confirmation = CONFIRMATION_REQUIRED_ACTIONS.includes(intent.action);
    if (intent.action === "domesticPayment") {
      intent.params.amount_source = intent.params.amount_source === "stated" ? "stated" : "inferred";
    }
    return intent;
  } catch (error) {
    console.warn("NLU failed:", error);
    return fallback;
  }
}

// -- STT ----------------------------------------------------------------------

export async function transcribeAudioBlob(file: File): Promise<TranscriptResult> {
  // Primary: ElevenLabs Scribe (same account as TTS - one less key to manage).
  if (ELEVENLABS_KEY) {
    try {
      const form = new FormData();
      form.append("model_id", "scribe_v1");
      form.append("file", file, file.name || "audio.wav");
      const resp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": ELEVENLABS_KEY },
        body: form,
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = String(data.text ?? "").trim();
        return { text, language: /[؀-ۿ]/.test(text) ? "ar" : "en" };
      }
      console.warn("ElevenLabs STT failed:", resp.status, await resp.text());
    } catch (error) {
      console.warn("ElevenLabs STT error:", error);
    }
  }

  // Fallback: OpenAI Whisper, only when a key is configured.
  if (OPENAI_KEY) {
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", file, file.name || "audio.wav");
    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
    });
    if (resp.ok) {
      const data = await resp.json();
      const text = String(data.text ?? "").trim();
      return { text, language: /[؀-ۿ]/.test(text) ? "ar" : "en" };
    }
    console.warn("OpenAI STT failed:", resp.status, await resp.text());
  }

  // Both providers unavailable: return an empty transcript so the turn
  // degrades to the ask-again path instead of a hard failure.
  return { text: "", language: "ar" };
}

// -- TTS (speech prep + ElevenLabs, inline data URLs) -------------------------

const SPEECH_PREP_SYSTEM_PROMPT = `You prepare Arabic text for a bank's text-to-speech engine. You do two things in one pass:

1. DIALECT: When a target dialect is given (Saudi/Gulf, Egyptian, Levantine, Iraqi, Maghrebi, ...), you MUST rewrite the sentence the way a native speaker of that dialect would actually SAY it out loud - vocabulary, grammar, and phrasing. Returning the formal/MSA wording unchanged is wrong whenever a dialect is given. Only when the target dialect is MSA or "none" do you keep the wording as written.
   Non-negotiable constraints while rephrasing:
   - NEVER change any number, amount, currency, account detail, or person's name. This is banking: a changed number is a wrong transaction.
   - Preserve the meaning exactly. A question stays a question, a confirmation prompt stays a confirmation prompt.
2. TASHKEEL: Add Arabic diacritics to the final text so the TTS engine pronounces it unambiguously, following the dialect's own pronunciation.

Return ONLY the final diacritized text. No explanation, no markdown, no quotes.`;

async function prepareArabicSpeech(text: string, dialect: string | null): Promise<string> {
  if (!ANTHROPIC_KEY) return text;
  const cacheKey = `${dialect ?? ""}|${text}`;
  const cached = speechPrepCache.get(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        system: SPEECH_PREP_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Target dialect: ${dialect || "none (keep wording)"}\n\nText:\n${text}` }],
      }),
    });
    if (!resp.ok) return text;
    const data = await resp.json();
    const prepared = String(data?.content?.[0]?.text ?? "").trim() || text;
    if (speechPrepCache.size > 128) speechPrepCache.clear();
    speechPrepCache.set(cacheKey, prepared);
    return prepared;
  } catch {
    return text;
  }
}

async function synthesizeElevenLabs(text: string, speed: number): Promise<Uint8Array | null> {
  if (!ELEVENLABS_KEY) return null;
  try {
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_KEY,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: { speed },
      }),
    });
    if (!resp.ok) {
      console.warn("ElevenLabs TTS failed:", resp.status, await resp.text());
      return null;
    }
    return new Uint8Array(await resp.arrayBuffer());
  } catch (error) {
    console.warn("ElevenLabs TTS error:", error);
    return null;
  }
}

// Returns a data: URL ("" when synthesis is unavailable - the frontend
// treats an empty audio_url as a silent turn and keeps working).
export async function audioDataUrlForText(
  text: string,
  dialect: string | null = null,
  speed: number = ELEVENLABS_SPEED,
): Promise<string> {
  const normalized = text.trim();
  if (!normalized) return "";
  const cacheKey = `${dialect ?? ""}|${speed}|${normalized}`;
  const cached = audioDataUrlCache.get(cacheKey);
  if (cached) return cached;

  const isArabic = /[؀-ۿ]/.test(normalized);
  const prepared = isArabic ? await prepareArabicSpeech(normalized, dialect) : normalized;
  const bytes = await synthesizeElevenLabs(prepared, speed);
  if (!bytes || bytes.length === 0) return "";

  const dataUrl = `data:audio/mpeg;base64,${Buffer.from(bytes).toString("base64")}`;
  if (audioDataUrlCache.size > 32) audioDataUrlCache.clear();
  audioDataUrlCache.set(cacheKey, dataUrl);
  return dataUrl;
}

// -- Response formatting (mirrors action_protocol.py) -------------------------

const ERROR_MESSAGES: Record<string, { ar: string; en: string }> = {
  invalid_amount: { ar: "المبلغ غير صالح.", en: "That amount isn't valid." },
  insufficient_funds: { ar: "الرصيد غير كافٍ لإتمام هذه العملية.", en: "Insufficient balance to complete this transfer." },
  unknown_card: { ar: "لم يتم العثور على بطاقة بهذا الرقم.", en: "No card found with that number." },
  ambiguous_card: { ar: "لديك أكثر من بطاقة، حدد آخر أربعة أرقام من البطاقة.", en: "You have more than one card - please specify the last 4 digits." },
  missing_identification: { ar: "رقم الحساب أو الآيبان مطلوب لإضافة مستفيد.", en: "An account number or IBAN is required to add a beneficiary." },
  duplicate_beneficiary: { ar: "هذا المستفيد مضاف بالفعل.", en: "This beneficiary is already on file." },
  unknown_currency: { ar: "هذه العملة غير مدعومة.", en: "That currency isn't supported." },
  unsupported_target_currency: { ar: "التحويل مدعوم فقط مقابل الريال السعودي.", en: "Exchange rates are only available against SAR." },
  unknown_beneficiary: { ar: "لا يوجد مستفيد بهذا الاسم في قائمة المستفيدين لديك.", en: "There is no beneficiary by that name on your list." },
  ambiguous_beneficiary: { ar: "يوجد أكثر من مستفيد مطابق، حدد الاسم الكامل.", en: "More than one beneficiary matches - please say the full name." },
  unsupported_action: { ar: "هذا الإجراء غير مدعوم.", en: "This action isn't supported." },
};

type ActionResult = {
  success: boolean;
  action_completed: boolean;
  message: string;
  data?: Record<string, any>;
  error?: string;
  needs_clarification?: boolean;
  cancelled?: boolean;
};

function failure(code: string, lang: "ar" | "en"): ActionResult {
  const entry = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unsupported_action;
  return { success: false, action_completed: false, message: entry[lang], error: code };
}

function currencyWord(currency: string, lang: "ar" | "en"): string {
  return lang === "ar" && (currency || "SAR").toUpperCase() === "SAR" ? "ريال" : currency;
}

export function buildConfirmationMessage(intent: Intent): string {
  const lang = intent.response_language;
  const params = intent.params;
  if (intent.action === "domesticPayment") {
    const amount = params.InstructedAmount?.Amount;
    const currency = currencyWord(String(params.InstructedAmount?.Currency ?? "SAR"), lang);
    const name = params.CreditorAccount?.Name;
    const inferred = params.amount_source === "inferred";
    if (lang === "ar") {
      return inferred
        ? `فاتورتك التقديرية ${amount} ${currency} بناءً على آخر فاتورة. أدفع هذا المبلغ لـ ${name}؟`
        : `تحويل ${amount} ${currency} إلى ${name}. تأكيد؟`;
    }
    return inferred
      ? `Your estimated bill is ${amount} ${currency} based on your last bill, for ${name}. Pay that amount?`
      : `Transfer ${amount} ${currency} to ${name}. Confirm?`;
  }
  if (intent.action === "freezeCard") {
    const last4 = params.cardLast4 || (lang === "ar" ? "بطاقتك" : "your card");
    return lang === "ar" ? `تجميد البطاقة المنتهية بـ ${last4}. تأكيد؟` : `Freeze the card ending in ${last4}. Confirm?`;
  }
  if (intent.action === "unfreezeCard") {
    const last4 = params.cardLast4 || (lang === "ar" ? "بطاقتك" : "your card");
    return lang === "ar" ? `إلغاء تجميد البطاقة المنتهية بـ ${last4}. تأكيد؟` : `Unfreeze the card ending in ${last4}. Confirm?`;
  }
  if (intent.action === "addBeneficiary") {
    const name = params.Name;
    const ident = params.Identification || (lang === "ar" ? "غير محدد" : "not provided");
    return lang === "ar"
      ? `إضافة ${name} كمستفيد جديد برقم حساب ${ident}. تأكيد؟`
      : `Add ${name} as a new beneficiary with account ${ident}. Confirm?`;
  }
  return lang === "ar" ? "تأكيد؟" : "Confirm?";
}

function executeAction(intent: Intent, backend: MockBankBackend): ActionResult {
  const lang = intent.response_language;
  const params = intent.params;
  try {
    switch (intent.action) {
      case "getBalances": {
        const accounts = backend.state.accounts;
        if (!accounts.length) return { success: true, action_completed: true, message: lang === "ar" ? "لا توجد حسابات." : "No accounts found.", data: { accounts } };
        const parts = accounts.map((a) =>
          lang === "ar"
            ? `رصيد حسابك ${a.type === "checking" ? "الجاري" : a.type} هو ${a.balance.toFixed(2)} ريال`
            : `Your ${a.type} account balance is ${a.balance.toFixed(2)} ${a.currency ?? "SAR"}`,
        );
        return { success: true, action_completed: true, message: parts.join(lang === "ar" ? "، " : ". "), data: { accounts } };
      }
      case "getTransactions": {
        const txns = backend.state.transactions.slice(0, params.count || 5);
        if (!txns.length) return { success: true, action_completed: true, message: lang === "ar" ? "لا توجد عمليات." : "No transactions found.", data: { transactions: txns } };
        const lines = txns.map((t) => `${t.date}: ${t.description} ${t.amount >= 0 ? "+" : ""}${t.amount.toFixed(2)}`);
        return { success: true, action_completed: true, message: lines.join(lang === "ar" ? "، " : "; "), data: { transactions: backend.state.transactions.slice(0, 10) } };
      }
      case "getBeneficiaries": {
        const beneficiaries = backend.state.beneficiaries;
        const message = beneficiaries.length
          ? beneficiaries.map((b) => b.name).join(lang === "ar" ? "، " : ", ")
          : lang === "ar" ? "لا يوجد مستفيدون مسجلون." : "No beneficiaries on file.";
        return { success: true, action_completed: true, message, data: { beneficiaries } };
      }
      case "domesticPayment": {
        // Hard rule: money only ever moves to a record on the CURRENT
        // beneficiary or biller list - never to free text from the NLU.
        const payees: Payee[] = [...backend.state.beneficiaries, ...BILLERS];
        const { match, candidates } = resolveBeneficiary(
          payees,
          params.CreditorAccount?.Name,
          params.CreditorAccount?.Identification,
        );
        if (!match) return failure(candidates.length ? "ambiguous_beneficiary" : "unknown_beneficiary", lang);
        const amount = Number(params.InstructedAmount?.Amount);
        const currency = String(params.InstructedAmount?.Currency ?? "SAR");
        const result = backend.domestic_payment(amount, currency, match.name);
        const message =
          lang === "ar"
            ? `تم تحويل ${result.amount.toFixed(2)} ${currencyWord(currency, lang)} إلى ${result.creditor_name}. الرصيد الجديد ${result.new_balance.toFixed(2)} ريال.`
            : `Sent ${result.amount.toFixed(2)} ${currency} to ${result.creditor_name}. New balance ${result.new_balance.toFixed(2)} SAR.`;
        return { success: true, action_completed: true, message, data: result };
      }
      case "freezeCard": {
        const card = backend.resolve_card(params.cardLast4);
        card.status = "frozen";
        return { success: true, action_completed: true, message: lang === "ar" ? `تم تجميد البطاقة المنتهية بـ ${card.last4}.` : `Card ending in ${card.last4} is now frozen.`, data: { last4: card.last4 } };
      }
      case "unfreezeCard": {
        const card = backend.resolve_card(params.cardLast4);
        card.status = "active";
        return { success: true, action_completed: true, message: lang === "ar" ? `تم إلغاء تجميد البطاقة المنتهية بـ ${card.last4}.` : `Card ending in ${card.last4} is now active.`, data: { last4: card.last4 } };
      }
      case "addBeneficiary": {
        const added = backend.add_beneficiary(String(params.Name ?? ""), params.Identification ? String(params.Identification) : null);
        return { success: true, action_completed: true, message: lang === "ar" ? `تمت إضافة ${added.name} كمستفيد جديد.` : `Added ${added.name} as a new beneficiary.`, data: added };
      }
      case "getExchangeRate": {
        const rate = backend.get_exchange_rate(String(params.SourceCurrency ?? ""), String(params.TargetCurrency ?? "SAR"));
        return { success: true, action_completed: true, message: lang === "ar" ? `سعر صرف ${rate.source_currency} اليوم هو ${rate.rate} ريال.` : `Today's ${rate.source_currency} exchange rate is ${rate.rate} SAR.`, data: rate };
      }
      case "thanks": {
        return { success: true, action_completed: true, message: lang === "ar" ? "العفو! موجود دايم إذا احتجت أي شي." : "Anytime, always here to help.", data: {} };
      }
      case "clarification": {
        return { success: false, action_completed: false, needs_clarification: true, message: intent.clarification_question || (lang === "ar" ? "ممكن توضح؟" : "Could you clarify?") };
      }
      case "unsupported": {
        return { success: false, action_completed: false, message: lang === "ar" ? "عذرًا، هذا خارج نطاق ما أقدر أساعدك فيه." : "Sorry, that's outside what I can help with." };
      }
      default:
        return failure("unsupported_action", lang);
    }
  } catch (error) {
    if (error instanceof BackendError) return failure(error.code, lang);
    console.warn("executeAction failed:", error);
    return failure("unsupported_action", lang);
  }
}

function buildScreenState(intent: Intent, result: ActionResult): ScreenState {
  if (result.needs_clarification) return { type: "clarification", message: result.message };
  if (result.cancelled) return { type: "cancelled", message: result.message };
  if (!result.success) return { type: "error", message: result.message, error_code: result.error };

  const data = result.data ?? {};
  switch (intent.action) {
    case "thanks":
      return { type: "idle" };
    case "getBalances": {
      const account = (data.accounts ?? [])[0];
      return { type: "balance", amount: account?.balance ?? 0, currency: account?.currency ?? "SAR", account_type: account?.type ?? "checking" };
    }
    case "getTransactions":
      return { type: "transactions", transactions: data.transactions ?? [] };
    case "getBeneficiaries":
      return { type: "beneficiaries", beneficiaries: data.beneficiaries ?? [] };
    case "getExchangeRate":
      return { type: "exchange_rate", source_currency: data.source_currency ?? "", target_currency: data.target_currency ?? "SAR", rate: data.rate ?? 0 };
    default:
      return { type: "success", message: result.message, data };
  }
}

function buildPendingScreenState(intent: Intent): ScreenState {
  if (intent.action === "domesticPayment") {
    return {
      type: "confirm_payment",
      amount: Number(intent.params.InstructedAmount?.Amount ?? 0),
      currency: String(intent.params.InstructedAmount?.Currency ?? "SAR"),
      recipient: intent.params.CreditorAccount?.Name ?? null,
      amount_source: intent.params.amount_source === "stated" ? "stated" : "inferred",
      reference: intent.params.Reference ?? null,
    };
  }
  return { type: "confirm_action", action: intent.action, ...intent.params } as ScreenState;
}

// -- Endpoints' core logic (all stateless) ------------------------------------

export async function buildSessionResponse(): Promise<SessionResponse> {
  const [greeting, pinPrompt, faceid] = await Promise.all([
    audioDataUrlForText(GREETING_TEXT, null, ELEVENLABS_GREETING_SPEED),
    audioDataUrlForText(PIN_PROMPT_TEXT),
    audioDataUrlForText(FACEID_TEXT),
  ]);
  return {
    session_id: crypto.randomUUID(),
    greeting_text: GREETING_TEXT,
    greeting_audio_url: greeting,
    pin_prompt_audio_url: pinPrompt,
    faceid_audio_url: faceid,
    account_state: defaultAccountState(),
  };
}

async function turnResponse(
  intent: Intent,
  transcript: string,
  requiresConfirmation: boolean,
  screenState: ScreenState,
  spokenText: string,
  state: AccountState,
  dialect: string | null,
  pendingIntent: Intent | null,
): Promise<TurnResponse> {
  return {
    transcript,
    action: intent.action,
    params: intent.params,
    requires_confirmation: requiresConfirmation,
    screen_state: screenState,
    spoken_text: spokenText,
    audio_url: await audioDataUrlForText(spokenText, dialect),
    account_state: state,
    dialect,
    pending_intent: pendingIntent,
  };
}

export async function handleTurn(
  state: AccountState,
  knownDialect: string | null,
  transcript: string,
  language: "ar" | "en",
): Promise<TurnResponse> {
  if (!transcript.trim()) {
    const msg = "ما سمعتك، ممكن تعيد؟";
    const intent: Intent = { action: "clarification", params: {}, confidence: 0, clarification_question: msg, response_language: "ar", dialect: knownDialect, requires_confirmation: false };
    return turnResponse(intent, "", false, { type: "clarification", message: msg }, msg, state, knownDialect, null);
  }

  const intent = await extractIntent(transcript, language, state);
  const dialect = intent.dialect || knownDialect;
  const backend = new MockBankBackend(state);

  if (intent.requires_confirmation && intent.action === "domesticPayment") {
    // Resolve the creditor against the CURRENT beneficiary/biller list
    // BEFORE the payment becomes pending - ask, never queue a payment to
    // an unresolved target.
    const payees: Payee[] = [...state.beneficiaries, ...BILLERS];
    const { match, candidates } = resolveBeneficiary(
      payees,
      intent.params.CreditorAccount?.Name,
      intent.params.CreditorAccount?.Identification,
    );
    if (match) {
      intent.params.CreditorAccount = { Identification: match.account_number, Name: match.name };
    } else {
      const lang = intent.response_language;
      const question = candidates.length
        ? (lang === "ar"
            ? `يوجد أكثر من مستفيد مطابق: ${candidates.map((c) => c.name).join("، ")}. من تقصد بالضبط؟`
            : `More than one beneficiary matches: ${candidates.map((c) => c.name).join(", ")}. Which one do you mean?`)
        : (lang === "ar"
            ? `ما لقيت مستفيد باسم ${intent.params.CreditorAccount?.Name ?? "هذا الاسم"} في قائمة المستفيدين لديك. ممكن تقول الاسم مثل ما هو مسجل؟`
            : `I couldn't find a beneficiary called ${intent.params.CreditorAccount?.Name ?? "that name"} on your list. Could you say the name as it is saved?`);
      return turnResponse(intent, transcript, false, { type: "clarification", message: question }, question, state, dialect, null);
    }
  }

  if (intent.requires_confirmation) {
    const spoken = buildConfirmationMessage(intent);
    return turnResponse(intent, transcript, true, buildPendingScreenState(intent), spoken, state, dialect, intent);
  }

  const result = executeAction(intent, backend);
  return turnResponse(intent, transcript, false, buildScreenState(intent, result), result.message, backend.state, dialect, null);
}

export function parsePendingIntent(raw: unknown): Intent | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, any>;
  if (typeof candidate.action !== "string") return null;
  // Re-enforce confirmation semantics on the round-tripped intent rather
  // than trusting the client blob.
  if (!CONFIRMATION_REQUIRED_ACTIONS.includes(candidate.action)) return null;
  return {
    action: candidate.action,
    params: (candidate.params ?? {}) as Record<string, any>,
    confidence: Number(candidate.confidence ?? 0.8),
    clarification_question: null,
    response_language: candidate.response_language === "en" ? "en" : "ar",
    dialect: candidate.dialect ?? null,
    requires_confirmation: true,
  };
}

export async function handleConfirm(
  state: AccountState,
  pendingIntent: Intent | null,
  confirmed: boolean,
  dialect: string | null,
): Promise<TurnResponse> {
  if (!pendingIntent) {
    const msg = "لا يوجد شيء للتأكيد.";
    const intent: Intent = { action: "unsupported", params: {}, confidence: 0, clarification_question: null, response_language: "ar", dialect, requires_confirmation: false };
    return turnResponse(intent, "", false, { type: "error", message: msg }, msg, state, dialect, null);
  }

  if (!confirmed) {
    const msg = pendingIntent.response_language === "ar" ? "تم الإلغاء." : "Cancelled.";
    return turnResponse(pendingIntent, "", false, { type: "cancelled", message: msg }, msg, state, dialect, null);
  }

  const backend = new MockBankBackend(state);
  const result = executeAction(pendingIntent, backend);
  return turnResponse(pendingIntent, "", false, buildScreenState(pendingIntent, result), result.message, backend.state, dialect, null);
}

export async function handlePaymentRequest(
  state: AccountState,
  dialect: string | null,
  body: Record<string, any>,
): Promise<TurnResponse> {
  const { match } = resolveBeneficiary(state.beneficiaries, null, String(body.creditor_account_number ?? ""));
  if (!match) {
    const msg = ERROR_MESSAGES.unknown_beneficiary.ar;
    const intent: Intent = { action: "unsupported", params: {}, confidence: 0, clarification_question: null, response_language: "ar", dialect, requires_confirmation: false };
    return turnResponse(intent, "", false, { type: "error", message: msg }, msg, state, dialect, null);
  }

  const intent: Intent = {
    action: "domesticPayment",
    params: {
      InstructedAmount: { Amount: String(body.amount ?? 0), Currency: String(body.currency ?? "SAR") },
      CreditorAccount: { Identification: match.account_number, Name: match.name },
      Reference: null,
      // The user typed the number themselves on the amount screen.
      amount_source: "stated",
    },
    confidence: 1,
    clarification_question: null,
    response_language: "ar",
    dialect,
    requires_confirmation: true,
  };

  const spoken = buildConfirmationMessage(intent);
  return turnResponse(intent, "", true, buildPendingScreenState(intent), spoken, state, dialect, intent);
}
