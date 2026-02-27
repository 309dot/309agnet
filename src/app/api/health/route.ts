import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const chatUrl = process.env.OPENCLAW_CHAT_URL || ""
  const streamUrl = process.env.OPENCLAW_CHAT_STREAM_URL || ""
  const hasChat = Boolean(chatUrl)
  const hasStream = Boolean(streamUrl)
  const allowMock = process.env.OPENCLAW_ALLOW_MOCK?.trim().toLowerCase() === "true"

  const mode = hasChat && hasStream ? "connected" : allowMock ? "mock" : "misconfigured"

  const reqHost = new URL(req.url).host
  const chatHost = hasChat ? new URL(chatUrl).host : null
  const streamHost = hasStream ? new URL(streamUrl).host : null

  return NextResponse.json({
    ok: mode !== "misconfigured",
    mode,
    checks: {
      chatUrl: hasChat,
      streamUrl: hasStream,
      allowMock,
    },
    upstream: {
      chatHost,
      streamHost,
      possibleSelfLoop: (chatHost === reqHost && streamHost === reqHost) || false,
    },
  })
}
