"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Message } from "@/lib/store"
import { ScrollArea } from "@/components/ui/scroll-area"

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
    <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_h1]:mb-1 [&_h1]:mt-3 [&_h2]:mb-1 [&_h2]:mt-2.5 [&_h3]:mb-1 [&_h3]:mt-2 [&_p]:my-1 [&_p]:leading-6 [&_ul]:my-1 [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:pl-5 [&_li]:my-0.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]">
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
  return (
    <ScrollArea className="h-full py-4">
      {messages.length === 0 ? (
        <div className="mx-auto max-w-3xl px-2 text-center text-sm text-muted-foreground">첫 메시지를 입력해 대화를 시작하세요.</div>
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-2">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "user" ? (
                <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground">{m.content}</div>
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
  )
}
