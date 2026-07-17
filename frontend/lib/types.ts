// Mirrors the screen_state contract built in backend/app.py - keep these
// two in sync. The backend decides what to render; the frontend only maps
// each shape to a component, it never re-derives meaning from `action`.

export type Transaction = {
  date: string;
  description: string;
  amount: number;
};

export type Beneficiary = {
  name: string;
  relation: string | null;
  account_number: string;
  bank: string;
};

export type Account = {
  type: string;
  balance: number;
  currency: string;
  last4: string;
  holder_name: string;
};

export type BankCard = {
  type: string;
  last4: string;
  status: string;
};

// Authoritative account snapshot the backend attaches to every response,
// rebuilt server-side from live state each time - the UI renders only this,
// never a locally remembered copy.
export type AccountState = {
  accounts: Account[];
  beneficiaries: Beneficiary[];
  cards: BankCard[];
  transactions: Transaction[];
};

export type ScreenState =
  | { type: "idle" }
  | { type: "processing" }
  | { type: "balance"; amount: number; currency: string; account_type: string }
  | { type: "transactions"; transactions: Transaction[] }
  | { type: "beneficiaries"; beneficiaries: Beneficiary[] }
  | { type: "exchange_rate"; source_currency: string; target_currency: string; rate: number }
  | {
      type: "confirm_payment";
      amount: number;
      currency: string;
      recipient: string | null;
      amount_source: "stated" | "inferred";
      reference: string | null;
    }
  | { type: "confirm_action"; action: "freezeCard" | "unfreezeCard" | "addBeneficiary"; [key: string]: unknown }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: "success"; message: string; data?: Record<string, any> }
  | { type: "error"; message: string; error_code?: string }
  | { type: "cancelled"; message: string }
  | { type: "clarification"; message: string };

// The ambient voice loop's state: off entirely, listening via VAD, or
// playing back a spoken response (mic paused so it can't hear itself).
export type VoiceState = "off" | "listening" | "speaking";

export type TurnResponse = {
  transcript: string;
  action: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>;
  requires_confirmation: boolean;
  screen_state: ScreenState;
  spoken_text: string;
  audio_url: string;
  account_state: AccountState;
};

export type SessionResponse = {
  session_id: string;
  greeting_text: string;
  greeting_audio_url: string;
  // Fixed confirmation-flow prompts ("" when server TTS was unavailable).
  pin_prompt_audio_url: string;
  faceid_audio_url: string;
  account_state: AccountState;
};
