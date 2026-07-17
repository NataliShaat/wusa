export function Card({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "error" | "pending";
}) {
  const toneClasses: Record<string, string> = {
    neutral: "bg-surface-soft border-surface",
    success: "bg-success-bg border-success",
    error: "bg-error-bg border-error",
    pending: "bg-surface border-accent-dark",
  };

  return (
    <div
      className={`w-full max-w-md rounded-[var(--radius-card)] border-2 p-6 text-lg leading-relaxed ${toneClasses[tone]}`}
    >
      {children}
    </div>
  );
}

export function CardHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-semibold mb-3">{children}</h2>;
}
