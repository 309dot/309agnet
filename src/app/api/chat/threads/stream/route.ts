import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth"
import { kvPipeline, resolveKvConfig } from "@/lib/kv"

function versionKeyForUser(userId: string) {
  return `openclaw:threads:ver:${userId}`
}

async function requireAccountUserId() {
  const session = await requireSession()
  if (!session.userId || session.authType !== "account") {
    throw new Error("account_session_required")
  }
  return session.userId
}

async function getThreadVersion(kv: NonNullable<ReturnType<typeof resolveKvConfig>>, userId: string) {
  const raw = await kvPipeline(kv, ["GET", versionKeyForUser(userId)])
  if (!raw) return "0"
  if (typeof raw !== "string") return "0"

  try {
    const parsed = JSON.parse(raw) as { version?: unknown }
    if (typeof parsed?.version === "number" || typeof parsed?.version === "string") {
      return String(parsed.version)
    }
  } catch {
    // ignore malformed value
  }

  return "0"
}

export async function GET() {
  try {
    const userId = await requireAccountUserId()
    const kv = resolveKvConfig()
    if (!kv) return NextResponse.json({ error: "kv_not_configured" }, { status: 503 })

    let currentVersion = await getThreadVersion(kv, userId)
    const startedAt = Date.now()
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false

        const send = (event: string, data: object) => {
          if (closed) return
          controller.enqueue(encoder.encode(`event: ${event}\n`))
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        send("connected", { version: currentVersion })

        while (!closed && Date.now() - startedAt < 55_000) {
          await new Promise((resolve) => setTimeout(resolve, 1000))

          const latestVersion = await getThreadVersion(kv, userId)
          if (latestVersion !== currentVersion) {
            currentVersion = latestVersion
            send("threads_updated", { version: currentVersion })
          } else {
            send("heartbeat", { version: currentVersion, ts: Date.now() })
          }
        }

        closed = true
        controller.close()
      },
      cancel() {
        // noop: loop exits naturally on close window
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
    if (error instanceof Error && error.message === "account_session_required") {
      return NextResponse.json({ error: "account_session_required" }, { status: 400 })
    }
    return NextResponse.json({ error: "failed_to_stream_threads" }, { status: 500 })
  }
}
