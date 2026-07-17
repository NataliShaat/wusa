"use client";

// Transfer screen: search, pinned "add beneficiary" row, and the
// beneficiaries list. Selecting a beneficiary pushes the amount screen.

import { useState } from "react";
import { useBankNav } from "@/components/navigation/bankNav";
import { useBank } from "@/components/BankProvider";
import { ScreenHeader } from "@/components/screens/ScreenHeader";
import { maskedAccount } from "@/lib/screens";
import type { Beneficiary } from "@/lib/types";
import { ChevronLeftIcon, SearchIcon, UserPlusIcon } from "@/components/bank-icons";

// Light avatar fills cycled per row; text stays ink on all of them so
// every combination passes AA contrast.
const AVATAR_FILLS = ["bg-lavender-soft", "bg-teal-bg", "bg-surface"];

export function BeneficiaryAvatar({
  beneficiary,
  index,
}: {
  beneficiary: Beneficiary;
  index: number;
}) {
  return (
    <span
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-ink ${
        AVATAR_FILLS[index % AVATAR_FILLS.length]
      }`}
      aria-hidden="true"
    >
      {beneficiary.name.trim().charAt(0)}
    </span>
  );
}

export function BeneficiaryRowDetails({ beneficiary }: { beneficiary: Beneficiary }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-semibold text-ink">{beneficiary.name}</span>
      <span className="block truncate text-sm text-ink-soft">
        {beneficiary.bank}{" "}
        <span dir="ltr" className="whitespace-nowrap">
          **** {maskedAccount(beneficiary.account_number)}
        </span>
      </span>
    </span>
  );
}

export function TransferScreen() {
  const { openAmount } = useBankNav();
  const { accountState } = useBank();
  const [query, setQuery] = useState("");

  // The live beneficiary list from the backend - the same list voice
  // transfers are resolved against.
  const beneficiaries = accountState?.beneficiaries ?? [];
  const normalized = query.trim();
  const filtered = beneficiaries.filter(
    (b) => b.name.includes(normalized) || b.bank.includes(normalized),
  );

  return (
    <div className="flex h-full flex-col bg-surface-soft">
      <ScreenHeader title="تحويل" />
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(env(safe-area-inset-bottom),16px)]">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-soft" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم المستفيد أو البنك"
            aria-label="البحث في المستفيدين"
            className="h-12 w-full rounded-full border border-surface bg-white pe-4 ps-12 text-ink placeholder:text-ink-soft/70"
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
          <button
            type="button"
            className="flex min-h-[64px] w-full items-center gap-3 border-b border-surface px-4 py-3 text-start"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-bg">
              <UserPlusIcon className="h-6 w-6 text-teal" />
            </span>
            <span className="font-semibold text-teal">إضافة مستفيد جديد</span>
          </button>

          {filtered.length > 0 ? (
            <ul className="divide-y divide-surface">
              {filtered.map((beneficiary, index) => (
                <li key={beneficiary.account_number}>
                  <button
                    type="button"
                    onClick={() => openAmount(beneficiary)}
                    className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-start"
                  >
                    <BeneficiaryAvatar beneficiary={beneficiary} index={index} />
                    <BeneficiaryRowDetails beneficiary={beneficiary} />
                    <ChevronLeftIcon className="h-5 w-5 shrink-0 text-ink-soft opacity-60" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status" className="px-4 py-8 text-center text-ink-soft">
              {accountState === null ? "جاري تحميل المستفيدين..." : "لا توجد نتائج مطابقة لبحثك."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
