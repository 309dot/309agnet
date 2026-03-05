import { NextResponse } from "next/server"
import { updateUserByAdmin } from "@/lib/auth"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminKey = req.headers.get("x-admin-key") || ""
  const { id } = await params

  const body = (await req.json()) as {
    active?: boolean
    name?: string
    role?: "admin" | "member"
  }

  try {
    const user = await updateUserByAdmin(
      id,
      {
        active: body.active,
        name: body.name,
        role: body.role,
      },
      adminKey,
    )

    return NextResponse.json({
      ok: true,
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
    const status = code === "unauthorized" ? 401 : code === "user_not_found" ? 404 : 400
    return NextResponse.json({ ok: false, error: code }, { status })
  }
}
