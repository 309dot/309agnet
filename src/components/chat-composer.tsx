"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export function ChatComposer({ onSend, disabled = false }: { onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const resize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }

  const submit = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText("")
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = "40px"
    })
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 bg-gradient-to-b from-background/0 via-background/75 to-background p-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            resize()
          }}
          placeholder="메세지를 입력하세요."
          className="h-10 min-h-10 resize-none bg-background text-foreground"
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <Button onClick={submit} disabled={disabled} className="h-10 shrink-0 self-end px-4">
          {disabled ? "전송 중..." : "전송"}
        </Button>
      </div>
    </div>
  )
}
