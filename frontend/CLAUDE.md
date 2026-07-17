@AGENTS.md
# wusa — Voice-First Banking SDK

## What this is
A bank-agnostic voice SDK embedded into any bank's app, built for elderly and 
blind users. Bypasses the visual UI entirely — voice mode activates on app open, 
guides users ambiently with no screen interaction required. Banking operations 
are executed through a standardized Action Protocol (~15-20 defined actions any 
bank implements once).

Built for the Amad Hackathon (Alinma Bank + Tuwaiq Academy), July 16-18, 2026, 
Riyadh.

## Branding rule — IMPORTANT
This is NOT an Alinma-branded app. Never use the Alinma logo or the name "Alinma" 
anywhere in UI, code, comments, or copy. Use "بنك تجريبي" as the placeholder bank 
name. Match Alinma's teal/turquoise visual language for realism, but keep the app 
generic/bank-agnostic in identity.

## Style rules
- No emojis anywhere — not in code, comments, commit messages, or UI text.
- English preferred for code comments and dev-facing docs.
- Arabic UI copy: no English words mixed in, no academic citation formatting, 
  progressively shorter text, one clear idea per sentence.
- RTL layout throughout for Arabic screens.

## Tech stack
- Frontend: Next.js PWA (App Router), hosted on Vercel
  - IMPORTANT: this Next.js version has breaking changes vs. training data — 
    check node_modules/next/dist/docs/ before writing Next.js-specific code
- Backend: FastAPI (Python)
- STT: faster-whisper (small model, RAM-constrained), fine-tuned on SADA dataset, 
  auto-calibrating silence detection, Arabic banking initial_prompt
- NLU: Claude API (primary/active), ALLaM (SDAIA/HUMAIN) via Ollama with Q2_K 
  quantization as opt-in --local flag for live demo (Q4_K_M exceeds RAM limits)
- TTS: multi-engine comparison in progress — Google Cloud TTS (Chirp3-HD), 
  ElevenLabs, edge-tts (edge-tts rejected: too robotic, mispronounces Arabic). 
  Diacritization (tashkeel) preprocessing is a required test axis — missing 
  tashkeel is the primary cause of Arabic TTS mispronunciation.
- VAD: @ricky0123/vad-web for always-on ambient listening
- Slide generation: pptxgenjs

## Dev environment
- Windows laptop, 8GB RAM, no GPU
- Python + VS Code + Claude Code extension

## Action Protocol / NLU conventions
- Action naming aligned to UK Open Banking / ISO 20022 standards (SAMA's own 
  spec is gated behind registration, so these are the practical reference)
- `requires_confirmation` field enforced in code (not just prompted) for all 
  money-moving or account-changing actions
- `amount_source` field distinguishes user-stated vs. context-inferred amounts
- Account context is injected into NLU so references like "my brother" or 
  "my electricity bill" resolve against real account data before asking 
  clarification questions

## Accessibility requirements (WCAG AA)
- 4.5:1 minimum contrast
- 44px minimum touch targets
- ARIA live regions for dynamic content
- Support 200% text resize
- WebAuthn biometric confirmation gates all money-moving actions, with PIN fallback

## Current focus
Building UI screens first (home screen, transfer screen with beneficiaries list), 
with slide-in navigation transitions (screens push in from the right, like native 
iOS navigation). Backend wiring is a separate, later phase — UI work should use 
placeholder data until then.

## Key rejected approaches (don't revisit)
- ALLaM via HuggingFace Inference API — does not exist as a usable endpoint
- edge-tts for production TTS — quality too poor for target users
- SawtArabi — research corpus, not a callable API
- JAIS (G42/Azure) — real API access exists but it's Emirati-made, conflicts 
  with the "Saudi AI stack" pitch narrative