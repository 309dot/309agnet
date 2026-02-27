import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth"
import { cancelOpenClawJob, getOpenClawJob } from "@/lib/openclaw-jobs-store"

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const { id } = await ctx.params
  const job = await getOpenClawJob(id)

  if (!job) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    result: job.result,
    error: job.error,
    artifactPath: job.artifactPath,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  })
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const { id } = await ctx.params
  const job = await cancelOpenClawJob(id)

  if (!job) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    error: job.error,
    updatedAt: job.updatedAt,
  })
}
