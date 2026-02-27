import { requireSession } from "@/lib/auth"

const DEFAULT_MOCK_DELAY = 180

function mockStream(threadId: string, message: string, model: string) {
  const encoder = new TextEncoder()
  const chunks = [
    `모델 ${model} 응답 시작... `,
    `스레드 ${threadId.slice(0, 8)} 기준으로 `,
    `"${message.slice(0, 80)}" 요청을 처리했습니다. `,
    "(MVP 스트리밍 데모)",
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
  const model = body.model ?? "gpt-5.3-codex"

  const upstream = process.env.OPENCLAW_CHAT_STREAM_URL
  const token = process.env.OPENCLAW_CHAT_STREAM_TOKEN

  // If upstream is configured, proxy SSE as-is.
  if (upstream) {
    try {
      const upstreamRes = await fetch(upstream, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ threadId, message, model }),
        cache: "no-store",
      })

      if (upstreamRes.ok && upstreamRes.body) {
        return new Response(upstreamRes.body, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        })
      }

      return new Response(mockStream(threadId, `${message}\n\n[OpenClaw 서버 연결 불안정으로 임시 응답 전환]`, model), {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-309agnet-Mode": "fallback",
        },
      })
    } catch {
      return new Response(mockStream(threadId, `${message}\n\n[OpenClaw 서버 연결 실패로 임시 응답 전환]`, model), {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-309agnet-Mode": "fallback",
        },
      })
    }
  }

  if (!allowMock) {
    return new Response("upstream_not_configured: set OPENCLAW_CHAT_STREAM_URL", { status: 503 })
  }

  // Fallback mock stream keeps app functional without external backend wiring.
  return new Response(mockStream(threadId, message, model), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-309agnet-Mode": "mock",
    },
  })
}
