"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type ConnectionMode = "unknown" | "connected" | "mock" | "misconfigured"

const modeLabel: Record<ConnectionMode, string> = {
  unknown: "상태 확인 중",
  connected: "OpenClaw 연결됨",
  mock: "Mock 모드",
  misconfigured: "설정 필요",
}

export function TopBar({
  model,
  onRunPanel,
  onOpenThreads,
  onCreateThread,
  connectionMode,
}: {
  model: string
  onRunPanel: () => void
  onOpenThreads: () => void
  onCreateThread: () => void
  connectionMode: ConnectionMode
}) {
  return (
    <header className="flex items-center justify-between border-b px-3 py-2 md:px-4 md:py-3">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-sm font-semibold tracking-tight">309agnet</h1>
        <Badge variant="secondary" className="hidden text-xs text-foreground sm:inline-flex">
          {model}
        </Badge>
        <Badge
          variant={connectionMode === "connected" ? "default" : connectionMode === "misconfigured" ? "destructive" : "secondary"}
          className="text-xs"
        >
          {modeLabel[connectionMode]}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onOpenThreads}>
          스레드
        </Button>
        <Button variant="outline" size="sm" onClick={onCreateThread}>
          새로
        </Button>
        <Button variant="outline" size="sm" onClick={onRunPanel}>
          Run
        </Button>
      </div>
    </header>
  )
}
