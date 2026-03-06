import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const repoDir = process.cwd()
const openclawDir = path.join(repoDir, '.openclaw')
const sessionsPath = path.join(openclawDir, 'auth-sessions.json')

const sessionToken = 'test-session-token'
const accountSession = {
  id: 'sess-account',
  token: sessionToken,
  deviceName: 'Test Device',
  userAgent: 'ContractTest/1.0',
  createdAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  revoked: false,
  userId: 'user-1',
  authType: 'account',
}

const legacySession = {
  ...accountSession,
  id: 'sess-legacy',
  token: 'legacy-token',
  userId: undefined,
  authType: 'legacy',
}

let kvServer
let kvUrl
let kvStore
let appProc
let appPort

function cookieHeader(token) {
  return { cookie: `oc_session=${token}` }
}

async function writeSessions(list) {
  await mkdir(openclawDir, { recursive: true })
  await writeFile(sessionsPath, JSON.stringify(list, null, 2), 'utf-8')
}

async function startKvMock() {
  kvStore = new Map()

  kvServer = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/pipeline') {
      res.statusCode = 404
      res.end('not found')
      return
    }

    const body = await new Promise((resolve, reject) => {
      let raw = ''
      req.setEncoding('utf-8')
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', () => resolve(raw))
      req.on('error', reject)
    })

    const parsed = JSON.parse(body)
    const [command] = parsed
    const [op, key, value] = command

    if (op === 'GET') {
      const result = kvStore.has(key) ? kvStore.get(key) : null
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify([{ result }]))
      return
    }

    if (op === 'SET') {
      kvStore.set(key, value)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify([{ result: 'OK' }]))
      return
    }

    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify([{ error: 'unsupported_op' }]))
  })

  await new Promise((resolve) => kvServer.listen(0, '127.0.0.1', resolve))
  const address = kvServer.address()
  kvUrl = `http://127.0.0.1:${address.port}`
}

async function stopKvMock() {
  if (!kvServer) return
  await new Promise((resolve) => kvServer.close(resolve))
}

async function waitForServerReady(baseUrl, timeoutMs = 90_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`)
      if (res.status === 200) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('next server did not become ready in time')
}

async function startApp() {
  appPort = 3200 + Math.floor(Math.random() * 400)
  appProc = spawn('npx', ['next', 'dev', '-p', String(appPort), '--hostname', '127.0.0.1'], {
    cwd: repoDir,
    env: {
      ...process.env,
      KV_REST_API_URL: kvUrl,
      KV_REST_API_TOKEN: 'test-token',
      OPENCLAW_ALLOW_MOCK: 'true',
      CI: '1',
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let logs = ''
  appProc.stdout?.on('data', (buf) => {
    logs += buf.toString()
  })
  appProc.stderr?.on('data', (buf) => {
    logs += buf.toString()
  })

  try {
    await waitForServerReady(`http://127.0.0.1:${appPort}`)
  } catch (error) {
    appProc.kill('SIGTERM')
    throw new Error(`failed to start app: ${String(error)}\n${logs}`)
  }
}

async function stopApp() {
  if (!appProc) return
  appProc.kill('SIGTERM')
  await new Promise((resolve) => {
    appProc.once('exit', resolve)
    setTimeout(() => {
      appProc.kill('SIGKILL')
      resolve()
    }, 5_000)
  })
}

function api(pathname) {
  return `http://127.0.0.1:${appPort}${pathname}`
}

before(async () => {
  await startKvMock()
  await startApp()
})

after(async () => {
  await stopApp()
  await stopKvMock()
})

beforeEach(async () => {
  await writeSessions([accountSession, { ...accountSession, id: 'sess-other', token: 'other-token', userId: 'user-2' }])
  kvStore.clear()
  kvStore.set('openclaw:threads:user-1', JSON.stringify([{ id: 't-1', title: 'Thread 1', updatedAt: Date.now() }]))
  kvStore.set('openclaw:threads:ver:user-1', JSON.stringify({ version: 1 }))
})

test('GET /api/auth/sessions: returns current user sessions', async () => {
  const res = await fetch(api('/api/auth/sessions'), { headers: cookieHeader(sessionToken) })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.storeMode, 'file')
  assert.equal(Array.isArray(body.sessions), true)
  assert.equal(body.sessions.length, 1)
  assert.equal(body.sessions[0].userId, 'user-1')
})

test('DELETE /api/auth/sessions: missing sessionId returns 400', async () => {
  const res = await fetch(api('/api/auth/sessions'), {
    method: 'DELETE',
    headers: { ...cookieHeader(sessionToken), 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })

  assert.equal(res.status, 400)
  const body = await res.json()
  assert.deepEqual(body, { ok: false, error: 'sessionId_required' })
})

test('DELETE /api/auth/sessions: cannot revoke different user session', async () => {
  const res = await fetch(api('/api/auth/sessions'), {
    method: 'DELETE',
    headers: { ...cookieHeader(sessionToken), 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-other' }),
  })

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: false })
})

test('DELETE /api/auth/sessions: revokes own session', async () => {
  const res = await fetch(api('/api/auth/sessions'), {
    method: 'DELETE',
    headers: { ...cookieHeader(sessionToken), 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-account' }),
  })

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})

test('GET /api/chat/threads: success for account session', async () => {
  const res = await fetch(api('/api/chat/threads'), { headers: cookieHeader(sessionToken) })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(Array.isArray(body.threads), true)
  assert.equal(body.threads.length, 1)
  assert.equal(body.threads[0].id, 't-1')
})

test('PUT /api/chat/threads: updates list and version', async () => {
  const payload = [{ id: 't-2', title: 'Updated', updatedAt: Date.now() }]
  const putRes = await fetch(api('/api/chat/threads'), {
    method: 'PUT',
    headers: { ...cookieHeader(sessionToken), 'content-type': 'application/json' },
    body: JSON.stringify({ threads: payload }),
  })

  assert.equal(putRes.status, 200)
  assert.deepEqual(await putRes.json(), { ok: true })

  const getRes = await fetch(api('/api/chat/threads'), { headers: cookieHeader(sessionToken) })
  const body = await getRes.json()
  assert.equal(body.threads[0].id, 't-2')

  const versionRaw = kvStore.get('openclaw:threads:ver:user-1')
  assert.equal(typeof versionRaw, 'string')
  assert.equal(typeof JSON.parse(versionRaw).version, 'number')
})

test('GET /api/chat/threads: unauthorized returns 401', async () => {
  const res = await fetch(api('/api/chat/threads'))
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'unauthorized' })
})

test('GET /api/chat/threads: legacy session returns 400', async () => {
  await writeSessions([legacySession])
  const res = await fetch(api('/api/chat/threads'), { headers: cookieHeader(legacySession.token) })
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'account_session_required' })
})

test('GET /api/chat/threads/stream: emits SSE connected event', async () => {
  const res = await fetch(api('/api/chat/threads/stream'), { headers: cookieHeader(sessionToken) })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/event-stream')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  let chunk = ''
  while (!chunk.includes('event: connected')) {
    const { value, done } = await reader.read()
    if (done) break
    chunk += decoder.decode(value, { stream: true })
    if (chunk.length > 4096) break
  }

  assert.match(chunk, /event: connected/)
  assert.match(chunk, /"version":"1"/)
  await reader.cancel()
})

test('GET /api/chat/threads/stream: unauthorized returns 401', async () => {
  const res = await fetch(api('/api/chat/threads/stream'))
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'unauthorized' })
})

test('GET /api/chat/threads/stream: legacy session returns 400', async () => {
  await writeSessions([legacySession])
  const res = await fetch(api('/api/chat/threads/stream'), { headers: cookieHeader(legacySession.token) })
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'account_session_required' })
})
