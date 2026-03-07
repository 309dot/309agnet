import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth"
import { buildSignedUpstreamUserHeaders } from "@/lib/auth-util"

type ReportPayload = {
  category?: string
  brief?: string
  details?: {
    source?: string
    mode?: string
    model?: string
    threadId?: string | null
    urlPath?: string
    userAgent?: string
    occurredAt?: string
    errorMessage?: string
  }
}

export async function POST(req: Request) {
  let session: Awaited<ReturnType<typeof requireSession>> | null = null
  try {
    session = await requireSession()
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as ReportPayload | null
  if (!body?.brief || !body?.details) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 })
  }

  const upstream = process.env.OPENCLAW_CHAT_URL
  const token = process.env.OPENCLAW_CHAT_TOKEN

  const reportText = [
    "[309agnet 자동 진단 리포트]",
    `brief: ${body.brief}`,
    `category: ${body.category ?? "unknown"}`,
    `source: ${body.details.source ?? "unknown"}`,
    `mode: ${body.details.mode ?? "unknown"}`,
    `model: ${body.details.model ?? "unknown"}`,
    `threadId: ${body.details.threadId ?? "-"}`,
    `path: ${body.details.urlPath ?? "-"}`,
    `time: ${body.details.occurredAt ?? new Date().toISOString()}`,
    `error: ${(body.details.errorMessage ?? "").slice(0, 1000)}`,
  ].join("\n")

  // Upstream not configured: swallow but return success so UX is not blocked.
  if (!upstream) return NextResponse.json({ ok: true, delivered: false })

  try {
    const userHeaders = buildSignedUpstreamUserHeaders(session)
    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(userHeaders ?? {}),
      },
      body: JSON.stringify({
        threadId: `diag_${body.details.threadId ?? "unknown"}`,
        model: "gpt-5.3-codex",
        message: reportText,
      }),
      cache: "no-store",
    })

    if (!upstreamRes.ok) {
      return NextResponse.json({ ok: true, delivered: false, status: upstreamRes.status })
    }

    return NextResponse.json({ ok: true, delivered: true })
  } catch {
    return NextResponse.json({ ok: true, delivered: false })
  }
}
