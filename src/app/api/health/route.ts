import { NextResponse } from "next/server"

export async function GET() {
  const hasChat = Boolean(process.env.OPENCLAW_CHAT_URL)
  const hasStream = Boolean(process.env.OPENCLAW_CHAT_STREAM_URL)
  const allowMock = process.env.OPENCLAW_ALLOW_MOCK?.trim().toLowerCase() === "true"

  const mode = hasChat && hasStream ? "connected" : allowMock ? "mock" : "misconfigured"

  return NextResponse.json({
    ok: mode !== "misconfigured",
    mode,
    checks: {
      chatUrl: hasChat,
      streamUrl: hasStream,
      allowMock,
    },
  })
}
