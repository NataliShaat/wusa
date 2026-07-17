import { Card, CardHeading } from "./Card";
import type { Beneficiary } from "@/lib/types";

export function BeneficiariesCard({ beneficiaries }: { beneficiaries: Beneficiary[] }) {
  return (
    <Card>
      <CardHeading>المستفيدون</CardHeading>
      {beneficiaries.length === 0 ? (
        <p>لا يوجد مستفيدون مسجلون.</p>
      ) : (
        <ul className="divide-y divide-surface">
          {beneficiaries.map((b, i) => (
            <li key={i} className="py-2">
              <div className="font-semibold">{b.name}</div>
              <div className="text-sm text-ink-soft">{b.relation ?? ""} - {b.account_number}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
