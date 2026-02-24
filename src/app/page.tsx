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
import { streamFromOpenClawGateway } from "@/lib/openclaw"
import { addMessage, AppSettings, createThread, loadSettings, loadThreads, saveSettings, saveThreads, Thread } from "@/lib/store"

const defaultSettings: AppSettings = { model: "gpt-5.3-codex", agentPanelEnabled: true, darkMode: true }

export default function HomePage() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [runOpen, setRunOpen] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [runLogs, setRunLogs] = useState<RunLog[]>([{ step: "idle", status: "queued", text: "요청 대기 중" }])
  const [threadPickerOpen, setThreadPickerOpen] = useState(false)
  const [threadQuery, setThreadQuery] = useState("")
  const [streamingDraft, setStreamingDraft] = useState("")
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      const loadedThreads = loadThreads()
      const loadedSettings = loadSettings()
      setThreads(loadedThreads)
      setSettings(loadedSettings)
      setActiveThreadId(loadedThreads[0]?.id ?? null)
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    saveThreads(threads)
  }, [threads])

  useEffect(() => {
    saveSettings(settings)
    document.documentElement.classList.toggle("dark", settings.darkMode)
  }, [settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setThreadPickerOpen(true)
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

  const filteredThreads = useMemo(() => {
    const q = threadQuery.trim().toLowerCase()
    if (!q) return threads
    return threads.filter((t) => t.title.toLowerCase().includes(q))
  }, [threadQuery, threads])

  const onCreateThread = () => {
    const t = createThread()
    setThreads((prev) => [t, ...prev])
    setActiveThreadId(t.id)
  }

  const onDeleteThread = (threadId: string) => {
    setThreads((prev) => prev.filter((t) => t.id !== threadId))
    if (activeThreadId === threadId) {
      const next = threads.find((t) => t.id !== threadId)
      setActiveThreadId(next?.id ?? null)
    }
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
      const created = createThread()
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
          message: text,
          model: settings.model,
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
      if (error instanceof DOMException && error.name === "AbortError") {
        return
      }
      const withAssistant = addMessage(userAdded, "assistant", "오류가 발생했습니다. 잠시 후 다시 시도해주세요.")
      setThreads((prev) => prev.map((t) => (t.id === withAssistant.id ? withAssistant : t)))
      setStreamingDraft("")
      setRunLogs([
        { step: "plan", status: "done", text: "요청을 분석했습니다." },
        { step: "agent", status: "error", text: String(error) },
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
    a.download = `309agnet-threads-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importThreads = async (file: File | null) => {
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as Thread[]
      if (!Array.isArray(parsed)) return
      setThreads(parsed)
      setActiveThreadId(parsed[0]?.id ?? null)
    } catch {
      // ignore invalid files in MVP
    }
  }

  return (
    <main className="flex h-screen bg-background text-foreground">
      <SidebarThreads
        threads={threads}
        activeThreadId={activeThreadId}
        onSelect={setActiveThreadId}
        onCreate={onCreateThread}
        onDelete={onDeleteThread}
      />
      <section className="flex min-w-0 flex-1 flex-col">
        <TopBar model={settings.model} onRunPanel={() => setRunOpen(true)} />
        <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
          <div>
            단축키: <kbd className="rounded border px-1">⌘/Ctrl + K</kbd> 스레드 검색 ·{" "}
            <kbd className="rounded border px-1">⌘/Ctrl + N</kbd> 새 스레드
          </div>
          <div className="flex items-center gap-2">
            {isSending ? (
              <Button variant="destructive" size="sm" onClick={onStop}>
                생성 중단
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
        <MessageList messages={activeThread?.messages ?? []} streamingDraft={streamingDraft} />
        <ChatComposer onSend={onSend} disabled={isSending} />
      </section>
      {settings.agentPanelEnabled && <RunPanel open={runOpen} onOpenChange={setRunOpen} logs={runLogs} />}

      <Dialog open={threadPickerOpen} onOpenChange={setThreadPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>스레드 빠른 전환</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="스레드 제목 검색..."
            value={threadQuery}
            onChange={(e) => setThreadQuery(e.target.value)}
            className="text-foreground"
          />
          <div className="max-h-72 space-y-2 overflow-auto">
            {filteredThreads.length === 0 ? (
              <p className="text-sm text-muted-foreground">검색 결과가 없습니다.</p>
            ) : (
              filteredThreads.map((t) => (
                <Button
                  key={t.id}
                  variant={t.id === activeThreadId ? "secondary" : "outline"}
                  className="w-full justify-start text-left"
                  onClick={() => {
                    setActiveThreadId(t.id)
                    setThreadPickerOpen(false)
                    setThreadQuery("")
                  }}
                >
                  <span className="truncate">{t.title}</span>
                </Button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
