#!/usr/bin/env node

const baseUrl = process.env.VERIFY_BASE_URL || "https://app.309designlab.com"
const accessCode = process.env.VERIFY_ACCESS_CODE || "309designlab-private"

async function main() {
  const cookieJar = []

  const health = await fetch(`${baseUrl}/api/health`, { cache: "no-store" })
  if (!health.ok) throw new Error(`health failed: ${health.status}`)
  const healthJson = await health.json()

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: accessCode, deviceName: "verify-deploy" }),
  })
  if (!login.ok) throw new Error(`login failed: ${login.status}`)
  const setCookie = login.headers.get("set-cookie")
  if (!setCookie) throw new Error("login did not set cookie")
  cookieJar.push(setCookie.split(";")[0])

  const chat = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieJar.join("; "),
    },
    body: JSON.stringify({ threadId: "verify", message: "verify", model: "gpt-5.3-codex" }),
  })
  if (!chat.ok) throw new Error(`chat failed: ${chat.status}`)
  const chatJson = await chat.json()

  const ocJobs = await fetch(`${baseUrl}/api/oc/jobs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieJar.join("; "),
    },
    body: JSON.stringify({ threadId: "verify", message: "verify job", model: "gpt-5.3-codex" }),
  })
  if (!ocJobs.ok) throw new Error(`oc jobs failed: ${ocJobs.status}`)
  const jobsJson = await ocJobs.json()

  console.log(JSON.stringify({ ok: true, health: healthJson, chat: chatJson, job: jobsJson }, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2))
  process.exit(1)
})
