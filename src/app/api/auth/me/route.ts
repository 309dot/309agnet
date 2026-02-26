import { NextResponse } from "next/server"
import { getSessionFromCookie } from "@/lib/auth"

export async function GET() {
  const session = await getSessionFromCookie()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })
  return NextResponse.json({ ok: true, session })
}
