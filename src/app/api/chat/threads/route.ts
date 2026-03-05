import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth"
import { kvGetJson, kvSetJson, resolveKvConfig } from "@/lib/kv"
import type { Thread } from "@/lib/store"

function keyForUser(userId: string) {
  return `openclaw:threads:${userId}`
}

function normalizeThreads(input: unknown): Thread[] {
  return Array.isArray(input) ? (input as Thread[]) : []
}

async function requireAccountUserId() {
  const session = await requireSession()
  if (!session.userId || session.authType !== "account") {
    throw new Error("account_session_required")
  }
  return session.userId
}

export async function GET() {
  try {
    const userId = await requireAccountUserId()
    const kv = resolveKvConfig()
    if (!kv) return NextResponse.json({ error: "kv_not_configured" }, { status: 503 })

    const stored = await kvGetJson<unknown>(kv, keyForUser(userId))
    return NextResponse.json({ threads: normalizeThreads(stored) })
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
    if (error instanceof Error && error.message === "account_session_required") {
      return NextResponse.json({ error: "account_session_required" }, { status: 400 })
    }
    return NextResponse.json({ error: "failed_to_load_threads" }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const userId = await requireAccountUserId()
    const kv = resolveKvConfig()
    if (!kv) return NextResponse.json({ error: "kv_not_configured" }, { status: 503 })

    const body = (await req.json().catch(() => null)) as { threads?: unknown } | unknown[] | null
    const threads = normalizeThreads(Array.isArray(body) ? body : body?.threads)
    await kvSetJson(kv, keyForUser(userId), threads)

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
    if (error instanceof Error && error.message === "account_session_required") {
      return NextResponse.json({ error: "account_session_required" }, { status: 400 })
    }
    return NextResponse.json({ error: "failed_to_save_threads" }, { status: 500 })
  }
}
