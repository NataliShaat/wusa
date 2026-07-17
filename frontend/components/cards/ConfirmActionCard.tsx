import { Card, CardHeading } from "./Card";
import { WarningIcon } from "../icons";

const ACTION_LABEL_AR: Record<string, string> = {
  freezeCard: "تجميد البطاقة",
  unfreezeCard: "إلغاء تجميد البطاقة",
  addBeneficiary: "إضافة مستفيد جديد",
};

export function ConfirmActionCard({
  action,
  params,
}: {
  action: string;
  params: Record<string, unknown>;
}) {
  return (
    <Card tone="pending">
      <div className="flex items-center gap-2 mb-3">
        <WarningIcon className="w-6 h-6 text-accent-darker" />
        <CardHeading>{ACTION_LABEL_AR[action] ?? "تأكيد العملية"}</CardHeading>
      </div>
      {typeof params.cardLast4 === "string" && params.cardLast4 && (
        <p>البطاقة المنتهية بـ {String(params.cardLast4)}</p>
      )}
      {typeof params.Name === "string" && <p>{params.Name}</p>}
      {typeof params.Identification === "string" && (
        <p className="text-sm text-ink-soft">{String(params.Identification)}</p>
      )}
    </Card>
  );
}
