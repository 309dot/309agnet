export interface GatewayChatRequest {
  threadId: string
  message: string
  model: string
}

export interface GatewayChatResponse {
  text: string
}

export async function sendToOpenClawGateway(req: GatewayChatRequest): Promise<GatewayChatResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(`gateway request failed: ${res.status}`)
  return (await res.json()) as GatewayChatResponse
}

export async function streamFromOpenClawGateway(
  req: GatewayChatRequest,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`stream request failed: ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let full = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const events = buffer.split("\n\n")
    buffer = events.pop() ?? ""

    for (const e of events) {
      const line = e
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.replace(/^data:\s?/, "")
      if (!line || line === "[DONE]") continue
      full += line
      onChunk(full)
    }
  }

  return full
}
