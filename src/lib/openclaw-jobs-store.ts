import { promises as fs } from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

export type OpenClawJobStatus = "queued" | "running" | "done" | "error"

export type OpenClawJob = {
  id: string
  threadId: string
  message: string
  model: string
  status: OpenClawJobStatus
  result?: string
  error?: string
  createdAt: string
  updatedAt: string
}

type JobStore = {
  jobs: OpenClawJob[]
}

const STORE_PATH = path.join(process.cwd(), ".openclaw", "openclaw-jobs.json")

async function readStore(): Promise<JobStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8")
    const parsed = JSON.parse(raw) as Partial<JobStore>
    return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] }
  } catch {
    return { jobs: [] }
  }
}

async function writeStore(store: JobStore) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true })
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8")
}

function trimJobs(jobs: OpenClawJob[]) {
  const MAX = 300
  if (jobs.length <= MAX) return jobs
  return [...jobs].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, MAX)
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

export async function processOpenClawJob(id: string): Promise<OpenClawJob | null> {
  const upstream = process.env.OPENCLAW_CHAT_URL
  const token = process.env.OPENCLAW_CHAT_TOKEN
  const allowMock = process.env.OPENCLAW_ALLOW_MOCK?.trim().toLowerCase() === "true"

  const marked = await updateOpenClawJob(id, (job) => {
    if (job.status !== "queued") return job
    return { ...job, status: "running", error: undefined }
  })

  if (!marked) return null
  if (marked.status !== "running") return marked

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
      const upstreamRes = await fetch(upstream, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          threadId: marked.threadId,
          message: marked.message,
          model: marked.model,
        }),
        cache: "no-store",
      })

      if (!upstreamRes.ok) {
        throw new Error(`upstream_error:${upstreamRes.status}`)
      }

      const data = (await upstreamRes.json()) as { text?: string }
      text = data.text ?? ""
    } else {
      await new Promise((r) => setTimeout(r, 350))
      text = `(MVP Mock Async Job) model=${marked.model} thread=${marked.threadId.slice(0, 8)}: ${marked.message.slice(0, 200)}`
    }

    return updateOpenClawJob(id, (job) => ({ ...job, status: "done", result: text, error: undefined }))
  } catch (error) {
    return updateOpenClawJob(id, (job) => ({ ...job, status: "error", error: String(error) }))
  }
}
