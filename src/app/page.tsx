"use client"

import { useEffect, useMemo, useState } from "react"
import { ChatComposer } from "@/components/chat-composer"
import { MessageList } from "@/components/message-list"
import { RunPanel } from "@/components/run-panel"
import { SidebarThreads } from "@/components/sidebar-threads"
import { TopBar } from "@/components/top-bar"
import { sendToOpenClawGateway } from "@/lib/openclaw"
import { addMessage, AppSettings, createThread, loadSettings, loadThreads, saveSettings, saveThreads, Thread } from "@/lib/store"

export default function HomePage() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>({ model: "gpt-5.3-codex", agentPanelEnabled: true, darkMode: true })
  const [runOpen, setRunOpen] = useState(false)
  const [isSending, setIsSending] = useState(false)

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

  const onSend = async (text: string) => {
    if (isSending) return
    setIsSending(true)

    let targetThread = activeThread
    if (!targetThread) {
      const created = createThread()
      setThreads((prev) => [created, ...prev])
      setActiveThreadId(created.id)
      targetThread = created
    }

    const userAdded = addMessage(targetThread, "user", text)
    setThreads((prev) => prev.map((t) => (t.id === userAdded.id ? userAdded : t)))

    const res = await sendToOpenClawGateway({
      threadId: userAdded.id,
      message: text,
      model: settings.model,
    })

    const withAssistant = addMessage(userAdded, "assistant", res.text)
    setThreads((prev) => prev.map((t) => (t.id === withAssistant.id ? withAssistant : t)))
    setIsSending(false)
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
        <ChatComposer onSend={onSend} disabled={isSending} />
      </section>
      {settings.agentPanelEnabled && <RunPanel open={runOpen} onOpenChange={setRunOpen} />}
    </main>
  )
}
