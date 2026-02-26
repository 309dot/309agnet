"use client"

import { Plus, Trash2 } from "lucide-react"
import { Thread } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

export function SidebarThreads({
  threads,
  activeThreadId,
  onSelect,
  onCreate,
  onDelete,
}: {
  threads: Thread[]
  activeThreadId: string | null
  onSelect: (threadId: string) => void
  onCreate: () => void
  onDelete: (threadId: string) => void
}) {
  return (
    <aside className="flex h-full w-72 flex-col border-r bg-muted/20">
      <div className="flex items-center justify-between p-3">
        <p className="text-sm font-medium">채팅</p>
        <Button variant="outline" size="icon" onClick={onCreate} aria-label="채팅 생성">
          <Plus className="size-4" />
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1 p-2">
        <div className="space-y-1">
          {threads.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">채팅이 없습니다.</p>
          ) : (
            threads.map((t) => (
              <div key={t.id} className="group flex items-center gap-1">
                <Button
                  variant={activeThreadId === t.id ? "secondary" : "ghost"}
                  className="h-9 flex-1 justify-start text-foreground"
                  onClick={() => onSelect(t.id)}
                >
                  <span className="truncate">{t.title}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-60 group-hover:opacity-100"
                  onClick={() => onDelete(t.id)}
                  aria-label="채팅 삭제"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}
