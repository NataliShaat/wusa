import { Card, CardHeading } from "./Card";

export function ExchangeRateCard({
  sourceCurrency,
  targetCurrency,
  rate,
}: {
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
}) {
  return (
    <Card>
      <CardHeading>سعر الصرف</CardHeading>
      <p className="text-2xl font-bold text-ink">
        1 {sourceCurrency} = {rate} {targetCurrency}
      </p>
    </Card>
  );
}
