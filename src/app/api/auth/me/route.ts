import { NextResponse } from "next/server"
import { getSessionFromCookie } from "@/lib/auth"

export async function GET() {
  const session = await getSessionFromCookie()
  if (!session) {
    // Initial unauthenticated checks are expected during app boot.
    // Return 200 to avoid noisy 401 console errors on clients.
    return NextResponse.json({ ok: false, session: null })
  }

  return NextResponse.json({ ok: true, session })
}
