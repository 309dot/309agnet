import { NextResponse } from "next/server"
import { checkAccessCode, createSession, setAuthCookie } from "@/lib/auth"

export async function POST(req: Request) {
  const body = (await req.json()) as { code?: string; deviceName?: string }
  const code = body.code ?? ""
  if (!checkAccessCode(code)) return NextResponse.json({ ok: false, error: "invalid_code" }, { status: 401 })

  const ua = req.headers.get("user-agent") || "unknown"
  const session = await createSession(body.deviceName ?? "My device", ua)
  await setAuthCookie(session.token)
  return NextResponse.json({ ok: true, sessionId: session.id })
}
