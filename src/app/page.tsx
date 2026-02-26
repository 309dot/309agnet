"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChatComposer } from "@/components/chat-composer"
import { MessageList } from "@/components/message-list"
import { RunLog, RunPanel } from "@/components/run-panel"
import { SidebarThreads } from "@/components/sidebar-threads"
import { TopBar } from "@/components/top-bar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { streamFromOpenClawGateway } from "@/lib/openclaw"
import { addMessage, createThread, loadThreads, saveThreads, Thread } from "@/lib/store"

type ConnectionMode = "unknown" | "connected" | "mock" | "misconfigured"
type AuthSession = { id: string; deviceName: string; userAgent: string; createdAt: string; lastSeenAt: string }
const FIXED_MODEL = "gpt-5.3-codex"
const RESPONSE_STYLE_PREFIX = "응답 형식 지침: 가독성 좋게 문단을 충분히 나눠서 작성해줘. 제목/머리말/부머리말/본문 구조를 쓰고, 목록은 bullet 또는 번호 목록을 사용하되 번호 목록은 반드시 '1) 2) 3)' 형식으로 써줘. 필요하면 간단한 표도 활용해줘. 이모지는 자연스럽게(과하지 않게) 사용하고 친근한 톤으로 답해줘.\n\n사용자 요청:\n"

export default function HomePage() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [runOpen, setRunOpen] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [runLogs, setRunLogs] = useState<RunLog[]>([{ step: "idle", status: "queued", text: "요청 대기 중" }])
  const [chatDialogOpen, setChatDialogOpen] = useState(false)
  const [threadQuery, setThreadQuery] = useState("")
  const [threadAgentFilter, setThreadAgentFilter] = useState("all")
  const [threadSort, setThreadSort] = useState("recent")
  const [streamingDraft, setStreamingDraft] = useState("")
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("unknown")
  const [authed, setAuthed] = useState(false)
  const [accessCode, setAccessCode] = useState("")
  const [deviceName, setDeviceName] = useState("")
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [sessions, setSessions] = useState<AuthSession[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const loadedThreads = loadThreads()
    if (loadedThreads.length > 0) {
      setThreads(loadedThreads)
      setActiveThreadId(loadedThreads[0].id)
    } else {
      const first = createThread("새 채팅", "orchestrator")
      setThreads([first])
      setActiveThreadId(first.id)
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveThreads(threads)
  }, [threads, hydrated])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" })
        setAuthed(res.ok)
      } catch {
        setAuthed(false)
      }
    })()
  }, [])

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768)
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" })
        if (!res.ok) return
        const data = (await res.json()) as { mode?: ConnectionMode }
        setConnectionMode(data.mode ?? "unknown")
      } catch {
        setConnectionMode("unknown")
      }
    })()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setChatDialogOpen(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault()
        onCreateThread()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [threads])

  const activeThread = useMemo(() => threads.find((t) => t.id === activeThreadId) ?? null, [threads, activeThreadId])

  const agentOptions = useMemo(() => {
    const set = new Set<string>()
    for (const t of threads) set.add(t.agent ?? "orchestrator")
    return ["all", ...Array.from(set)]
  }, [threads])

  const filteredThreads = useMemo(() => {
    const q = threadQuery.trim().toLowerCase()
    let list = threads.filter((t) => (q ? t.title.toLowerCase().includes(q) : true))

    if (threadAgentFilter !== "all") {
      list = list.filter((t) => (t.agent ?? "orchestrator") === threadAgentFilter)
    }

    const sorted = [...list]
    if (threadSort === "recent") {
      sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    } else if (threadSort === "oldest") {
      sorted.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    } else {
      sorted.sort((a, b) => a.title.localeCompare(b.title, "ko"))
    }
    return sorted
  }, [threadQuery, threadAgentFilter, threadSort, threads])

  const onCreateThread = () => {
    const t = createThread("새 채팅", "orchestrator")
    setThreads((prev) => [t, ...prev])
    setActiveThreadId(t.id)
  }

  const onSelectThread = (threadId: string) => {
    setActiveThreadId(threadId)
    if (isMobile) setSidebarOpen(false)
  }

  const onDeleteThread = (threadId: string) => {
    setThreads((prev) => {
      const nextList = prev.filter((t) => t.id !== threadId)
      if (activeThreadId === threadId) setActiveThreadId(nextList[0]?.id ?? null)
      return nextList
    })
  }

  const onStop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsSending(false)
    setStreamingDraft("")
    setRunLogs([
      { step: "plan", status: "done", text: "요청을 분석했습니다." },
      { step: "agent", status: "error", text: "사용자가 생성 중단" },
      { step: "compose", status: "queued", text: "중단됨" },
    ])
  }

  const onSend = async (text: string) => {
    if (isSending) return
    setIsSending(true)
    setRunLogs([
      { step: "plan", status: "done", text: "요청을 분석했습니다." },
      { step: "agent", status: "running", text: "게이트웨이에 요청 전송 중..." },
      { step: "compose", status: "queued", text: "응답 생성 대기" },
    ])

    let targetThread = activeThread
    if (!targetThread) {
      const created = createThread("새 채팅", "orchestrator")
      setThreads((prev) => [created, ...prev])
      setActiveThreadId(created.id)
      targetThread = created
    }

    const userAdded = addMessage(targetThread, "user", text)
    setThreads((prev) => prev.map((t) => (t.id === userAdded.id ? userAdded : t)))

    try {
      const controller = new AbortController()
      abortRef.current = controller

      const textOut = await streamFromOpenClawGateway(
        {
          threadId: userAdded.id,
          message: `${RESPONSE_STYLE_PREFIX}${text}`,
          model: FIXED_MODEL,
        },
        (partial) => {
          setStreamingDraft(partial)
          setRunLogs([
            { step: "plan", status: "done", text: "요청을 분석했습니다." },
            { step: "agent", status: "running", text: "게이트웨이 스트리밍 수신 중..." },
            { step: "compose", status: "running", text: "응답 작성 중" },
          ])
        },
        controller.signal,
      )

      const withAssistant = addMessage(userAdded, "assistant", textOut)
      setThreads((prev) => prev.map((t) => (t.id === withAssistant.id ? withAssistant : t)))
      setStreamingDraft("")
      setRunLogs([
        { step: "plan", status: "done", text: "요청을 분석했습니다." },
        { step: "agent", status: "done", text: "게이트웨이 호출 성공" },
        { step: "compose", status: "done", text: "응답 생성 완료" },
      ])
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      const message = String(error)
      const isConfigError = message.includes("503")
      const friendly = isConfigError
        ? "OpenClaw 연동 설정이 아직 안 됐습니다. 관리자에게 OPENCLAW_CHAT_STREAM_URL 설정을 요청해주세요."
        : "오류가 발생했습니다. 잠시 후 다시 시도해주세요."
      if (isConfigError) setConnectionMode("misconfigured")

      const withAssistant = addMessage(userAdded, "assistant", friendly)
      setThreads((prev) => prev.map((t) => (t.id === withAssistant.id ? withAssistant : t)))
      setStreamingDraft("")
      setRunLogs([
        { step: "plan", status: "done", text: "요청을 분석했습니다." },
        { step: "agent", status: "error", text: message },
        { step: "compose", status: "queued", text: "오류로 인해 중단됨" },
      ])
    } finally {
      abortRef.current = null
      setIsSending(false)
    }
  }

  const exportThreads = () => {
    const blob = new Blob([JSON.stringify(threads, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `309agnet-chats-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importThreads = async (file: File | null) => {
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as Thread[]
      if (!Array.isArray(parsed) || parsed.length === 0) return
      setThreads(parsed)
      setActiveThreadId(parsed[0]?.id ?? null)
    } catch {
      // ignore invalid files in MVP
    }
  }

  const login = async () => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: accessCode, deviceName: deviceName || "My device" }),
    })
    setAuthed(res.ok)
    if (!res.ok) alert("접근 코드가 맞지 않아요.")
  }

  const fetchSessions = async () => {
    const res = await fetch("/api/auth/sessions", { cache: "no-store" })
    if (!res.ok) return
    const data = (await res.json()) as { sessions: AuthSession[] }
    setSessions(data.sessions)
  }

  const revokeSession = async (sessionId: string) => {
    const res = await fetch("/api/auth/sessions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
    if (res.ok) void fetchSessions()
  }

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    setAuthed(false)
  }

  if (!authed) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-3 rounded-lg border p-4">
          <h1 className="text-lg font-semibold">🔒 개인 접근</h1>
          <p className="text-sm text-muted-foreground">접근 코드로 로그인하세요.</p>
          <Input placeholder="디바이스 이름 (선택)" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          <Input placeholder="접근 코드" type="password" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} />
          <Button className="w-full" onClick={() => void login()}>로그인</Button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-dvh overflow-hidden bg-background text-foreground">
      {sidebarOpen && !isMobile ? (
        <SidebarThreads
          threads={threads}
          activeThreadId={activeThreadId}
          onSelect={onSelectThread}
          onCreate={onCreateThread}
          onDelete={onDeleteThread}
        />
      ) : null}

      <Sheet open={sidebarOpen && isMobile} onOpenChange={(open) => setSidebarOpen(open)}>
        <SheetContent side="left" className="p-0 md:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>채팅 사이드바</SheetTitle>
          </SheetHeader>
          <SidebarThreads
            threads={threads}
            activeThreadId={activeThreadId}
            onSelect={onSelectThread}
            onCreate={onCreateThread}
            onDelete={onDeleteThread}
          />
        </SheetContent>
      </Sheet>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          model={FIXED_MODEL}
          onRunPanel={() => setRunOpen(true)}
          onOpenDevices={() => {
            setDevicesOpen(true)
            void fetchSessions()
          }}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          connectionMode={connectionMode}
        />

        <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground md:px-4">
          <div className="truncate">
            <kbd className="rounded border px-1">⌘/Ctrl + K</kbd> 채팅 검색 · <kbd className="rounded border px-1">⌘/Ctrl + N</kbd> 새 채팅
          </div>
          <div className="ml-2 flex items-center gap-2">
            {isSending ? (
              <Button variant="destructive" size="sm" onClick={onStop}>
                중단
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={exportThreads}>
              내보내기
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              불러오기
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => importThreads(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <section className="min-h-0 flex-1 overflow-hidden pb-[52px]">
          <MessageList messages={activeThread?.messages ?? []} streamingDraft={streamingDraft} />
        </section>
        <ChatComposer onSend={onSend} disabled={isSending} />
      </section>

      <RunPanel open={runOpen} onOpenChange={setRunOpen} logs={runLogs} />

      <Dialog open={chatDialogOpen} onOpenChange={setChatDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>채팅 빠른 전환</DialogTitle>
          </DialogHeader>

          <Input
            placeholder="채팅 제목 검색..."
            value={threadQuery}
            onChange={(e) => setThreadQuery(e.target.value)}
            className="text-foreground"
          />

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Select value={threadAgentFilter} onValueChange={setThreadAgentFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Agent 필터" />
              </SelectTrigger>
              <SelectContent>
                {agentOptions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a === "all" ? "전체 agent" : a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={threadSort} onValueChange={setThreadSort}>
              <SelectTrigger>
                <SelectValue placeholder="정렬" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">최근 활동순</SelectItem>
                <SelectItem value="oldest">오래된순</SelectItem>
                <SelectItem value="title">제목순</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="max-h-72 space-y-2 overflow-auto">
            {filteredThreads.length === 0 ? (
              <p className="text-sm text-muted-foreground">검색 결과가 없습니다.</p>
            ) : (
              filteredThreads.map((t) => (
                <div key={t.id} className="flex items-center gap-2">
                  <Button
                    variant={t.id === activeThreadId ? "secondary" : "outline"}
                    className="w-full justify-start text-left"
                    onClick={() => {
                      setActiveThreadId(t.id)
                      setChatDialogOpen(false)
                      setThreadQuery("")
                    }}
                  >
                    <span className="truncate">{t.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{t.agent ?? "orchestrator"}</span>
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onDeleteThread(t.id)} aria-label="채팅 삭제">
                    ×
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={devicesOpen} onOpenChange={setDevicesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>디바이스 관리</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-auto">
            {sessions.map((s) => (
              <div key={s.id} className="rounded-md border p-2 text-sm">
                <p className="font-medium">{s.deviceName}</p>
                <p className="text-xs text-muted-foreground">최근 활동: {new Date(s.lastSeenAt).toLocaleString()}</p>
                <p className="truncate text-xs text-muted-foreground">{s.userAgent}</p>
                <div className="mt-2 flex justify-end">
                  <Button variant="destructive" size="sm" onClick={() => void revokeSession(s.id)}>
                    강제 로그아웃
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" onClick={() => void logout()}>내 기기 로그아웃</Button>
        </DialogContent>
      </Dialog>
    </main>
  )
}
