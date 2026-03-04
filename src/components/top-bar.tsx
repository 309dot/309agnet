"use client"

import { Menu, Play, Shield } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type ConnectionMode = "unknown" | "connected" | "mock" | "misconfigured"

const modeLabel: Record<ConnectionMode, string> = {
  unknown: "상태 확인 중",
  connected: "OpenClaw 연결됨",
  mock: "Mock 모드",
  misconfigured: "설정 필요",
}

export function TopBar({
  model,
  modelOptions,
  onChangeModel,
  onRunPanel,
  onOpenDevices,
  onToggleSidebar,
  connectionMode,
}: {
  model: string
  modelOptions: Array<{ value: string; label: string }>
  onChangeModel: (value: string) => void
  onRunPanel: () => void
  onOpenDevices: () => void
  onToggleSidebar: () => void
  connectionMode: ConnectionMode
}) {
  return (
    <header className="flex items-center justify-between border-b px-3 py-2 md:px-4 md:py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="outline" size="icon" onClick={onToggleSidebar} aria-label="사이드바 토글">
          <Menu className="size-4" />
        </Button>
        <h1 className="truncate text-sm font-semibold tracking-tight">309agnet</h1>

        <Select value={model} onValueChange={onChangeModel}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="모델 선택" />
          </SelectTrigger>
          <SelectContent>
            {modelOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Badge
          variant={connectionMode === "connected" ? "default" : connectionMode === "misconfigured" ? "destructive" : "secondary"}
          className="text-xs"
        >
          {modeLabel[connectionMode]}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={onOpenDevices} aria-label="디바이스 관리">
          <Shield className="size-4" />
        </Button>
        <Button variant="outline" size="icon" onClick={onRunPanel} aria-label="Run 패널">
          <Play className="size-4" />
        </Button>
      </div>
    </header>
  )
}
