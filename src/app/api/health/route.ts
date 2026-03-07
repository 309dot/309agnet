import { NextResponse } from "next/server"

type Connectivity = "ok" | "error"

async function probeEndpoint(rawUrl: string): Promise<Connectivity> {
  if (!rawUrl) return "error"

  try {
    const origin = new URL(rawUrl).origin
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)

    try {
      const res = await fetch(origin, {
        method: "HEAD",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
      })
      return res.status < 500 ? "ok" : "error"
    } finally {
      clearTimeout(timeoutId)
    }
  } catch {
    return "error"
  }
}

export async function GET(req: Request) {
  const chatUrl = process.env.OPENCLAW_CHAT_URL || ""
  const streamUrl = process.env.OPENCLAW_CHAT_STREAM_URL || ""
  const hasChat = Boolean(chatUrl)
  const hasStream = Boolean(streamUrl)
  const allowMock = process.env.OPENCLAW_ALLOW_MOCK?.trim().toLowerCase() === "true"
  const hasUpstreamContextSecret = Boolean(process.env.OPENCLAW_UPSTREAM_CONTEXT_SECRET?.trim())
  const hasChatToken = Boolean(process.env.OPENCLAW_CHAT_TOKEN?.trim())
  const hasStreamToken = Boolean(process.env.OPENCLAW_CHAT_STREAM_TOKEN?.trim())

  const reqHost = new URL(req.url).host
  const chatHost = hasChat ? new URL(chatUrl).host : null
  const streamHost = hasStream ? new URL(streamUrl).host : null

  const chatConnectivity = hasChat ? await probeEndpoint(chatUrl) : "error"
  const streamConnectivity = hasStream ? await probeEndpoint(streamUrl) : "error"

  const hasConfig = hasChat && hasStream
  const hasReachability = chatConnectivity === "ok" && streamConnectivity === "ok"

  const mode = hasConfig ? (hasReachability ? "connected" : "unreachable") : allowMock ? "mock" : "misconfigured"

  return NextResponse.json({
    ok: mode === "connected" || mode === "mock",
    mode,
    checks: {
      chatUrl: hasChat,
      streamUrl: hasStream,
      allowMock,
      chatConnectivity,
      streamConnectivity,
    },
    security: {
      hasUpstreamContextSecret,
      hasChatToken,
      hasStreamToken,
    },
    upstream: {
      chatHost,
      streamHost,
      possibleSelfLoop: (chatHost === reqHost && streamHost === reqHost) || false,
    },
  })
}
