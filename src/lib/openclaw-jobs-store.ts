import { promises as fs } from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

export type OpenClawJobStatus = "queued" | "running" | "done" | "error" | "cancelled"

export type OpenClawJob = {
  id: string
  threadId: string
  message: string
  model: string
  status: OpenClawJobStatus
  result?: string
  error?: string
  artifactPath?: string
  createdAt: string
  updatedAt: string
}

type JobStore = {
  jobs: OpenClawJob[]
}

const STORE_PATH = path.join(process.cwd(), ".openclaw", "openclaw-jobs.json")
const ARTIFACTS_DIR = path.join(process.cwd(), ".openclaw", "job-artifacts")
const DEFAULT_BACKUP_CHAT_URL = "https://ocbridge.309designlab.com/chat"

function isVercelRuntime() {
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined
}

function getMemoryStore(): JobStore {
  const g = globalThis as unknown as { __openclawJobsStore?: JobStore }
  if (!g.__openclawJobsStore) g.__openclawJobsStore = { jobs: [] }
  return g.__openclawJobsStore
}

async function readStore(): Promise<JobStore> {
  if (isVercelRuntime()) return getMemoryStore()

  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8")
    const parsed = JSON.parse(raw) as Partial<JobStore>
    return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] }
  } catch {
    return { jobs: [] }
  }
}

async function writeStore(store: JobStore) {
  if (isVercelRuntime()) {
    const mem = getMemoryStore()
    mem.jobs = store.jobs
    return
  }

  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true })
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8")
}

function trimJobs(jobs: OpenClawJob[]) {
  const MAX = 300
  if (jobs.length <= MAX) return jobs
  return [...jobs].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, MAX)
}

function extractUserPrompt(message: string) {
  const marker = "사용자 요청:\n"
  const idx = message.indexOf(marker)
  if (idx < 0) return message
  return message.slice(idx + marker.length).trim()
}

async function writeJobArtifact(job: OpenClawJob, result: string): Promise<string> {
  if (isVercelRuntime()) return "artifacts-disabled-on-vercel"

  await fs.mkdir(ARTIFACTS_DIR, { recursive: true })
  const safeDate = new Date().toISOString().replaceAll(":", "-")
  const fileName = `${safeDate}-${job.id}.md`
  const fullPath = path.join(ARTIFACTS_DIR, fileName)
  const content = `# OpenClaw Job Result\n\n- jobId: ${job.id}\n- threadId: ${job.threadId}\n- model: ${job.model}\n- createdAt: ${job.createdAt}\n- updatedAt: ${new Date().toISOString()}\n\n## Prompt\n\n${job.message}\n\n## Result\n\n${result}\n`
  await fs.writeFile(fullPath, content, "utf-8")
  return path.relative(process.cwd(), fullPath)
}

export async function createOpenClawJob(input: Pick<OpenClawJob, "threadId" | "message" | "model">): Promise<OpenClawJob> {
  const now = new Date().toISOString()
  const store = await readStore()
  const job: OpenClawJob = {
    id: crypto.randomUUID(),
    threadId: input.threadId,
    message: input.message,
    model: input.model,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  }
  store.jobs.unshift(job)
  store.jobs = trimJobs(store.jobs)
  await writeStore(store)
  return job
}

export async function getOpenClawJob(id: string): Promise<OpenClawJob | null> {
  const store = await readStore()
  return store.jobs.find((j) => j.id === id) ?? null
}

async function updateOpenClawJob(id: string, updater: (job: OpenClawJob) => OpenClawJob): Promise<OpenClawJob | null> {
  const store = await readStore()
  const idx = store.jobs.findIndex((j) => j.id === id)
  if (idx < 0) return null
  const next = updater(store.jobs[idx])
  store.jobs[idx] = { ...next, updatedAt: new Date().toISOString() }
  await writeStore(store)
  return store.jobs[idx]
}

export async function retryOpenClawJob(id: string): Promise<OpenClawJob | null> {
  return updateOpenClawJob(id, (job) => {
    if (job.status !== "error" && job.status !== "cancelled") return job
    return { ...job, status: "queued", error: undefined, result: undefined }
  })
}

export async function cancelOpenClawJob(id: string): Promise<OpenClawJob | null> {
  return updateOpenClawJob(id, (job) => {
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") return job
    return { ...job, status: "cancelled", error: "cancelled_by_user" }
  })
}

async function requestUpstream(url: string, token: string | undefined, payload: { threadId: string; message: string; model: string }) {
  const upstreamRes = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  })

  if (!upstreamRes.ok) throw new Error(`upstream_error:${upstreamRes.status}`)
  const data = (await upstreamRes.json()) as { text?: string }
  return data.text ?? ""
}

export async function processOpenClawJob(id: string): Promise<OpenClawJob | null> {
  const upstream = process.env.OPENCLAW_CHAT_URL
  const token = process.env.OPENCLAW_CHAT_TOKEN
  const backupUpstream = process.env.OPENCLAW_CHAT_BACKUP_URL || DEFAULT_BACKUP_CHAT_URL
  const allowMock = process.env.OPENCLAW_ALLOW_MOCK?.trim().toLowerCase() === "true"

  const marked = await updateOpenClawJob(id, (job) => {
    if (job.status !== "queued") return job
    return { ...job, status: "running", error: undefined }
  })

  if (!marked) return null
  if (marked.status !== "running") return marked

  const userPrompt = extractUserPrompt(marked.message)

  if (!upstream && !allowMock) {
    return updateOpenClawJob(id, (job) => ({
      ...job,
      status: "error",
      error: "upstream_not_configured: set OPENCLAW_CHAT_URL",
    }))
  }

  try {
    let text = ""

    if (upstream) {
      try {
        text = await requestUpstream(upstream, token, {
          threadId: marked.threadId,
          message: marked.message,
          model: marked.model,
        })
      } catch {
        try {
          text = await requestUpstream(backupUpstream, undefined, {
            threadId: marked.threadId,
            message: marked.message,
            model: marked.model,
          })
        } catch {
          text = `지금 OpenClaw 서버 연결이 불안정합니다.\n\n요청: ${userPrompt.slice(0, 80)}\n\n잠시 후 다시 시도해 주세요.`
        }
      }
    } else {
      await new Promise((r) => setTimeout(r, 350))
      text = `(MVP Mock Async Job) model=${marked.model} thread=${marked.threadId.slice(0, 8)}: ${marked.message.slice(0, 200)}`
    }

    return updateOpenClawJob(id, (job) => {
      if (job.status === "cancelled") return job
      return { ...job, status: "done", result: text, error: undefined }
    }).then(async (doneJob) => {
      if (!doneJob || doneJob.status !== "done" || !doneJob.result) return doneJob
      const artifactPath = await writeJobArtifact(doneJob, doneJob.result)
      return updateOpenClawJob(id, (job) => ({ ...job, artifactPath }))
    })
  } catch {
    const fallback = `지금 OpenClaw 서버에 연결할 수 없습니다.\n\n요청: ${userPrompt.slice(0, 80)}\n\n잠시 후 다시 시도해 주세요.`
    return updateOpenClawJob(id, (job) => {
      if (job.status === "cancelled") return job
      return { ...job, status: "done", result: fallback, error: undefined }
    })
  }
}
