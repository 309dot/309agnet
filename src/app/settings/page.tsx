"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { AppSettings, loadSettings, saveSettings } from "@/lib/store"

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({ model: "gpt-5.3-codex", agentPanelEnabled: true, darkMode: true })

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettings(loadSettings())
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    saveSettings(settings)
    document.documentElement.classList.toggle("dark", settings.darkMode)
  }, [settings])

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">설정</h1>
        <Button asChild variant="outline">
          <Link href="/">채팅으로 돌아가기</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>모델 / 에이전트</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">기본 모델</p>
            <Input
              value={settings.model}
              onChange={(e) => setSettings((prev) => ({ ...prev, model: e.target.value }))}
              className="text-foreground"
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Run/Agent 패널 표시</p>
            <Switch
              checked={settings.agentPanelEnabled}
              onCheckedChange={(v) => setSettings((prev) => ({ ...prev, agentPanelEnabled: v }))}
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">다크 모드</p>
            <Switch checked={settings.darkMode} onCheckedChange={(v) => setSettings((prev) => ({ ...prev, darkMode: v }))} />
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
