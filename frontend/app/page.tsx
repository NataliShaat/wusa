"use client";

import { BankProvider } from "@/components/BankProvider";
import { BankOverlay } from "@/components/BankOverlay";
import { ScreenStack } from "@/components/navigation/ScreenStack";
import { HomeScreen } from "@/components/screens/HomeScreen";
import { TransferScreen } from "@/components/screens/TransferScreen";
import { AmountScreen } from "@/components/screens/AmountScreen";
import type { ScreenDescriptor } from "@/lib/screens";

function renderScreen(descriptor: ScreenDescriptor) {
  switch (descriptor.screen) {
    case "transfer":
      return <TransferScreen />;
    case "amount":
      return (
        <AmountScreen
          beneficiary={descriptor.beneficiary}
          initialAmount={descriptor.initialAmount}
        />
      );
  }
}

export default function Home() {
  // Full-bleed on phones (h-dvh tracks the real visible viewport as mobile
  // browser chrome collapses); capped to a centered phone-width column only
  // on tablet/desktop-size viewports.
  return (
    <main className="mx-auto h-dvh w-full sm:max-w-md">
      <BankProvider>
        <ScreenStack
          home={<HomeScreen />}
          renderScreen={renderScreen}
          overlay={<BankOverlay />}
        />
      </BankProvider>
    </main>
  );
}
