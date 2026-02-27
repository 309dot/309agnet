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
  artifactPath?: string
  createdAt?: string
  updatedAt: string
}

export async function createOpenClawJob(req: OpenClawJobCreateRequest): Promise<OpenClawJobCreateResponse> {
  const res = await fetch("/api/oc/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(`job_create_failed:${res.status}`)
  return (await res.json()) as OpenClawJobCreateResponse
}

export async function getOpenClawJobStatus(jobId: string): Promise<OpenClawJobStatusResponse> {
  const res = await fetch(`/api/oc/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" })
  if (!res.ok) throw new Error(`job_status_failed:${res.status}`)
  return (await res.json()) as OpenClawJobStatusResponse
}

export async function cancelOpenClawJob(jobId: string): Promise<OpenClawJobStatusResponse> {
  const res = await fetch(`/api/oc/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`job_cancel_failed:${res.status}`)
  return (await res.json()) as OpenClawJobStatusResponse
}

export async function retryOpenClawJob(jobId: string): Promise<OpenClawJobStatusResponse> {
  const res = await fetch(`/api/oc/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" })
  if (!res.ok) throw new Error(`job_retry_failed:${res.status}`)
  return (await res.json()) as OpenClawJobStatusResponse
}

export function streamOpenClawJobStatus(
  jobId: string,
  onStatus: (status: OpenClawJobStatusResponse) => void,
): Promise<OpenClawJobStatusResponse> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/oc/jobs/${encodeURIComponent(jobId)}/stream`)

    const cleanup = () => {
      es.close()
    }

    es.addEventListener("status", (evt) => {
      try {
        const data = JSON.parse((evt as MessageEvent).data) as OpenClawJobStatusResponse
        onStatus(data)
        if (data.status === "done" || data.status === "error" || data.status === "cancelled") {
          cleanup()
          resolve(data)
        }
      } catch (error) {
        cleanup()
        reject(error)
      }
    })

    es.addEventListener("error", () => {
      cleanup()
      reject(new Error("job_stream_error"))
    })
  })
}
