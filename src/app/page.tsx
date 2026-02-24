"use client"

import { useEffect, useMemo, useState } from "react"
import { ChatComposer } from "@/components/chat-composer"
import { MessageList } from "@/components/message-list"
import { RunPanel } from "@/components/run-panel"
import { SidebarThreads } from "@/components/sidebar-threads"
import { TopBar } from "@/components/top-bar"
import { addMessage, AppSettings, createThread, loadSettings, loadThreads, saveSettings, saveThreads, Thread } from "@/lib/store"

export default function HomePage() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>({ model: "gpt-5.3-codex", agentPanelEnabled: true, darkMode: true })
  const [runOpen, setRunOpen] = useState(false)

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

  const activeThread = useMemo(() => threads.find((t) => t.id === activeThreadId) ?? null, [threads, activeThreadId])

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

  const onSend = (text: string) => {
    if (!activeThread) {
      const t = createThread()
      const withUser = addMessage(t, "user", text)
      const withAssistant = addMessage(withUser, "assistant", "(MVP) 스트리밍 응답 자리입니다. OpenClaw 게이트웨이 연동 준비 완료.")
      setThreads((prev) => [withAssistant, ...prev])
      setActiveThreadId(withAssistant.id)
      return
    }
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id !== activeThread.id) return t
        const withUser = addMessage(t, "user", text)
        return addMessage(withUser, "assistant", "(MVP) 스트리밍 응답 자리입니다. OpenClaw 게이트웨이 연동 준비 완료.")
      }),
    )
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
        <MessageList messages={activeThread?.messages ?? []} />
        <ChatComposer onSend={onSend} />
      </section>
      {settings.agentPanelEnabled && <RunPanel open={runOpen} onOpenChange={setRunOpen} />}
    </main>
  )
}
