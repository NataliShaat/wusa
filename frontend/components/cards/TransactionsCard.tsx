import { Card, CardHeading } from "./Card";
import type { Transaction } from "@/lib/types";

export function TransactionsCard({ transactions }: { transactions: Transaction[] }) {
  return (
    <Card>
      <CardHeading>آخر العمليات</CardHeading>
      {transactions.length === 0 ? (
        <p>لا توجد عمليات.</p>
      ) : (
        <ul className="divide-y divide-surface">
          {transactions.map((t, i) => (
            <li key={i} className="flex justify-between items-baseline py-2 gap-4">
              <span className="text-sm text-ink-soft">{t.date}</span>
              <span className="flex-1">{t.description}</span>
              <span className={t.amount >= 0 ? "text-success font-semibold" : "text-ink font-semibold"}>
                {t.amount >= 0 ? "+" : ""}
                {t.amount.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
