export type Role = "user" | "assistant"

export interface Message {
  id: string
  role: Role
  content: string
  createdAt: string
}

export interface Thread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: Message[]
}

export interface AppSettings {
  model: string
  agentPanelEnabled: boolean
  darkMode: boolean
}

const THREADS_KEY = "oc_threads_v1"
const SETTINGS_KEY = "oc_settings_v1"

const defaultSettings: AppSettings = {
  model: "gpt-5.3-codex",
  agentPanelEnabled: true,
  darkMode: true,
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function loadThreads(): Thread[] {
  if (typeof window === "undefined") return []
  const raw = localStorage.getItem(THREADS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Thread[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveThreads(threads: Thread[]): void {
  if (typeof window === "undefined") return
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads))
}

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return defaultSettings
  const raw = localStorage.getItem(SETTINGS_KEY)
  if (!raw) return defaultSettings
  try {
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === "undefined") return
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function createThread(name = "새 스레드"): Thread {
  const now = new Date().toISOString()
  return {
    id: uid("thread"),
    title: name,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

export function addMessage(thread: Thread, role: Role, content: string): Thread {
  const msg: Message = {
    id: uid("msg"),
    role,
    content,
    createdAt: new Date().toISOString(),
  }
  return {
    ...thread,
    updatedAt: new Date().toISOString(),
    title: thread.messages.length === 0 ? content.slice(0, 24) || thread.title : thread.title,
    messages: [...thread.messages, msg],
  }
}
