export interface GatewayChatRequest {
  threadId: string
  message: string
  model: string
}

export interface GatewayChatResponse {
  text: string
}

/**
 * MVP integration point for OpenClaw gateway.
 * For now returns a mocked response so the app runs without backend wiring.
 */
export async function sendToOpenClawGateway(req: GatewayChatRequest): Promise<GatewayChatResponse> {
  await new Promise((r) => setTimeout(r, 350))
  return {
    text: `(MVP Mock) model=${req.model} thread=${req.threadId.slice(0, 8)}: 게이트웨이 연동 준비 완료`,
  }
}
