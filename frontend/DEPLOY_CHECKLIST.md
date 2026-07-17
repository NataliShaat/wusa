# Deployment Checklist for Vercel

Follow these steps to deploy the frontend and serverless API to Vercel.

1. Ensure these environment variables are set in your Vercel project settings:
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_ID` (optional; default used if missing: `LE1b8WpPSScCUklGPKzg`)
   - `NEXT_PUBLIC_API_BASE_URL` (leave empty for same-origin API)

2. Confirm `vercel.json` exists at repo root and `frontend` is the build target.

3. Trigger a new deploy from the Vercel dashboard or push another commit to `main`.

4. Watch the build logs — the build command is:

```bash
npm --prefix frontend run build
```

5. If the build fails, paste the Vercel build log here and I'll patch the code.

6. After a successful deploy, verify these endpoints on your deployment domain:
   - `POST /api/session` — create session
   - `POST /api/turn` — send audio or `text` for STT bypass
   - `POST /api/turn/confirm` — confirm pending action
   - `POST /api/transcribe` — transcribe audio
   - `POST /api/payment` — initiate payment (creates pending confirm)
   - `GET /api/state?session_id=<id>` — get account state
   - `GET /api/audio/<token>` — stream cached TTS audio

7. Test from phone using the deployment domain (no localhost required).

If you want, I can create a small health-check script to POST a test `text` to `/api/turn` and assert responses — say "yes" and I'll add it and push the commit.
