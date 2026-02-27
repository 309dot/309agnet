import { cookies } from "next/headers"
import { promises as fs } from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

export type AuthSession = {
  id: string
  token: string
  deviceName: string
  userAgent: string
  createdAt: string
  lastSeenAt: string
  revoked?: boolean
}

const COOKIE_NAME = "oc_session"
const STORE_PATH = path.join(process.cwd(), ".openclaw", "auth-sessions.json")

function isVercelRuntime() {
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined
}

function sessionSecret() {
  return process.env.OPENCLAW_APP_SESSION_SECRET || process.env.OPENCLAW_APP_ACCESS_CODE || "309-session-secret"
}

function signStatelessToken(payload: object) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url")
  return `st.${body}.${sig}`
}

function verifyStatelessToken(token: string): Omit<AuthSession, "token"> | null {
  if (!token.startsWith("st.")) return null
  const [, body, sig] = token.split(".")
  if (!body || !sig) return null

  const expected = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url")
  if (expected !== sig) return null

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as {
      id: string
      deviceName: string
      userAgent: string
      createdAt: string
      lastSeenAt: string
      exp?: number
    }

    if (typeof parsed.exp === "number" && Date.now() > parsed.exp) return null

    return {
      id: parsed.id,
      deviceName: parsed.deviceName,
      userAgent: parsed.userAgent,
      createdAt: parsed.createdAt,
      lastSeenAt: new Date().toISOString(),
      revoked: false,
    }
  } catch {
    return null
  }
}

async function readStore(): Promise<AuthSession[]> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeStore(list: AuthSession[]) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true })
  await fs.writeFile(STORE_PATH, JSON.stringify(list, null, 2), "utf-8")
}

export async function createSession(deviceName: string, userAgent: string) {
  const now = new Date().toISOString()

  if (isVercelRuntime()) {
    const sessionBase = {
      id: crypto.randomUUID(),
      deviceName: deviceName || "Unknown Device",
      userAgent,
      createdAt: now,
      lastSeenAt: now,
      revoked: false,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 30,
    }

    const token = signStatelessToken(sessionBase)
    const session: AuthSession = {
      id: sessionBase.id,
      token,
      deviceName: sessionBase.deviceName,
      userAgent: sessionBase.userAgent,
      createdAt: sessionBase.createdAt,
      lastSeenAt: sessionBase.lastSeenAt,
      revoked: false,
    }

    return session
  }

  const list = await readStore()
  const session: AuthSession = {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(24).toString("hex"),
    deviceName: deviceName || "Unknown Device",
    userAgent,
    createdAt: now,
    lastSeenAt: now,
    revoked: false,
  }
  list.unshift(session)
  await writeStore(list)
  return session
}

export async function getSessionFromCookie() {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return null

  if (isVercelRuntime()) {
    const verified = verifyStatelessToken(token)
    if (!verified) return null
    return { ...verified, token }
  }

  const list = await readStore()
  const found = list.find((s) => s.token === token && !s.revoked)
  if (!found) return null
  found.lastSeenAt = new Date().toISOString()
  await writeStore(list)
  return found
}

export async function requireSession() {
  const s = await getSessionFromCookie()
  if (!s) throw new Error("unauthorized")
  return s
}

export async function listSessions() {
  if (isVercelRuntime()) return []
  return (await readStore()).filter((s) => !s.revoked)
}

export async function revokeSession(id: string) {
  if (isVercelRuntime()) return false
  const list = await readStore()
  let changed = false
  for (const s of list) {
    if (s.id === id) {
      s.revoked = true
      changed = true
    }
  }
  if (changed) await writeStore(list)
  return changed
}

export async function setAuthCookie(token: string) {
  ;(await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  })
}

export async function clearAuthCookie() {
  ;(await cookies()).set(COOKIE_NAME, "", { path: "/", maxAge: 0 })
}

export function checkAccessCode(code: string) {
  const expected = process.env.OPENCLAW_APP_ACCESS_CODE || "309designlab-private"
  return code === expected
}
