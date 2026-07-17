import type { AccountState, SessionResponse, TurnResponse } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";
const BASE = API_BASE || "";

export function audioUrl(path: string): string {
  if (path.startsWith("http") || path.startsWith("data:")) {
    return path;
  }
  return `${BASE}${path}`;
}

export async function createSession(): Promise<SessionResponse> {
  const res = await fetch(`${BASE}/api/session`, { method: "POST" });
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
  return res.json();
}

// account_state/dialect/pending_intent ride along for the stateless
// serverless backend; the local FastAPI backend simply ignores the extra
// fields and uses its own server-side session instead.
export type TurnContext = {
  accountState: AccountState | null;
  dialect: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingIntent?: Record<string, any> | null;
};

export async function sendTurn(sessionId: string, audioBlob: Blob, ctx: TurnContext): Promise<TurnResponse> {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("audio", audioBlob, "utterance.wav");
  if (ctx.accountState) form.append("account_state", JSON.stringify(ctx.accountState));
  if (ctx.dialect) form.append("dialect", ctx.dialect);

  const res = await fetch(`${BASE}/api/turn`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`sendTurn failed: ${res.status}`);
  return res.json();
}

// STT only - no NLU, no action. Used by voice PIN entry so spoken digits
// reach the exact same validation path as typed digits.
export async function transcribeAudio(audioBlob: Blob): Promise<{ text: string; language: string }> {
  const form = new FormData();
  form.append("audio", audioBlob, "utterance.wav");

  const res = await fetch(`${BASE}/api/transcribe`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`transcribeAudio failed: ${res.status}`);
  return res.json();
}

export async function confirmTurn(sessionId: string, confirmed: boolean, ctx: TurnContext): Promise<TurnResponse> {
  const res = await fetch(`${BASE}/api/turn/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      confirmed,
      account_state: ctx.accountState,
      pending_intent: ctx.pendingIntent ?? null,
      dialect: ctx.dialect,
    }),
  });
  if (!res.ok) throw new Error(`confirmTurn failed: ${res.status}`);
  return res.json();
}

export async function fetchAccountState(sessionId: string): Promise<AccountState> {
  const res = await fetch(`${BASE}/api/state?session_id=${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(`fetchAccountState failed: ${res.status}`);
  const body = await res.json();
  return body.account_state;
}

// Touch-initiated transfer (amount screen). Returns the same pending
// confirmation turn a voice payment produces - execution still only happens
// through confirmTurn, so confirmation stays enforced server-side.
export async function startPayment(
  sessionId: string,
  payment: { amount: number; currency: string; creditorAccountNumber: string },
  ctx: TurnContext,
): Promise<TurnResponse> {
  const res = await fetch(`${BASE}/api/payment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      amount: payment.amount,
      currency: payment.currency,
      creditor_account_number: payment.creditorAccountNumber,
      account_state: ctx.accountState,
      dialect: ctx.dialect,
    }),
  });
  if (!res.ok) throw new Error(`startPayment failed: ${res.status}`);
  return res.json();
}
