import { Card } from "./Card";
import { ErrorIcon } from "../icons";

export function ErrorCard({ message }: { message: string }) {
  return (
    <Card tone="error">
      <div className="flex items-center gap-3">
        <ErrorIcon className="w-8 h-8 text-error shrink-0" />
        <p className="font-medium">{message}</p>
      </div>
    </Card>
  );
}
