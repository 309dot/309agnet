"use client"

import { Check, Circle, Loader2, Send, Square, Sparkles, Wand2 } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"

export type InputMode = "normal" | "agent" | "pm"

const modeMeta: Record<InputMode, { label: string; icon: typeof Circle }> = {
  normal: { label: "일반", icon: Circle },
  agent: { label: "agent", icon: Wand2 },
  pm: { label: "pm", icon: Sparkles },
}

export function ChatComposer({
  onSend,
  disabled = false,
  mode = "normal",
  onModeChange,
  onStop,
}: {
  onSend: (text: string) => void
  disabled?: boolean
  mode?: InputMode
  onModeChange?: (mode: InputMode) => void
  onStop?: () => void
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
    if (!t || disabled) return
    onSend(t)
    setText("")
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = "40px"
    })
  }

  const placeholder = mode === "agent" ? "agent 모드로 작업 요청을 입력하세요." : mode === "pm" ? "PM 모드로 메시지를 입력하세요." : "메시지를 입력하세요."
  const ModeIcon = modeMeta[mode].icon

  return (
    <div className="sticky bottom-0 z-20 bg-gradient-to-b from-background/0 from-0% via-background/0 via-55% to-background to-100% p-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <div className="relative flex-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute left-2 top-1/2 z-10 h-7 w-7 -translate-y-1/2 rounded-full"
                aria-label="입력 모드 선택"
                title={`입력 모드: ${modeMeta[mode].label}`}
              >
                <ModeIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-36">
              {(Object.keys(modeMeta) as InputMode[]).map((item) => {
                const ItemIcon = modeMeta[item].icon
                return (
                  <DropdownMenuItem key={item} onClick={() => onModeChange?.(item)} className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2">
                      <ItemIcon className="size-3.5" />
                      {modeMeta[item].label}
                    </span>
                    {mode === item ? <Check className="size-3.5" /> : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <Textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              resize()
            }}
            placeholder={placeholder}
            className="h-10 min-h-10 resize-none bg-background pl-12 text-foreground"
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
        </div>

        {disabled ? (
          <Button type="button" variant="destructive" size="icon" className="h-10 w-10 shrink-0" onClick={onStop} aria-label="전송 중단" title="전송 중단">
            <Square className="size-4" />
          </Button>
        ) : null}

        <Button onClick={submit} disabled={disabled} className="h-10 shrink-0 self-end px-4">
          {disabled ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  )
}
