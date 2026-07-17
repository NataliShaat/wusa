"use client";

// Simulated Face ID step shown after the PIN is accepted - a scan animation
// followed by a confirmation tick, then onDone fires. Purely visual demo
// theater: the actual authorization already happened (PIN or WebAuthn), and
// execution still only happens server-side via /api/turn/confirm.
//
// The scan holds until BOTH the minimum scan time has elapsed AND the
// spoken announcement has finished (audioDone) - the voice must never be
// cut off by the visual ending first.

import { useEffect, useState } from "react";

const MIN_SCAN_MS = 1700;
const DONE_LINGER_MS = 800;
const MAX_FACEID_WAIT_MS = 8000;

export function FakeFaceId({
  audioDone,
  onDone,
}: {
  audioDone: boolean;
  onDone: () => void;
}) {
  const [minScanElapsed, setMinScanElapsed] = useState(false);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMinScanElapsed(true), MIN_SCAN_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!minScanElapsed || !audioDone || verified) return;
    setVerified(true);
    const t = setTimeout(onDone, DONE_LINGER_MS);
    return () => clearTimeout(t);
  }, [minScanElapsed, audioDone, verified, onDone]);

  useEffect(() => {
    if (verified) return;
    const t = setTimeout(() => {
      if (!verified) {
        setVerified(true);
        onDone();
      }
    }, MAX_FACEID_WAIT_MS);
    return () => clearTimeout(t);
  }, [verified, onDone]);

  return (
    <div className="flex flex-col items-center gap-4 py-2" role="status" aria-live="assertive">
      <div className="relative h-24 w-24">
        <svg viewBox="0 0 96 96" className="h-24 w-24" aria-hidden="true">
          {/* Face ID style rounded corner brackets */}
          <path
            d="M30 10 H20 a10 10 0 0 0 -10 10 v10 M66 10 h10 a10 10 0 0 1 10 10 v10 M30 86 H20 a10 10 0 0 1 -10 -10 v-10 M66 86 h10 a10 10 0 0 0 10 -10 v-10"
            fill="none"
            stroke="var(--color-primary, #0e7a74)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          {verified ? (
            <path
              d="M32 50 l11 11 l21 -24"
              fill="none"
              stroke="var(--color-primary, #0e7a74)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <>
              {/* simple face: eyes + smile */}
              <circle cx="38" cy="42" r="3.5" fill="var(--color-primary, #0e7a74)" />
              <circle cx="58" cy="42" r="3.5" fill="var(--color-primary, #0e7a74)" />
              <path
                d="M36 58 q12 10 24 0"
                fill="none"
                stroke="var(--color-primary, #0e7a74)"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </>
          )}
        </svg>
        {!verified && (
          <div
            aria-hidden="true"
            className="absolute inset-x-2 top-2 h-1 rounded-full bg-primary/70"
            style={{ animation: "faceid-scan 1700ms ease-in-out infinite" }}
          />
        )}
      </div>
      <p className="text-lg font-medium text-ink">
        {verified ? "تم التحقق من الوجه" : "جاري التحقق من الوجه..."}
      </p>
      <style>{`
        @keyframes faceid-scan {
          0% { transform: translateY(0); }
          50% { transform: translateY(74px); }
          100% { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
