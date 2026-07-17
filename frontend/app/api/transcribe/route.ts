import { NextResponse } from "next/server";
import { transcribeAudioBlob } from "@/lib/server";

export async function POST(req: Request) {
  const formData = await req.formData();
  const audio = formData.get("audio");

  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "audio file is required" }, { status: 400 });
  }

  const transcript = await transcribeAudioBlob(audio);
  return NextResponse.json(transcript);
}
