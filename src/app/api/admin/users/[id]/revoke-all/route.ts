import { NextResponse } from "next/server"
import { listUsersByAdmin, revokeAllSessionsByUserId } from "@/lib/auth"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminKey = req.headers.get("x-admin-key") || ""
  const { id } = await params

  try {
    const users = await listUsersByAdmin(adminKey)
    const exists = users.some((u) => u.id === id)
    if (!exists) {
      return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 })
    }

    const revokedCount = await revokeAllSessionsByUserId(id)
    return NextResponse.json({ ok: true, revokedCount })
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown_error"
    const status = code === "unauthorized" ? 401 : 400
    return NextResponse.json({ ok: false, error: code }, { status })
  }
}
