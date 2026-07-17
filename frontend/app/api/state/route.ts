import { NextResponse } from "next/server";
import { defaultAccountState } from "@/lib/server";

// Stateless deployment: the authoritative account_state rides on every
// turn response, so this endpoint only serves the initial default state.
export async function GET() {
  return NextResponse.json({ account_state: defaultAccountState() });
}
