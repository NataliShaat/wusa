import { Card, CardHeading } from "./Card";

const ACCOUNT_TYPE_AR: Record<string, string> = { checking: "الجاري", savings: "التوفير" };

export function BalanceCard({
  amount,
  currency,
  accountType,
}: {
  amount: number;
  currency: string;
  accountType: string;
}) {
  return (
    <Card>
      <CardHeading>رصيد حسابك {ACCOUNT_TYPE_AR[accountType] ?? accountType}</CardHeading>
      <p className="text-3xl font-bold text-ink">
        {amount.toFixed(2)} <span className="text-xl font-normal">{currency}</span>
      </p>
    </Card>
  );
}
