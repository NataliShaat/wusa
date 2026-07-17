import { Card } from "./Card";
import { CheckIcon } from "../icons";

export function SuccessCard({ message }: { message: string }) {
  return (
    <Card tone="success">
      <div className="flex items-center gap-3">
        <CheckIcon className="w-8 h-8 text-success shrink-0" />
        <p className="font-medium">{message}</p>
      </div>
    </Card>
  );
}
