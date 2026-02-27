import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth"
import { processOpenClawJob, retryOpenClawJob } from "@/lib/openclaw-jobs-store"

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const { id } = await ctx.params
  const retried = await retryOpenClawJob(id)

  if (!retried) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  void processOpenClawJob(retried.id)

  return NextResponse.json({
    jobId: retried.id,
    status: retried.status,
    updatedAt: retried.updatedAt,
  })
}
