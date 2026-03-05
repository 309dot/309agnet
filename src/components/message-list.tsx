"use client"

import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Bot, ChevronDown, Sparkles } from "lucide-react"
import { Message } from "@/lib/store"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"

function normalizeReadableText(input: string) {
  return input
    .replace(/\s*([•\-]\s+)/g, "\n$1")
    .replace(/([.!?다요])\s+(?=[A-Z가-힣0-9])/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function AssistantText({ content }: { content: string }) {
  const normalized = normalizeReadableText(content)
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_h1]:mb-1 [&_h1]:mt-3 [&_h2]:mb-1 [&_h2]:mt-2.5 [&_h3]:mb-1 [&_h3]:mt-2 [&_p]:my-1 [&_p]:leading-6 [&_ul]:my-1 [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:pl-5 [&_li]:my-0.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:px-2 [&_td]:py-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children } = props
            const isBlock = Boolean(className && className.includes("language-"))
            if (isBlock) {
              return <code className={className}>{children}</code>
            }
            return <code>{children}</code>
          },
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  )
}

export function MessageList({ messages, streamingDraft }: { messages: Message[]; streamingDraft?: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const getViewport = () => rootRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement | null

  const scrollToLatest = () => {
    const viewport = getViewport()
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" })
    setIsAtBottom(true)
  }

  useEffect(() => {
    const viewport = getViewport()
    if (!viewport) return

    const updateBottomState = () => {
      const threshold = 24
      const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= threshold
      setIsAtBottom(atBottom)
    }

    updateBottomState()
    viewport.addEventListener("scroll", updateBottomState, { passive: true })
    return () => viewport.removeEventListener("scroll", updateBottomState)
  }, [])

  useEffect(() => {
    const viewport = getViewport()
    if (!viewport || !isAtBottom) return
    viewport.scrollTop = viewport.scrollHeight
  }, [messages, streamingDraft, isAtBottom])

  return (
    <div className="relative h-full">
      <ScrollArea ref={rootRef} className="h-full">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-3xl px-2 text-center text-sm text-muted-foreground">첫 메시지를 입력해 대화를 시작하세요.</div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 pb-10">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "user" ? (
                  <div className="relative max-w-[85%]">
                    {m.openclawMode ? (
                      <div
                        className="absolute -left-7 bottom-1 inline-flex h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground"
                        title="openclaw 요청"
                        aria-label="openclaw 요청"
                      >
                        <Bot className="size-3.5" />
                      </div>
                    ) : null}
                    {m.pmMode ? (
                      <div
                        className="absolute -left-14 bottom-1 inline-flex h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground"
                        title="PM 모드"
                        aria-label="PM 모드"
                      >
                        <Sparkles className="size-3.5" />
                      </div>
                    ) : null}
                    <div className="rounded-2xl bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground">{m.content}</div>
                  </div>
                ) : (
                  <div className="max-w-full text-sm leading-relaxed text-foreground">
                    <AssistantText content={m.content} />
                  </div>
                )}
              </div>
            ))}
            {streamingDraft ? (
              <div className="flex justify-start">
                <div className="max-w-full text-sm leading-relaxed text-foreground">
                  <AssistantText content={streamingDraft} />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </ScrollArea>

      {!isAtBottom ? (
        <Button
          type="button"
          size="icon"
          className="absolute bottom-2 right-4 z-20 h-10 w-10 rounded-full shadow-lg md:bottom-0"
          onClick={scrollToLatest}
          aria-label="최신 메시지로 이동"
          title="최신 메시지로 이동"
        >
          <ChevronDown className="size-5" />
        </Button>
      ) : null}
    </div>
  )
}
