import { NextResponse } from "next/server"

export async function POST(req: Request) {
  const body = (await req.json()) as { threadId?: string; message?: string; model?: string }
  const threadId = body.threadId ?? "unknown"
  const message = body.message ?? ""
  const model = body.model ?? "gpt-5.3-codex"

  // TODO: replace with real OpenClaw Gateway call
  await new Promise((r) => setTimeout(r, 250))

  return NextResponse.json({
    text: `(MVP Mock API) model=${model} thread=${threadId.slice(0, 8)}: ${message.slice(0, 120)}`,
  })
}
