import type { Beneficiary } from "./types";

export type ScreenDescriptor =
  | { screen: "transfer" }
  // initialAmount is set when voice arrives with the amount already parsed -
  // the amount screen prefills it but is otherwise the same screen touch uses.
  | { screen: "amount"; beneficiary: Beneficiary; initialAmount?: number };

// Last four digits of an IBAN-style identifier, for masked display.
export function maskedAccount(accountNumber: string) {
  const digits = accountNumber.replace(/\s/g, "");
  return digits.slice(-4);
}
