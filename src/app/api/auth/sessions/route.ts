import { NextResponse } from "next/server"
import { listSessions, requireSession, revokeSession } from "@/lib/auth"

export async function GET() {
  const current = await requireSession()
  const sessions = await listSessions()
  const safeSessions = sessions.length > 0 ? sessions : [current]
  return NextResponse.json({ ok: true, sessions: safeSessions })
}

export async function DELETE(req: Request) {
  await requireSession()
  const body = (await req.json()) as { sessionId?: string }
  if (!body.sessionId) return NextResponse.json({ ok: false, error: "sessionId_required" }, { status: 400 })
  const ok = await revokeSession(body.sessionId)
  return NextResponse.json({ ok })
}
