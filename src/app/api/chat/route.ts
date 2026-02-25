import { NextResponse } from "next/server"

export async function POST(req: Request) {
  const allowMock = process.env.OPENCLAW_ALLOW_MOCK?.trim().toLowerCase() === "true"
  const body = (await req.json()) as { threadId?: string; message?: string; model?: string }
  const threadId = body.threadId ?? "unknown"
  const message = body.message ?? ""
  const model = body.model ?? "gpt-5.3-codex"

  const upstream = process.env.OPENCLAW_CHAT_URL
  const token = process.env.OPENCLAW_CHAT_TOKEN

  if (upstream) {
    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ threadId, message, model }),
      cache: "no-store",
    })

    if (!upstreamRes.ok) {
      return NextResponse.json({ error: `upstream_error:${upstreamRes.status}` }, { status: 502 })
    }

    const data = (await upstreamRes.json()) as { text?: string }
    return NextResponse.json({ text: data.text ?? "" })
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
