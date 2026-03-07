import { NextResponse } from "next/server"

type Connectivity = "ok" | "error"
type ProbeReason = "ok" | "missing_url" | "invalid_url" | "timeout" | "http_5xx" | "network"
type ProbeResult = {
  connectivity: Connectivity
  reason: ProbeReason
  latencyMs: number | null
  httpStatus: number | null
}

async function probeEndpoint(rawUrl: string): Promise<ProbeResult> {
  if (!rawUrl) {
    return { connectivity: "error", reason: "missing_url", latencyMs: null, httpStatus: null }
  }

  let origin = ""
  try {
    origin = new URL(rawUrl).origin
  } catch {
    return { connectivity: "error", reason: "invalid_url", latencyMs: null, httpStatus: null }
  }

  const startedAt = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 2000)

  try {
    const res = await fetch(origin, {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    })
    const latencyMs = Date.now() - startedAt

    if (res.status >= 500) {
      return { connectivity: "error", reason: "http_5xx", latencyMs, httpStatus: res.status }
    }

    return { connectivity: "ok", reason: "ok", latencyMs, httpStatus: res.status }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const isAbort = error instanceof DOMException && error.name === "AbortError"
    return {
      connectivity: "error",
      reason: isAbort ? "timeout" : "network",
      latencyMs,
      httpStatus: null,
    }
  } finally {
    clearTimeout(timeoutId)
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

  const chatProbe = await probeEndpoint(chatUrl)
  const streamProbe = await probeEndpoint(streamUrl)

  const hasConfig = hasChat && hasStream
  const hasReachability = chatProbe.connectivity === "ok" && streamProbe.connectivity === "ok"

  const mode = hasConfig ? (hasReachability ? "connected" : "unreachable") : allowMock ? "mock" : "misconfigured"

  return NextResponse.json({
    ok: mode === "connected" || mode === "mock",
    mode,
    checks: {
      chatUrl: hasChat,
      streamUrl: hasStream,
      allowMock,
      chatConnectivity: chatProbe.connectivity,
      streamConnectivity: streamProbe.connectivity,
      chatReason: chatProbe.reason,
      streamReason: streamProbe.reason,
      chatLatencyMs: chatProbe.latencyMs,
      streamLatencyMs: streamProbe.latencyMs,
      chatHttpStatus: chatProbe.httpStatus,
      streamHttpStatus: streamProbe.httpStatus,
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
