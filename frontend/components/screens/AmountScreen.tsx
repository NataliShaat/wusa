"use client";

// Amount entry step, pushed after picking a beneficiary - by tap or by a
// voice intent (which arrives with initialAmount already parsed). The
// continue button starts a real payment through POST /api/payment, which
// parks it as a pending confirmation server-side exactly like a voice
// payment; execution only ever happens after the biometric/PIN confirm.

import { useState } from "react";
import { ScreenHeader } from "@/components/screens/ScreenHeader";
import {
  BeneficiaryAvatar,
  BeneficiaryRowDetails,
} from "@/components/screens/TransferScreen";
import { ConfirmPaymentCard } from "@/components/cards/ConfirmPaymentCard";
import { useBank } from "@/components/BankProvider";
import type { Beneficiary } from "@/lib/types";

const QUICK_AMOUNTS = [50, 100, 500];

export function AmountScreen({
  beneficiary,
  initialAmount,
}: {
  beneficiary: Beneficiary;
  initialAmount?: number;
}) {
  const { accountState, screenState, startTouchPayment } = useBank();
  const [amount, setAmount] = useState(
    initialAmount !== undefined ? String(initialAmount) : "",
  );

  const account = accountState?.accounts[0] ?? null;
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  // The backend's pending confirmation for THIS beneficiary renders inside
  // this screen; the floating overlay shows it for any other payee.
  const confirmingHere =
    screenState.type === "confirm_payment" && screenState.recipient === beneficiary.name;
  const busy = screenState.type === "processing" || confirmingHere;

  return (
    <div className="flex h-full flex-col bg-surface-soft">
      <ScreenHeader title="مبلغ التحويل" />
      <div className="flex flex-1 flex-col overflow-y-auto overscroll-contain p-4 pb-[max(env(safe-area-inset-bottom),16px)]">
        <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
          <BeneficiaryAvatar beneficiary={beneficiary} index={0} />
          <BeneficiaryRowDetails beneficiary={beneficiary} />
        </div>

        <div className="mt-10 text-center">
          <label htmlFor="transfer-amount" className="text-sm font-semibold text-ink-soft">
            المبلغ
          </label>
          <div className="mt-3 flex items-baseline justify-center gap-2">
            <input
              id="transfer-amount"
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amount}
              disabled={busy}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="w-44 border-b-2 border-surface bg-transparent pb-1 text-center text-4xl font-bold text-ink placeholder:text-ink-soft/70 focus:border-primary-dark disabled:opacity-60"
            />
            <span className="text-lg font-semibold text-ink-soft">ر.س</span>
          </div>
          <p className="mt-3 text-sm text-ink-soft">
            من الحساب الجاري <span aria-hidden="true">•••</span> {account?.last4}
          </p>
        </div>

        <div className="mt-8 flex justify-center gap-3">
          {QUICK_AMOUNTS.map((quick) => (
            <button
              key={quick}
              type="button"
              disabled={busy}
              onClick={() => setAmount(String(quick))}
              className="h-11 rounded-full border border-surface bg-white px-6 text-sm font-semibold text-ink disabled:opacity-40"
            >
              {quick}
            </button>
          ))}
        </div>

        <div className="mt-auto pt-8">
          {confirmingHere ? (
            <div className="flex flex-col items-center gap-3">
              <ConfirmPaymentCard
                amount={screenState.amount}
                currency={screenState.currency}
                recipient={screenState.recipient}
                amountSource={screenState.amount_source}
              />
              <p role="status" className="text-center text-sm font-semibold text-ink-soft">
                أكد العملية بالبصمة أو الرقم السري للمتابعة.
              </p>
            </div>
          ) : (
            <button
              type="button"
              disabled={!valid || busy}
              onClick={() => void startTouchPayment(beneficiary, value)}
              className="h-12 w-full rounded-full bg-ink text-base font-bold text-white disabled:opacity-40"
            >
              متابعة
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
