import { NextResponse } from "next/server";
import { buildSessionResponse } from "@/lib/server";

export async function POST() {
  return NextResponse.json(await buildSessionResponse());
}
