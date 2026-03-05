import crypto from "node:crypto"
import type { AuthSession, AuthType } from "@/lib/auth"

export type UpstreamUserContext = {
  sessionId: string
  userId: string | null
  authType: AuthType
  deviceName: string
  ts: number
}

function resolveUpstreamContextSecret() {
  return (
    process.env.OPENCLAW_UPSTREAM_CONTEXT_SECRET?.trim() ||
    process.env.OPENCLAW_CHAT_TOKEN?.trim() ||
    process.env.OPENCLAW_APP_SESSION_SECRET?.trim() ||
    process.env.OPENCLAW_APP_ACCESS_CODE?.trim() ||
    ""
  )
}

export function buildUpstreamUserContext(session: AuthSession): UpstreamUserContext {
  return {
    sessionId: session.id,
    userId: session.userId ?? null,
    authType: session.authType ?? "legacy",
    deviceName: session.deviceName || "Unknown Device",
    ts: Date.now(),
  }
}

export function buildSignedUpstreamUserHeaders(session: AuthSession): Record<string, string> {
  const context = buildUpstreamUserContext(session)
  const encoded = Buffer.from(JSON.stringify(context), "utf-8").toString("base64url")
  const secret = resolveUpstreamContextSecret()

  if (!secret) {
    return {
      "X-309-User-Context": encoded,
    }
  }

  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url")

  return {
    "X-309-User-Context": encoded,
    "X-309-User-Signature": signature,
  }
}
