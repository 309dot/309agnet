export interface GatewayChatRequest {
  threadId: string
  message: string
  model: string
}

export interface GatewayChatResponse {
  text: string
}

/**
 * Client integration point: hits local Next API route.
 * Later, `/api/chat` can proxy to OpenClaw Gateway SSE/WebSocket.
 */
export async function sendToOpenClawGateway(req: GatewayChatRequest): Promise<GatewayChatResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(`gateway request failed: ${res.status}`)
  return (await res.json()) as GatewayChatResponse
}
