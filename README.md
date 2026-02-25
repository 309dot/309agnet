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

## Quick QA checklist

1. Create thread
2. Send message (Enter)
3. Delete thread
4. Reload and confirm persistence
5. Open/close run panel and toggle dark mode in settings
