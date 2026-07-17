import { NextResponse } from "next/server";
import { handleConfirm, parseAccountState, parsePendingIntent } from "@/lib/server";

export async function POST(req: Request) {
  const body = await req.json();
  const state = parseAccountState(body.account_state);
  const pending = parsePendingIntent(body.pending_intent);
  const dialect = body.dialect ? String(body.dialect) : null;

  return NextResponse.json(await handleConfirm(state, pending, Boolean(body.confirmed), dialect));
}
