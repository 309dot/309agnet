# 309agnet

ChatGPT-style web app MVP built with **Next.js (App Router)**, **TypeScript**, **Tailwind v4**, and **shadcn/ui**.

## Features

- Left sidebar: thread list, new thread, delete thread
- Main chat: message list + composer
  - Enter to send
  - Shift+Enter for newline
- Right run panel (Sheet): mock status/log steps
- Settings page:
  - model text
  - run panel toggle
  - dark mode toggle
- Local persistence via `localStorage`
  - threads/messages/settings
- OpenClaw gateway integration point prepared (`src/lib/openclaw.ts`)

## Routes

- `/` chat
- `/settings` settings

## Run locally

```bash
npm ci
npm run dev
```

## Verify

```bash
npm run lint
npm run build
```

## Deploy

- GitHub: https://github.com/309dot/309agnet
- Vercel: https://vercel.com/309dots-projects/309agnet

## OpenClaw backend wiring (optional)

For real OpenClaw replies in Vercel, set env vars:

- `OPENCLAW_CHAT_URL` (non-stream JSON endpoint)
- `OPENCLAW_CHAT_TOKEN` (optional bearer token)
- `OPENCLAW_CHAT_STREAM_URL` (SSE endpoint)
- `OPENCLAW_CHAT_STREAM_TOKEN` (optional bearer token)

Optional local/demo fallback:
- `OPENCLAW_ALLOW_MOCK=true` (enables mock responses when upstream is missing)

Default behavior in production is now **fail-closed** (returns 503 when upstream is not configured), so users don’t mistake mock text for real OpenClaw output.

## Task Master + OpenClaw agent dispatch

Installed package: `task-master-ai`

Commands:

```bash
npm run tm               # Task Master CLI
npm run tm:dispatch:dry  # show which pending tasks map to which agent
npm run tm:dispatch      # dispatch pending tasks to agents, mark in-progress
```

Routing file:
- `.taskmaster/agent-routing.json`

Task storage:
- `.taskmaster/tasks/tasks.json`

Notes:
- `assignee` field on each task is used first.
- If `assignee` is missing, keyword rules in `agent-routing.json` are used.
- Dispatch uses `openclaw agent --agent <id> --session-id tm_task_<id> ...`.

## launchd 운영 (macOS)

`com.309agent.app3090` 서비스는 `RunAtLoad + KeepAlive` 조합으로 부팅/로그인 시 자동 기동됩니다.

로그 증가 방지를 위해 15분 간격 롤링 에이전트를 함께 운영합니다.

- 스크립트: `scripts/logrotate-app3090.sh`
- LaunchAgent 템플릿: `scripts/com.309agent.app3090.logrotate.plist`
- 기본 정책: 파일당 20MB 초과 시 gzip 롤링, 최대 7개 보관

배포 순서:

```bash
cp scripts/logrotate-app3090.sh /Users/309agent/.openclaw/workspace-orchestrator/.openclaw/
chmod +x /Users/309agent/.openclaw/workspace-orchestrator/.openclaw/logrotate-app3090.sh
cp scripts/com.309agent.app3090.logrotate.plist ~/Library/LaunchAgents/
launchctl bootout gui/$(id -u)/com.309agent.app3090.logrotate >/dev/null 2>&1 || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.309agent.app3090.logrotate.plist
launchctl kickstart -k gui/$(id -u)/com.309agent.app3090.logrotate
```

재기동 점검:

```bash
launchctl kickstart -k gui/$(id -u)/com.309agent.app3090
curl -i http://127.0.0.1:3090
```

## Quick QA checklist

1. Create thread
2. Send message (Enter)
3. Delete thread
4. Reload and confirm persistence
5. Open/close run panel and toggle dark mode in settings
