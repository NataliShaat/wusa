import type { AccountState, SessionResponse, TurnResponse } from "./types";

// Points at the FastAPI backend (backend/app.py), deployed separately from
// this Next.js app - set NEXT_PUBLIC_API_BASE_URL once a host is chosen.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export function audioUrl(path: string): string {
  return path.startsWith("http") ? path : `${API_BASE}${path}`;
}

export async function createSession(): Promise<SessionResponse> {
  const res = await fetch(`${API_BASE}/api/session`, { method: "POST" });
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
  return res.json();
}

export async function sendTurn(sessionId: string, audioBlob: Blob): Promise<TurnResponse> {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("audio", audioBlob, "utterance.webm");

  const res = await fetch(`${API_BASE}/api/turn`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`sendTurn failed: ${res.status}`);
  return res.json();
}

// STT only - no NLU, no action. Used by voice PIN entry so spoken digits
// reach the exact same validation path as typed digits.
export async function transcribeAudio(audioBlob: Blob): Promise<{ text: string; language: string }> {
  const form = new FormData();
  form.append("audio", audioBlob, "utterance.wav");

  const res = await fetch(`${API_BASE}/api/transcribe`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`transcribeAudio failed: ${res.status}`);
  return res.json();
}

export async function confirmTurn(sessionId: string, confirmed: boolean): Promise<TurnResponse> {
  const res = await fetch(`${API_BASE}/api/turn/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, confirmed }),
  });
  if (!res.ok) throw new Error(`confirmTurn failed: ${res.status}`);
  return res.json();
}

export async function fetchAccountState(sessionId: string): Promise<AccountState> {
  const res = await fetch(`${API_BASE}/api/state?session_id=${encodeURIComponent(sessionId)}`);
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
): Promise<TurnResponse> {
  const res = await fetch(`${API_BASE}/api/payment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      amount: payment.amount,
      currency: payment.currency,
      creditor_account_number: payment.creditorAccountNumber,
    }),
  });
  if (!res.ok) throw new Error(`startPayment failed: ${res.status}`);
  return res.json();
}
