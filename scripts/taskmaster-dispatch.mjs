#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const tasksPath = path.join(root, '.taskmaster', 'tasks', 'tasks.json')
const routingPath = path.join(root, '.taskmaster', 'agent-routing.json')

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run') || args.has('-n')

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw'
const DISPATCH_TIMEOUT_MS = Number(process.env.DISPATCH_TIMEOUT_MS || '15000')

function run(cmd, cmdArgs, extra = {}) {
  return spawnSync(cmd, cmdArgs, { encoding: 'utf8', ...extra })
}

function resolveAgent(task, routing) {
  if (task.assignee) return task.assignee
  const hay = `${task.title ?? ''} ${task.description ?? ''}`.toLowerCase()
  for (const r of routing.routes ?? []) {
    try {
      const re = new RegExp(r.match, 'i')
      if (re.test(hay)) return r.agent
    } catch {}
  }
  return routing.defaultAgent || 'orchestrator'
}

if (!fs.existsSync(tasksPath)) {
  console.error(`tasks.json not found: ${tasksPath}`)
  process.exit(1)
}

const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'))
const routing = fs.existsSync(routingPath)
  ? JSON.parse(fs.readFileSync(routingPath, 'utf8'))
  : { defaultAgent: 'orchestrator', routes: [] }

const tasks = Array.isArray(data.tasks) ? data.tasks : []
const pending = tasks.filter((t) => (t.status || 'pending') === 'pending')

if (pending.length === 0) {
  console.log('No pending tasks to dispatch.')
  process.exit(0)
}

for (const t of pending) {
  const agent = resolveAgent(t, routing)
  const sessionId = `tm_task_${String(t.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const message = [
    `[TaskMaster Dispatch]`,
    `Task ID: ${t.id}`,
    `Title: ${t.title}`,
    `Description: ${t.description}`,
    t.details ? `Details: ${t.details}` : '',
    t.testStrategy ? `Test strategy: ${t.testStrategy}` : '',
    `Please execute this task and report progress.`
  ].filter(Boolean).join('\n')

  if (dryRun) {
    console.log(`[DRY] task ${t.id} -> agent=${agent} session=${sessionId}`)
    continue
  }

  const send = run(
    OPENCLAW_BIN,
    [
      'agent',
      '--agent',
      agent,
      '--session-id',
      sessionId,
      '--message',
      message,
      '--json'
    ],
    { timeout: DISPATCH_TIMEOUT_MS }
  )

  if (send.error?.code === 'ETIMEDOUT') {
    console.error(`Dispatch timeout for task ${t.id} after ${DISPATCH_TIMEOUT_MS}ms`)
    continue
  }

  if (send.status !== 0) {
    console.error(`Dispatch failed for task ${t.id}: ${send.stderr || send.stdout}`)
    continue
  }

  const setStatus = run('./node_modules/.bin/task-master', ['set-status', String(t.id), 'in-progress'])
  if (setStatus.status !== 0) {
    console.error(`set-status failed for task ${t.id}: ${setStatus.stderr || setStatus.stdout}`)
    continue
  }

  console.log(`Dispatched task ${t.id} -> ${agent}`)
}
