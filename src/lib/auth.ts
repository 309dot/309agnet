import { cookies } from "next/headers"
import { promises as fs } from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

export type AuthType = "legacy" | "account"

export type AuthSession = {
  id: string
  token: string
  deviceName: string
  userAgent: string
  createdAt: string
  lastSeenAt: string
  revoked?: boolean
  userId?: string
  authType?: AuthType
}

export type AuthUser = {
  id: string
  email: string
  name?: string
  passwordHash: string
  role: "admin" | "member"
  active: boolean
  createdAt: string
  updatedAt: string
}

const COOKIE_NAME = "oc_session"
const SESSION_STORE_PATH = path.join(process.cwd(), ".openclaw", "auth-sessions.json")
const USER_STORE_PATH = path.join(process.cwd(), ".openclaw", "auth-users.json")

function isVercelRuntime() {
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined
}

function sessionSecret() {
  return process.env.OPENCLAW_APP_SESSION_SECRET || process.env.OPENCLAW_APP_ACCESS_CODE || "309-session-secret"
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function issuerKey() {
  return process.env.OPENCLAW_ADMIN_ISSUER_KEY || process.env.OPENCLAW_APP_ACCESS_CODE || ""
}

function assertAdminKey(adminKey: string) {
  const expected = issuerKey()
  if (!expected || adminKey !== expected) {
    throw new Error("unauthorized")
  }
}

function parseEnvUsers(): AuthUser[] {
  const raw = process.env.OPENCLAW_AUTH_USERS_JSON
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex")
  const derived = crypto.scryptSync(password, salt, 64).toString("hex")
  return `scrypt:${salt}:${derived}`
}

function verifyPasswordHash(password: string, stored: string) {
  const [algo, salt, hash] = stored.split(":")
  if (algo !== "scrypt" || !salt || !hash) return false
  const derived = crypto.scryptSync(password, salt, 64).toString("hex")
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derived, "hex"))
  } catch {
    return false
  }
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
      userId?: string
      authType?: AuthType
    }

    if (typeof parsed.exp === "number" && Date.now() > parsed.exp) return null

    return {
      id: parsed.id,
      deviceName: parsed.deviceName,
      userAgent: parsed.userAgent,
      createdAt: parsed.createdAt,
      lastSeenAt: new Date().toISOString(),
      revoked: false,
      userId: parsed.userId,
      authType: parsed.authType,
    }
  } catch {
    return null
  }
}

async function readSessionStore(): Promise<AuthSession[]> {
  try {
    const raw = await fs.readFile(SESSION_STORE_PATH, "utf-8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeSessionStore(list: AuthSession[]) {
  await fs.mkdir(path.dirname(SESSION_STORE_PATH), { recursive: true })
  await fs.writeFile(SESSION_STORE_PATH, JSON.stringify(list, null, 2), "utf-8")
}

async function readUserStore(): Promise<AuthUser[]> {
  if (isVercelRuntime()) {
    return parseEnvUsers()
  }
  try {
    const raw = await fs.readFile(USER_STORE_PATH, "utf-8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeUserStore(list: AuthUser[]) {
  if (isVercelRuntime()) return
  await fs.mkdir(path.dirname(USER_STORE_PATH), { recursive: true })
  await fs.writeFile(USER_STORE_PATH, JSON.stringify(list, null, 2), "utf-8")
}

export async function findUserByEmail(email: string) {
  const normalized = normalizeEmail(email)
  const users = await readUserStore()
  return users.find((u) => normalizeEmail(u.email) === normalized && u.active) ?? null
}

export async function verifyUserPassword(email: string, password: string) {
  const user = await findUserByEmail(email)
  if (!user) return null
  if (!verifyPasswordHash(password, user.passwordHash)) return null
  return user
}

export async function createUserByAdmin(
  input: { email: string; password: string; name?: string; role?: "admin" | "member" },
  adminKey: string,
) {
  assertAdminKey(adminKey)

  if (isVercelRuntime()) {
    // Vercel runtime cannot persist user-store writes at runtime.
    // OPENCLAW_AUTH_USERS_JSON is treated as bootstrap/read-only source.
    throw new Error("user_store_not_configured")
  }

  const email = normalizeEmail(input.email || "")
  const password = input.password || ""
  const name = input.name?.trim() || undefined
  const role = input.role === "admin" ? "admin" : "member"

  if (!email.includes("@") || email.length < 5) throw new Error("invalid_email")
  if (password.length < 8) throw new Error("invalid_password")

  const users = await readUserStore()
  const exists = users.some((u) => normalizeEmail(u.email) === email)
  if (exists) throw new Error("email_exists")

  const now = new Date().toISOString()
  const user: AuthUser = {
    id: crypto.randomUUID(),
    email,
    name,
    passwordHash: hashPassword(password),
    role,
    active: true,
    createdAt: now,
    updatedAt: now,
  }

  users.unshift(user)
  await writeUserStore(users)

  return user
}

export async function listUsersByAdmin(adminKey: string) {
  assertAdminKey(adminKey)
  const users = await readUserStore()
  return users.map(({ passwordHash: _passwordHash, ...user }) => user)
}

export async function updateUserByAdmin(
  id: string,
  patch: { active?: boolean; name?: string; role?: "admin" | "member" },
  adminKey: string,
) {
  assertAdminKey(adminKey)

  const users = await readUserStore()
  const target = users.find((u) => u.id === id)
  if (!target) throw new Error("user_not_found")

  let changed = false
  if (typeof patch.active === "boolean" && patch.active !== target.active) {
    target.active = patch.active
    changed = true
  }
  if (typeof patch.name === "string") {
    const normalizedName = patch.name.trim() || undefined
    if (normalizedName !== target.name) {
      target.name = normalizedName
      changed = true
    }
  }
  if (patch.role === "admin" || patch.role === "member") {
    if (patch.role !== target.role) {
      target.role = patch.role
      changed = true
    }
  }

  if (!changed) return target

  target.updatedAt = new Date().toISOString()
  await writeUserStore(users)
  return target
}

export async function revokeAllSessionsByUserId(userId: string, actorSession?: AuthSession) {
  if (isVercelRuntime()) return 0
  const list = await readSessionStore()
  let revokedCount = 0

  for (const session of list) {
    if (session.userId !== userId || session.revoked) continue
    if (actorSession && actorSession.id === session.id) continue
    session.revoked = true
    revokedCount += 1
  }

  if (revokedCount > 0) {
    await writeSessionStore(list)
  }

  return revokedCount
}

export async function createSession(
  deviceName: string,
  userAgent: string,
  opts?: { userId?: string; authType?: AuthType },
) {
  const now = new Date().toISOString()
  const authType: AuthType = opts?.authType ?? (opts?.userId ? "account" : "legacy")

  if (isVercelRuntime()) {
    const sessionBase = {
      id: crypto.randomUUID(),
      deviceName: deviceName || "Unknown Device",
      userAgent,
      createdAt: now,
      lastSeenAt: now,
      revoked: false,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 30,
      userId: opts?.userId,
      authType,
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
      userId: sessionBase.userId,
      authType: sessionBase.authType,
    }

    return session
  }

  const list = await readSessionStore()
  const session: AuthSession = {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(24).toString("hex"),
    deviceName: deviceName || "Unknown Device",
    userAgent,
    createdAt: now,
    lastSeenAt: now,
    revoked: false,
    userId: opts?.userId,
    authType,
  }
  list.unshift(session)
  await writeSessionStore(list)
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

  const list = await readSessionStore()
  const found = list.find((s) => s.token === token && !s.revoked)
  if (!found) return null
  found.lastSeenAt = new Date().toISOString()
  await writeSessionStore(list)
  return found
}

export async function requireSession() {
  const s = await getSessionFromCookie()
  if (!s) throw new Error("unauthorized")
  return s
}

export async function listSessions() {
  if (isVercelRuntime()) return []
  return (await readSessionStore()).filter((s) => !s.revoked)
}

export async function listSessionsForCurrent(currentSession: AuthSession) {
  if (isVercelRuntime()) return [currentSession]
  const sessions = await listSessions()
  if (currentSession.userId) {
    return sessions.filter((s) => s.userId === currentSession.userId)
  }
  return sessions.length > 0 ? sessions.filter((s) => s.id === currentSession.id) : [currentSession]
}

export async function revokeSession(id: string) {
  if (isVercelRuntime()) return false
  const list = await readSessionStore()
  let changed = false
  for (const s of list) {
    if (s.id === id) {
      s.revoked = true
      changed = true
    }
  }
  if (changed) await writeSessionStore(list)
  return changed
}

export async function revokeSessionForCurrent(currentSession: AuthSession, targetSessionId: string) {
  if (isVercelRuntime()) {
    return currentSession.id === targetSessionId
  }

  const list = await readSessionStore()
  const target = list.find((s) => s.id === targetSessionId && !s.revoked)
  if (!target) return false

  const canRevoke = currentSession.userId
    ? target.userId === currentSession.userId
    : target.id === currentSession.id

  if (!canRevoke) return false
  target.revoked = true
  await writeSessionStore(list)
  return true
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
