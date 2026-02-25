import http from "node:http"
import { execFile } from "node:child_process"

const PORT = Number(process.env.BRIDGE_PORT || 18790)

function runAgent({ threadId, message }) {
  const sessionId = `web_${String(threadId || "default").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`
  return new Promise((resolve, reject) => {
    execFile(
      "openclaw",
      ["agent", "--session-id", sessionId, "--message", String(message || ""), "--json"],
      { maxBuffer: 1024 * 1024 * 8, timeout: 1000 * 120 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || err.message))
          return
        }
        try {
          const parsed = JSON.parse(stdout)
          const text = parsed?.result?.payloads?.map((p) => p?.text).filter(Boolean).join("\n") || ""
          resolve(text)
        } catch (e) {
          reject(new Error(`invalid_json:${e.message}`))
        }
      },
    )
  })
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (c) => {
      body += c
      if (body.length > 1024 * 1024) {
        reject(new Error("payload_too_large"))
        req.destroy()
      }
    })
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error("invalid_json"))
      }
    })
    req.on("error", reject)
  })
}

function sseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (req.method === "POST" && req.url === "/chat") {
    try {
      const body = await readJson(req)
      const text = await runAgent(body)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ text }))
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: String(e.message || e) }))
    }
    return
  }

  if (req.method === "POST" && req.url === "/chat/stream") {
    try {
      const body = await readJson(req)
      const text = await runAgent(body)
      sseHeaders(res)
      const chunks = text.match(/.{1,32}/g) || [text]
      for (const c of chunks) {
        res.write(`data: ${c}\n\n`)
      }
      res.write("event: done\ndata: [DONE]\n\n")
      res.end()
    } catch (e) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" })
      res.end(`bridge_error:${String(e.message || e)}`)
    }
    return
  }

  res.writeHead(404, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ error: "not_found" }))
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[bridge] listening http://127.0.0.1:${PORT}`)
})
