"use client";

import { useNav } from "@/components/navigation/ScreenStack";
import { ChevronRightIcon } from "@/components/bank-icons";

export function ScreenHeader({ title }: { title: string }) {
  const { pop } = useNav();
  return (
    <header className="shrink-0 border-b border-surface bg-white pt-[env(safe-area-inset-top)]">
      <div className="relative flex h-14 items-center justify-center px-14">
        <button
          type="button"
          onClick={pop}
          aria-label="رجوع"
          className="absolute start-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-ink"
        >
          <ChevronRightIcon className="h-6 w-6" />
        </button>
        <h1 className="truncate text-lg font-bold text-ink">{title}</h1>
      </div>
    </header>
  );
}
