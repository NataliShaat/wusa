import type { ScreenState } from "@/lib/types";
import { BalanceCard } from "./cards/BalanceCard";
import { TransactionsCard } from "./cards/TransactionsCard";
import { BeneficiariesCard } from "./cards/BeneficiariesCard";
import { ExchangeRateCard } from "./cards/ExchangeRateCard";
import { ConfirmPaymentCard } from "./cards/ConfirmPaymentCard";
import { ConfirmActionCard } from "./cards/ConfirmActionCard";
import { SuccessCard } from "./cards/SuccessCard";
import { ErrorCard } from "./cards/ErrorCard";
import { CancelledCard } from "./cards/CancelledCard";
import { ClarificationCard } from "./cards/ClarificationCard";
import { ProcessingCard } from "./cards/ProcessingCard";

// The backend decides what to render via screen_state - this component only
// maps each shape to a card, it never re-derives meaning from action names.
// aria-live announces every state change automatically to screen readers,
// since the screen updates without the user manually navigating to it.
// "assertive" for states needing immediate attention, "polite" otherwise.
const ASSERTIVE_TYPES = new Set(["error", "confirm_payment", "confirm_action"]);

export function DynamicResponseArea({ screenState }: { screenState: ScreenState }) {
  const live = ASSERTIVE_TYPES.has(screenState.type) ? "assertive" : "polite";

  return (
    <div aria-live={live} aria-atomic="true" className="flex justify-center w-full">
      {renderCard(screenState)}
    </div>
  );
}

function renderCard(state: ScreenState) {
  switch (state.type) {
    case "idle":
      return null;
    case "processing":
      return <ProcessingCard />;
    case "balance":
      return <BalanceCard amount={state.amount} currency={state.currency} accountType={state.account_type} />;
    case "transactions":
      return <TransactionsCard transactions={state.transactions} />;
    case "beneficiaries":
      return <BeneficiariesCard beneficiaries={state.beneficiaries} />;
    case "exchange_rate":
      return (
        <ExchangeRateCard sourceCurrency={state.source_currency} targetCurrency={state.target_currency} rate={state.rate} />
      );
    case "confirm_payment":
      return (
        <ConfirmPaymentCard
          amount={state.amount}
          currency={state.currency}
          recipient={state.recipient}
          amountSource={state.amount_source}
        />
      );
    case "confirm_action":
      return <ConfirmActionCard action={state.action} params={state} />;
    case "success":
      return <SuccessCard message={state.message} />;
    case "error":
      return <ErrorCard message={state.message} />;
    case "cancelled":
      return <CancelledCard message={state.message} />;
    case "clarification":
      return <ClarificationCard message={state.message} />;
  }
}
