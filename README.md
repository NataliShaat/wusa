# wusa - Voice-First Banking SDK

**Banking that speaks your dialect. Built for the people banking apps forgot.**

wusa is a bank-agnostic voice SDK that lets elderly and visually impaired users run their bank account entirely by voice - check balances, transfer money, pay bills, freeze cards - with no need to see or touch a screen. It embeds into any bank's app and bypasses the visual UI through a standardized Action Protocol, so one integration serves every bank.

Built in 48 hours for the Amad Hackathon (Alinma Bank + Tuwaiq Academy), July 16-18 2026, Riyadh.

## The problem

Banking apps assume you can see a screen, read small text, and navigate nested menus. Millions of elderly and blind users in Saudi Arabia cannot - so they hand their cards and passwords to relatives, or queue in branches for a transfer that takes others ten seconds. Accessibility is usually an afterthought bolted onto a visual UI. wusa inverts that: voice is the primary interface, and the screen is the accessory.

## What makes it different

**It understands meaning, not phrases.** There are no keyword lists anywhere. "كم رصيدي؟", "كم في بحسابي؟", "وش باقي عندي", and "معايا كام في الحساب؟" all resolve to the same balance check - any paraphrase, in any Arabic dialect, even through imperfect speech-to-text.

**It answers in your dialect.** wusa detects whether the user speaks Gulf, Egyptian, Levantine, or another dialect from their first utterance, and every spoken response is naturally rephrased into that dialect - a Gulf grandmother and an Egyptian grandfather each hear their own Arabic. Numbers, amounts, and names are never altered in the process: this is banking, and a changed number is a wrong transaction.

**It pronounces Arabic correctly.** Undiacritized Arabic is genuinely ambiguous to pronounce, which is the primary cause of robotic-sounding Arabic TTS. Every response is diacritized (tashkeel) before synthesis in the same model pass that handles dialect rephrasing.

**Money cannot move without confirmation - enforced in code.** Every money-moving or account-changing action carries `requires_confirmation`, enforced by the backend, never left to a prompt the model could skip. Payments only ever resolve against the user's saved beneficiary and biller list - never against free text from the language model. Amounts are tagged `stated` (the user said the number) or `inferred` (estimated from context, e.g. a last bill), and inferred amounts are announced as estimates before anything executes.

**Voice and touch are the same code path.** Every action the voice pipeline triggers calls the exact same navigation and action functions a tap does - the screens slide and update identically either way. There is no parallel voice-only logic to drift out of sync. The confirmation PIN can be spoken or typed; both feed one validation function.

**Fully accessible flow, end to end.** The confirmation sequence is voiced at every stage: the app asks for the PIN out loud, listens for spoken digits (Arabic words, Arabic-Indic numerals, or Western digits), announces the biometric verification step, and speaks the result. WCAG AA throughout: 4.5:1 contrast, 44px touch targets, ARIA live regions, RTL layout, 200% text-resize support.

## The Action Protocol

Banks integrate once by implementing a small, standardized action interface. Naming follows the UK Open Banking Standard and ISO 20022 - the same foundations SAMA's Open Banking Framework was built from - split honestly into what is genuinely standard and what is not:

| Category | Actions | Basis |
|---|---|---|
| Standard (AIS/PIS scope) | `getBalances`, `getTransactions`, `getBeneficiaries`, `domesticPayment` | UK Open Banking / ISO 20022 resource and field naming |
| Bank extensions | `freezeCard`, `unfreezeCard`, `addBeneficiary`, `getExchangeRate` | No regulator standardizes these; clearly labeled as extensions |
| Control | `clarification`, `unsupported`, `thanks` | Conversation flow |

A bill payment is just a `domesticPayment` whose creditor is a biller - no special case.

## How a turn works

```
ambient mic (Silero VAD, browser)
        |  isolated utterance
        v
Speech-to-text ---- faster-whisper locally / ElevenLabs Scribe serverless
        |  transcript (any dialect, possibly imperfect)
        v
NLU (Claude) ------ semantic intent + dialect detection + account-context
        |  intent JSON        resolution ("my brother" -> saved beneficiary)
        v
Action Protocol --- confirmation enforcement, beneficiary resolution,
        |  result             mock bank backend (swappable for a real one)
        v
Speech prep ------- dialect rephrasing + tashkeel in one model pass
        |
        v
TTS (ElevenLabs) -- natural Arabic voice, cached for repeated responses
```

## Architecture

Two interchangeable backends speak the same wire contract:

- **Serverless (deployed)** - the entire pipeline runs as Next.js API routes on Vercel, written stateless: session state travels with the client, audio returns as inline data URLs. No servers to keep alive, works from any phone.
- **Local (demo)** - a FastAPI backend runs the richer local stack: faster-whisper STT on-device and the full Python Action Protocol. The frontend switches to it with one env var.

The NLU can also run on **ALLaM** (SDAIA's Saudi model) locally via Ollama as an opt-in flag - proof the pipeline runs on a Saudi AI stack end to end.

| Layer | Technology |
|---|---|
| Frontend | Next.js PWA, App Router, RTL Arabic, iOS-style slide navigation |
| Voice activity | @ricky0123/vad-web (Silero VAD, on-device, works in a noisy hall) |
| STT | faster-whisper (local) / ElevenLabs Scribe (serverless) |
| NLU | Claude (Haiku for per-turn latency); ALLaM via Ollama (local option) |
| TTS | ElevenLabs multilingual, tashkeel preprocessing, response audio cache |
| Biometrics | WebAuthn (real OS biometrics) with voice-or-typed PIN fallback |
| Backend | FastAPI (local) / Next.js route handlers (Vercel) |

## Running it

**Deployed:** push to `main` deploys to Vercel. Required project env vars: `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY` (and optionally `ELEVENLABS_VOICE_ID`, `OPENAI_API_KEY` as STT fallback). See `frontend/DEPLOY_CHECKLIST.md`.

**Local full stack:**

```bash
# backend (Python 3.11+, needs ANTHROPIC_API_KEY and ELEVENLABS_API_KEY set)
pip install -r backend/requirements.txt
python -m uvicorn backend.app:app --port 8000

# frontend (frontend/.env.local points it at the local backend)
cd frontend && npm ci && npm run dev
```

Or run the whole pipeline in a terminal with no UI at all - which is the point of the project: `python main.py`.

## Try saying

- "كم رصيدي؟" - or any phrasing of it, in your dialect
- "حول مية ريال لأخوي" - resolves "my brother" from saved beneficiaries, then walks the voiced confirmation: spoken PIN, biometric check, spoken receipt
- "سدد فاتورة الكهرباء" - pays the biller using the last bill amount, announced as an estimate
- "جمد بطاقتي" - freeze the card, with enforced confirmation
- "شكرا، هذا كل شي" - it answers warmly, in your dialect

## Honest limitations

This is a hackathon build: the bank backend is an in-memory mock (the interface is designed for a real integration to drop in), the PIN and WebAuthn checks are demo-grade and not server-verified, and dialect coverage is as good as the underlying models. The Action Protocol cannot claim SAMA conformance - SAMA's spec is gated behind registration - so it aligns with the public standards SAMA built from, and says so.

## Team

Built at the Amad Hackathon 2026. Bank branding in the UI is the placeholder "بنك تجريبي" by design - wusa is a bank-agnostic SDK, not a bank app.
