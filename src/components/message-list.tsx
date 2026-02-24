"use client"

import { Message } from "@/lib/store"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"

export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <ScrollArea className="h-[calc(100vh-13rem)] px-4 py-4">
      {messages.length === 0 ? (
        <Card className="mx-auto max-w-2xl p-6 text-center text-sm text-muted-foreground">
          첫 메시지를 입력해 대화를 시작하세요.
        </Card>
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-card-foreground border"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </ScrollArea>
  )
}
