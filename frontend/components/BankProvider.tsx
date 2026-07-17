"use client";

// Session-level state and the ambient voice loop:
//   VAD speech end -> POST /api/turn (STT -> NLU -> action -> TTS)
//   -> screen_state + fresh account_state land here -> UI re-renders
//   -> response audio plays -> listening resumes.
//
// account_state is the ONLY source the UI renders balances, beneficiaries,
// and transactions from. It is replaced wholesale from every backend
// response and never mutated or cached locally, which is what guarantees a
// balance readout can never be stale relative to the backend.
//
// Confirmation for money-moving actions is enforced server-side: the
// backend holds the pending intent and only executes it via
// /api/turn/confirm. This provider just decides when to send that confirm
// (after WebAuthn or the PIN fallback succeeds) - it cannot skip it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  audioUrl,
  confirmTurn,
  createSession,
  sendTurn,
  startPayment,
} from "@/lib/api";
import { createVoiceDetector, type VoiceDetector } from "@/lib/vad";
import { hasEnrolledCredential, confirmWithBiometrics } from "@/lib/webauthn";
import type {
  AccountState,
  Beneficiary,
  ScreenState,
  SessionResponse,
  TurnResponse,
  VoiceState,
} from "@/lib/types";

// Pitch-preserving speed-up applied at playback time, on top of the TTS
// engine's own speed setting.
const PLAYBACK_RATE = 1.15;

// How long transient result cards (success, error, clarification, ...) stay
// on screen after the spoken response finishes.
const TRANSIENT_CARD_MS = 6000;

export type ConfirmationStage = "none" | "awaiting_biometric" | "awaiting_pin";

type BankApi = {
  session: SessionResponse | null;
  accountState: AccountState | null;
  screenState: ScreenState;
  voiceState: VoiceState;
  confirmationStage: ConfirmationStage;
  // Monotonic id + payload of the latest backend turn, for navigation
  // effects that must run exactly once per turn.
  lastTurn: { id: number; response: TurnResponse } | null;
  toggleVoice: () => void;
  startTouchPayment: (beneficiary: Beneficiary, amount: number) => Promise<void>;
  resolveConfirmation: (confirmed: boolean) => Promise<void>;
  // Plays one of the fixed confirmation-flow prompts; onDone fires when the
  // audio finishes (immediately when the path is empty or playback fails).
  playPromptAudio: (path: string, onDone?: () => void) => void;
};

const BankContext = createContext<BankApi | null>(null);

export function useBank(): BankApi {
  const ctx = useContext(BankContext);
  if (!ctx) throw new Error("useBank must be used inside <BankProvider>");
  return ctx;
}

export function BankProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [accountState, setAccountState] = useState<AccountState | null>(null);
  const [screenState, setScreenState] = useState<ScreenState>({ type: "idle" });
  const [voiceState, setVoiceState] = useState<VoiceState>("off");
  const [confirmationStage, setConfirmationStage] = useState<ConfirmationStage>("none");
  const [lastTurn, setLastTurn] = useState<BankApi["lastTurn"]>(null);

  const detectorRef = useRef<VoiceDetector | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<SessionResponse | null>(null);
  const voiceOnRef = useRef(false);
  const sessionRequested = useRef(false);
  const turnCounter = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Guarded so React StrictMode's double effect run cannot create two
    // backend sessions (a second session would reset the account state).
    if (sessionRequested.current) return;
    sessionRequested.current = true;
    createSession()
      .then((s) => {
        sessionRef.current = s;
        setSession(s);
        setAccountState(s.account_state);
      })
      .catch(() => {
        setScreenState({ type: "error", message: "تعذر الاتصال بالخادم. تأكد من تشغيله ثم حدث الصفحة." });
      });
  }, []);

  useEffect(() => {
    return () => {
      detectorRef.current?.destroy();
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  const scheduleTransientClear = useCallback((forTurn: number) => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      // Only clear if no newer turn replaced the state meanwhile.
      if (turnCounter.current === forTurn) setScreenState({ type: "idle" });
    }, TRANSIENT_CARD_MS);
  }, []);

  const resumeListening = useCallback(() => {
    if (!voiceOnRef.current) {
      setVoiceState("off");
      return;
    }
    setVoiceState("listening");
    detectorRef.current?.start();
  }, []);

  const playAudio = useCallback(
    (path: string, onDone: () => void) => {
      // Pause the mic so the app's own voice never re-triggers a turn.
      detectorRef.current?.pause();
      const audio = audioRef.current;
      // path can be "" when server-side TTS failed - a silent turn still
      // updates the screen and continues the flow.
      if (!audio || !path) {
        onDone();
        return;
      }
      if (voiceOnRef.current) setVoiceState("speaking");
      audio.src = audioUrl(path);
      audio.playbackRate = PLAYBACK_RATE;
      audio.onended = onDone;
      audio.play().catch(() => onDone());
    },
    [],
  );

  const resolveConfirmationRef = useRef<(confirmed: boolean) => Promise<void>>(async () => {});

  const runConfirmationFlow = useCallback(async () => {
    if (hasEnrolledCredential()) {
      setConfirmationStage("awaiting_biometric");
      const ok = await confirmWithBiometrics();
      if (ok) {
        await resolveConfirmationRef.current(true);
        return;
      }
    }
    // Speak the PIN request BEFORE the card appears and starts listening -
    // the PIN mic must never be live while the app itself is talking.
    const promptUrl = sessionRef.current?.pin_prompt_audio_url ?? "";
    playAudio(promptUrl, () => setConfirmationStage("awaiting_pin"));
  }, [playAudio]);

  const applyTurn = useCallback(
    (response: TurnResponse) => {
      const id = ++turnCounter.current;
      setAccountState(response.account_state);
      setScreenState(response.screen_state);
      setLastTurn({ id, response });

      playAudio(response.audio_url, () => {
        if (response.requires_confirmation) {
          void runConfirmationFlow();
        } else {
          resumeListening();
          scheduleTransientClear(id);
        }
      });
    },
    [playAudio, resumeListening, runConfirmationFlow, scheduleTransientClear],
  );

  const failTurn = useCallback(() => {
    const id = ++turnCounter.current;
    setScreenState({ type: "error", message: "حدث خطأ في الاتصال بالخادم." });
    resumeListening();
    scheduleTransientClear(id);
  }, [resumeListening, scheduleTransientClear]);

  const handleUtterance = useCallback(
    async (blob: Blob) => {
      const s = sessionRef.current;
      if (!s) return;
      setScreenState({ type: "processing" });
      try {
        applyTurn(await sendTurn(s.session_id, blob));
      } catch {
        failTurn();
      }
    },
    [applyTurn, failTurn],
  );

  const resolveConfirmation = useCallback(
    async (confirmed: boolean) => {
      const s = sessionRef.current;
      setConfirmationStage("none");
      if (!s) return;
      setScreenState({ type: "processing" });
      try {
        applyTurn(await confirmTurn(s.session_id, confirmed));
      } catch {
        failTurn();
      }
    },
    [applyTurn, failTurn],
  );
  resolveConfirmationRef.current = resolveConfirmation;

  // Playback for the fixed confirmation-flow prompts (e.g. the Face ID
  // announcement). The caller can sync visuals to the audio via onDone.
  const playPromptAudio = useCallback(
    (path: string, onDone?: () => void) => {
      playAudio(path, onDone ?? (() => {}));
    },
    [playAudio],
  );

  const startTouchPayment = useCallback(
    async (beneficiary: Beneficiary, amount: number) => {
      const s = sessionRef.current;
      if (!s) return;
      setScreenState({ type: "processing" });
      try {
        applyTurn(
          await startPayment(s.session_id, {
            amount,
            currency: "SAR",
            creditorAccountNumber: beneficiary.account_number,
          }),
        );
      } catch {
        failTurn();
      }
    },
    [applyTurn, failTurn],
  );

  const toggleVoice = useCallback(async () => {
    if (voiceOnRef.current) {
      voiceOnRef.current = false;
      detectorRef.current?.pause();
      audioRef.current?.pause();
      setVoiceState("off");
      return;
    }

    const s = sessionRef.current;
    if (!s) return; // session still being created - ignore taps until ready

    voiceOnRef.current = true;
    if (!detectorRef.current) {
      try {
        detectorRef.current = await createVoiceDetector({
          onSpeechStart: () => setScreenState({ type: "processing" }),
          onSpeechEnd: (blob) => void handleUtterance(blob),
        });
      } catch {
        voiceOnRef.current = false;
        setScreenState({ type: "error", message: "تعذر الوصول إلى المايكروفون." });
        return;
      }
    }

    playAudio(s.greeting_audio_url, resumeListening);
  }, [handleUtterance, playAudio, resumeListening]);

  const api = useMemo<BankApi>(
    () => ({
      session,
      accountState,
      screenState,
      voiceState,
      confirmationStage,
      lastTurn,
      toggleVoice: () => void toggleVoice(),
      startTouchPayment,
      resolveConfirmation,
      playPromptAudio,
    }),
    [
      session,
      accountState,
      screenState,
      voiceState,
      confirmationStage,
      lastTurn,
      toggleVoice,
      startTouchPayment,
      resolveConfirmation,
      playPromptAudio,
    ],
  );

  return (
    <BankContext.Provider value={api}>
      {children}
      <audio ref={audioRef} className="hidden" />
    </BankContext.Provider>
  );
}
