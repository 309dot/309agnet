"use client"

import { Bot } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export function ChatComposer({
  onSend,
  disabled = false,
  openclawMode = false,
  onToggleOpenclawMode,
}: {
  onSend: (text: string) => void
  disabled?: boolean
  openclawMode?: boolean
  onToggleOpenclawMode?: () => void
}) {
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
    <div className="sticky bottom-0 z-20 bg-gradient-to-b from-background/0 from-0% via-background/0 via-55% to-background to-100% p-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Button
          type="button"
          variant={openclawMode ? "default" : "outline"}
          size="icon"
          onClick={onToggleOpenclawMode}
          disabled={disabled}
          className="h-10 w-10 shrink-0 rounded-full"
          title={openclawMode ? "openclaw 요청 ON" : "openclaw 요청 OFF"}
          aria-label="openclaw 요청 토글"
        >
          <Bot className="size-4" />
        </Button>

        <Textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            resize()
          }}
          placeholder={openclawMode ? "openclaw 작업 요청을 입력하세요." : "메세지를 입력하세요."}
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
