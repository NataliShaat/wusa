import { Card } from "./Card";

export function CancelledCard({ message }: { message: string }) {
  return (
    <Card>
      <p className="font-medium text-ink-soft">{message}</p>
    </Card>
  );
}
