---
name: verify
description: Build, launch, and drive the wusa frontend (Next.js PWA) to verify UI changes at runtime.
---

# Verifying the wusa frontend

## Build / launch

- Dev server: `npm run dev` in `frontend/` (Turbopack, ready in ~2s on http://localhost:3000). Run it in the background.
- `npx` is broken on this machine ("Could not determine Node.js install directory"). Call local binaries directly:
  - `node .\node_modules\typescript\bin\tsc --noEmit`
  - `node .\node_modules\eslint\bin\eslint.js app components lib`

## Drive (no Playwright/Puppeteer installed)

Headless Edge + raw CDP from plain Node (global `fetch` + `WebSocket`, zero deps) works well. A known-good driver covering screenshots, taps, keyboard, search input, and touch swipes lived at the session scratchpad as `drive.js` — pattern summary:

1. Spawn `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` with `--headless=new --remote-debugging-port=9222 --user-data-dir=<tmp> --window-size=390,844`.
2. `PUT /json/new?about:blank`, connect to `webSocketDebuggerUrl`, then `Page.enable`, `Runtime.enable`.
3. Phone emulation: `Emulation.setDeviceMetricsOverride` (390x844, dpr 2, mobile) + `Emulation.setTouchEmulationEnabled`.
4. Screenshots via `Page.captureScreenshot`; taps via `Runtime.evaluate` finding buttons by Arabic text content; controlled React inputs need the native value setter + `dispatchEvent(new Event("input", {bubbles:true}))`.
5. Real swipes via `Input.dispatchTouchEvent` (touchStart/touchMove.../touchEnd) - these produce trusted pointer events, so `setPointerCapture` works.

## Gotchas

- Stopping the background `npm run dev` task kills only the npm wrapper; the `next dev` child keeps serving on port 3000, and a second `next dev` will bind 3001 then exit with "Another next dev server is already running". Reuse the surviving server on 3000, or `taskkill /PID <pid> /F` it (the error message prints the PID).

- OneDrive actively corrupts this repo's write-heavy dirs (os error 1392 "corrupted and unreadable", UNKNOWN errno -4094 on `.next` files, and once a source file gained garbage bytes at offset 0). Seen corrupting `.next/` and `node_modules/next/dist/esm/shared/lib/page-path`. If a dir hits 1392: it is NTFS-level - `rd /s /q`, `move`, and `ren` all fail (Access is denied while OneDrive holds it). Recovery: pause/quit OneDrive (user action), then rename the broken package dir away and `npm install`; truly stuck entries need `chkdsk`. Deleting `.next` before starting dev after a crash avoids the errno -4094 flavor.
- 8GB RAM: `next build` can die with heap/commit OOM while `next dev` works fine - verify with the dev server + tsc, not a production build. The backend must also be memory-light: stt.py lazy-loads numpy/sounddevice/faster-whisper for this reason; don't reintroduce top-level heavy imports.
- Full-stack runs: start the backend with `python -m uvicorn backend.app:app --port 8000` from the repo root. For testing without a mic, POST `/api/turn` accepts a `text` form field that bypasses STT but exercises real NLU/action/TTS. Start it with `ELEVENLABS_API_KEY=` (empty) during tests to fall back to edge-tts and preserve the ElevenLabs free-tier quota for demos.

- `el.click()` from `Runtime.evaluate` bypasses the `inert` attribute on covered screen-stack layers - a "double push" seen that way is a driver artifact, not a user-reachable bug. Use `Input.dispatchTouchEvent` when inert-blocking matters.
- The dark circle bottom-left in dev screenshots is the Next.js dev-tools overlay, not app UI.
- Screen-stack state is inspectable via `document.querySelectorAll(".screen-layer")` - check `getComputedStyle(l).transform` and `l.inert` to verify push/pop/parallax.

## Flows worth driving

- Home -> "التحويل السريع" (push transition, home parks at -28% and goes inert)
- Transfer list: search filter, empty state, beneficiary tap -> amount screen
- Pop paths: header back button, Escape key, right-edge touch swipe
