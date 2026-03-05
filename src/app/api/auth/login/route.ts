import { NextResponse } from "next/server"
import { checkAccessCode, createSession, setAuthCookie, verifyUserPassword } from "@/lib/auth"

export async function POST(req: Request) {
  const body = (await req.json()) as {
    code?: string
    email?: string
    password?: string
    deviceName?: string
  }

  const ua = req.headers.get("user-agent") || "unknown"

  if (body.email && body.password) {
    const user = await verifyUserPassword(body.email, body.password)
    if (!user) return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 })

    const session = await createSession(body.deviceName ?? "My device", ua, {
      userId: user.id,
      authType: "account",
    })
    await setAuthCookie(session.token)
    return NextResponse.json({ ok: true, sessionId: session.id })
  }

  const code = body.code ?? ""
  if (!checkAccessCode(code)) return NextResponse.json({ ok: false, error: "invalid_code" }, { status: 401 })

  const session = await createSession(body.deviceName ?? "My device", ua, {
    authType: "legacy",
  })
  await setAuthCookie(session.token)
  return NextResponse.json({ ok: true, sessionId: session.id })
}
