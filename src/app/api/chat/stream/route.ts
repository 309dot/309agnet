export async function POST(req: Request) {
  const body = (await req.json()) as { threadId?: string; message?: string; model?: string }
  const threadId = body.threadId ?? "unknown"
  const message = body.message ?? ""
  const model = body.model ?? "gpt-5.3-codex"

  const encoder = new TextEncoder()
  const chunks = [
    `모델 ${model} 응답 시작... `,
    `스레드 ${threadId.slice(0, 8)} 기준으로 `,
    `"${message.slice(0, 80)}" 요청을 처리했습니다. `,
    "(MVP 스트리밍 데모)"
  ]

  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`))
        await new Promise((r) => setTimeout(r, 180))
      }
      controller.enqueue(encoder.encode("event: done\ndata: [DONE]\n\n"))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
