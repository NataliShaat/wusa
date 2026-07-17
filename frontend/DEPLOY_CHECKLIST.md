# Deployment Checklist for Vercel

Follow these steps to deploy the frontend and serverless API to Vercel.

1. Ensure these environment variables are set in your Vercel project settings:
   - `ANTHROPIC_API_KEY` (required - NLU and Arabic speech prep)
   - `ELEVENLABS_API_KEY` (required - TTS, and STT via Scribe)
   - `ELEVENLABS_VOICE_ID` (optional; default used if missing: `LE1b8WpPSScCUklGPKzg`)
   - `OPENAI_API_KEY` (optional - Whisper STT fallback if ElevenLabs STT is unavailable)
   - `NEXT_PUBLIC_API_BASE_URL` must NOT be set on Vercel - it would point the
     frontend away from the bundled serverless API. It belongs only in a local
     `.env.local` when developing against the Python FastAPI backend.

2. Confirm `vercel.json` exists at repo root and `frontend` is the build target.

3. Trigger a new deploy from the Vercel dashboard or push another commit to `main`.

4. Watch the build logs — the build command is:

```bash
npm --prefix frontend run build
```

5. If the build fails, paste the Vercel build log here and I'll patch the code.

6. After a successful deploy, verify these endpoints on your deployment domain:
   - `POST /api/session` — create session (greeting and prompts as data: URLs)
   - `POST /api/turn` — send audio or `text` for STT bypass
   - `POST /api/turn/confirm` — confirm pending action
   - `POST /api/transcribe` — transcribe audio (voice PIN)
   - `POST /api/payment` — initiate payment (creates pending confirm)
   - `GET /api/state` — default account state
   (all audio is returned inline as data: URLs - there is no /api/audio route)

7. Test from phone using the deployment domain (no localhost required).

If you want, I can create a small health-check script to POST a test `text` to `/api/turn` and assert responses — say "yes" and I'll add it and push the commit.
