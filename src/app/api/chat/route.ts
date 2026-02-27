import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth"

function extractUserPrompt(message: string) {
  const marker = "사용자 요청:\n"
  const idx = message.indexOf(marker)
  if (idx < 0) return message
  return message.slice(idx + marker.length).trim()
}

export async function POST(req: Request) {
  try {
    await requireSession()
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const allowMock = process.env.OPENCLAW_ALLOW_MOCK?.trim().toLowerCase() === "true"
  const body = (await req.json()) as { threadId?: string; message?: string; model?: string }
  const threadId = body.threadId ?? "unknown"
  const message = body.message ?? ""
  const userPrompt = extractUserPrompt(message)
  const model = body.model ?? "gpt-5.3-codex"

  const upstream = process.env.OPENCLAW_CHAT_URL
  const token = process.env.OPENCLAW_CHAT_TOKEN

  if (upstream) {
    try {
      const upstreamRes = await fetch(upstream, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ threadId, message, model }),
        cache: "no-store",
      })

      if (upstreamRes.ok) {
        const data = (await upstreamRes.json()) as { text?: string }
        return NextResponse.json({ text: data.text ?? "" })
      }

      await new Promise((r) => setTimeout(r, 200))
      return NextResponse.json({
        text: `지금 OpenClaw 서버 연결이 불안정합니다.\n\n요청: ${userPrompt.slice(0, 80)}\n\n잠시 후 다시 시도해 주세요.`,
      })
    } catch {
      await new Promise((r) => setTimeout(r, 200))
      return NextResponse.json({
        text: `지금 OpenClaw 서버에 연결할 수 없습니다.\n\n요청: ${userPrompt.slice(0, 80)}\n\n잠시 후 다시 시도해 주세요.`,
      })
    }
  }

  if (!allowMock) {
    return NextResponse.json(
      {
        error: "upstream_not_configured",
        hint: "Set OPENCLAW_CHAT_URL (and optional OPENCLAW_CHAT_TOKEN) in Vercel.",
      },
      { status: 503 },
    )
  }

  await new Promise((r) => setTimeout(r, 250))
  return NextResponse.json({
    text: `(MVP Mock API) model=${model} thread=${threadId.slice(0, 8)}: ${message.slice(0, 120)}`,
  })
}
