"use client";

// The shared screen transitions. Every navigation in the app - whether
// triggered by a tap handler or by a parsed voice intent - goes through
// exactly these functions, so touch and voice can never drift apart: same
// push/pop calls, same slide animations, same back stack.

import { useCallback, useMemo } from "react";
import { useNav } from "@/components/navigation/ScreenStack";
import type { Beneficiary } from "@/lib/types";

export function useBankNav() {
  const { push, pop, popAll, stack } = useNav();

  // Home -> transfer screen (quick action, the transfers tab, or a voice
  // transfer/beneficiaries intent).
  const openTransfer = useCallback(() => {
    push({ screen: "transfer" });
  }, [push]);

  // Transfer screen -> amount entry for one beneficiary (tapping a row, or
  // voice resolving a recipient). initialAmount prefills the field when the
  // utterance already contained the amount.
  const openAmount = useCallback(
    (beneficiary: Beneficiary, initialAmount?: number) => {
      push({ screen: "amount", beneficiary, initialAmount });
    },
    [push],
  );

  // One screen back (header back button, edge swipe, Escape).
  const goBack = pop;

  // All the way back to home (after a completed action, or a voice query
  // answered on the home screen).
  const goHome = popAll;

  return useMemo(
    () => ({ openTransfer, openAmount, goBack, goHome, stack }),
    [openTransfer, openAmount, goBack, goHome, stack],
  );
}
