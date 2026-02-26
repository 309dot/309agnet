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
  const list = await readStore()
  const now = new Date().toISOString()
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
  return (await readStore()).filter((s) => !s.revoked)
}

export async function revokeSession(id: string) {
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
