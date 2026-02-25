"use client"

import Link from "next/link"
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
  connectionMode,
}: {
  model: string
  onRunPanel: () => void
  connectionMode: ConnectionMode
}) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold tracking-tight">309agnet</h1>
        <Badge variant="secondary" className="text-xs text-foreground">
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
        <Button variant="outline" size="sm" onClick={onRunPanel}>
          Run 패널
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/settings">설정</Link>
        </Button>
      </div>
    </header>
  )
}
