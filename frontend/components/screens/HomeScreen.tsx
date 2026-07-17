"use client";


import { useEffect, useRef, useState } from "react";
import { useBankNav } from "@/components/navigation/bankNav";
import { useBank } from "@/components/BankProvider";
import {
  BellIcon,
  BillIcon,
  CardIcon,
  EyeIcon,
  EyeOffIcon,
  GridIcon,
  HeadsetIcon,
  HomeIcon,
  MicShieldIcon,
  PlusIcon,
  StatementIcon,
  TopUpIcon,
  TransferIcon,
} from "@/components/bank-icons";

// Live clock in Riyadh time (h:mm, no AM/PM, like the iOS status bar).
// Starts empty and fills in after mount so the server-rendered HTML never
// disagrees with the client (hydration safety).
function useRiyadhTime() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Riyadh",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const update = () => {
      const parts = formatter.formatToParts(new Date());
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      setTime(`${get("hour")}:${get("minute")}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// Fake iOS status bar so the demo reads as a native app screen. Purely
// decorative - hidden from assistive tech, and hidden entirely when the
// app runs installed (standalone), where the OS draws the real one.
function StatusBar() {
  const time = useRiyadhTime();
  return (
    <div
      dir="ltr"
      aria-hidden="true"
      className="standalone-hidden flex items-center justify-between px-6 pt-3 text-xs font-semibold"
    >
      <span>{time}</span>
      <span className="flex items-center gap-1.5">
        <svg viewBox="0 0 18 12" className="h-3 w-4 fill-current">
          <rect x="0" y="7" width="3" height="5" rx="1" />
          <rect x="5" y="5" width="3" height="7" rx="1" />
          <rect x="10" y="2.5" width="3" height="9.5" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 16 12" className="h-3 w-4 fill-current">
          <path d="M8 12L.8 4.8a10.2 10.2 0 0114.4 0L8 12z" />
        </svg>
        <svg viewBox="0 0 25 12" className="h-3 w-6">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3" fill="none" stroke="currentColor" />
          <rect x="2.5" y="2.5" width="15" height="7" rx="1.5" fill="currentColor" />
          <rect x="23" y="3.5" width="2" height="5" rx="1" fill="currentColor" />
        </svg>
      </span>
    </div>
  );
}

export function HomeScreen() {
  const { openTransfer } = useBankNav();
  const { accountState, screenState, voiceState, toggleVoice } = useBank();
  const [balanceVisible, setBalanceVisible] = useState(false);
  const [balanceFlash, setBalanceFlash] = useState(false);

  // Always the live backend value - there is no locally remembered balance.
  const account = accountState?.accounts[0] ?? null;
  const balance = account?.balance ?? null;

  // Reveal and flash the balance when a voice balance query answers, and
  // flash whenever the authoritative balance itself changes (a transfer
  // just debited it), so the spoken number and the screen always agree.
  const prevBalance = useRef<number | null>(null);
  useEffect(() => {
    const queried = screenState.type === "balance";
    const changed =
      prevBalance.current !== null && balance !== null && balance !== prevBalance.current;
    prevBalance.current = balance;
    if (!queried && !changed) return;
    setBalanceVisible(true);
    setBalanceFlash(true);
    const id = setTimeout(() => setBalanceFlash(false), 2000);
    return () => clearTimeout(id);
  }, [screenState, balance]);

  const voiceOn = voiceState !== "off";
  const voiceLabel = voiceState === "off" ? "متوقف" : voiceState === "listening" ? "يستمع" : "يتحدث";

  const quickActions = [
    {
      label: "التحويل السريع",
      icon: TransferIcon,
      onPress: openTransfer,
    },
    { label: "دفع الفواتير", icon: BillIcon },
    { label: "شحن الجوال", icon: TopUpIcon },
    { label: "كشف الحساب", icon: StatementIcon },
  ];

  return (
    <div className="relative flex h-full flex-col bg-surface-soft">
      <div className="flex-1 overflow-y-auto overscroll-contain pb-32">
        <header className="rounded-b-[28px] bg-ink pb-16 pt-[env(safe-area-inset-top)] text-white">
          <StatusBar />
          <div className="flex items-center justify-between px-4 pt-3">
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-lg font-bold"
                aria-hidden="true"
              >
                {account?.holder_name.trim().charAt(0) ?? ""}
              </span>
              <div>
                <p className="text-xs text-white/70">بنك تجريبي</p>
                <p className="text-base font-bold">{account?.holder_name ?? "جاري التحميل..."}</p>
              </div>
            </div>
            <div className="flex items-center">
              <button
                type="button"
                aria-label="الدعم الفني"
                className="flex h-11 w-11 items-center justify-center rounded-full"
              >
                <HeadsetIcon className="h-6 w-6" />
              </button>
              <button
                type="button"
                aria-label="الإشعارات - يوجد إشعار جديد"
                className="relative flex h-11 w-11 items-center justify-center rounded-full"
              >
                <BellIcon className="h-6 w-6" />
                <span className="absolute end-2.5 top-2 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        {}
        <section aria-label="الحساب الجاري" className="relative -mt-12 px-4">
          <div
            className={`rounded-2xl bg-white p-5 text-center shadow-sm transition-shadow ${
              balanceFlash ? "ring-4 ring-primary" : ""
            }`}
            aria-live="polite"
          >
            <p className="text-sm font-semibold text-ink-soft">
              {account?.holder_name} <span aria-hidden="true">•••</span> {account?.last4}
            </p>
            <div className="mt-2 flex items-center justify-center gap-1">
              <p className="text-3xl font-bold text-ink">
                {balanceVisible && balance !== null ? (
                  <>
                    {balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}{" "}
                    <span className="text-base font-semibold text-ink-soft">ر.س</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true" className="tracking-widest">
                      ********
                    </span>
                    <span className="sr-only">الرصيد مخفي</span>
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => setBalanceVisible((v) => !v)}
                aria-label={balanceVisible ? "إخفاء الرصيد" : "إظهار الرصيد"}
                className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft"
              >
                {balanceVisible ? <EyeOffIcon className="h-6 w-6" /> : <EyeIcon className="h-6 w-6" />}
              </button>
            </div>
            <span className="mt-3 inline-block rounded-full bg-teal-bg px-4 py-1 text-sm font-semibold text-teal">
              {account?.type === "checking" ? "جاري" : account?.type ?? ""}
            </span>
            <div className="mt-4 flex items-center justify-center gap-1.5" aria-hidden="true">
              <span className="h-1 w-6 rounded-full bg-ink" />
              <span className="h-1 w-1.5 rounded-full bg-surface" />
            </div>
          </div>
        </section>

        <section aria-label="إجراءات سريعة" className="mt-6 px-4">
          <div className="grid grid-cols-4 gap-2">
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onPress}
                className="flex min-h-[44px] flex-col items-center gap-2 rounded-xl py-1"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
                  <action.icon className="h-6 w-6 text-primary-dark" />
                </span>
                <span className="text-center text-xs font-semibold leading-tight text-ink">
                  {action.label}
                </span>
              </button>
            ))}
          </div>
        </section>

        {}
        <section aria-label="المساعد الصوتي" className="mt-6 px-4">
          <div className="flex items-center gap-4 rounded-2xl bg-lavender-soft p-5">
            <div className="flex-1">
              <h2 className="text-base font-bold text-ink">مساعدك المصرفي الصوتي!</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                أنجز تحويلاتك وفواتيرك بصوتك، بأمان وخصوصية تامة.
              </p>
            </div>
            <span className="flex shrink-0 flex-col items-center gap-1">
              <button
                type="button"
                role="switch"
                aria-checked={voiceOn}
                aria-label="تشغيل أو إيقاف المساعد الصوتي"
                onClick={toggleVoice}
                className={`flex h-16 w-16 items-center justify-center rounded-full transition-colors ${
                  voiceOn ? "bg-primary-dark text-white" : "bg-white text-primary-dark"
                }`}
              >
                <MicShieldIcon className={`h-9 w-9 ${voiceState === "listening" ? "animate-pulse" : ""}`} />
              </button>
              <span className="text-xs font-semibold text-ink-soft" aria-hidden="true">
                {voiceLabel}
              </span>
            </span>
          </div>
        </section>

        <section aria-label="البطاقات الجديدة" className="mt-6 px-4">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-bold text-ink">استكشف بطاقاتنا الجديدة</h2>
              <button
                type="button"
                className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-semibold text-white"
              >
                <PlusIcon className="h-4 w-4" />
                بطاقة جديدة
              </button>
            </div>
            <div className="mt-4 flex h-36 items-center justify-center rounded-xl border-2 border-dashed border-surface bg-surface-soft">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
                <PlusIcon className="h-6 w-6 text-ink-soft" />
              </span>
            </div>
          </div>
        </section>
      </div>

      <nav
        aria-label="التنقل الرئيسي"
        className="absolute inset-x-0 bottom-0 border-t border-surface bg-white pb-[max(env(safe-area-inset-bottom),8px)]"
      >
        <ul className="grid grid-cols-4">
          {[
            { label: "الرئيسية", icon: HomeIcon, active: true },
            {
              label: "التحويلات",
              icon: TransferIcon,
              onPress: openTransfer,
            },
            { label: "البطاقات", icon: CardIcon },
            { label: "المزيد", icon: GridIcon },
          ].map((tab) => (
            <li key={tab.label}>
              <button
                type="button"
                onClick={tab.onPress}
                aria-current={tab.active ? "page" : undefined}
                className={`flex min-h-[56px] w-full flex-col items-center justify-center gap-1 py-2 ${
                  tab.active ? "text-primary-dark" : "text-ink-soft"
                }`}
              >
                <tab.icon className="h-6 w-6" />
                <span className="text-[11px] font-semibold">{tab.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
