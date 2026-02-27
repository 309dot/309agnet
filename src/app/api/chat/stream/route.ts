import { requireSession } from "@/lib/auth"

const DEFAULT_MOCK_DELAY = 180
const DEFAULT_BACKUP_STREAM_URL = "https://ocbridge.309designlab.com/chat/stream"

function extractUserPrompt(message: string) {
  const marker = "사용자 요청:\n"
  const idx = message.indexOf(marker)
  if (idx < 0) return message
  return message.slice(idx + marker.length).trim()
}

function mockStream(message: string) {
  const encoder = new TextEncoder()
  const chunks = [
    "요청을 처리하는 중입니다. ",
    `${message.slice(0, 80)} `,
    "(임시 응답 모드)",
  ]

  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`))
        await new Promise((r) => setTimeout(r, DEFAULT_MOCK_DELAY))
      }
      controller.enqueue(encoder.encode("event: done\ndata: [DONE]\n\n"))
      controller.close()
    },
  })
}

async function requestUpstreamStream(url: string, token: string | undefined, payload: { threadId: string; message: string; model: string }) {
  const upstreamRes = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  })

  if (!upstreamRes.ok || !upstreamRes.body) {
    throw new Error(`upstream_error:${upstreamRes.status}`)
  }

  return upstreamRes.body
}

export async function POST(req: Request) {
  try {
    await requireSession()
  } catch {
    return new Response("unauthorized", { status: 401 })
  }

  const allowMock = process.env.OPENCLAW_ALLOW_MOCK?.trim().toLowerCase() === "true"
  const body = (await req.json()) as { threadId?: string; message?: string; model?: string }
  const threadId = body.threadId ?? "unknown"
  const message = body.message ?? ""
  const userPrompt = extractUserPrompt(message)
  const model = body.model ?? "gpt-5.3-codex"

  const upstream = process.env.OPENCLAW_CHAT_STREAM_URL
  const token = process.env.OPENCLAW_CHAT_STREAM_TOKEN
  const backupUpstream = process.env.OPENCLAW_CHAT_STREAM_BACKUP_URL || DEFAULT_BACKUP_STREAM_URL

  if (upstream) {
    const payload = { threadId, message, model }

    try {
      const bodyStream = await requestUpstreamStream(upstream, token, payload)
      return new Response(bodyStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      })
    } catch {
      try {
        const bodyStream = await requestUpstreamStream(backupUpstream, undefined, payload)
        return new Response(bodyStream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-309agnet-Mode": "backup-upstream",
          },
        })
      } catch {
        return new Response(mockStream(`요청: ${userPrompt.slice(0, 80)}\n\n[OpenClaw 서버 연결 실패로 임시 응답 전환]`), {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-309agnet-Mode": "fallback",
          },
        })
      }
    }
  }

  if (!allowMock) {
    return new Response("upstream_not_configured: set OPENCLAW_CHAT_STREAM_URL", { status: 503 })
  }

  return new Response(mockStream(userPrompt), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-309agnet-Mode": "mock",
    },
  })
}
