export interface OpenClawJobCreateRequest {
  threadId: string
  message: string
  model: string
}

export interface OpenClawJobCreateResponse {
  jobId: string
  status: "queued" | "running" | "done" | "error" | "cancelled"
  createdAt: string
}

export interface OpenClawJobStatusResponse {
  jobId: string
  status: "queued" | "running" | "done" | "error" | "cancelled"
  result?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export async function createOpenClawJob(req: OpenClawJobCreateRequest): Promise<OpenClawJobCreateResponse> {
  const res = await fetch("/api/openclaw/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(`job_create_failed:${res.status}`)
  return (await res.json()) as OpenClawJobCreateResponse
}

export async function getOpenClawJobStatus(jobId: string): Promise<OpenClawJobStatusResponse> {
  const res = await fetch(`/api/openclaw/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" })
  if (!res.ok) throw new Error(`job_status_failed:${res.status}`)
  return (await res.json()) as OpenClawJobStatusResponse
}

export async function cancelOpenClawJob(jobId: string): Promise<OpenClawJobStatusResponse> {
  const res = await fetch(`/api/openclaw/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`job_cancel_failed:${res.status}`)
  return (await res.json()) as OpenClawJobStatusResponse
}
