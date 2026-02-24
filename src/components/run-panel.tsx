"use client"

import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

export interface RunLog {
  step: string
  status: "done" | "running" | "queued" | "error"
  text: string
}

export function RunPanel({
  open,
  onOpenChange,
  logs,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  logs: RunLog[]
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[360px] sm:w-[420px]">
        <SheetHeader>
          <SheetTitle>Run / Agent 패널</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {logs.map((log, idx) => (
            <div key={`${log.step}-${idx}`} className="rounded-lg border p-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-medium">{log.step}</p>
                <Badge
                  variant={
                    log.status === "done" ? "default" : log.status === "error" ? "destructive" : "secondary"
                  }
                >
                  {log.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{log.text}</p>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
