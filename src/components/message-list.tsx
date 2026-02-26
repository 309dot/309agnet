"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Message } from "@/lib/store"
import { ScrollArea } from "@/components/ui/scroll-area"

function AssistantText({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_h1]:mb-2 [&_h1]:mt-4 [&_h2]:mb-2 [&_h2]:mt-4 [&_h3]:mb-2 [&_h3]:mt-3 [&_li]:my-1 [&_p]:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

export function MessageList({ messages, streamingDraft }: { messages: Message[]; streamingDraft?: string }) {
  return (
    <ScrollArea className="h-[calc(100vh-13rem)] py-4">
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
