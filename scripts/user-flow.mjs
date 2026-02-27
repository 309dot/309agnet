#!/usr/bin/env node

const baseUrl = process.env.USER_FLOW_BASE_URL || "https://app.309designlab.com"
const accessCode = process.env.USER_FLOW_ACCESS_CODE || "309designlab-private"
const allowFallback = process.env.USER_FLOW_ALLOW_FALLBACK === "true"

async function postJson(url, body, cookie) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { res, text, json }
}

async function getJson(url, cookie) {
  const res = await fetch(url, {
    headers: cookie ? { cookie } : {},
    cache: "no-store",
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { res, text, json }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const report = { ok: true, steps: [] }

  const health = await getJson(`${baseUrl}/api/health`)
  if (!health.res.ok) throw new Error(`health:${health.res.status}`)
  report.steps.push({ step: "health", status: health.res.status, body: health.json })

  const login = await postJson(`${baseUrl}/api/auth/login`, { code: accessCode, deviceName: "user-flow" })
  if (!login.res.ok) throw new Error(`login:${login.res.status} ${login.text}`)
  const cookie = (login.res.headers.get("set-cookie") || "").split(";")[0]
  if (!cookie) throw new Error("login:no_cookie")
  report.steps.push({ step: "login", status: login.res.status })

  const chat = await postJson(
    `${baseUrl}/api/chat`,
    { threadId: "flow-thread", message: "user-flow 일반 요청", model: "gpt-5.3-codex" },
    cookie,
  )
  if (!chat.res.ok) throw new Error(`chat:${chat.res.status} ${chat.text}`)
  if (!chat.json?.text) throw new Error("chat:empty_text")
  const chatText = String(chat.json.text)
  if (!allowFallback && chatText.includes("임시 응답")) {
    throw new Error("chat:fallback_detected")
  }
  report.steps.push({ step: "chat", status: chat.res.status, preview: chatText.slice(0, 80) })

  const jobCreate = await postJson(
    `${baseUrl}/api/oc/jobs`,
    { threadId: "flow-thread", message: "user-flow openclaw 요청", model: "gpt-5.3-codex" },
    cookie,
  )
  if (!jobCreate.res.ok) throw new Error(`job_create:${jobCreate.res.status} ${jobCreate.text}`)
  const jobId = jobCreate.json?.jobId
  if (!jobId) throw new Error("job_create:no_job_id")
  report.steps.push({ step: "job_create", status: jobCreate.res.status, jobId })

  let final = null
  for (let i = 0; i < 25; i += 1) {
    const status = await getJson(`${baseUrl}/api/oc/jobs/${encodeURIComponent(jobId)}`, cookie)
    if (!status.res.ok) throw new Error(`job_status:${status.res.status} ${status.text}`)
    const s = status.json?.status
    if (s === "done" || s === "error" || s === "cancelled") {
      final = status.json
      break
    }
    await sleep(1000)
  }

  if (!final) throw new Error("job_status:timeout")
  const finalText = String(final.result || final.error || "")
  if (!allowFallback && finalText.includes("임시 응답")) {
    throw new Error("job:fallback_detected")
  }
  report.steps.push({ step: "job_final", status: final.status, preview: finalText.slice(0, 80) })

  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2))
  process.exit(1)
})
