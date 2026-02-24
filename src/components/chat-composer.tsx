"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export function ChatComposer({ onSend, disabled = false }: { onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("")

  const submit = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText("")
  }

  return (
    <div className="border-t p-4">
      <div className="mx-auto flex max-w-3xl gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="메시지를 입력하세요. Enter 전송 / Shift+Enter 줄바꿈"
          className="min-h-[52px] resize-none bg-background text-foreground"
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <Button onClick={submit} className="self-end" disabled={disabled}>
          {disabled ? "전송 중..." : "전송"}
        </Button>
      </div>
    </div>
  )
}
