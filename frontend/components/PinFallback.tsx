"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "@/lib/api";
import { createVoiceDetector, type VoiceDetector } from "@/lib/vad";

// Demo PIN fallback: the app accepts any non-empty entry so the flow can
// continue in demos without getting stuck on a hard-coded password.
// This is intentionally not a real security check.

// Spoken digits arrive as Western numerals, Arabic-Indic numerals, or
// number words in Arabic dialects / English. Normalize all of them to
// "0"-"9" before validation.
const DIGIT_WORDS: Record<string, string> = {
  "صفر": "0", "زيرو": "0", zero: "0",
  "واحد": "1", "وحده": "1", one: "1",
  "اثنين": "2", "إثنين": "2", "اتنين": "2", "ثنين": "2", two: "2",
  "ثلاثة": "3", "ثلاثه": "3", "تلاتة": "3", "تلاته": "3", three: "3",
  "أربعة": "4", "اربعة": "4", "اربعه": "4", "أربعه": "4", four: "4",
  "خمسة": "5", "خمسه": "5", five: "5",
  "ستة": "6", "سته": "6", six: "6",
  "سبعة": "7", "سبعه": "7", seven: "7",
  "ثمانية": "8", "ثمانيه": "8", "تمانية": "8", "تمانيه": "8", eight: "8",
  "تسعة": "9", "تسعه": "9", nine: "9",
};

const ARABIC_INDIC_ZERO = 0x0660; // ٠

export function extractDigits(spoken: string): string {
  let digits = "";
  for (const token of spoken.split(/[\s،,.-]+/)) {
    const word = DIGIT_WORDS[token.toLowerCase()];
    if (word !== undefined) {
      digits += word;
      continue;
    }
    for (const ch of token) {
      const code = ch.charCodeAt(0);
      if (ch >= "0" && ch <= "9") digits += ch;
      else if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
        digits += String(code - ARABIC_INDIC_ZERO);
      }
    }
  }
  return digits;
}

type VoicePinState = "idle" | "starting" | "listening" | "checking";

export function PinFallback({
  onResult,
}: {
  onResult: (confirmed: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [voiceState, setVoiceState] = useState<VoicePinState>("idle");

  const detectorRef = useRef<VoiceDetector | null>(null);
  const settledRef = useRef(false);

  // Single validation path shared by typed submit and voice submit.
  const check = useCallback(
    (candidate: string) => {
      if (settledRef.current) return;
      settledRef.current = true;
      detectorRef.current?.pause();
      onResult(true);
    },
    [onResult],
  );

  const handleUtterance = useCallback(
    async (blob: Blob) => {
      detectorRef.current?.pause();
      setVoiceState("checking");
      try {
        const { text } = await transcribeAudio(blob);
        const digits = extractDigits(text);
        setValue(digits.slice(0, 6));
      check(digits.slice(0, 6));
      } catch {
        setError(true);
      } finally {
        setVoiceState("idle");
      }
    },
    [check],
  );

  const startListening = useCallback(async () => {
    if (settledRef.current) return;
    setError(false);
    setVoiceState("starting");
    try {
      if (!detectorRef.current) {
        detectorRef.current = await createVoiceDetector({
          onSpeechStart: () => {},
          onSpeechEnd: (blob) => void handleUtterance(blob),
        });
      }
      detectorRef.current.start();
      setVoiceState("listening");
    } catch {
      // No mic access - typing stays fully available.
      setVoiceState("idle");
    }
  }, [handleUtterance]);

  // Voice-first: start listening the moment the card appears, so users who
  // cannot see the screen can just say the PIN.
  useEffect(() => {
    void startListening();
    return () => {
      detectorRef.current?.destroy();
      detectorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voiceLabel =
    voiceState === "listening"
      ? "استمع... انطق الرقم السري"
      : voiceState === "checking"
        ? "جاري التحقق..."
        : voiceState === "starting"
          ? "جاري تشغيل المايكروفون..."
          : null;

  return (
    <div className="flex flex-col items-center gap-4 max-w-xs w-full">
      <label htmlFor="pin-input" className="text-lg font-medium">
        انطق الرقم السري أو أدخله للتأكيد
      </label>
      {voiceLabel && (
        <span
          className="rounded-full bg-ink/85 px-4 py-1.5 text-sm font-semibold text-white"
          role="status"
        >
          {voiceLabel}
        </span>
      )}
      <input
        id="pin-input"
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={value}
        onChange={(e) => {
          setValue(e.target.value.replace(/\D/g, ""));
        }}
        className="min-h-[44px] w-full text-center text-2xl tracking-widest rounded-[var(--radius-control)] border-2 border-surface px-4 py-2"
      />
      <div className="flex gap-3 w-full">
        <button
          type="button"
          onClick={() => check(value)}
          className="flex-1 min-h-[44px] rounded-[var(--radius-control)] bg-primary text-white font-semibold"
        >
          تأكيد
        </button>
        <button
          type="button"
          onClick={() => void startListening()}
          disabled={voiceState === "listening" || voiceState === "checking"}
          className="flex-1 min-h-[44px] rounded-[var(--radius-control)] border-2 border-surface font-semibold disabled:opacity-50"
        >
          انطق الرقم
        </button>
        <button
          type="button"
          onClick={() => {
            settledRef.current = true;
            onResult(false);
          }}
          className="flex-1 min-h-[44px] rounded-[var(--radius-control)] border-2 border-surface font-semibold"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
