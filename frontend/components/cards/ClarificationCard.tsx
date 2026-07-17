import { Card } from "./Card";
import { MicIcon } from "../icons";

export function ClarificationCard({ message }: { message: string }) {
  return (
    <Card tone="pending">
      <div className="flex items-center gap-3">
        <MicIcon className="w-6 h-6 text-accent-darker shrink-0" />
        <p className="font-medium">{message}</p>
      </div>
    </Card>
  );
}
