import { NextResponse } from "next/server"
import { createUserByAdmin, listUsersByAdmin } from "@/lib/auth"

export async function GET(req: Request) {
  const adminKey = req.headers.get("x-admin-key") || ""

  try {
    const users = await listUsersByAdmin(adminKey)
    return NextResponse.json({ ok: true, users })
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown_error"
    const status = code === "unauthorized" ? 401 : 500
    return NextResponse.json({ ok: false, error: code }, { status })
  }
}

export async function POST(req: Request) {
  const adminKey = req.headers.get("x-admin-key") || ""

  const body = (await req.json()) as {
    email?: string
    password?: string
    name?: string
    role?: "admin" | "member"
  }

  try {
    const user = await createUserByAdmin(
      {
        email: body.email || "",
        password: body.password || "",
        name: body.name,
        role: body.role,
      },
      adminKey,
    )

    return NextResponse.json({
      ok: true,
      email: user.email,
      role: user.role,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        active: user.active,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    })
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown_error"
    const status = code === "unauthorized" ? 401 : code === "email_exists" || code.startsWith("invalid_") ? 400 : 500
    return NextResponse.json({ ok: false, error: code }, { status })
  }
}
