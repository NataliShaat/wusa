import { Card, CardHeading } from "./Card";
import { WarningIcon } from "../icons";

export function ConfirmPaymentCard({
  amount,
  currency,
  recipient,
  amountSource,
}: {
  amount: number;
  currency: string;
  recipient: string | null;
  amountSource: "stated" | "inferred";
}) {
  return (
    <Card tone="pending">
      <div className="flex items-center gap-2 mb-3">
        <WarningIcon className="w-6 h-6 text-accent-darker" />
        <CardHeading>تأكيد العملية</CardHeading>
      </div>
      {amountSource === "inferred" && (
        <p className="mb-2 text-sm text-accent-darker font-medium">
          هذا مبلغ تقديري بناءً على آخر فاتورة، وليس مبلغاً مؤكداً بعد.
        </p>
      )}
      <p className="text-2xl font-bold text-ink mb-1">
        {amount.toFixed(2)} {currency}
      </p>
      {recipient && <p className="text-lg">إلى {recipient}</p>}
    </Card>
  );
}
