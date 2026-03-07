export type FailureCategory =
  | "gateway_connect"
  | "auth"
  | "request_validation"
  | "upstream"
  | "job_pipeline"
  | "cancelled"
  | "unknown"

export type FailureReportInput = {
  source: "chat_send" | "chat_stream" | "job"
  mode: "normal" | "agent" | "pm"
  model: string
  errorMessage: string
  threadId?: string | null
}

export type FailureReportPayload = {
  category: FailureCategory
  brief: string
  details: {
    source: FailureReportInput["source"]
    mode: FailureReportInput["mode"]
    model: string
    threadId?: string | null
    urlPath: string
    userAgent: string
    occurredAt: string
    errorMessage: string
  }
}

function classify(errorMessage: string): FailureCategory {
  const msg = errorMessage.toLowerCase()
  if (msg.includes("abort") || msg.includes("cancel")) return "cancelled"
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden")) return "auth"
  if (msg.includes("400") || msg.includes("validation") || msg.includes("payload")) return "request_validation"
  if (msg.includes("job_") || msg.includes("stream_timeout") || msg.includes("job_pipeline")) return "job_pipeline"
  if (msg.includes("upstream_error") || msg.includes("503") || msg.includes("500")) return "upstream"
  if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("upstream_unreachable") || msg.includes("127.0.0.1:18789")) return "gateway_connect"
  return "unknown"
}

function shortMessage(category: FailureCategory) {
  switch (category) {
    case "gateway_connect":
      return "게이트웨이 연결 실패"
    case "auth":
      return "인증/권한 오류"
    case "request_validation":
      return "요청 형식 오류"
    case "upstream":
      return "상위 서버 처리 오류"
    case "job_pipeline":
      return "잡 파이프라인 실패"
    case "cancelled":
      return "요청 취소됨"
    default:
      return "알 수 없는 처리 오류"
  }
}

export function buildFailureReport(input: FailureReportInput): FailureReportPayload {
  const category = classify(input.errorMessage)
  const occurredAt = new Date().toISOString()

  return {
    category,
    brief: `[${shortMessage(category)}] mode=${input.mode} model=${input.model}`,
    details: {
      source: input.source,
      mode: input.mode,
      model: input.model,
      threadId: input.threadId ?? null,
      urlPath: typeof window !== "undefined" ? window.location.pathname : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      occurredAt,
      errorMessage: input.errorMessage.slice(0, 1000),
    },
  }
}

export async function sendFailureReport(input: FailureReportInput): Promise<void> {
  const payload = buildFailureReport(input)
  try {
    await fetch("/api/diag/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    })
  } catch {
    // non-blocking best effort only
  }
}
