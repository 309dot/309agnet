const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])

function isLocalHost(hostname: string): boolean {
  if (!hostname) return false
  if (LOCAL_HOSTS.has(hostname)) return true
  return hostname.endsWith(".local")
}

function ensureWsProtocol(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ""

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === "http:") parsed.protocol = "ws:"
    if (parsed.protocol === "https:") parsed.protocol = "wss:"
    return parsed.toString()
  } catch {
    return trimmed
  }
}

export function resolveGatewayUrl(hostname: string): string | null {
  const publicUrl = ensureWsProtocol(process.env.NEXT_PUBLIC_GATEWAY_URL ?? "")
  const localUrl = ensureWsProtocol(process.env.NEXT_PUBLIC_LOCAL_GATEWAY_URL ?? "ws://127.0.0.1:18789")

  if (isLocalHost(hostname)) {
    return localUrl || publicUrl || null
  }

  return publicUrl || null
}

export function isLikelyLocalGatewayRefused(message: string): boolean {
  return message.includes("ws://127.0.0.1:18789") || message.includes("127.0.0.1:18789")
}
