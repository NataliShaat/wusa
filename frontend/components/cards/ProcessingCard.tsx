export function ProcessingCard() {
  return (
    <div className="w-full max-w-md flex items-center gap-3 p-6 text-lg text-ink-soft">
      <span
        className="w-5 h-5 rounded-full border-4 border-surface border-t-primary animate-spin shrink-0"
        aria-hidden="true"
      />
      <p>...جارٍ التنفيذ</p>
    </div>
  );
}
