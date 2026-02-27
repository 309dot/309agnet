import { requireSession } from "@/lib/auth"
import { getOpenClawJob } from "@/lib/openclaw-jobs-store"

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
  } catch {
    return new Response("unauthorized", { status: 401 })
  }

  const { id } = await ctx.params
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let loops = 0
      const maxLoops = 240

      while (loops < maxLoops) {
        const job = await getOpenClawJob(id)
        if (!job) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "not_found" })}\n\n`))
          controller.close()
          return
        }

        controller.enqueue(
          encoder.encode(
            `event: status\ndata: ${JSON.stringify({
              jobId: job.id,
              status: job.status,
              result: job.result,
              error: job.error,
              artifactPath: job.artifactPath,
              updatedAt: job.updatedAt,
            })}\n\n`,
          ),
        )

        if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
          controller.enqueue(encoder.encode("event: done\ndata: [DONE]\n\n"))
          controller.close()
          return
        }

        loops += 1
        await new Promise((r) => setTimeout(r, 1000))
      }

      controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "stream_timeout" })}\n\n`))
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
