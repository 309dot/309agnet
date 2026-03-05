import { NextResponse } from "next/server"
import { getSessionStoreMode, listSessionsForCurrent, requireSession, revokeSessionForCurrent } from "@/lib/auth"

export async function GET() {
  const current = await requireSession()
  const sessions = await listSessionsForCurrent(current)
  const storeMode = await getSessionStoreMode()
  return NextResponse.json({ ok: true, sessions, storeMode })
}

export async function DELETE(req: Request) {
  const current = await requireSession()
  const body = (await req.json()) as { sessionId?: string }
  if (!body.sessionId) return NextResponse.json({ ok: false, error: "sessionId_required" }, { status: 400 })

  const ok = await revokeSessionForCurrent(current, body.sessionId)
  return NextResponse.json({ ok })
}
