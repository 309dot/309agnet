"use client"

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const mockLogs = [
  { step: "plan", status: "done", text: "요청 해석 완료" },
  { step: "tool", status: "running", text: "데이터 조회 중" },
  { step: "compose", status: "queued", text: "응답 포맷 준비" },
]

export function RunPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          Run 패널
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[360px] sm:w-[420px]">
        <SheetHeader>
          <SheetTitle>Run / Agent 패널</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {mockLogs.map((log) => (
            <div key={log.step} className="rounded-lg border p-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-medium">{log.step}</p>
                <Badge variant={log.status === "done" ? "default" : "secondary"}>{log.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{log.text}</p>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
