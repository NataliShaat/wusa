"use client";

import { useState } from "react";
import { enroll } from "@/lib/webauthn";

// One-time "enroll this device" step - a simplified stand-in for real bank
// enrollment (branch visit, ID verification, etc). Registers a real
// platform WebAuthn credential (Face ID / Windows Hello / fingerprint) so
// the biometric prompt used later for confirmations is genuine, but this
// onboarding itself has no identity verification behind it. Not
// production-grade - see lib/webauthn.ts for the same caveat.

export function OnboardingWebAuthn({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");

  async function handleEnroll() {
    setStatus("working");
    const ok = await enroll();
    if (ok) {
      onDone();
    } else {
      setStatus("failed");
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center max-w-md px-6">
      <h1 className="text-2xl font-bold text-ink">تسجيل الجهاز</h1>
      <p className="text-lg text-ink-soft">
        قبل البدء، سجل هذا الجهاز للتأكيد البيومتري (بصمة الإصبع أو التعرف على الوجه) على العمليات المالية.
      </p>
      <button
        type="button"
        onClick={handleEnroll}
        disabled={status === "working"}
        className="min-h-[44px] min-w-[44px] px-8 py-3 rounded-[var(--radius-control)] bg-primary text-white text-lg font-semibold disabled:opacity-60"
      >
        {status === "working" ? "جارٍ التسجيل..." : "تسجيل الجهاز"}
      </button>
      {status === "failed" && (
        <p className="text-error font-medium" role="alert">
          تعذر التسجيل البيومتري. يمكنك المتابعة واستخدام الرقم السري بدلاً من ذلك عند التأكيد.
        </p>
      )}
      <button type="button" onClick={onDone} className="text-primary-dark underline min-h-[44px]">
        تخطي الآن
      </button>
    </div>
  );
}
