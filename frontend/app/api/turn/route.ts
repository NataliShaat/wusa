import { NextResponse } from "next/server";
import { handleTurn, parseAccountState, transcribeAudioBlob } from "@/lib/server";

export async function POST(req: Request) {
  const formData = await req.formData();
  const audio = formData.get("audio");
  const text = formData.get("text");
  const rawState = formData.get("account_state");
  const dialect = String(formData.get("dialect") ?? "") || null;

  const state = parseAccountState(rawState ? JSON.parse(String(rawState)) : null);

  let transcript = "";
  let language: "ar" | "en" = "ar";
  if (typeof text === "string" && text.trim()) {
    // Text bypass for development/testing without recording audio.
    transcript = text.trim();
    language = /[؀-ۿ]/.test(transcript) ? "ar" : "en";
  } else if (audio instanceof File) {
    const heard = await transcribeAudioBlob(audio);
    transcript = heard.text;
    language = heard.language;
  } else {
    return NextResponse.json({ error: "either audio or text is required" }, { status: 422 });
  }

  return NextResponse.json(await handleTurn(state, dialect, transcript, language));
}
