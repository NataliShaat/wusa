"use client";

// Rendered inside <ScreenStack> as its overlay, so it has access to the
// same navigation API the tap handlers use. Two jobs:
//
// 1. Navigation effects: when a voice turn lands, drive the screen stack
//    through the exact same shared transitions (useBankNav) that tapping
//    would - push the transfer screen, then the amount screen, or pop back
//    home - never by teleporting state past the animations.
// 2. Response cards + confirmation prompts that float above whatever screen
//    is showing (transactions, clarifications, errors, PIN fallback, ...).

import { useEffect, useRef, useState } from "react";
import { useBank } from "@/components/BankProvider";
import { useBankNav } from "@/components/navigation/bankNav";
import { DynamicResponseArea } from "@/components/DynamicResponseArea";
import { PinFallback } from "@/components/PinFallback";
import { FakeFaceId } from "@/components/FakeFaceId";

// Matches ScreenStack's TRANSITION_MS: the second push of a voice-driven
// two-screen jump starts once the first slide has landed, so the user sees
// the same sequence of transitions a tap-tap flow produces.
const PUSH_STAGGER_MS = 360;
// How long the success card stays before popping back home.
const SUCCESS_LINGER_MS = 2600;

// States rendered as floating cards here. The rest are reflected by the
// screens themselves: balance -> home balance card, beneficiaries -> the
// transfer screen list, confirm_payment -> the amount screen.
const OVERLAY_CARD_TYPES = new Set([
  "processing",
  "transactions",
  "exchange_rate",
  "confirm_action",
  "success",
  "error",
  "cancelled",
  "clarification",
]);

export function BankOverlay() {
  const { session, accountState, screenState, confirmationStage, lastTurn, resolveConfirmation, playPromptAudio, voiceState } = useBank();
  const nav = useBankNav();
  // After a correct PIN, a simulated Face ID scan plays before the
  // confirmation is actually sent - authorization itself already happened
  // (the PIN), this is the visual verification step of the demo flow.
  // faceIdAudioDone syncs the visual to the spoken announcement so the
  // voice is never cut off by the animation ending first.
  const [faceIdRunning, setFaceIdRunning] = useState(false);
  const [faceIdAudioDone, setFaceIdAudioDone] = useState(false);

  const navRef = useRef(nav);
  navRef.current = nav;
  const processedTurn = useRef(0);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (navTimer.current) clearTimeout(navTimer.current);
  }, []);

  useEffect(() => {
    if (!lastTurn || lastTurn.id === processedTurn.current) return;
    processedTurn.current = lastTurn.id;
    if (navTimer.current) clearTimeout(navTimer.current);

    const { response } = lastTurn;
    const state = response.screen_state;
    const { stack, openTransfer, openAmount, goHome } = navRef.current;
    const top = stack[stack.length - 1];

    if (state.type === "confirm_payment") {
      const ident: unknown = response.params?.CreditorAccount?.Identification;
      const beneficiary = accountState?.beneficiaries.find((b) => b.account_number === ident);
      // Billers have no screen of their own; their confirmation shows as the
      // amount screen only when the payee is an actual beneficiary.
      if (!beneficiary) return;
      if (top?.screen === "amount" && top.beneficiary.account_number === beneficiary.account_number) {
        return; // touch flow - already sitting on this exact screen
      }
      if (top?.screen === "transfer") {
        openAmount(beneficiary, state.amount);
      } else {
        openTransfer();
        navTimer.current = setTimeout(() => {
          navRef.current.openAmount(beneficiary, state.amount);
        }, PUSH_STAGGER_MS);
      }
      return;
    }

    if (state.type === "balance") {
      if (stack.length > 0) goHome();
      return;
    }

    if (state.type === "beneficiaries") {
      if (!stack.some((s) => s.screen === "transfer")) openTransfer();
      return;
    }

    if (state.type === "success" && response.action === "domesticPayment") {
      if (stack.length > 0) {
        navTimer.current = setTimeout(() => navRef.current.goHome(), SUCCESS_LINGER_MS);
      }
    }
  }, [lastTurn, accountState]);

  // confirm_payment renders inside the amount screen when the matching
  // beneficiary screen is on top; for any other payee (e.g. a biller) the
  // card floats here instead so the prompt is never invisible.
  const topScreen = nav.stack[nav.stack.length - 1];
  const handledByAmountScreen =
    screenState.type === "confirm_payment" &&
    topScreen?.screen === "amount" &&
    topScreen.beneficiary.name === screenState.recipient;
  const showCard =
    OVERLAY_CARD_TYPES.has(screenState.type) ||
    (screenState.type === "confirm_payment" && !handledByAmountScreen);
  const confirming = confirmationStage !== "none";
  const voiceLabel = voiceState === "listening" ? "يستمع..." : voiceState === "speaking" ? "يتحدث..." : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-4 pb-24">
      {voiceLabel && (
        <span
          className="rounded-full bg-ink/85 px-4 py-1.5 text-sm font-semibold text-white"
          role="status"
        >
          {voiceLabel}
        </span>
      )}

      {showCard && (
        <div className="pointer-events-auto w-full">
          <DynamicResponseArea screenState={screenState} />
        </div>
      )}

      {faceIdRunning && (
        <div className="pointer-events-auto w-full rounded-2xl bg-white p-5 shadow-lg">
          <div className="flex justify-center">
            <FakeFaceId
              audioDone={faceIdAudioDone}
              onDone={() => {
                setFaceIdRunning(false);
                void resolveConfirmation(true);
              }}
            />
          </div>
        </div>
      )}

      {confirming && !faceIdRunning && (
        <div className="pointer-events-auto w-full rounded-2xl bg-white p-5 shadow-lg">
          {confirmationStage === "awaiting_biometric" ? (
            <p className="text-center text-lg font-medium text-ink" role="status">
              بانتظار التأكيد البيومتري...
            </p>
          ) : (
            <div className="flex justify-center">
              <PinFallback
                onResult={(confirmed) => {
                  if (confirmed) {
                    // Announce the Face ID check out loud alongside the
                    // scan animation - blind users must know what stage
                    // the confirmation is in without seeing the screen.
                    // The animation waits for this audio to finish.
                    const finish = () => {
                      setFaceIdAudioDone(true);
                      setFaceIdRunning(true);
                    };

                    if (session?.faceid_audio_url) {
                      setFaceIdAudioDone(false);
                      playPromptAudio(session.faceid_audio_url, finish);
                    } else {
                      finish();
                    }
                  } else {
                    void resolveConfirmation(false);
                  }
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
