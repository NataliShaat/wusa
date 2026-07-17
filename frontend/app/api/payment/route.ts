import { NextResponse } from "next/server";
import { handlePaymentRequest, parseAccountState } from "@/lib/server";

export async function POST(req: Request) {
  const body = await req.json();
  const state = parseAccountState(body.account_state);
  const dialect = body.dialect ? String(body.dialect) : null;

  return NextResponse.json(await handlePaymentRequest(state, dialect, body));
}
