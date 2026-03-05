import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth"
import { buildSignedUpstreamUserHeaders } from "@/lib/auth-util"
import { createOpenClawJob, processOpenClawJob } from "@/lib/openclaw-jobs-store"

export async function POST(req: Request) {
  let session: Awaited<ReturnType<typeof requireSession>> | null = null
  try {
    session = await requireSession()
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const body = (await req.json()) as { threadId?: string; message?: string; model?: string }
  const threadId = body.threadId?.trim() || "unknown"
  const message = body.message?.trim() || ""
  const model = body.model?.trim() || "gpt-5.3-codex"

  if (!message) {
    return NextResponse.json({ error: "message_required" }, { status: 400 })
  }

  const job = await createOpenClawJob({
    threadId,
    message,
    model,
    userContextHeaders: session ? buildSignedUpstreamUserHeaders(session) : undefined,
  })
  void processOpenClawJob(job.id)

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt,
  })
}
