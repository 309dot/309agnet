import express from "express";
import cors from "cors";
import { spawn, execFile } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { extractUrls, fetchWebDocument, hashUrl } from "./rag/web.mjs";
import { chunkText } from "./rag/chunk.mjs";
import { rankChunksByEmbedding } from "./rag/embed.mjs";

const app = express();
const DEFAULT_PERMISSION =
  String(process.env.DEFAULT_PERMISSION ?? "full").toLowerCase() === "basic"
    ? "basic"
    : "full";
const CORS_ORIGINS = String(process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const LOCAL_ORIGINS = new Set([
  "http://localhost:4310",
  "http://127.0.0.1:4310",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);
const allowedOrigins =
  CORS_ORIGINS.length > 0
    ? new Set([...LOCAL_ORIGINS, ...CORS_ORIGINS])
    : null;

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!allowedOrigins || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error("not_allowed_origin"), false);
    }
  })
);
app.use(express.json({ limit: "2mb" }));

const WORKSPACE =
  process.env.WORKSPACE ?? "/Users/a309/Documents/Agent309/wOpenclaw";
const DATA_DIR = process.env.DATA_DIR ?? path.join(WORKSPACE, "apps/ui/.data");
const RUNS_DIR = path.join(DATA_DIR, "runs");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const MEMORY_DIR = path.join(DATA_DIR, "memory");
const GLOBAL_MEMORY_PATH = path.join(MEMORY_DIR, "global.md");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const RAG_DIR = path.join(DATA_DIR, "rag");
const RAG_WEB_CACHE_DIR = path.join(RAG_DIR, "web-cache");
const CAPABILITIES_DIR = path.join(DATA_DIR, "capabilities");
const CAP_REGISTRY_PATH = path.join(CAPABILITIES_DIR, "registry.json");

const OPENCLAW_BIN =
  process.env.OPENCLAW_BIN ?? "/Users/a309/.openclaw/bin/openclaw";
const OPENCLAW_CONFIG =
  process.env.OPENCLAW_CONFIG ??
  "/Users/a309/Documents/Agent309/wOpenclaw/.openclaw-state/openclaw.json";
const OPENCLAW_STATE_DIR =
  process.env.OPENCLAW_STATE_DIR ??
  "/Users/a309/Documents/Agent309/wOpenclaw/.openclaw-state";
const OPENCLAW_LOG_DIR = process.env.OPENCLAW_LOG_DIR ?? "/tmp/openclaw";
const MCP_CONFIG_PATH = process.env.MCP_CONFIG_PATH ?? path.join(WORKSPACE, "mcp.json");
const OLLAMA_API_BASE = process.env.OLLAMA_API_BASE ?? "http://127.0.0.1:11434";

const DEFAULT_MCP_CONFIG = {
  servers: {
    "figma-desktop": {
      type: "http",
      url: "http://127.0.0.1:3845/mcp"
    }
  }
};

const MCP_CONFIG_TTL_MS = 5_000;
const MCP_TOOLS_TTL_MS = 10_000;

const PRESET_MODELS = {
  assistant: "qwen2.5:7b",
  dev: "qwen2.5:14b",
  design: "qwen2.5:32b"
};

const AGENT_MODELS = {
  ask: "qwen2.5:7b",
  plan: "qwen2.5:14b",
  code: "qwen3-coder:30b"
};

const normalizePermission = (value) => (value === "full" ? "full" : "basic");
const DEFAULT_SESSION_PROJECT = {
  id: "default",
  name: "wOpenclaw",
  type: "path",
  value: WORKSPACE
};

const normalizeProjectType = (value) => (value === "git" ? "git" : "path");

const projectNameFromValue = (type, value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unnamed project";
  if (type === "git") {
    const cleaned = raw.replace(/\.git$/i, "").replace(/\/+$/, "");
    const parts = cleaned.split("/").filter(Boolean);
    return parts[parts.length - 1] || cleaned;
  }
  const trimmed = raw.replace(/\/+$/, "");
  return path.basename(trimmed) || trimmed || "Unnamed project";
};

const buildProjectId = (type, value) => {
  const key = `${normalizeProjectType(type)}:${String(value ?? "").trim()}`;
  const digest = crypto.createHash("sha1").update(key).digest("hex").slice(0, 10);
  return `p-${digest}`;
};

const normalizeProjectRef = (project) => {
  if (!project || typeof project !== "object") return { ...DEFAULT_SESSION_PROJECT };
  const type = normalizeProjectType(project.type);
  const value = String(project.value ?? "").trim();
  if (!value) return { ...DEFAULT_SESSION_PROJECT };
  const name = String(project.name ?? "").trim() || projectNameFromValue(type, value);
  const id = String(project.id ?? "").trim() || buildProjectId(type, value);
  return { id, name, type, value };
};

const stripModePrefix = (message) => {
  const raw = String(message ?? "").trimStart();
  const match = raw.match(/^\/(ask|plan|code)\b\s*/i);
  if (!match) return { forced: null, text: String(message ?? "") };
  const forced = match[1].toLowerCase();
  return { forced, text: raw.slice(match[0].length) };
};

const inferAgentMode = (message) => {
  const s = String(message ?? "");
  const { forced, text } = stripModePrefix(s);
  if (forced) return { mode: forced, text };

  // Figma links should never route to ask-mode.
  // Without tools (ask-mode), we can't fetch design context or implement changes.
  if (/https?:\/\/(?:www\.)?figma\.com\/(file|design|proto)\//i.test(s)) {
    return { mode: "code", text: s };
  }

  // "code" intent heuristics (files/commands/tests).
  // Goal: if the user is asking us to change code/UI or run commands, we must route to code mode.
  // Ask mode must not pretend it will open/edit files (tools are disabled there).
  const hasWorkspacePath =
    /\/Users\/[^ \n\t]+/i.test(s) || /\/workspace(\/|\\)/i.test(s);
  const codeHint =
    /(수정|바꿔|변경|추가|삭제|만들|생성|리팩터|버그|에러|고쳐|해결|테스트|빌드|실행|커밋|브랜치|PR|푸시|git|npm|pnpm|yarn|옮기|이동|위치|정렬|패딩|마진|스타일|css|레이아웃|컴포넌트|버튼|사이드바|드롭다운)/i.test(
      s
    );
  const looksLikePureQuestion =
    /(\?|뭐야|무엇|왜|설명|정의|차이)/i.test(s) &&
    !/(수정|바꿔|변경|추가|삭제|만들|생성|리팩터|고쳐|해결|옮기|이동|위치)/i.test(s);

  if (hasWorkspacePath) return { mode: "code", text: s };
  if (codeHint && !looksLikePureQuestion) return { mode: "code", text: s };

  // "plan" intent heuristics (design/requirements/plan).
  if (/(기획|계획|플랜|설계|요구사항|정리|로드맵|리스크|우선순위)/i.test(s)) {
    return { mode: "plan", text: s };
  }
  return { mode: "ask", text: s };
};

const requestLikelyNeedsWorldChange = (message) => {
  const s = String(message ?? "");
  return /(파일|생성|만들|추가|삭제|수정|변경|리팩터|고쳐|해결|css|스타일|레이아웃|컴포넌트|버튼|사이드바|드롭다운|테스트|빌드|실행|커밋|브랜치|PR|git|pnpm|npm|yarn)/i.test(
    s
  );
};

const inferCandidateFilesForRequest = (message) => {
  const s = String(message ?? "").toLowerCase();
  const candidates = new Set();
  // Global fallback candidates for UI tweaks.
  candidates.add("apps/ui/src/styles.css");
  candidates.add("apps/ui/src/App.jsx");

  if (/(입력|인풋|input|패딩|padding|라운드|radius|border)/i.test(s)) {
    candidates.add("apps/ui/src/components/composer/PromptComposer.jsx");
    candidates.add("apps/ui/src/components/chat/ChatPane.jsx");
  }
  if (/(사이드바|sidebar|세션 목록|session list)/i.test(s)) {
    candidates.add("apps/ui/src/components/sessions/SessionList.jsx");
    candidates.add("apps/ui/src/components/layout/AppShell.jsx");
  }
  if (/(헤더|header|탑바|topbar)/i.test(s)) {
    candidates.add("apps/ui/src/components/topbar/TopBarMinimal.jsx");
    candidates.add("apps/ui/src/components/topbar/OverflowMenu.jsx");
  }
  if (/(버튼|button)/i.test(s)) {
    candidates.add("apps/ui/src/components/act/ActRunner.jsx");
    candidates.add("apps/ui/src/components/composer/PromptComposer.jsx");
  }
  return [...candidates].slice(0, 8);
};

const agentModeToPreset = (mode) => {
  if (mode === "ask") return "assistant";
  if (mode === "plan") return "dev";
  return "dev";
};

const pickModelId = (mode, models) => {
  const ids = (models ?? []).map((m) => m.id);
  const desired = AGENT_MODELS[mode] ?? AGENT_MODELS.ask;
  if (ids.includes(desired)) return desired;
  // ask 모드만 fallback 허용 (대화 UX 보호).
  // code/plan은 조용한 모델 강등을 막아 정확한 실패를 노출한다.
  if (mode === "ask") {
    if (ids.includes("qwen2.5:14b")) return "qwen2.5:14b";
    if (ids.includes("qwen2.5:7b")) return "qwen2.5:7b";
    return ids[0] ?? desired;
  }
  return null;
};

const defaultApprovals = {
  mail: false,
  deploy: false,
  merge: false,
  gitPush: false,
  prCreate: false
};

const approvalKeywords = {
  mail: /메일|email|gmail|calendar|캘린더|보내|send/i,
  deploy: /배포|deploy|release|prod|production/i,
  merge: /머지|merge/i,
  gitPush: /git\s*push|push origin/i,
  prCreate: /\bPR\b|pull request|draft pr/i
};

const inferRequiredApprovals = (text) => {
  const required = { ...defaultApprovals };
  const block = String(text ?? "");
  for (const [key, regex] of Object.entries(approvalKeywords)) {
    required[key] = regex.test(block);
  }
  return required;
};

const state = {
  active: null
};

const selfImproveState = {
  running: false,
  child: null,
  startedAt: null,
  logPath: null
};

const MAX_LOG_BYTES = 200_000;

const mcpCache = {
  configLoadedAt: 0,
  config: null,
  tools: new Map(), // serverName -> { loadedAt, tools }
  sessions: new Map() // serverName -> { sessionId, initializedAt }
};

const ensureDirs = async () => {
  await fsp.mkdir(RUNS_DIR, { recursive: true });
  await fsp.mkdir(SESSIONS_DIR, { recursive: true });
  await fsp.mkdir(MEMORY_DIR, { recursive: true });
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(RAG_WEB_CACHE_DIR, { recursive: true });
  await fsp.mkdir(CAPABILITIES_DIR, { recursive: true });
};

const migrateGlobalMemory = async () => {
  await ensureDirs();
  const raw = await readText(GLOBAL_MEMORY_PATH);
  if (!raw.trim()) return;
  if (isMostlyKorean(raw) && !containsCjk(raw)) return;
  // Never block server startup on Ollama being down. Prefer stripping + best-effort rewrite with timeout.
  const stripped = containsCjk(raw) ? raw.replace(/[\u4E00-\u9FFF]+/g, "").trim() : raw;
  const rewritten = await rewriteToKorean(stripped, 1500).catch(() => stripped);
  await writeText(GLOBAL_MEMORY_PATH, trimCharsFromEnd(rewritten || stripped, 1500));
};

const loadMcpConfig = async () => {
  const now = Date.now();
  if (mcpCache.config && now - mcpCache.configLoadedAt < MCP_CONFIG_TTL_MS) {
    return mcpCache.config;
  }
  let cfg = DEFAULT_MCP_CONFIG;
  try {
    const raw = await fsp.readFile(MCP_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.servers) {
      cfg = parsed;
    }
  } catch {
    // ignore; fall back to DEFAULT_MCP_CONFIG
  }
  mcpCache.config = cfg;
  mcpCache.configLoadedAt = now;
  return cfg;
};

const parseMcpSse = (text) => {
  const lines = String(text ?? "").split(/\r?\n/);
  const dataLines = lines
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice("data:".length).trim())
    .filter(Boolean);
  if (!dataLines.length) return null;
  const last = dataLines[dataLines.length - 1];
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
};

const fetchJsonWithTimeout = async (url, body, timeoutMs = 2_500, extraHeaders = null) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "Content-Type": "application/json", ...(extraHeaders ?? {}) };
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await resp.text();
    const contentType = resp.headers.get("content-type") ?? "";
    let json = null;
    if (contentType.includes("text/event-stream") || text.trimStart().startsWith("event:")) {
      json = parseMcpSse(text);
    } else {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { ok: resp.ok, status: resp.status, json, text, headers: resp.headers };
  } finally {
    clearTimeout(timer);
  }
};

const getMcpServer = async (serverName) => {
  const cfg = await loadMcpConfig();
  const servers = cfg?.servers ?? {};
  const entry = servers?.[serverName] ?? null;
  if (!entry) return null;
  if (entry.type !== "http") return null;
  const url = String(entry.url ?? "").trim();
  if (!url) return null;

  const figmaTokenFromFile = async () => {
    try {
      const tokenPath = path.join(WORKSPACE, ".secrets", "figma.token");
      const token = await fsp.readFile(tokenPath, "utf-8");
      return String(token ?? "").trim();
    } catch {
      return "";
    }
  };

  const resolveHeaderValue = async (rawValue) => {
    const raw = String(rawValue ?? "");
    if (!raw) return "";
    // Minimal template support: ${ENV_VAR}. (Used for Authorization, etc.)
    const out = raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, key) => String(process.env[key] ?? ""));
    // Special-case: allow FIGMA_OAUTH_TOKEN to come from workspace secret file as well.
    if (out.includes("Bearer ") && raw.includes("${FIGMA_OAUTH_TOKEN}") && !(process.env.FIGMA_OAUTH_TOKEN ?? "").trim()) {
      const token = await figmaTokenFromFile();
      if (token) return raw.replace("${FIGMA_OAUTH_TOKEN}", token);
    }
    return out;
  };

  const entryHeaders = entry.headers && typeof entry.headers === "object" ? entry.headers : null;
  const headers = {};
  if (entryHeaders) {
    for (const [k, v] of Object.entries(entryHeaders)) {
      const key = String(k ?? "").trim();
      if (!key) continue;
      const resolved = await resolveHeaderValue(v);
      if (resolved) headers[key] = resolved;
    }
  }

  const timeoutMsRaw = Number(entry.timeoutMs ?? entry.timeout_ms ?? 2_500);
  const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(250, Math.min(60_000, timeoutMsRaw)) : 2_500;

  return { name: serverName, type: "http", url, headers, timeoutMs };
};

const mcpJsonRpc = async ({ serverName, method, params }) => {
  const server = await getMcpServer(serverName);
  if (!server) {
    return { ok: false, error: "mcp_server_not_configured" };
  }
  const id = createId();
  const body = { jsonrpc: "2.0", id, method, params: params ?? {} };
  const sessionEntry = mcpCache.sessions.get(serverName) ?? null;
  const sessionId = sessionEntry?.sessionId ?? null;
  const headers = {
    ...(server.headers ?? {}),
    accept: "application/json, text/event-stream",
    ...(sessionId && method !== "initialize" ? { "mcp-session-id": sessionId } : {})
  };
  try {
    const resp = await fetchJsonWithTimeout(server.url, body, server.timeoutMs ?? 2_500, headers);
    if (!resp.ok || !resp.json) {
      return {
        ok: false,
        error: "mcp_request_failed",
        status: resp.status ?? null,
        detail: resp.text?.slice(0, 4000) ?? ""
      };
    }
    if (method === "initialize") {
      const newSession = resp.headers?.get?.("mcp-session-id") ?? null;
      if (newSession) {
        mcpCache.sessions.set(serverName, { sessionId: newSession, initializedAt: Date.now() });
      }
    }
    if (resp.json.error) {
      return { ok: false, error: "mcp_error", detail: resp.json.error };
    }
    return { ok: true, result: resp.json.result ?? resp.json ?? null };
  } catch (err) {
    const name = String(err?.name ?? "");
    const message = String(err?.message ?? "");
    const joined = `${name}${message ? `: ${message}` : ""}`.trim() || String(err ?? "");
    const isAbort = name === "AbortError" || joined.includes("AbortError");
    return { ok: false, error: isAbort ? "mcp_timeout" : "mcp_unreachable", detail: joined };
  }
};

const getMcpTools = async (serverName) => {
  const cached = mcpCache.tools.get(serverName);
  const now = Date.now();
  if (cached && now - cached.loadedAt < MCP_TOOLS_TTL_MS) return cached.tools;

  // Best-effort initialize (some MCP servers require it). Ignore failures.
  await mcpJsonRpc({
    serverName,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "309Agent", version: "0.1.0" }
    }
  }).catch(() => {});

  const resp = await mcpJsonRpc({ serverName, method: "tools/list", params: {} });
  if (!resp.ok) {
    return { ok: false, error: resp.error, detail: resp.detail };
  }
  const tools = resp.result?.tools ?? resp.result ?? [];
  const normalized = Array.isArray(tools) ? tools : [];
  mcpCache.tools.set(serverName, { loadedAt: now, tools: normalized });
  return { ok: true, tools: normalized };
};

const extractMcpText = (result) => {
  if (!result) return "";
  const content = result.content ?? result.contents ?? null;
  if (Array.isArray(content)) {
    const parts = content
      .map((c) => (c?.type === "text" ? c.text : c?.text))
      .filter(Boolean);
    return parts.join("\n\n").trim();
  }
  if (typeof result === "string") return result.trim();
  return JSON.stringify(result, null, 2).slice(0, 8000);
};

const extractFigmaRef = (text) => {
  const s = String(text ?? "");
  const urlMatch = s.match(/https?:\/\/(?:www\.)?figma\.com\/(file|design|proto)\/([a-zA-Z0-9]+)([^\s]*)/i);
  if (!urlMatch) return null;
  const kind = urlMatch[1].toLowerCase();
  const fileKey = urlMatch[2];
  const urlTail = urlMatch[3] ?? "";
  const nodeId =
    (urlTail.match(/[?&]node-id=([^&]+)/i)?.[1] ??
      urlTail.match(/[?&]node_id=([^&]+)/i)?.[1] ??
      null);
  const url = urlMatch[0];
  return { kind, fileKey, nodeId, url };
};

const normalizeFigmaNodeId = (nodeId) => {
  if (!nodeId) return "";
  const decoded = decodeURIComponent(String(nodeId));
  // Figma URLs often use `node-id=1-2` while APIs accept `1:2`.
  return decoded.replace(/-/g, ":").trim();
};

const buildFigmaMcpContext = async (text) => {
  const ref = extractFigmaRef(text);
  if (!ref) return { ok: false, error: "no_figma_url" };

  const toolsResp = await getMcpTools("figma-desktop");
  if (!toolsResp.ok) {
    return { ok: false, error: toolsResp.error, detail: toolsResp.detail, ref };
  }
  const tools = toolsResp.tools ?? [];
  const toolNames = new Set(tools.map((t) => t?.name).filter(Boolean));

  const used = [];
  const snippets = [];

  const callTool = async (name, args) => {
    const resp = await mcpJsonRpc({
      serverName: "figma-desktop",
      method: "tools/call",
      params: { name, arguments: args ?? {} }
    });
    if (!resp.ok) return { ok: false, error: resp.error, detail: resp.detail };
    return { ok: true, text: extractMcpText(resp.result) };
  };

  const nodeId = normalizeFigmaNodeId(ref.nodeId);

  // Prefer Figma Desktop MCP canonical tools.
  if (toolNames.has("get_design_context")) {
    const args = {
      nodeId,
      clientLanguages: "unknown",
      clientFrameworks: "unknown",
      artifactType: "DESIGN_SYSTEM"
    };
    let out = await callTool("get_design_context", args);
    // Common case: the node isn't open/selected in Figma Desktop. Retry with empty nodeId (selected node).
    if (!out.ok && nodeId) {
      out = await callTool("get_design_context", { ...args, nodeId: "" });
      used.push({ tool: "get_design_context(nodeId=selected)", ok: out.ok });
    } else {
      used.push({ tool: "get_design_context", ok: out.ok });
    }
    if (out.ok && out.text) {
      snippets.push(`## get_design_context\n${out.text}`);
    } else if (!out.ok) {
      const detail = String(out.detail ?? out.error ?? "").trim();
      if (detail) snippets.push(`## get_design_context (failed)\n${detail.slice(0, 800)}`);
    }
  }
  if (toolNames.has("get_variable_defs")) {
    const out = await callTool("get_variable_defs", {
      nodeId,
      clientLanguages: "unknown",
      clientFrameworks: "unknown"
    });
    used.push({ tool: "get_variable_defs", ok: out.ok });
    if (out.ok && out.text) snippets.push(`## get_variable_defs\n${out.text}`);
    if (!out.ok) {
      const detail = String(out.detail ?? out.error ?? "").trim();
      if (detail) snippets.push(`## get_variable_defs (failed)\n${detail.slice(0, 800)}`);
    }
  }
  if (!snippets.length && toolNames.has("get_metadata")) {
    const out = await callTool("get_metadata", {
      nodeId,
      clientLanguages: "unknown",
      clientFrameworks: "unknown"
    });
    used.push({ tool: "get_metadata", ok: out.ok });
    if (out.ok && out.text) snippets.push(`## get_metadata\n${out.text}`);
  }

  if (!snippets.length) {
    return {
      ok: false,
      error: "no_usable_figma_tools",
      ref,
      availableTools: [...toolNames].slice(0, 40)
    };
  }

  const mergedTextForCheck = snippets.join("\n\n");
  // Some Figma MCP backends return success responses that are actually "user action required"
  // messages (e.g., Desktop selection not available). Treat those as a failure so the agent
  // doesn't continue and stall/hallucinate.
  if (
    /No node could be found for the provided nodeId/i.test(mergedTextForCheck) ||
    /Make sure the Figma desktop app is open/i.test(mergedTextForCheck) ||
    /document containing the node is the active tab/i.test(mergedTextForCheck)
  ) {
    return {
      ok: false,
      error: "figma_node_not_found",
      ref,
      detail:
        "Figma MCP는 연결됐지만 해당 nodeId를 찾지 못했습니다. Figma Desktop 앱에서 해당 문서를 열고 활성 탭으로 만든 뒤, 해당 프레임/컴포넌트를 선택하고 다시 시도하세요."
    };
  }

  const header = `FIGMA_MCP_CONTEXT:\n- url: ${ref.url}\n- fileKey: ${ref.fileKey}${ref.nodeId ? `\n- nodeId: ${ref.nodeId}` : ""}\n- toolsUsed: ${used.map((u) => `${u.tool}:${u.ok ? "ok" : "fail"}`).join(", ")}`;
  const body = snippets.join("\n\n---\n\n");
  const merged = `${header}\n\n${body}`.trim();
  return { ok: true, ref, text: trimCharsFromEnd(merged, 8000) };
};

const trashSessionFile = async (sessionId) => {
  await ensureDirs();
  const src = path.join(SESSIONS_DIR, `${sessionId}.json`);
  const exists = await fsp.stat(src).catch(() => null);
  if (!exists) return false;
  const trashDir = path.join(DATA_DIR, "trash", "sessions");
  await fsp.mkdir(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const dst = path.join(trashDir, `${sessionId}.${stamp}.json`);
  await fsp.rename(src, dst);
  return true;
};

const readJson = async (filePath) => {
  const raw = await fsp.readFile(filePath, "utf-8");
  return JSON.parse(raw);
};

const writeJson = async (filePath, data) => {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2));
};

const readText = async (filePath) => {
  try {
    return await fsp.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
};

const writeText = async (filePath, text) => {
  await fsp.writeFile(filePath, String(text ?? ""), "utf-8");
};

const trimCharsFromEnd = (value, maxChars) => {
  const s = String(value ?? "");
  if (s.length <= maxChars) return s;
  return s.slice(Math.max(0, s.length - maxChars));
};

const redactConfigForDisk = (cfg) => {
  if (!cfg || typeof cfg !== "object") return cfg;
  const cloned = JSON.parse(JSON.stringify(cfg));
  // Best-effort redaction: prevent secrets from being written into run artifacts.
  if (cloned.models?.providers?.ollama) {
    if (typeof cloned.models.providers.ollama.apiKey === "string") {
      cloned.models.providers.ollama.apiKey = "REDACTED";
    }
  }
  if (cloned.gateway?.auth?.token) cloned.gateway.auth.token = "REDACTED";
  if (cloned.gateway?.remote?.token) cloned.gateway.remote.token = "REDACTED";
  if (cloned.channels?.slack) {
    if (typeof cloned.channels.slack.botToken === "string") cloned.channels.slack.botToken = "REDACTED";
    if (typeof cloned.channels.slack.appToken === "string") cloned.channels.slack.appToken = "REDACTED";
  }
  return cloned;
};

const readTailText = async (filePath, maxChars = 20_000) => {
  if (!filePath) return "";
  const t = await readText(filePath);
  return trimCharsFromEnd(t, maxChars);
};

const toOneLine = (value, maxLen = 180) => {
  const s = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
};

const normalizeSession = (session) => {
  const createdAt = session?.createdAt ?? new Date().toISOString();
  const permission = normalizePermission(session?.permission ?? DEFAULT_PERMISSION);
  const agentMode = String(session?.agentMode ?? "").toLowerCase() || null;
  const project = normalizeProjectRef(session?.project);
  let statusValue = session?.status ?? "idle";
  const approvals = {
    mail: false,
    deploy: false,
    merge: false,
    gitPush: false,
    prCreate: false,
    ...(session?.approvals ?? {})
  };
  const goal = {
    statement: "",
    success_criteria: [],
    artifacts: [],
    ...(session?.pipeline?.goal ?? session?.goal ?? {})
  };
  const loop = {
    step: "plan", // plan|act|verify|evaluate|replan|done
    attempt: 0,
    maxAttempts: 3,
    lastFailure: null,
    ...(session?.pipeline?.loop ?? {})
  };
  // ask sessions don't participate in the autonomy loop; keep it "done" to avoid false locking/UX noise.
  if (agentMode === "ask") loop.step = "done";
  const nextAction = {
    type: "auto", // auto|needs_user|approval_required
    description: "",
    recommended: true,
    ...(session?.pipeline?.nextAction ?? {})
  };
  const pipelineRaw = session?.pipeline ?? {};
  const pipeline = {
    planOnly: false,
    auto: true,
    phase: "idle", // idle|planning|acting|verifying|evaluating|replanning|done|needs_approval
    pendingContinue: false,
    activeRunId: null,
    // Preserve any previously stored RAG/MCP context but keep a stable shape.
    rag: {
      urls: [],
      references: [],
      fetchedAt: null,
      webContext: "",
      method: null,
      ...(pipelineRaw?.rag ?? {})
    },
    mcpContext: pipelineRaw?.mcpContext ?? undefined,
    ...(pipelineRaw ?? {}),
    // Always override normalized control fields after spreading raw pipeline.
    goal,
    loop,
    nextAction,
    planSteps: Array.isArray(pipelineRaw?.planSteps) ? pipelineRaw.planSteps : []
  };
  const memory = {
    sessionSummary: "",
    updatedAt: null,
    ...(session?.memory ?? {})
  };
  if (/[\u4E00-\u9FFF]/.test(String(memory.sessionSummary ?? ""))) {
    // Prevent CJK text from being re-injected via SESSION_MEMORY.
    memory.sessionSummary = String(memory.sessionSummary ?? "").replace(/[\u4E00-\u9FFF]+/g, "").trim();
  }
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const historyRaw = Array.isArray(session?.history) ? session.history : [];
  const history = historyRaw.map((e) => {
    const normalized = ensureHistoryEntry(e);
    // Evidence hygiene: ask/plan/evaluate/replan must not claim file/command changes.
    if (["ask", "plan", "evaluate", "replan"].includes(normalized.type)) {
      return {
        ...normalized,
        execution_summary: {
          ...normalized.execution_summary,
          worldChange: {
            filesCreated: [],
            filesModified: [],
            filesDeleted: [],
            commandsExecuted: [],
            testsExecuted: [],
            browserActions: []
          }
        }
      };
    }
    return normalized;
  });
  const requiredApprovals = {
    mail: false,
    deploy: false,
    merge: false,
    gitPush: false,
    prCreate: false,
    ...(session?.requiredApprovals ?? {})
  };
  const runs = Array.isArray(session?.runs) ? session.runs : [];

  // Repair: old ask sessions were marked as "running/acting" because isLockedCodeThread() was too broad.
  // If the most recent ask run already finished, show it as done/success for UX stability.
  if (agentMode === "ask") {
    const activeRunId = pipeline?.activeRunId ?? null;
    if (!activeRunId && String(session?.status ?? "") === "running") {
      const lastAsk = runs
        .slice()
        .reverse()
        .find((r) => String(r?.kind ?? "").toLowerCase() === "ask");
      if (lastAsk && String(lastAsk.status ?? "") !== "running") {
        pipeline.phase = "done";
        pipeline.pendingContinue = false;
        loop.step = "done";
        statusValue = String(lastAsk.status ?? "") === "success" ? "success" : "failed";
      } else {
        // Older sessions (created before run meta was appended) may have no runs[].
        // If we already have an ask history entry and an assistant message, treat it as completed.
        const historyTypes = Array.isArray(session?.history) ? session.history.map((h) => String(h?.type ?? "")) : [];
        const hasAskHistory = historyTypes.some((t) => t.toLowerCase() === "ask");
        const hasAssistantMsg =
          Array.isArray(session?.messages) &&
          session.messages.some((m) => String(m?.kind ?? "").toLowerCase() === "assistant");
        if (hasAskHistory && hasAssistantMsg) {
          const last = Array.isArray(session?.history) ? session.history[session.history.length - 1] : null;
          const ok = String(last?.status ?? "").toLowerCase() === "success";
          pipeline.phase = "done";
          pipeline.pendingContinue = false;
          loop.step = "done";
          statusValue = ok ? "success" : "failed";
        }
      }
    }
  }

  // Recovery: if the server restarted or crashed, session JSON can keep stale "running" state.
  // In that case no in-memory active run exists, so repair to a terminal state.
  const activeRunId = pipeline?.activeRunId ?? null;
  if (String(statusValue ?? "") === "running" && activeRunId && state.active?.id !== activeRunId) {
    const activeRun = runs.find((r) => String(r?.id ?? "") === String(activeRunId));
    const activeRunStatus = String(activeRun?.status ?? "").toLowerCase();
    const runningCreatedAt = activeRun?.createdAt ? Date.parse(String(activeRun.createdAt)) : NaN;
    const runningAgeMs = Number.isFinite(runningCreatedAt) ? Date.now() - runningCreatedAt : Number.POSITIVE_INFINITY;
    // Avoid false recovery during handoff windows (e.g. plan -> act) where memory state can briefly be empty.
    // Only recover stale "running" runs after a long grace period.
    const RUNNING_RECOVERY_GRACE_MS = 10 * 60 * 1000;
    if (activeRunStatus === "running" && runningAgeMs < RUNNING_RECOVERY_GRACE_MS) {
      return {
        ...session,
        createdAt,
        status: statusValue,
        approvals,
        pipeline,
        history,
        runs
      };
    }
    if (activeRunStatus === "success") statusValue = "success";
    else if (activeRunStatus === "cancelled") statusValue = "cancelled";
    else statusValue = "failed";
    pipeline.phase = "done";
    pipeline.pendingContinue = false;
    pipeline.activeRunId = null;
    loop.step = "done";
    if (!pipeline.nextAction || String(pipeline.nextAction.type ?? "") === "auto") {
      pipeline.nextAction = {
        type: "needs_user",
        description: "이전 실행이 중단되어 상태를 복구했습니다. 다시 실행해 주세요.",
        recommended: true
      };
    }
  }

  return {
    ...session,
    createdAt,
    status: statusValue,
    approvals,
    pipeline,
    memory,
    messages,
    history,
    requiredApprovals,
    lastAnswer: /[\u4E00-\u9FFF]/.test(String(session?.lastAnswer ?? ""))
      ? String(session?.lastAnswer ?? "").replace(/[\u4E00-\u9FFF]+/g, "").trim()
      : (session?.lastAnswer ?? ""),
    permission,
    agentMode: agentMode ?? null,
    project
  };
};

const loadConfig = async () => {
  const raw = await fsp.readFile(OPENCLAW_CONFIG, "utf-8");
  return JSON.parse(raw);
};

const listModels = async () => {
  const cfg = await loadConfig();
  const models =
    cfg?.models?.providers?.ollama?.models?.map((model) => ({
      id: model.id,
      name: model.name ?? model.id
    })) ?? [];
  return models;
};

const getPresetMap = async () => {
  const models = await listModels();
  const modelIds = new Set(models.map((model) => model.id));
  const presetMap = { ...PRESET_MODELS };
  for (const [preset, modelId] of Object.entries(presetMap)) {
    if (!modelIds.has(modelId)) {
      presetMap[preset] = models[0]?.id ?? modelId;
    }
  }
  return presetMap;
};

const containsCjk = (text) => /[\u4E00-\u9FFF]/.test(String(text ?? ""));

const isMostlyKorean = (text) => {
  const s = String(text ?? "");
  if (!s.trim()) return true;
  // If CJK ideographs exist, treat as not mostly Korean to force rewrite.
  if (containsCjk(s)) return false;
  const hangul = (s.match(/[가-힣]/g) ?? []).length;
  const latin = (s.match(/[A-Za-z]/g) ?? []).length;
  const letters = hangul + latin;
  if (!letters) return true;
  return hangul / letters >= 0.75;
};

const rewriteToKorean = async (text, timeoutMs = 2500) => {
  if (!text) return "";
  if (isMostlyKorean(text)) return text;
  try {
    const models = await listModels();
    const model = pickModelId("ask", models);
    if (!model) return text;
    const prompt = `다음 내용을 한국어로만 간결하게 다시 작성해줘. 의미는 보존하고, 불필요한 장식은 빼.\n\n---\n${text}\n---`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));
    if (!resp.ok) return text;
    const data = await resp.json();
    const out = String(data?.response ?? "").trim();
    // If the model still returns non-Korean heavy output, fall back to stripping CJK.
    const normalized = out || text;
    if (containsCjk(normalized)) {
      const stripped = normalized.replace(/[\u4E00-\u9FFF]+/g, "").trim();
      return stripped || text;
    }
    return normalized;
  } catch {
    return text;
  }
};

const maskToken = (token) => {
  if (!token) return null;
  if (token.length <= 6) return "••••";
  return `${token.slice(0, 2)}••••${token.slice(-4)}`;
};

const getGatewayLogPath = () => {
  const stamp = new Date().toISOString().slice(0, 10);
  return path.join(OPENCLAW_LOG_DIR, `openclaw-${stamp}.log`);
};

const resolveClientPath = (inputPath) => {
  if (!inputPath) return WORKSPACE;
  let raw = inputPath.trim();
  if (!raw) return WORKSPACE;
  if (raw.startsWith("/workspace")) {
    raw = path.join(WORKSPACE, raw.replace(/^\/workspace\/?/, ""));
  } else if (!path.isAbsolute(raw)) {
    raw = path.join(WORKSPACE, raw);
  }
  const resolved = path.resolve(raw);
  if (!resolved.startsWith(WORKSPACE)) {
    throw new Error("path_outside_workspace");
  }
  return resolved;
};

const toClientPath = (absolutePath) => {
  if (!absolutePath) return "/workspace";
  if (absolutePath.startsWith(WORKSPACE)) {
    const rel = path.relative(WORKSPACE, absolutePath);
    return rel ? `/workspace/${rel}` : "/workspace";
  }
  return absolutePath;
};

const rewriteWorkspacePaths = (text) => {
  if (!text) return { text, rewritten: false };
  let rewritten = false;
  const replaced = text.replace(
    /(^|\s)(\/workspace(?:\/[^\s"'`]+)?)/g,
    (match, lead, token) => {
      rewritten = true;
      const rel = token.replace(/^\/workspace\/?/, "");
      const abs = path.join(WORKSPACE, rel);
      return `${lead}${abs}`;
    }
  );
  return { text: replaced, rewritten };
};

const createId = () => {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const rnd = crypto.randomBytes(2).toString("hex");
  return `${stamp}-${rnd}`;
};

const readLogChunk = async (filePath, offset) => {
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat) {
    return { data: "", nextOffset: offset, eof: true };
  }
  const size = stat.size;
  if (offset >= size) {
    return { data: "", nextOffset: size, eof: true };
  }
  const toRead = Math.min(MAX_LOG_BYTES, size - offset);
  const handle = await fsp.open(filePath, "r");
  const buffer = Buffer.alloc(toRead);
  await handle.read(buffer, 0, toRead, offset);
  await handle.close();
  return {
    data: buffer.toString("utf-8"),
    nextOffset: offset + toRead,
    eof: offset + toRead >= size
  };
};

const readTail = async (filePath, maxBytes = 2_000_000) => {
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat) return "";
  const size = stat.size;
  const start = Math.max(0, size - maxBytes);
  const handle = await fsp.open(filePath, "r");
  const buffer = Buffer.alloc(size - start);
  await handle.read(buffer, 0, size - start, start);
  await handle.close();
  return buffer.toString("utf-8");
};

const parseToolEvents = (raw, runIdFilter = null) => {
  if (!raw) return [];
  const lines = raw.split("\n").filter(Boolean);
  const events = [];
  for (const line of lines) {
    if (!line.includes("tool start") && !line.includes("tool end")) {
      continue;
    }
    const ts = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)/)?.[1] ?? null;
    const kind = line.includes("tool start") ? "start" : "end";
    const tool = line.match(/tool=([a-zA-Z0-9_-]+)/)?.[1] ?? null;
    const toolCallId = line.match(/toolCallId=([^\s]+)/)?.[1] ?? null;
    const runId = line.match(/runId=([^\s]+)/)?.[1] ?? null;
    if (runIdFilter && runId && runId !== runIdFilter) continue;
    events.push({
      at: ts,
      kind,
      tool,
      toolCallId,
      runId,
      raw: line
    });
  }
  return events;
};

const findRunIdForSession = (raw, sessionId) => {
  if (!raw) return null;
  const lines = raw.split("\n").filter(Boolean);
  for (const line of lines) {
    if (!line.includes("embedded run start")) continue;
    if (!line.includes(`sessionId=${sessionId}`)) continue;
    const runId = line.match(/runId=([^\s]+)/)?.[1] ?? null;
    if (runId) return runId;
  }
  return null;
};

const listRuns = async () => {
  await ensureDirs();
  const entries = await fsp.readdir(RUNS_DIR);
  const metas = [];
  for (const entry of entries) {
    // Only include run meta JSON. (Exclude run temp config snapshots: *.config.json)
    if (!/^\d{14}-[a-z0-9]{4}\.json$/i.test(entry)) continue;
    try {
      const metaPath = path.join(RUNS_DIR, entry);
      const meta = await readJson(metaPath);
      metas.push(meta);
    } catch {
      // ignore invalid files
    }
  }
  metas.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return metas;
};

const listSessions = async () => {
  await ensureDirs();
  const entries = await fsp.readdir(SESSIONS_DIR);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const session = normalizeSession(await readJson(path.join(SESSIONS_DIR, entry)));
      const lastMsg = Array.isArray(session.messages) ? session.messages[session.messages.length - 1] : null;
      const snippetSource = lastMsg?.text || session.request || "";
      const phase = String(session.pipeline?.phase ?? "idle");
      const isRunning =
        session.status === "running" ||
        Boolean(session.pipeline?.activeRunId) ||
        ["planning", "acting", "verifying", "evaluating", "replanning"].includes(phase);
      sessions.push({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        lastActivityAt:
          session.history?.[session.history.length - 1]?.at ??
          session.messages?.[session.messages.length - 1]?.at ??
          session.createdAt,
        status: isRunning ? "running" : session.status,
        agentMode: session.agentMode ?? "ask",
        permission: session.permission ?? DEFAULT_PERMISSION,
        project: session.project ?? { ...DEFAULT_SESSION_PROJECT },
        snippet: toOneLine(String(snippetSource), 120)
      });
    } catch {
      // ignore
    }
  }
  sessions.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return sessions;
};

const loadSession = async (sessionId) => {
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  const raw = await readJson(sessionPath);
  const normalized = normalizeSession(raw);
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    await writeJson(sessionPath, normalized).catch(() => {});
  }
  return normalized;
};

const saveSession = async (session) => {
  const sessionPath = path.join(SESSIONS_DIR, `${session.id}.json`);
  const normalized = normalizeSession(session);
  await writeJson(sessionPath, normalized);
  return normalized;
};

const updateSession = async (sessionId, updater) => {
  const session = await loadSession(sessionId);
  const updated = updater(session);
  await saveSession(updated);
  return updated;
};

const createSession = async ({
  title,
  request,
  modelPreset,
  modelId,
  approvals,
  agentMode,
  permission,
  project
}) => {
  const id = createId();
  const createdAt = new Date().toISOString();
  const effectiveMode = agentMode ?? null;
  const normalizedPermission = normalizePermission(permission ?? DEFAULT_PERMISSION);
  const session = {
    id,
    title: title || request?.slice(0, 60) || "New chat",
    createdAt,
    status: request ? (effectiveMode === "ask" ? "running" : "planning") : "idle",
    request: request ?? "",
    plan: "",
    planEdited: false,
    modelPreset,
    modelId,
    agentMode: agentMode ?? null,
    permission: normalizedPermission,
    project: normalizeProjectRef(project),
    approvals: {
      mail: false,
      deploy: false,
      merge: false,
      gitPush: false,
      prCreate: false,
      ...approvals
    },
    requiredApprovals: { ...defaultApprovals },
    messages: request
      ? [
          {
            id: createId(),
            role: "user",
            kind: "user",
            text: request,
            at: new Date().toISOString()
          }
        ]
      : [],
    memory: {
      sessionSummary: "",
      updatedAt: null
    },
    pipeline: {
      planOnly: false,
      auto: true,
      phase: request ? "planning" : "idle",
      pendingContinue: false,
      activeRunId: null,
      rag: { urls: [], references: [], fetchedAt: null, webContext: "", method: null },
      goal: { statement: "", success_criteria: [], artifacts: [] },
      loop: { step: "plan", attempt: 0, maxAttempts: 3, lastFailure: null },
      nextAction: { type: "auto", description: "", recommended: true },
      planSteps: []
    },
    history: [],
    lastAnswer: "",
    runs: []
  };
  await saveSession(session);
  return session;
};

const extractPayloadText = (raw) => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    const payloads = parsed?.result?.payloads ?? parsed?.payloads ?? [];
    const texts = payloads
      .map((item) => item?.text ?? item?.content?.text)
      .filter(Boolean);
    if (texts.length) return texts.join("\n\n");
  } catch {
    // fallback to line-by-line
  }
  const lines = trimmed.split("\n");
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const payloads = parsed?.result?.payloads ?? parsed?.payloads ?? [];
      const texts = payloads
        .map((item) => item?.text ?? item?.content?.text)
        .filter(Boolean);
      if (texts.length) return texts.join("\n\n");
    } catch {
      // ignore
    }
  }
  return trimmed;
};

const extractHumanAnswer = (raw) => {
  let text = extractPayloadText(raw);
  if (!text) return "";
  text = String(text)
    .replace(/<tool_call[^>]*>[\s\S]*?<\/tool_call>/g, "")
    .replace(/<tool_call[^>]*>/g, "")
    .replace(/<\/tool_call>/g, "")
    .replace(/^\s*[_-]{1,}\s*$/gm, "")
    .trim();

  const upper = text.toUpperCase();
  const idx = upper.indexOf("RESULT:");
  if (idx >= 0) {
    const rest = text.slice(idx + "RESULT:".length);
    const endCandidates = ["NEXT:", "RISKS:", "NEEDS_APPROVAL:", "PLAN:", "ACTIONS:", "VERIFY:"];
    let end = rest.length;
    for (const marker of endCandidates) {
      const mi = rest.toUpperCase().indexOf(marker);
      if (mi >= 0) end = Math.min(end, mi);
    }
    const picked = rest.slice(0, end).trim();
    if (picked) return picked;
  }
  return text.trim();
};

const summarizeSystemPrompt = (report) => {
  if (!report) return null;
  const systemPrompt = report.systemPrompt ?? {};
  const injected = (report.injectedWorkspaceFiles ?? []).map((file) => ({
    name: file.name,
    path: file.path,
    chars: file.injectedChars ?? file.rawChars ?? 0
  }));
  return {
    chars: systemPrompt.chars ?? null,
    projectContextChars: systemPrompt.projectContextChars ?? null,
    nonProjectContextChars: systemPrompt.nonProjectContextChars ?? null,
    injectedFiles: injected
  };
};

const extractRunSummary = (raw) => {
  const summary = {
    provider: null,
    model: null,
    sessionId: null,
    usage: null,
    systemPrompt: null
  };

  const applyParsed = (parsed) => {
    const meta = parsed?.result?.meta ?? parsed?.meta ?? null;
    const usage = meta?.agentMeta?.usage ?? parsed?.agentMeta?.usage ?? null;
    if (usage) summary.usage = usage;
    const agentMeta = meta?.agentMeta ?? parsed?.agentMeta ?? null;
    if (agentMeta) {
      if (!summary.provider && agentMeta.provider) summary.provider = agentMeta.provider;
      if (!summary.model && agentMeta.model) summary.model = agentMeta.model;
      if (!summary.sessionId && agentMeta.sessionId) summary.sessionId = agentMeta.sessionId;
    }
    const report = meta?.systemPromptReport ?? parsed?.systemPromptReport ?? null;
    if (report) summary.systemPrompt = summarizeSystemPrompt(report);
  };

  const trimmed = raw.trim();
  if (!trimmed) return summary;
  try {
    const parsed = JSON.parse(trimmed);
    applyParsed(parsed);
    return summary;
  } catch {
    // ignore
  }

  const lines = trimmed.split("\n");
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      applyParsed(parsed);
    } catch {
      // ignore
    }
  }
  return summary;
};

const buildPlanPrompt = ({ request, contextPrefix }) => {
  return `${contextPrefix || ""}너는 로컬 309Agent(=OpenClaw)다. 이 단계에서는 도구(tool)를 절대 사용하지 말고, \"목표(goal)+성공 기준+계획\"만 만든다.\n\n추가 규칙:\n- 입력에 Figma 링크가 있으면, 시스템이 FIGMA_MCP_CONTEXT 블록을 주입할 수 있다. 해당 컨텍스트를 근거로 계획을 세워라.\n- 단, Figma 앱 UI를 직접 조작하거나 원격으로 클릭/편집하는 것은 할 수 없다.\n\n필수 출력 포맷(반드시 이 구조를 지켜라. 파싱 실패하면 작업이 중단된다):\n\nGOAL:\n- statement: (사용자 요청을 1문장 목표로)\n- success_criteria: [\"2~5개\", \"완료 판단 기준\"]\n\nPLAN_STEPS (JSON):\n[\n  {\"id\":\"S1\",\"description\":\"...\",\"tool\":\"read|write|edit|exec|process\",\"expected_output\":\"...\",\"risk_level\":\"low|med|high\",\"requires_approval\":false},\n  {\"id\":\"S2\",\"description\":\"...\",\"tool\":\"...\",\"expected_output\":\"...\",\"risk_level\":\"...\",\"requires_approval\":true}\n]\n\nRISKS:\n- (리스크)\n\nNEEDS_APPROVAL: mail|calendar|deploy|merge|git push|PR (해당되는 것만)\n\n요청:\n${request}`;
};

const buildEvaluatePrompt = ({ request, goal, plan, actSummary, changedFiles, verifySummary, contextPrefix }) => {
  const goalStatement = String(goal?.statement ?? "").trim();
  const criteria = Array.isArray(goal?.success_criteria) ? goal.success_criteria : [];
  const artifacts = Array.isArray(goal?.artifacts) ? goal.artifacts : [];
  const criteriaBlock = criteria.length ? criteria.map((c) => `- ${c}`).join("\n") : "(없음)";
  const changedBlock = Array.isArray(changedFiles) && changedFiles.length ? changedFiles.map((f) => `- ${f}`).join("\n") : "(없음)";
  const artifactsBlock = artifacts.length ? artifacts.map((a) => `- ${a}`).join("\n") : "(없음)";
  return `${contextPrefix || ""}너는 로컬 309Agent의 \"Evaluate\" 단계다. 목표 달성 여부를 판단하고 다음 행동을 결정한다. 도구(tool)는 사용하지 않는다.\n\n필수 출력 포맷(반드시 이 JSON 한 줄만 출력):\nEVALUATION_JSON:\n{\"achieved\":\"yes|no\",\"confidence\":0.0,\"missing\":[],\"next\":\"replan|done|needs_user|approval_required\",\"reason\":\"\",\"suggested_actions\":[]}\n\n입력:\n- request:\n${request}\n\n- goal.statement:\n${goalStatement || "(없음)"}\n\n- goal.success_criteria:\n${criteriaBlock}\n\n- goal.artifacts:\n${artifactsBlock}\n\n- plan(요약):\n${trimCharsFromEnd(plan || "", 2000)}\n\n- actSummary(요약):\n${trimCharsFromEnd(actSummary || "", 2000)}\n\n- changedFiles:\n${changedBlock}\n\n- verifySummary(요약):\n${trimCharsFromEnd(verifySummary || "", 2000)}\n\n판단 규칙:\n- achieved=yes는 \"말\"이 아니라 기준 충족 근거가 있을 때만.\n- Verify(테스트/스모크)가 실패했다고 판단되면 achieved=no로 둬라.\n- 부족하면 missing에 무엇이 부족한지 구체적으로.\n- next는 반드시 하나.\n`;
};

const buildReplanPrompt = ({ request, goal, plan, evaluation, lastFailure, contextPrefix }) => {
  const goalStatement = String(goal?.statement ?? "").trim();
  const criteria = Array.isArray(goal?.success_criteria) ? goal.success_criteria : [];
  const criteriaBlock = criteria.length ? criteria.map((c) => `- ${c}`).join("\n") : "(없음)";
  const missing = Array.isArray(evaluation?.missing) ? evaluation.missing : [];
  const missingBlock = missing.length ? missing.map((m) => `- ${m}`).join("\n") : "(없음)";
  const failureBlock = lastFailure ? `${lastFailure.kind}: ${lastFailure.reason}` : "(없음)";
  return `${contextPrefix || ""}너는 로컬 309Agent의 \"Replan\" 단계다. Evaluate 결과를 반영해 다음 시도의 계획을 업데이트한다. 도구(tool)는 사용하지 않는다.\n\n필수 출력 포맷(반드시 이 JSON 한 줄만 출력):\nREPLAN_JSON:\n{\"updated_plan_steps\":[],\"strategy\":\"\",\"why_this\":\"\"}\n\n입력:\n- request:\n${request}\n\n- goal.statement:\n${goalStatement || "(없음)"}\n\n- goal.success_criteria:\n${criteriaBlock}\n\n- previous plan(요약):\n${trimCharsFromEnd(plan || "", 2000)}\n\n- evaluation.missing:\n${missingBlock}\n\n- evaluation.reason:\n${String(evaluation?.reason ?? "").slice(0, 800)}\n\n- lastFailure:\n${failureBlock}\n\n요구:\n- missing을 해결하도록 updated_plan_steps를 재작성.\n- 대안 2개를 고려하고, 추천 전략을 strategy/why_this로 명확히.\n`;
};

const formatApprovals = (approvals) => {
  const approved = Object.entries(approvals || {})
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
    .join(", ");
  return approved || "없음";
};

const appendMessage = async (sessionId, message) => {
  return updateSession(sessionId, (session) => {
    const normalized = normalizeSession(session);
    const messages = [...(normalized.messages || [])];
    messages.push({
      id: createId(),
      at: new Date().toISOString(),
      kind: message?.kind ?? message?.role ?? "system",
      role: message?.role ?? "system",
      text: String(message?.text ?? ""),
      runId: message?.runId ?? null
    });
    return { ...normalized, messages };
  });
};

const isDockerLikelyUnavailable = async () => {
  return await new Promise((resolve) => {
    execFile("docker", ["info"], { timeout: 1500 }, (error, stdout, stderr) => {
      if (error) return resolve(true);
      const out = `${stdout || ""}\n${stderr || ""}`;
      if (/Docker Desktop is unable to start/i.test(out)) return resolve(true);
      resolve(false);
    });
  });
};

const getRecentMessagesForContext = (messages, limit = 6) => {
  const recent = [...(messages || [])].slice(-limit);
  const lines = [];
  for (const m of recent) {
    const role = m.role === "assistant" ? "ASSISTANT" : m.role === "user" ? "USER" : "SYSTEM";
    const text = String(m.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    lines.push(`${role}: ${text.slice(0, 400)}`);
  }
  return lines.join("\n");
};

const loadGlobalMemory = async () => {
  await ensureDirs();
  return trimCharsFromEnd(await readText(GLOBAL_MEMORY_PATH), 1500).trim();
};

const normalizeMemoryEntry = async (entry) => {
  const raw = String(entry ?? "").trim();
  if (!raw) return "";
  // Keep memory Korean-only to prevent re-injection of other languages.
  return await rewriteToKorean(raw);
};

const updateGlobalMemory = async (entry) => {
  await ensureDirs();
  const normalizedEntry = await normalizeMemoryEntry(entry);
  if (!normalizedEntry) return;
  const prev = await readText(GLOBAL_MEMORY_PATH);
  const next = `${prev}${prev.trim() ? "\n" : ""}${normalizedEntry}`.trim();
  await writeText(GLOBAL_MEMORY_PATH, trimCharsFromEnd(next, 1500));
};

const updateSessionMemory = async (sessionId, entry) => {
  const normalizedEntry = await normalizeMemoryEntry(entry);
  if (!normalizedEntry) return loadSession(sessionId);
  return updateSession(sessionId, (session) => {
    const normalized = normalizeSession(session);
    const prev = String(normalized.memory?.sessionSummary ?? "").trim();
    const next = `${prev}${prev ? "\n" : ""}${normalizedEntry}`.trim();
    return {
      ...normalized,
      memory: {
        sessionSummary: trimCharsFromEnd(next, 1500),
        updatedAt: new Date().toISOString()
      }
    };
  });
};

const buildContextPrefix = async (session) => {
  const figmaBlock = String(session?.pipeline?.mcpContext?.figma?.text ?? "").trim();
  const ragBlock = String(session?.pipeline?.rag?.webContext ?? "").trim();
  const mode = String(session?.agentMode ?? "").toLowerCase();
  const isCodeMode = mode === "code";
  const globalMemory = isCodeMode ? "" : await loadGlobalMemory();
  const sessionMemory = isCodeMode ? "" : String(session?.memory?.sessionSummary ?? "").trim();
  const recent = getRecentMessagesForContext(session?.messages ?? [], isCodeMode ? 4 : 6);

  const blocks = [];
  if (figmaBlock) blocks.push(figmaBlock);
  if (ragBlock) blocks.push(ragBlock);
  if (globalMemory) blocks.push(`GLOBAL_MEMORY:\n${globalMemory}`);
  if (sessionMemory) blocks.push(`SESSION_MEMORY:\n${sessionMemory}`);
  if (recent) blocks.push(`RECENT_MESSAGES:\n${recent}`);
  return blocks.length ? `${blocks.join("\n\n")}\n\n---\n\n` : "";
};

const readWebCache = async (url) => {
  await ensureDirs();
  const key = hashUrl(url);
  const cachePath = path.join(RAG_WEB_CACHE_DIR, `${key}.json`);
  const data = await readJson(cachePath).catch(() => null);
  return data && typeof data === "object" ? data : null;
};

const writeWebCache = async (url, payload) => {
  await ensureDirs();
  const key = hashUrl(url);
  const cachePath = path.join(RAG_WEB_CACHE_DIR, `${key}.json`);
  await writeJson(cachePath, payload).catch(() => {});
};

const keywordScore = (query, chunk) => {
  const q = String(query ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 24);
  if (!q.length) return 0;
  const t = String(chunk ?? "").toLowerCase();
  let score = 0;
  for (const w of q) {
    if (w.length < 2) continue;
    if (t.includes(w)) score += 1;
  }
  return score / q.length;
};

const buildWebRagContext = async (message) => {
  // Skip RAG for Figma URLs: they frequently return CloudFront blocks.
  // Figma should be handled via MCP (get_design_context/get_screenshot).
  const urls = extractUrls(message, 2).filter((u) => !/https?:\/\/(?:www\.)?figma\.com\//i.test(u));
  if (!urls.length) return { ok: false, error: "no_urls" };

  const docs = [];
  const errors = [];
  for (const url of urls) {
    const cached = await readWebCache(url);
    const now = Date.now();
    if (cached?.fetchedAt && now - Number(cached.fetchedAt) < 24 * 60 * 60 * 1000) {
      if (cached?.text) docs.push(cached);
      continue;
    }
    const fetched = await fetchWebDocument(url, { timeoutMs: 12_000 });
    if (fetched.ok && fetched.text) {
      const payload = {
        url: fetched.url,
        title: fetched.title,
        text: trimCharsFromEnd(fetched.text, 40_000),
        fetchedAt: Date.now()
      };
      await writeWebCache(url, payload);
      docs.push(payload);
    } else if (!fetched.ok) {
      // Preserve the most specific reason (e.g. blocked_private_ip/blocked_localhost) for user feedback.
      errors.push({ url, error: fetched.error ?? "fetch_failed", detail: fetched.detail ?? null });
    }
  }

  if (!docs.length) {
    const first = errors[0] ?? null;
    return {
      ok: false,
      error: first?.error ?? "fetch_failed",
      detail: first?.detail ?? null,
      urls
    };
  }

  const sourceLines = docs.map((d, i) => `SOURCE ${i + 1}: ${d.title} (${d.url})`);
  const allChunks = [];
  const chunkMeta = [];
  for (let i = 0; i < docs.length; i++) {
    const chunks = chunkText(docs[i].text, { maxChars: 2600, minChars: 800 });
    for (let j = 0; j < chunks.length; j++) {
      allChunks.push(chunks[j]);
      chunkMeta.push({ sourceIndex: i, chunkIndex: j });
    }
  }
  if (!allChunks.length) return { ok: false, error: "no_text" };

  // Rank by embeddings (preferred), fallback to keyword scoring if embedding model is missing.
  let picked = null;
  let method = "embedding";
  const emb = await rankChunksByEmbedding({ query: message, chunks: allChunks, topK: 6 });
  if (emb.ok) {
    picked = emb.picked;
  } else {
    method = "keyword";
    const scored = allChunks.map((c, idx) => ({
      index: idx,
      score: keywordScore(message, c),
      text: c
    }));
    scored.sort((a, b) => b.score - a.score);
    picked = scored.slice(0, 6);
  }

  const references = [];
  const snippetLines = [];
  for (const item of picked) {
    const meta = chunkMeta[item.index] ?? { sourceIndex: 0, chunkIndex: 0 };
    const doc = docs[meta.sourceIndex] ?? docs[0];
    const snippet = trimCharsFromEnd(String(item.text ?? ""), 900);
    references.push({
      url: doc.url,
      title: doc.title,
      source: meta.sourceIndex + 1,
      chunk: meta.chunkIndex + 1,
      snippet
    });
    snippetLines.push(`[S${meta.sourceIndex + 1}-${meta.chunkIndex + 1}] ${snippet}`);
  }

  const webContext = `RAG_WEB_CONTEXT:\n${sourceLines.join("\n")}\n\nSNIPPETS:\n${snippetLines.join("\n\n")}\n\n(주의: 로그인/동적 페이지는 일부 내용이 누락될 수 있음. method=${method})`;
  return { ok: true, urls: docs.map((d) => d.url), references, webContext: trimCharsFromEnd(webContext, 8000), method };
};

const readCapabilityRegistry = async () => {
  await ensureDirs();
  const data = await readJson(CAP_REGISTRY_PATH).catch(() => null);
  if (!data || typeof data !== "object") {
    return { updatedAt: null, items: {} };
  }
  return {
    updatedAt: data.updatedAt ?? null,
    items: data.items && typeof data.items === "object" ? data.items : {}
  };
};

const writeCapabilityRegistry = async (registry) => {
  await ensureDirs();
  const next = {
    updatedAt: new Date().toISOString(),
    items: registry?.items ?? {}
  };
  await writeJson(CAP_REGISTRY_PATH, next).catch(() => {});
  return next;
};

const hasOllamaModel = async (name) => {
  const out = await runCommand("ollama", ["list"], WORKSPACE);
  if (!out.ok) return false;
  return out.stdout.split("\n").some((line) => line.trimStart().startsWith(`${name} `));
};

const ensureEmbeddingModelInstalled = async () => {
  const registry = await readCapabilityRegistry();
  const current = registry.items?.rag_web ?? null;
  if (current?.status === "installed") return { ok: true, already: true };

  const present = await hasOllamaModel("nomic-embed-text");
  if (present) {
    registry.items.rag_web = {
      status: "installed",
      installedAt: new Date().toISOString(),
      detail: "nomic-embed-text already present"
    };
    await writeCapabilityRegistry(registry);
    return { ok: true, already: true };
  }

  registry.items.rag_web = {
    status: "installing",
    startedAt: new Date().toISOString(),
    detail: "ollama pull nomic-embed-text"
  };
  await writeCapabilityRegistry(registry);

  // Fire-and-forget install. Do not block user requests.
  const child = spawn("ollama", ["pull", "nomic-embed-text"], {
    cwd: WORKSPACE,
    stdio: "ignore",
    detached: true
  });
  child.unref();

  return { ok: true, started: true };
};

const parseNeedsApproval = (planText) => {
  const required = { ...defaultApprovals };
  const block = String(planText ?? "");
  const upper = block.toUpperCase();
  const idx = upper.indexOf("NEEDS_APPROVAL");
  if (idx < 0) return required;
  const tail = block.slice(idx, idx + 800).toLowerCase();
  if (/(mail|email|gmail|calendar|캘린더|메일)/.test(tail)) required.mail = true;
  if (/(deploy|배포|release|prod|production)/.test(tail)) required.deploy = true;
  if (/(merge|머지)/.test(tail)) required.merge = true;
  if (/(git\s*push|push\s+origin|push)/.test(tail)) required.gitPush = true;
  if (/(pr\b|pull request|draft)/.test(tail)) required.prCreate = true;
  return required;
};

const approvalsSatisfied = (required, approvals, permission) => {
  if (normalizePermission(permission) === "full") return true;
  const req = required || defaultApprovals;
  const app = approvals || defaultApprovals;
  return Object.entries(req).every(([key, needed]) => !needed || Boolean(app[key]));
};

const hasCodeLikeHistory = (session) => {
  const history = Array.isArray(session?.history) ? session.history : [];
  return history.some((h) => ["act", "verify", "evaluate", "replan"].includes(String(h?.type ?? "").toLowerCase()));
};

// Once a session has entered code-loop mode, do not let follow-up "ask" overwrite request/mode/state.
const isLockedCodeThread = (session) => {
  const mode = String(session?.agentMode ?? "").toLowerCase();
  // Important: do NOT use pipeline.loop defaults here. They exist even for ask sessions.
  // Locking is only for real code-loop sessions.
  if (mode === "code") return true;
  if (hasCodeLikeHistory(session)) return true;
  return false;
};

const extractJsonAfterMarker = (text, marker) => {
  const s = String(text ?? "");
  const idx = s.indexOf(marker);
  if (idx < 0) return null;
  const tail = s.slice(idx + marker.length);
  const start = tail.indexOf("{");
  const startArr = tail.indexOf("[");
  const startIdx =
    startArr >= 0 && (start < 0 || startArr < start) ? startArr : start;
  if (startIdx < 0) return null;
  const raw = tail.slice(startIdx).trim();
  // Try whole-string JSON first.
  try {
    return JSON.parse(raw);
  } catch {
    // Try parse first top-level JSON value by bracket matching.
  }

  const openChar = raw[0];
  const closeChar = openChar === "[" ? "]" : "}";
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === openChar) depth++;
    if (ch === closeChar) depth--;
    if (depth === 0) {
      const slice = raw.slice(0, i + 1);
      try {
        return JSON.parse(slice);
      } catch {
        return null;
      }
    }
  }
  return null;
};

const parseGoalAndPlanSteps = (planText) => {
  const text = String(planText ?? "");
  const statement =
    text.match(/^\s*-\s*statement:\s*(.+)\s*$/m)?.[1]?.trim() ??
    text.match(/^\s*statement:\s*(.+)\s*$/m)?.[1]?.trim() ??
    "";

  const criteriaInline =
    text.match(/^\s*-\s*success_criteria:\s*(\[[^\n]+\])\s*$/m)?.[1] ??
    text.match(/^\s*success_criteria:\s*(\[[^\n]+\])\s*$/m)?.[1] ??
    null;
  let success_criteria = [];
  if (criteriaInline) {
    try {
      const parsed = JSON.parse(criteriaInline);
      if (Array.isArray(parsed)) success_criteria = parsed.map((c) => String(c));
    } catch {
      // ignore
    }
  }
  if (!success_criteria.length) {
    // Fallback: collect bullets between "GOAL:" and "PLAN_STEPS"
    const goalIdx = text.toUpperCase().indexOf("GOAL:");
    const stepsIdx = text.toUpperCase().indexOf("PLAN_STEPS");
    const block =
      goalIdx >= 0
        ? text.slice(goalIdx, stepsIdx > goalIdx ? stepsIdx : goalIdx + 800)
        : "";
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- ") && !l.includes("statement:") && !l.includes("success_criteria:"));
    success_criteria = lines.map((l) => l.replace(/^- /, "").trim()).filter(Boolean).slice(0, 5);
  }

  const planSteps = extractJsonAfterMarker(text, "PLAN_STEPS") ?? [];
  const normalizedSteps = Array.isArray(planSteps) ? planSteps : [];

  return {
    goal: {
      statement,
      success_criteria
    },
    plan_steps: normalizedSteps
  };
};

const parseEvaluation = (text) => {
  const parsed = extractJsonAfterMarker(text, "EVALUATION_JSON:");
  if (parsed && typeof parsed === "object") return parsed;
  return null;
};

const parseReplan = (text) => {
  const parsed = extractJsonAfterMarker(text, "REPLAN_JSON:");
  if (parsed && typeof parsed === "object") return parsed;
  return null;
};

const getWorldChangeFromPorcelain = (porcelain) => {
  const out = { filesCreated: [], filesModified: [], filesDeleted: [] };
  const lines = String(porcelain ?? "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("?? ")) {
      out.filesCreated.push(line.slice(3));
      continue;
    }
    const code = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (!file) continue;
    if (code.includes("D")) out.filesDeleted.push(file);
    else if (code.includes("A")) out.filesCreated.push(file);
    else out.filesModified.push(file);
  }
  out.filesCreated = [...new Set(out.filesCreated)].sort();
  out.filesModified = [...new Set(out.filesModified)].sort();
  out.filesDeleted = [...new Set(out.filesDeleted)].sort();
  return out;
};

const parsePorcelainMap = (porcelain) => {
  const map = new Map();
  const lines = String(porcelain ?? "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean);
  for (const line of lines) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    let file = line.slice(3).trim();
    if (file.includes("->")) {
      file = file.split("->").pop().trim();
    }
    map.set(file, status);
  }
  return map;
};

// Evidence-based best-effort delta between two porcelain snapshots.
// (Porcelain doesn't capture "changed again" while already dirty; this avoids guessing.)
const getWorldChangeDeltaFromPorcelain = (beforePorcelain, afterPorcelain) => {
  if (!afterPorcelain) return { filesCreated: [], filesModified: [], filesDeleted: [] };
  if (!beforePorcelain) return getWorldChangeFromPorcelain(afterPorcelain);

  const before = parsePorcelainMap(beforePorcelain);
  const after = parsePorcelainMap(afterPorcelain);
  const created = [];
  const modified = [];
  const deleted = [];

  for (const [file, status] of after.entries()) {
    const prev = before.get(file);
    if (!prev) {
      if (status.includes("D")) deleted.push(file);
      else if (status.includes("A") || status.includes("?")) created.push(file);
      else modified.push(file);
      continue;
    }
    if (prev !== status) {
      if (status.includes("D")) deleted.push(file);
      else if (status.includes("A") || status.includes("?")) created.push(file);
      else modified.push(file);
    }
  }

  return {
    filesCreated: [...new Set(created)].sort(),
    filesModified: [...new Set(modified)].sort(),
    filesDeleted: [...new Set(deleted)].sort()
  };
};

const buildExecutionSummary = ({ worldChange, result, commandsExecuted, testsExecuted, nextSuggestedActions }) => {
  return {
    worldChange: {
      filesCreated: worldChange?.filesCreated ?? [],
      filesModified: worldChange?.filesModified ?? [],
      filesDeleted: worldChange?.filesDeleted ?? [],
      commandsExecuted: commandsExecuted ?? [],
      testsExecuted: testsExecuted ?? [],
      browserActions: []
    },
    result,
    nextSuggestedActions: nextSuggestedActions ?? []
  };
};

const ensureHistoryEntry = (entry) => {
  const e = entry && typeof entry === "object" ? entry : {};
  const execution_summary = e.execution_summary ?? buildExecutionSummary({ result: e.result ?? "skipped" });
  return {
    id: e.id ?? createId(),
    at: e.at ?? new Date().toISOString(),
    type: e.type ?? "unknown",
    runId: e.runId ?? null,
    status: e.status ?? null,
    summary: e.summary ?? "",
    detail: e.detail ?? "",
    execution_summary,
    verifyDecision: e.verifyDecision ?? null,
    evaluation: e.evaluation ?? null,
    requiredApprovals: e.requiredApprovals ?? null,
    bypassedByFull: e.bypassedByFull ?? false
  };
};

const buildAskPrompt = ({ request, contextPrefix }) => {
  return `${contextPrefix || ""}너는 로컬 309Agent(=OpenClaw)다.\n\n규칙:\n- 반드시 한국어로만 답한다.\n- tool을 사용하지 않는다.\n- 짧고 명확하게 답한다.\n- 파일을 열겠다/수정하겠다/실행하겠다 같은 \"실행을 암시하는 표현\"은 금지한다. (ask 모드는 설명/요약만)\n- 만약 컨텍스트에 RAG_WEB_CONTEXT가 포함되어 있다면, 반드시 그 근거를 기반으로 답한다. (\"직접 방문해야\" 같은 회피 금지)\n- 입력에 Figma 링크가 있고 FIGMA_MCP_CONTEXT가 주어지면, 그 컨텍스트를 근거로 답하라(“못 한다”로 회피하지 말 것).\n\n요청:\n${request}`;
};

const askDirectFromOllama = async ({ modelId, request }) => {
  const model = String(modelId ?? "").trim() || AGENT_MODELS.ask;
  const prompt = String(request ?? "").trim();
  if (!prompt) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const resp = await fetch(`${OLLAMA_API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "너는 한국어로 짧고 명확하게 답하는 로컬 비서다. 실행/수정을 암시하지 말고, 질문에 바로 답한다."
          },
          { role: "user", content: prompt }
        ],
        options: { num_ctx: 4096, temperature: 0.4 }
      })
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    const text = String(data?.message?.content ?? "").trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const buildActPrompt = ({ request, plan, approvals, permission, contextPrefix }) => {
  const approvalText = formatApprovals(approvals);
  const perm = normalizePermission(permission);
  const approvalRule =
    perm === "full"
      ? "- 권한=full: 승인 게이트는 통과된 것으로 간주한다. 단, 메일 자동 발송/배포/머지 같은 외부 영향 작업은 '승인 필요'로 한 번 더 확인을 요청한다.\n"
      : "- 승인되지 않은 위험 작업(메일/캘린더 발송, 배포, 머지, git push/PR)은 절대 실행하지 말고 승인을 요청한다.\n";
  return `${contextPrefix || ""}너는 로컬 OpenClaw 에이전트이며 실제로 실행한다.\n\n규칙:\n- 파일/디렉터리 확인, git, 테스트, 쉘 실행은 반드시 tool을 사용한다.\n- tool 없이 실행했다고 말하지 말 것.\n- 절대 \"도구 호출 스펙(JSON)\"을 텍스트/코드블록으로 출력하지 말 것. (예: \`{\"name\":\"read\",...}\` 출력 금지)\n- 대신: tool을 실제로 실행하고, 그 결과(stdout/stderr/읽은 내용/변경사항)를 VERIFY/RESULT에 포함한다.\n- 요청에 파일 경로가 명시되지 않아도 먼저 스스로 탐색해서(예: read/exec로 후보 파일 확인) 수정을 시도한다.\n- 사용자에게 \"파일 경로를 알려달라/정보를 더 달라\"고 먼저 묻지 말고, 최소 1개 파일 수정 시도 후 결과를 보고한다.\n- 한 번의 시도에서 실패해도 가능한 후보 파일로 재시도한 뒤 결론을 낸다.\n${approvalRule}- 출력 형식: PLAN -> ACTIONS -> VERIFY(stdout/stderr 원문) -> RESULT(변경 파일/테스트) -> NEXT\n- FIGMA_MCP_CONTEXT가 있으면 그 내용을 설계 근거로 사용하라.\n- 다만 Figma 앱 UI를 직접 조작/편집하는 것은 할 수 없으니, 필요한 경우 사용자에게 “Figma에서 해야 할 최소 단계”만 요청하라.\n\n승인됨(기존 체크): ${approvalText}\n권한 모드: ${perm}\n\n요청:\n${request}\n\n계획:\n${plan || "(계획 없음)"}`;
};

const runCommand = (cmd, args, cwd) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd }, (error, stdout, stderr) => {
      const code =
        typeof error?.code === "number"
          ? error.code
          : error
            ? 1
            : 0;
      resolve({
        ok: !error,
        exitCode: code,
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? ""
      });
    });
  });

const getRepoRoot = async () => {
  const result = await runCommand("git", ["-C", WORKSPACE, "rev-parse", "--show-toplevel"]);
  if (!result.ok) return null;
  return result.stdout.trim() || null;
};

const getGitStatusSnapshot = async () => {
  const repoRoot = await getRepoRoot();
  if (!repoRoot) return null;
  const status = await runCommand("git", ["-C", repoRoot, "status", "--porcelain"]);
  if (!status.ok) return null;
  return status.stdout;
};

const loadVerifyCommand = async () => {
  const filePath = path.join(WORKSPACE, "PROJECT_TESTS.json");
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    const cmd = String(data?.default ?? "").trim();
    return cmd || "";
  } catch {
    return "";
  }
};

const detectSmokeVerify = async () => {
  // Keep it cheap and deterministic. At least 1 command must run.
  // Prefer the UI build, because this repo is primarily the UI server+client.
  const uiPkg = path.join(WORKSPACE, "apps/ui/package.json");
  const rootPkg = path.join(WORKSPACE, "package.json");
  const hasUi = await fsp.stat(uiPkg).then(() => true).catch(() => false);
  if (hasUi) {
    return { cmd: "pnpm", args: ["-C", "apps/ui", "build"], cwd: WORKSPACE, label: "pnpm -C apps/ui build" };
  }
  const hasRoot = await fsp.stat(rootPkg).then(() => true).catch(() => false);
  if (hasRoot) {
    return {
      cmd: process.execPath,
      args: ["-e", "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')"],
      cwd: WORKSPACE,
      label: "node -e package.json parse"
    };
  }
  return {
    cmd: "ls",
    args: ["-la"],
    cwd: WORKSPACE,
    label: "ls -la"
  };
};

const runSmokeVerify = async () => {
  const spec = await detectSmokeVerify();
  const out = await runCommand(spec.cmd, spec.args, spec.cwd);
  return {
    ok: out.ok,
    exitCode: out.exitCode ?? (out.ok ? 0 : 1),
    stdout: out.stdout,
    stderr: out.stderr,
    label: spec.label
  };
};

const buildVerifyPrompt = ({ request, plan, verifyCmd, contextPrefix }) => {
  return `${contextPrefix || ""}너는 로컬 OpenClaw 에이전트이며 "검증(Verify)" 단계만 수행한다.\n\n목표:\n- 아래 테스트 명령을 tool(exec)로 실행한다.\n- stdout/stderr 원문을 포함해 결과를 요약한다.\n\n규칙:\n- 테스트는 반드시 tool(exec)로 실행한다.\n- 절대 \"도구 호출 스펙(JSON)\"을 텍스트/코드블록으로 출력하지 말 것. 결과만 남겨라.\n- 출력 형식: ACTIONS -> VERIFY(stdout/stderr 원문) -> RESULT(테스트 통과/실패) -> NEXT\n\n테스트 명령:\n${verifyCmd}\n\n요청(참고):\n${request}\n\n계획(참고):\n${plan || "(계획 없음)"}`;
};

const getDiffArtifacts = async () => {
  const repoRoot = await getRepoRoot();
  if (!repoRoot) {
    return { files: [], diff: "" };
  }
  const status = await runCommand("git", ["-C", repoRoot, "status", "--porcelain"]);
  const files = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3));
  const diff = await runCommand("git", ["-C", repoRoot, "diff"]);
  const cached = await runCommand("git", ["-C", repoRoot, "diff", "--cached"]);
  const mergedDiff = [diff.stdout, cached.stdout].filter(Boolean).join("\n");
  return { files, diff: mergedDiff };
};

const startRun = async ({ prompt, modelId, kind, sessionId, preserveSessionState = false }) => {
  await ensureDirs();
  await fsp.access(OPENCLAW_BIN);
  await fsp.access(OPENCLAW_CONFIG);

  const gitStatusBefore = sessionId && kind === "act" ? await getGitStatusSnapshot() : null;

  const id = createId();
  const createdAt = new Date().toISOString();
  const logPath = path.join(RUNS_DIR, `${id}.log`);
  const gatewayLogPath = getGatewayLogPath();
  const metaPath = path.join(RUNS_DIR, `${id}.json`);
  const MAX_RUN_MS_BY_KIND = {
    ask: 2 * 60_000,
    plan: 4 * 60_000,
    act: 8 * 60_000,
    verify: 6 * 60_000,
    evaluate: 4 * 60_000,
    replan: 4 * 60_000
  };

  const cfg = await loadConfig();
  const tempConfigPath = await (async () => {
    if (!modelId) return null;
    if (!cfg?.agents?.defaults) return null;
    cfg.agents.defaults.model = cfg.agents.defaults.model ?? {};
    cfg.agents.defaults.model.primary = `ollama/${modelId}`;
    // UI runtime should not hard-depend on Docker sandbox availability.
    cfg.agents.defaults.sandbox = cfg.agents.defaults.sandbox ?? {};
    cfg.agents.defaults.sandbox.mode = "off";
    cfg.agents.defaults.sandbox.workspaceAccess = "rw";
    // Write an ephemeral config for this run. Do NOT redact gateway tokens here, or Gateway auth may break.
    // The file is stored under DATA_DIR/tmp and is deleted on run completion.
    const tempPath = path.join(TMP_DIR, `${id}.openclaw.json`);
    await fsp.writeFile(tempPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    await fsp.chmod(tempPath, 0o600).catch(() => {});
    return tempPath;
  })();

  const openclawSessionId = sessionId ? `ui-thread-${sessionId}` : `ui-${id}`;
  const meta = {
    id,
    sessionId,
    kind,
    prompt,
    createdAt,
    status: "running",
    logPath,
    gatewayLogPath,
    openclawSessionId,
    preserveSessionState: Boolean(preserveSessionState),
    configPath: OPENCLAW_CONFIG,
    modelId: modelId ?? null,
    stateDir: OPENCLAW_STATE_DIR,
    gitStatusBeforeAct: gitStatusBefore,
    exitCode: null,
    completedAt: null,
    durationMs: null
  };

  await writeJson(metaPath, meta);

  // For inline ask inside an active code-thread, we must not mutate the pipeline/status.
  // (This prevents "ask" from overwriting a running/failed code loop state.)
  const shouldMutateSession =
    Boolean(sessionId) && !(kind === "ask" && preserveSessionState);

  if (shouldMutateSession) {
    await updateSession(sessionId, (session) => ({
      ...session,
      status: kind === "plan" ? "planning" : "running",
      pipeline: {
        ...(session.pipeline ?? {}),
        phase:
          kind === "plan"
            ? "planning"
            : kind === "verify"
              ? "verifying"
              : kind === "evaluate"
                ? "evaluating"
                : kind === "replan"
                  ? "replanning"
                  : "acting",
        pendingContinue: false,
        activeRunId: id,
        gitStatusBeforeAct: gitStatusBefore ?? (session.pipeline?.gitStatusBeforeAct ?? null)
      },
      runs: [...(session.runs || []), meta]
    }));
  }

  const env = {
    ...process.env,
    OPENCLAW_STATE_DIR,
    OPENCLAW_CONFIG_PATH: tempConfigPath ?? OPENCLAW_CONFIG
  };

  if (kind === "ask") {
    env.OPENCLAW_SANDBOX_MODE = "off";
    env.OPENCLAW_SANDBOX_WORKSPACE_ACCESS = "rw";
  }

  if (cfg?.gateway?.auth?.token) {
    env.OPENCLAW_GATEWAY_TOKEN = cfg.gateway.auth.token;
  }
  if (cfg?.gateway?.remote?.url) {
    env.OPENCLAW_GATEWAY_URL = cfg.gateway.remote.url;
  }

  const agentOut = fs.createWriteStream(logPath, { flags: "a" });
  state.active = { id, agent: null, metaPath, stopRequested: false, timeoutRequested: false };

  const startAt = Date.now();

  const agent = spawn(
    OPENCLAW_BIN,
    ["agent", "--session-id", openclawSessionId, "--message", prompt, "--json"],
    { env }
  );

  state.active.agent = agent;

  agent.stdout.pipe(agentOut);
  agent.stderr.pipe(agentOut);

  // Hard timeout: OpenClaw can occasionally stall (no exit, no output). Never allow infinite "doing nothing".
  const maxMs = MAX_RUN_MS_BY_KIND[kind] ?? 8 * 60_000;
  const timeout = setTimeout(() => {
    // Only cancel if this run is still active.
    if (!state.active || state.active.id !== id) return;
    state.active.timeoutRequested = true;
    try {
      agentOut.write(`\n[TIMEOUT] kind=${kind} exceeded ${maxMs}ms. Sending SIGTERM...\n`);
    } catch {}
    try {
      agent.kill("SIGTERM");
    } catch {}
    setTimeout(() => {
      if (!state.active || state.active.id !== id) return;
      try {
        agentOut.write(`\n[TIMEOUT] kind=${kind} still running. Sending SIGKILL...\n`);
      } catch {}
      try {
        agent.kill("SIGKILL");
      } catch {}
    }, 5000);
  }, maxMs);

  const finish = async (status, code, { timedOut } = {}) => {
    clearTimeout(timeout);
    // Enrich run meta with actual runtime info (provider/model/usage/systemPrompt) from OpenClaw JSON output.
    const runRaw = (() => {
      try {
        return fs.readFileSync(logPath, "utf-8");
      } catch {
        return "";
      }
    })();
    const extracted = extractRunSummary(runRaw);
    // Compute run-scoped diff/change evidence before building run artifacts.
    const diffArtifacts =
      kind === "act" || kind === "verify" || kind === "evaluate" || kind === "replan"
        ? await getDiffArtifacts().catch(() => ({ files: [], diff: "" }))
        : { files: [], diff: "" };
    const porcelainNow = kind === "act" ? await getGitStatusSnapshot() : null;
    const worldChangeDelta =
      kind === "act" && porcelainNow
        ? getWorldChangeDeltaFromPorcelain(gitStatusBefore, porcelainNow)
        : null;

    const runArtifacts = (() => {
      // Make artifacts "run-scoped" when possible (avoid showing the whole repo's dirty diff).
      if (kind === "act") {
        const baselineDirty = Boolean(gitStatusBefore && String(gitStatusBefore).trim());
        const wc = worldChangeDelta ?? { filesCreated: [], filesModified: [], filesDeleted: [] };
        const files = [
          ...(wc.filesCreated ?? []).map((f) => `A ${f}`),
          ...(wc.filesModified ?? []).map((f) => `M ${f}`),
          ...(wc.filesDeleted ?? []).map((f) => `D ${f}`)
        ];
        return {
          baselineDirty,
          worldChange: wc,
          files,
          diff: trimCharsFromEnd(String(diffArtifacts?.diff ?? ""), 200_000)
        };
      }
      if (kind === "verify" || kind === "evaluate" || kind === "replan") {
        return {
          baselineDirty: false,
          worldChange: { filesCreated: [], filesModified: [], filesDeleted: [] },
          files: [],
          diff: trimCharsFromEnd(String(diffArtifacts?.diff ?? ""), 200_000)
        };
      }
      return { baselineDirty: false, worldChange: { filesCreated: [], filesModified: [], filesDeleted: [] }, files: [], diff: "" };
    })();

    const updated = {
      ...meta,
      status,
      timedOut: Boolean(timedOut),
      exitCode: code ?? null,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startAt,
      usage: extracted.usage ?? null,
      systemPrompt: extracted.systemPrompt ?? null,
      provider: extracted.provider ?? null,
      actualModelId: extracted.model ?? null,
      artifacts: runArtifacts
    };
    await writeJson(metaPath, updated);
    if (tempConfigPath) {
      await fsp.unlink(tempConfigPath).catch(() => {});
    }
    state.active = null;
    agentOut.end();

    if (sessionId) {
      const planText = kind === "plan" && status === "success" ? extractPayloadText(runRaw) : null;
      const humanAnswerRaw =
        kind === "act" || kind === "verify" || kind === "ask"
          ? extractHumanAnswer(runRaw)
          : "";
      const humanAnswer =
        kind === "act" || kind === "verify" || kind === "ask"
          ? await rewriteToKorean(humanAnswerRaw)
          : humanAnswerRaw;

      const payloadText = extractPayloadText(runRaw);
      const verifyCmdForHistory = kind === "verify" ? await loadVerifyCommand() : "";
      const parsedGoal =
        kind === "plan" && status === "success" ? parseGoalAndPlanSteps(payloadText) : null;
      const parsedEvaluation =
        kind === "evaluate" && status === "success" ? parseEvaluation(payloadText) : null;
      const parsedReplan =
        kind === "replan" && status === "success" ? parseReplan(payloadText) : null;

      const executionSummaryForKind = (() => {
        const wc =
          kind === "act" && worldChangeDelta
            ? worldChangeDelta
            : { filesCreated: [], filesModified: [], filesDeleted: [] };
        const testsExecuted =
          kind === "verify" && verifyCmdForHistory
            ? [verifyCmdForHistory]
            : [];
        return buildExecutionSummary({
          worldChange: wc,
          result:
            status === "success"
              ? "success"
              : status === "cancelled"
                ? "cancelled"
                : "failed",
          commandsExecuted: [],
          testsExecuted,
          nextSuggestedActions: []
        });
      })();

      const historyEntry = (() => {
        const base = {
          type: kind,
          runId: updated.id,
          status,
          summary: "",
          detail: trimCharsFromEnd(payloadText || "", 8000),
          execution_summary: executionSummaryForKind
        };
        if (kind === "plan") {
          const st = parsedGoal?.goal?.statement ?? "";
          base.summary = st ? `GOAL: ${toOneLine(st, 140)}` : "계획을 생성했습니다.";
          base.requiredApprovals = (parsedGoal ? null : null);
        } else if (kind === "act") {
          base.summary = humanAnswer ? toOneLine(humanAnswer, 160) : "실행을 완료했습니다.";
        } else if (kind === "verify") {
          base.summary = humanAnswer ? toOneLine(humanAnswer, 160) : "검증을 완료했습니다.";
          const changedByDiff = Array.isArray(diffArtifacts?.files) ? diffArtifacts.files.length > 0 : false;
          base.verifyDecision = {
            verifyCmdPresent: Boolean(verifyCmdForHistory),
            changedByDiff,
            changedByStatus: false,
            actHadToolWork: false,
            smokeOnly: false,
            reason: verifyCmdForHistory ? "verifyCmd 실행 결과" : "verify 단계 실행"
          };
        } else if (kind === "evaluate") {
          base.summary = parsedEvaluation
            ? `평가: achieved=${parsedEvaluation.achieved ?? "?"} conf=${parsedEvaluation.confidence ?? "?"}`
            : "평가를 수행했습니다.";
          base.evaluation = parsedEvaluation;
        } else if (kind === "replan") {
          base.summary = parsedReplan?.strategy
            ? `재계획: ${toOneLine(parsedReplan.strategy, 160)}`
            : "재계획을 생성했습니다.";
        } else if (kind === "ask") {
          base.summary = humanAnswer ? toOneLine(humanAnswer, 160) : "답변을 생성했습니다.";
        }
        return ensureHistoryEntry(base);
      })();

      const updatedSession = await updateSession(sessionId, (session) => {
        const normalized = normalizeSession(session);
        const runs = (session.runs || []).map((run) =>
          run.id === updated.id ? updated : run
        );
        let plan = normalized.plan;
        let statusValue = normalized.status;
        let requiredApprovals = normalized.requiredApprovals ?? { ...defaultApprovals };
        let pipeline = { ...(normalized.pipeline ?? {}) };
        let lastAnswer = normalized.lastAnswer ?? "";
        let messages = [...(normalized.messages ?? [])];
        let history = [...(normalized.history ?? [])];

        if (status === "cancelled") {
          messages.push({
            id: createId(),
            at: new Date().toISOString(),
            kind: "assistant",
            role: "assistant",
            text: "요청을 중지했습니다.",
            runId: updated.id
          });
          history.push(historyEntry);
          return {
            ...normalized,
            status: "cancelled",
            plan,
            requiredApprovals,
            pipeline: { ...pipeline, phase: "done", pendingContinue: false, activeRunId: null },
            lastAnswer,
            messages,
            history,
            runs
          };
        }

        if (status === "failed" && Boolean(timedOut)) {
          messages.push({
            id: createId(),
            at: new Date().toISOString(),
            kind: "assistant",
            role: "assistant",
            text: `시간이 너무 오래 걸려 자동으로 중지했습니다. (단계: ${kind})`,
            runId: updated.id
          });
          history.push(
            ensureHistoryEntry({
              type: "timeout",
              runId: updated.id,
              status: "failed",
              summary: `시간 초과로 중지됨 (${kind})`,
              detail: `kind=${kind} maxMs=${maxMs}`,
              execution_summary: buildExecutionSummary({
                worldChange: { filesCreated: [], filesModified: [], filesDeleted: [] },
                result: "failed",
                commandsExecuted: [],
                testsExecuted: [],
                nextSuggestedActions: ["요청을 더 작게 쪼개거나, 더 가벼운 모델로 재시도하세요."]
              })
            })
          );
          return {
            ...normalized,
            status: "failed",
            pipeline: {
              ...(normalized.pipeline ?? {}),
              phase: "done",
              pendingContinue: false,
              activeRunId: null,
              nextAction: {
                type: "needs_user",
                description: `시간 초과로 중단됨: ${kind}. 요청을 더 작게 쪼개서 다시 시도하세요.`,
                recommended: true
              }
            },
            messages,
            history,
            runs
          };
        }

        if (kind === "plan") {
          if (status === "success") {
            plan = planText ?? "";
            const parsed = parseNeedsApproval(plan);
            const hasAny = Object.values(parsed).some(Boolean);
            requiredApprovals = hasAny
              ? parsed
              : inferRequiredApprovals(`${normalized.request}\n${plan}`);
            // Store goal + plan steps for code-mode loop visibility.
            if (parsedGoal?.goal) {
              const statementRaw = String(parsedGoal.goal.statement ?? "").trim();
              const criteriaRaw = Array.isArray(parsedGoal.goal.success_criteria)
                ? parsedGoal.goal.success_criteria.slice(0, 5).map((c) => String(c))
                : [];
              const fallbackStatement = toOneLine(normalized.request, 160);
              const fallbackCriteria = ["요청 핵심을 수행했는가", "근거(변경/로그/결과)가 남았는가"];
              pipeline = {
                ...pipeline,
                goal: {
                  ...(pipeline.goal ?? {}),
                  statement: statementRaw || fallbackStatement,
                  success_criteria: criteriaRaw.length ? criteriaRaw : fallbackCriteria
                },
                planSteps: Array.isArray(parsedGoal.plan_steps) ? parsedGoal.plan_steps : pipeline.planSteps ?? []
              };
            }
            // Plan 단계만 끝난 상태. 다음 단계 실행 여부는 finish() 밖에서 결정한다.
            statusValue = "idle";
            pipeline = { ...pipeline, phase: "idle", pendingContinue: false };
          } else {
            statusValue = "failed";
            pipeline = {
              ...pipeline,
              phase: "done",
              pendingContinue: false
            };
          }
          history.push(historyEntry);
        } else if (kind === "act") {
          const answer = humanAnswer;
          if (status === "success") {
            lastAnswer = answer;
            if (answer) {
              messages.push({
                id: createId(),
                at: new Date().toISOString(),
                kind: "assistant",
                role: "assistant",
                text: answer,
                runId: updated.id
              });
            }
            // 다음 단계(verify/evaluate) 여부는 finish() 밖에서 결정한다.
            statusValue = "running";
            pipeline = { ...pipeline, phase: "idle", pendingContinue: false };
            pipeline = {
              ...pipeline,
              goal: {
                ...(pipeline.goal ?? {}),
                artifacts: [
                  ...new Set([...(pipeline.goal?.artifacts ?? []), ...((diffArtifacts.files ?? []).slice(0, 200))])
                ]
              }
            };
          } else {
            if (answer) {
              messages.push({
                id: createId(),
                at: new Date().toISOString(),
                kind: "assistant",
                role: "assistant",
                text: answer,
                runId: updated.id
              });
            }
            statusValue = "failed";
            pipeline = {
              ...pipeline,
              phase: "done",
              pendingContinue: false
            };
          }
          history.push(historyEntry);
        } else if (kind === "verify") {
          const verifyText = humanAnswer;
          if (verifyText) {
            messages.push({
              id: createId(),
              at: new Date().toISOString(),
              kind: "assistant",
              role: "assistant",
              text: verifyText,
              runId: updated.id
            });
          }
          statusValue = status === "success" ? "running" : "failed";
          pipeline = { ...pipeline, phase: "idle", pendingContinue: false };
          history.push(historyEntry);
        } else if (kind === "evaluate") {
          // Evaluate doesn't have to be shown in user chat; store results for the loop.
          const achieved = String(parsedEvaluation?.achieved ?? "").toLowerCase() === "yes";
          statusValue = achieved ? "running" : normalized.status;
          pipeline = {
            ...pipeline,
            phase: "idle",
            pendingContinue: false
          };
          history.push(historyEntry);
        } else if (kind === "replan") {
          statusValue = "running";
          pipeline = {
            ...pipeline,
            phase: "idle",
            pendingContinue: false
          };
          if (parsedReplan?.updated_plan_steps && Array.isArray(parsedReplan.updated_plan_steps)) {
            pipeline = { ...pipeline, planSteps: parsedReplan.updated_plan_steps };
          }
          history.push(historyEntry);
        } else if (kind === "ask") {
          const answer = humanAnswer;
          if (answer) {
            const refs = Array.isArray(pipeline?.rag?.references) ? pipeline.rag.references : [];
            messages.push({
              id: createId(),
              at: new Date().toISOString(),
              kind: "assistant",
              role: "assistant",
              text: answer,
              references: refs.length ? refs.slice(0, 8) : undefined,
              runId: updated.id
            });
          }
          // Inline ask must not overwrite status/pipeline/lastAnswer for a code-thread.
          if (!preserveSessionState) {
            lastAnswer = answer || lastAnswer;
            statusValue = status === "success" ? "success" : "failed";
            pipeline = { ...pipeline, phase: "done", pendingContinue: false };
          }
          history.push(historyEntry);
        }

        // Regardless of kind/outcome, the run is no longer active from the session's perspective.
        if (!preserveSessionState) {
          pipeline = { ...(pipeline ?? {}), activeRunId: null };
        }
        return {
          ...normalized,
          status: statusValue,
          plan,
          requiredApprovals,
          pipeline,
          lastAnswer,
          messages,
          history,
          runs
        };
      });

      // Goal-driven autonomy loop (code mode only):
      // plan -> (approval) -> act -> verify/smoke -> evaluate -> (replan+retry)* -> done
      const after = normalizeSession(updatedSession);
      const agentMode = after.agentMode ?? null;

      const recordDoneAndMemory = async ({ finalStatus, note, nextAction }) => {
        const current = await loadSession(sessionId);
        const baselinePorcelain = current.pipeline?.gitStatusBeforeAct ?? null;
        const porcelain = await getGitStatusSnapshot();
        const snapshotWc = porcelain
          ? getWorldChangeFromPorcelain(porcelain)
          : { filesCreated: [], filesModified: [], filesDeleted: [] };
        const deltaWc = porcelain
          ? getWorldChangeDeltaFromPorcelain(baselinePorcelain, porcelain)
          : { filesCreated: [], filesModified: [], filesDeleted: [] };
        const deltaCount =
          (deltaWc.filesCreated?.length ?? 0) +
          (deltaWc.filesModified?.length ?? 0) +
          (deltaWc.filesDeleted?.length ?? 0);
        const snapCount =
          (snapshotWc.filesCreated?.length ?? 0) +
          (snapshotWc.filesModified?.length ?? 0) +
          (snapshotWc.filesDeleted?.length ?? 0);
        const baselineIsDirty = Boolean(baselinePorcelain && baselinePorcelain.trim());
        // If the repo was already dirty, "snapshot" is misleading. Prefer empty + an explicit note.
        const wcMode =
          deltaCount > 0
            ? "delta"
            : baselineIsDirty && snapCount > 0
              ? "unknown_dirty"
              : snapCount > 0
                ? "snapshot"
                : "none";
        const wc =
          wcMode === "delta"
            ? deltaWc
            : wcMode === "snapshot"
              ? snapshotWc
              : { filesCreated: [], filesModified: [], filesDeleted: [] };

        const summarizeTop = (label, prefix, files, limit = 10) => {
          const list = (files ?? []).slice(0, limit);
          if (!list.length) return null;
          const items = list.map((f) => `\`${prefix} ${f}\``).join(", ");
          return `- ${label}: ${items}`;
        };

        const createdLine = summarizeTop("생성", "A", wc.filesCreated);
        const modifiedLine = summarizeTop("수정", "M", wc.filesModified);
        const deletedLine = summarizeTop("삭제", "D", wc.filesDeleted);
        const lines = [createdLine, modifiedLine, deletedLine].filter(Boolean);
        const counts = `생성 ${wc.filesCreated.length} / 수정 ${wc.filesModified.length} / 삭제 ${wc.filesDeleted.length}${
          wcMode === "delta"
            ? " (이번 실행 기준)"
            : wcMode === "snapshot"
              ? " (현재 변경 기준)"
              : wcMode === "unknown_dirty"
                ? " (기존 변경이 많아 이번 실행 변경을 확정할 수 없음)"
                : ""
        }`;

        const doneNote =
          note ||
          (finalStatus === "success"
            ? "완료"
            : finalStatus === "cancelled"
              ? "중지됨"
              : "실패");

        const doneMessage = `${doneNote}\n\n변경 요약: ${counts}\n${lines.length ? `\n변경 파일(Top 10):\n${lines.join("\n")}\n\n(전체 diff는 패널에서 확인하세요.)` : "\n변경 파일을 감지하지 못했습니다. (git status 기준)\n"}`.trim();
        const doneEntry = ensureHistoryEntry({
          type: "done",
          runId: null,
          status: finalStatus,
          summary: doneNote,
          detail: doneMessage,
          execution_summary: buildExecutionSummary({
            worldChange: wc,
            result: finalStatus === "success" ? "success" : finalStatus === "cancelled" ? "cancelled" : "failed",
            commandsExecuted: [],
            testsExecuted: [],
            nextSuggestedActions: []
          })
        });

        const updated = await updateSession(sessionId, (s) => {
          const n = normalizeSession(s);
          const history = [...(n.history ?? []), doneEntry];
          const messages = [...(n.messages ?? [])];
          messages.push({
            id: createId(),
            at: new Date().toISOString(),
            kind: "assistant",
            role: "assistant",
            text: doneMessage,
            runId: null
          });
          const pipeline = {
            ...(n.pipeline ?? {}),
            phase: "done",
            pendingContinue: false,
            loop: { ...(n.pipeline?.loop ?? {}), step: "done" },
            nextAction: nextAction ?? { type: "auto", description: "", recommended: true }
          };
          return { ...n, status: finalStatus, pipeline, history, messages, lastAnswer: doneMessage };
        });

        const now = new Date();
        const entry = `- [${now.toISOString().slice(0, 10)}] ${toOneLine(
          updated.title,
          60
        )}: ${toOneLine(updated.request, 120)} -> ${toOneLine(updated.lastAnswer, 180)}`;
        await updateSessionMemory(sessionId, entry);
        await updateGlobalMemory(entry);
      };

      // Keep existing memory behavior for ask/plan modes.
      if (agentMode === "ask") {
        const session = await loadSession(sessionId);
        const now = new Date();
        const entry = `- [${now.toISOString().slice(0, 10)}] ${toOneLine(
          session.title,
          60
        )}: ${toOneLine(session.request, 120)} -> ${toOneLine(session.lastAnswer, 180)}`;
        await updateSessionMemory(sessionId, entry);
        await updateGlobalMemory(entry);
        return;
      }

      // Legacy (plan mode): plan only, then pendingContinue.
      if (agentMode === "plan" && kind === "plan" && status === "success") {
        await updateSession(sessionId, (s) => {
          const n = normalizeSession(s);
          return {
            ...n,
            status: "idle",
            pipeline: {
              ...(n.pipeline ?? {}),
              phase: "idle",
              pendingContinue: true,
              loop: { ...(n.pipeline?.loop ?? {}), step: "plan" },
              nextAction: { type: "needs_user", description: "계속 실행하려면 '계속 실행'을 선택하세요.", recommended: true }
            }
          };
        });
        await appendMessage(sessionId, {
          role: "assistant",
          kind: "assistant",
          text: "계획이 준비되었습니다. 계속 실행하려면 '계속 실행'을 눌러주세요."
        });
        return;
      }

      if (agentMode !== "code") {
        // Non-code flows stop here.
        return;
      }

      // CODE MODE LOOP
      if (kind === "plan" && status === "success") {
        const latest = await loadSession(sessionId);
        const planOnly = Boolean(latest.pipeline?.planOnly);
        const approvalsOk = approvalsSatisfied(latest.requiredApprovals, latest.approvals, latest.permission);
        const neededKeys = Object.entries(latest.requiredApprovals ?? {})
          .filter(([, v]) => Boolean(v))
          .map(([k]) => k);
        const bypassedByFull =
          normalizePermission(latest.permission) === "full" &&
          neededKeys.length > 0 &&
          !approvalsSatisfied(latest.requiredApprovals, latest.approvals, "basic");

        if (planOnly) {
          await updateSession(sessionId, (s) => {
            const n = normalizeSession(s);
            return {
              ...n,
              pipeline: {
                ...(n.pipeline ?? {}),
                phase: "idle",
                pendingContinue: true,
                loop: { ...(n.pipeline?.loop ?? {}), step: "plan", attempt: 0 },
                nextAction: { type: "needs_user", description: "Plan 모드입니다. 계속 실행하려면 '계속 실행'을 누르세요.", recommended: true }
              }
            };
          });
          await appendMessage(sessionId, {
            role: "assistant",
            kind: "assistant",
            text: "계획이 준비되었습니다. Plan 모드이므로 여기서 멈췄습니다. 계속 실행하려면 '계속 실행'을 눌러주세요."
          });
          return;
        }

        if (!approvalsOk) {
          await updateSession(sessionId, (s) => {
            const n = normalizeSession(s);
            return {
              ...n,
              pipeline: {
                ...(n.pipeline ?? {}),
                phase: "needs_approval",
                pendingContinue: true,
                loop: { ...(n.pipeline?.loop ?? {}), step: "plan", attempt: 0 },
                nextAction: {
                  type: "approval_required",
                  description: neededKeys.length ? `승인이 필요한 항목: ${neededKeys.join(", ")}` : "승인이 필요한 작업이 포함되어 있습니다.",
                  recommended: true
                }
              }
            };
          });
          await appendMessage(sessionId, {
            role: "assistant",
            kind: "assistant",
            text: "승인이 필요한 작업이 포함되어 자동 실행을 멈췄습니다. 채팅에서 '계속' 또는 '항상 허용'을 선택하면 계속 진행합니다."
          });
          return;
        }

        if (bypassedByFull) {
          const bypassEntry = ensureHistoryEntry({
            type: "approval",
            runId: null,
            status: "success",
            summary: "full 권한으로 승인 게이트를 우회했습니다.",
            detail: `requiredApprovals: ${neededKeys.join(", ")}`,
            bypassedByFull: true,
            execution_summary: buildExecutionSummary({
              worldChange: { filesCreated: [], filesModified: [], filesDeleted: [] },
              result: "success",
              commandsExecuted: [],
              testsExecuted: [],
              nextSuggestedActions: []
            })
          });
          await updateSession(sessionId, (s) => {
            const n = normalizeSession(s);
            return { ...n, history: [...(n.history ?? []), bypassEntry] };
          });
        }

        if (!state.active) {
          const session = await loadSession(sessionId);
          const contextPrefix = await buildContextPrefix(session);
          const { text: rewrittenRequest } = rewriteWorkspacePaths(session.request);
          const actPrompt = buildActPrompt({
            request: rewrittenRequest,
            plan: session.plan,
            approvals: session.approvals,
            permission: session.permission,
            contextPrefix
          });
          await startRun({ prompt: actPrompt, modelId: session.modelId, kind: "act", sessionId });
        }
        return;
      }

      if (kind === "act") {
        const session = await loadSession(sessionId);
        if (status !== "success") {
          const reason = toOneLine(extractHumanAnswer(runRaw), 240) || "act 단계 실패";
          await recordDoneAndMemory({
            finalStatus: "failed",
            note: "실행(Act)이 실패했습니다.",
            nextAction: { type: "needs_user", description: `실패 원인 확인 후 다시 시도하세요: ${reason}`, recommended: true }
          });
          return;
        }

        // Always attempt verify, and record evidence (exitCode/stdout/stderr). No evidence => no "success".
        // We execute verify on the host to avoid the "model narrated it" failure mode.
        const verifyCmd = await loadVerifyCommand();
        const before = session.pipeline?.gitStatusBeforeAct ?? null;
        const afterStatus = await getGitStatusSnapshot();
        const changedByStatus =
          before !== null && afterStatus !== null ? before !== afterStatus : false;
        const changedByDiff = Array.isArray(diffArtifacts?.files)
          ? diffArtifacts.files.length > 0
          : false;
        const actHadToolWork = /ACTIONS:\s*[\s\S]*?(VERIFY:|RESULT:|NEXT:)/i.test(
          payloadText || ""
        );
        const asksMoreInfo = /(알려주시면|정보.*필요|경로.*(필요|알려)|파일.*(제공|알려))/i.test(
          payloadText || ""
        );

        // Hard gate: code-like requests must not end as "정보 더 필요" without any file change evidence.
        if (
          requestLikelyNeedsWorldChange(session.request) &&
          !changedByDiff &&
          !changedByStatus &&
          asksMoreInfo
        ) {
          const loop = session.pipeline?.loop ?? { attempt: 1, maxAttempts: 3 };
          const attempt = Number(loop.attempt ?? 1) || 1;
          const autoRetryAllowed = attempt < 2;
          const candidates = inferCandidateFilesForRequest(session.request);
          if (autoRetryAllowed && candidates.length) {
            const { text: rewrittenRequest } = rewriteWorkspacePaths(session.request);
            const narrowedRequest = `${rewrittenRequest}\n\n자동 추정 후보 파일(우선 확인):\n${candidates
              .map((f) => `- ${f}`)
              .join("\n")}`;
            await updateSession(sessionId, (s) => {
              const n = normalizeSession(s);
              return {
                ...n,
                status: "running",
                pipeline: {
                  ...(n.pipeline ?? {}),
                  phase: "acting",
                  loop: {
                    ...(n.pipeline?.loop ?? {}),
                    step: "act",
                    attempt: attempt + 1
                  },
                  nextAction: { type: "auto", description: "", recommended: true }
                }
              };
            });
            const refreshed = await loadSession(sessionId);
            const contextPrefix = await buildContextPrefix(refreshed);
            const retryPrompt = buildActPrompt({
              request: narrowedRequest,
              plan: refreshed.plan,
              approvals: refreshed.approvals,
              permission: refreshed.permission,
              contextPrefix
            });
            await startRun({
              prompt: retryPrompt,
              modelId: refreshed.modelId,
              kind: "act",
              sessionId
            });
            return;
          }
          await recordDoneAndMemory({
            finalStatus: "failed",
            note: "실행(Act)이 파일 변경 없이 추가 정보 요청으로 종료되었습니다.",
            nextAction: {
              type: "needs_user",
              description:
                "자동 탐색/재시도 후에도 변경하지 못했습니다. 화면 요소 이름 또는 관련 파일 힌트를 1개만 추가해 주세요.",
              recommended: true
            }
          });
          return;
        }

        const verifyDecision = {
          verifyCmdPresent: Boolean(verifyCmd),
          changedByDiff,
          changedByStatus,
          actHadToolWork,
          smokeOnly: !verifyCmd,
          reason: verifyCmd ? "verifyCmd 실행(호스트)" : "verifyCmd 없음: smoke verify(호스트)"
        };

        await updateSession(sessionId, (s) => {
          const n = normalizeSession(s);
          const loop = n.pipeline?.loop ?? {};
          return {
            ...n,
            pipeline: {
              ...(n.pipeline ?? {}),
              phase: "verifying",
              loop: { ...loop, step: "verify" },
              lastVerifyDecision: verifyDecision
            }
          };
        });

        const cwd = (await getRepoRoot()) ?? WORKSPACE;
        const result = verifyCmd
          ? await runCommand("/bin/zsh", ["-lc", verifyCmd], cwd)
          : await (async () => {
              const smoke = await runSmokeVerify();
              return {
                ok: smoke.ok,
                exitCode: smoke.exitCode ?? (smoke.ok ? 0 : 1),
                stdout: smoke.stdout,
                stderr: smoke.stderr,
                label: smoke.label
              };
            })();

        const label = verifyCmd ? verifyCmd : `SMOKE: ${(result.label ?? "smoke").toString()}`;
        const exitCode = Number.isFinite(result.exitCode) ? result.exitCode : result.ok ? 0 : 1;
        const stdoutTail = trimCharsFromEnd(result.stdout || "", 6000);
        const stderrTail = trimCharsFromEnd(result.stderr || "", 6000);
        const verifyOk = Boolean(result.ok) && exitCode === 0;

        const verifyDetail = `VERIFY_COMMAND:\n${label}\n\nexitCode: ${exitCode}\n\nSTDOUT:\n${stdoutTail}\n\nSTDERR:\n${stderrTail}`.trim();
        // Verify should not claim workspace changes; it is evidence for test execution only.
        const wc = { filesCreated: [], filesModified: [], filesDeleted: [] };
        const verifyEntry = ensureHistoryEntry({
          type: "verify",
          runId: null,
          status: verifyOk ? "success" : "failed",
          summary: verifyOk
            ? `검증: 통과 (exit=${exitCode})`
            : `검증: 실패 (exit=${exitCode})`,
          detail: trimCharsFromEnd(verifyDetail, 8000),
          verifyDecision,
          execution_summary: buildExecutionSummary({
            worldChange: wc,
            result: verifyOk ? "success" : "failed",
            commandsExecuted: [],
            testsExecuted: [label],
            nextSuggestedActions: verifyOk
              ? []
              : ["실패 로그(Verify)를 확인하고 수정 후 재시도"]
          })
        });

        await updateSession(sessionId, (s) => {
          const n = normalizeSession(s);
          const messages = [...(n.messages ?? [])];
          messages.push({
            id: createId(),
            at: new Date().toISOString(),
            kind: "assistant",
            role: "assistant",
            text: verifyOk ? "검증을 완료했습니다. (통과)" : "검증을 완료했습니다. (실패)",
            runId: null
          });
          return {
            ...n,
            messages,
            history: [...(n.history ?? []), verifyEntry],
            pipeline: {
              ...(n.pipeline ?? {}),
              phase: "idle",
              loop: { ...(n.pipeline?.loop ?? {}), step: "evaluate" }
            }
          };
        });

        const refreshed = await loadSession(sessionId);
        const contextPrefix = await buildContextPrefix(refreshed);
        const evalPrompt = buildEvaluatePrompt({
          request: refreshed.request,
          goal: refreshed.pipeline?.goal ?? {},
          plan: refreshed.plan,
          actSummary: refreshed.lastAnswer,
          changedFiles: diffArtifacts?.files ?? [],
          verifySummary: verifyEntry.summary,
          contextPrefix
        });
        if (!state.active) {
          await startRun({
            prompt: evalPrompt,
            modelId: refreshed.modelId,
            kind: "evaluate",
            sessionId
          });
        }
        return;
      }

      if (kind === "verify") {
        // Always evaluate after verify (success/fail).
        const session = await loadSession(sessionId);
        const contextPrefix = await buildContextPrefix(session);
        const evalPrompt = buildEvaluatePrompt({
          request: session.request,
          goal: session.pipeline?.goal ?? {},
          plan: session.plan,
          actSummary: session.lastAnswer,
          changedFiles: diffArtifacts?.files ?? [],
          verifySummary: extractHumanAnswer(runRaw),
          contextPrefix
        });
        if (!state.active) {
          await updateSession(sessionId, (s) => {
            const n = normalizeSession(s);
            return { ...n, pipeline: { ...(n.pipeline ?? {}), loop: { ...(n.pipeline?.loop ?? {}), step: "evaluate" } } };
          });
          await startRun({ prompt: evalPrompt, modelId: session.modelId, kind: "evaluate", sessionId });
        }
        return;
      }

      if (kind === "evaluate") {
        const session = await loadSession(sessionId);
        const loop = session.pipeline?.loop ?? { attempt: 1, maxAttempts: 3 };
        const evalObj = parsedEvaluation ?? null;
        if (!evalObj) {
          await recordDoneAndMemory({
            finalStatus: "failed",
            note: "평가(Evaluate) 결과를 파싱하지 못했습니다.",
            nextAction: {
              type: "needs_user",
              description: "Evaluate 출력 형식이 깨졌습니다. 다시 시도하거나(재실행), 요청을 더 구체화해 주세요.",
              recommended: true
            }
          });
          return;
        }
        let achieved = String(evalObj?.achieved ?? "").toLowerCase() === "yes";
        let next = String(evalObj?.next ?? "").toLowerCase();
        const missing = Array.isArray(evalObj?.missing) ? evalObj.missing : [];
        const suggested = Array.isArray(evalObj?.suggested_actions) ? evalObj.suggested_actions : [];

        // Evidence gate: if the most recent verify failed, we must not treat this as achieved.
        const lastVerify = [...(session.history ?? [])]
          .slice()
          .reverse()
          .find((h) => String(h?.type ?? "").toLowerCase() === "verify");
        const verifyFailed = lastVerify && String(lastVerify.status ?? "").toLowerCase() === "failed";
        const verifyPassed = lastVerify && String(lastVerify.status ?? "").toLowerCase() === "success";
        if (verifyFailed && achieved) {
          achieved = false;
          next = next && next !== "done" ? next : "replan";
        }

        // Evidence gate: for "code" tasks that likely require world changes, don't allow achieved=yes with no world change.
        const lastAct = [...(session.history ?? [])]
          .slice()
          .reverse()
          .find((h) => String(h?.type ?? "").toLowerCase() === "act");
        const actWc = lastAct?.execution_summary?.worldChange ?? null;
        const actChangeCount = actWc
          ? (actWc.filesCreated?.length ?? 0) +
            (actWc.filesModified?.length ?? 0) +
            (actWc.filesDeleted?.length ?? 0)
          : 0;
        if (achieved && requestLikelyNeedsWorldChange(session.request) && actChangeCount === 0) {
          achieved = false;
          next = next && next !== "done" ? next : "replan";
        }

        // Approval sanity: only block for approval_required when requiredApprovals actually exists and isn't satisfied.
        // Some models may emit next=approval_required spuriously; do not trap the user in a fake "approval required" state.
        const neededKeys = Object.entries(session.requiredApprovals ?? {})
          .filter(([, v]) => Boolean(v))
          .map(([k]) => k);
        const approvalsOk = approvalsSatisfied(session.requiredApprovals, session.approvals, session.permission);
        if (next === "approval_required" && neededKeys.length === 0) {
          // If we already have strong evidence (verify passed and/or world change happened), treat it as done.
          if ((verifyPassed && !verifyFailed) || actChangeCount > 0 || !requestLikelyNeedsWorldChange(session.request)) {
            achieved = true;
            next = "done";
          } else {
            next = "needs_user";
          }
        }

        if (achieved || next === "done") {
          await recordDoneAndMemory({
            finalStatus: "success",
            note: "목표를 달성했습니다.",
            nextAction: { type: "auto", description: "", recommended: true }
          });
          return;
        }

        if (next === "approval_required") {
          if (neededKeys.length === 0 || approvalsOk) {
            await recordDoneAndMemory({
              finalStatus: "success",
              note: "승인 없이 완료 가능한 작업으로 판단되어 종료했습니다.",
              nextAction: { type: "auto", description: "", recommended: true }
            });
            return;
          }
          await updateSession(sessionId, (s) => {
            const n = normalizeSession(s);
            return {
              ...n,
              pipeline: {
                ...(n.pipeline ?? {}),
                phase: "needs_approval",
                pendingContinue: true,
                loop: { ...(n.pipeline?.loop ?? {}), step: "evaluate" },
                nextAction: {
                  type: "approval_required",
                  description: neededKeys.length ? `승인이 필요한 항목: ${neededKeys.join(", ")}` : "승인이 필요한 작업이 남아 있습니다.",
                  recommended: true
                }
              }
            };
          });
          await appendMessage(sessionId, {
            role: "assistant",
            kind: "assistant",
            text: "승인이 필요한 작업이 남아 있어 자동 실행을 멈췄습니다. '계속' 또는 '항상 허용'을 선택하면 진행합니다."
          });
          return;
        }

        if (next === "needs_user") {
          await recordDoneAndMemory({
            finalStatus: "failed",
            note: "추가 정보가 필요합니다.",
            nextAction: {
              type: "needs_user",
              description: missing.length ? `부족한 것: ${missing.join(", ")}` : "추가 정보가 필요합니다.",
              recommended: true
            }
          });
          return;
        }

        // Replan/retry
        if (loop.attempt >= loop.maxAttempts) {
          await recordDoneAndMemory({
            finalStatus: "failed",
            note: "재시도 횟수를 초과했습니다.",
            nextAction: {
              type: "needs_user",
              description: "수동으로 방향을 지정해 주세요. (원인/제약/원하는 결과를 추가로 알려주세요)",
              recommended: true
            }
          });
          return;
        }

        const contextPrefix = await buildContextPrefix(session);
        const replanPrompt = buildReplanPrompt({
          request: session.request,
          goal: session.pipeline?.goal ?? {},
          plan: session.plan,
          evaluation: evalObj ?? { missing, reason: "" },
          lastFailure: session.pipeline?.loop?.lastFailure ?? null,
          contextPrefix
        });
        if (!state.active) {
          await updateSession(sessionId, (s) => {
            const n = normalizeSession(s);
            return {
              ...n,
              pipeline: {
                ...(n.pipeline ?? {}),
                loop: { ...(n.pipeline?.loop ?? {}), step: "replan" },
                nextAction: { type: "auto", description: suggested[0] ? `다음 시도: ${suggested[0]}` : "재계획 중", recommended: true }
              }
            };
          });
          await startRun({ prompt: replanPrompt, modelId: session.modelId, kind: "replan", sessionId });
        }
        return;
      }

      if (kind === "replan" && status === "success") {
        const session = await loadSession(sessionId);
        const loop = session.pipeline?.loop ?? { attempt: 1, maxAttempts: 3 };
        const nextAttempt = Math.max(1, (Number(loop.attempt) || 1) + 1);
        const approvalsOk = approvalsSatisfied(session.requiredApprovals, session.approvals, session.permission);
        if (!approvalsOk) {
          await updateSession(sessionId, (s) => {
            const n = normalizeSession(s);
            return {
              ...n,
              pipeline: {
                ...(n.pipeline ?? {}),
                phase: "needs_approval",
                pendingContinue: true,
                loop: { ...(n.pipeline?.loop ?? {}), step: "replan", attempt: nextAttempt },
                nextAction: { type: "approval_required", description: "재시도 전에 승인이 필요합니다.", recommended: true }
              }
            };
          });
          await appendMessage(sessionId, {
            role: "assistant",
            kind: "assistant",
            text: "재시도 전에 승인이 필요한 작업이 포함되어 자동 실행을 멈췄습니다."
          });
          return;
        }

        if (!state.active) {
          await updateSession(sessionId, (s) => {
            const n = normalizeSession(s);
            return { ...n, pipeline: { ...(n.pipeline ?? {}), loop: { ...(n.pipeline?.loop ?? {}), step: "act", attempt: nextAttempt } } };
          });

          const contextPrefix = await buildContextPrefix(session);
          const { text: rewrittenRequest } = rewriteWorkspacePaths(session.request);
          const actPrompt = buildActPrompt({
            request: rewrittenRequest,
            plan: session.plan,
            approvals: session.approvals,
            permission: session.permission,
            contextPrefix
          });
          await startRun({ prompt: actPrompt, modelId: session.modelId, kind: "act", sessionId });
        }
        return;
      }
    }
  };

  agent.on("close", (code) => {
    const stopped = Boolean(state.active?.stopRequested);
    const timedOut = Boolean(state.active?.timeoutRequested);
    const status = timedOut ? "failed" : stopped ? "cancelled" : code === 0 ? "success" : "failed";
    finish(status, code, { timedOut }).catch(() => {});
  });

  agent.on("error", () => {
    const timedOut = Boolean(state.active?.timeoutRequested);
    finish("failed", 1, { timedOut }).catch(() => {});
  });

  return meta;
};

app.get("/api/health", async (_req, res) => {
  const running = Boolean(state.active);
  if (!running) return res.json({ ok: true, running: false });
  const activeMeta = state.active?.metaPath ? await readJson(state.active.metaPath).catch(() => null) : null;
  res.json({
    ok: true,
    running: true,
    activeRunId: activeMeta?.id ?? state.active?.id ?? null,
    activeSessionId: activeMeta?.sessionId ?? null,
    activeKind: activeMeta?.kind ?? null
  });
});

app.get("/api/capabilities", async (_req, res) => {
  const reg = await readCapabilityRegistry();
  res.json(reg);
});

app.post("/api/self-improve/run", async (_req, res) => {
  if (selfImproveState.running) {
    return res.status(409).json({ error: "self_improve_running" });
  }
  if (state.active) {
    return res.status(409).json({ error: "agent_running" });
  }
  try {
    await ensureDirs();
    const outDir = path.join(DATA_DIR, "self-improve");
    await fsp.mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const logPath = path.join(outDir, `server-${stamp}.log`);
    const scriptPath = path.join(WORKSPACE, "scripts/self_improve/run_self_improve.mjs");
    const child = spawn(process.execPath, [scriptPath], {
      cwd: WORKSPACE,
      env: {
        ...process.env,
        SELF_IMPROVE_BASE_URL: `http://127.0.0.1:${Number(process.env.PORT ?? 4310)}`
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    selfImproveState.running = true;
    selfImproveState.child = child;
    selfImproveState.startedAt = new Date().toISOString();
    selfImproveState.logPath = logPath;

    const out = fs.createWriteStream(logPath, { flags: "a" });
    child.stdout.pipe(out);
    child.stderr.pipe(out);

    child.on("close", () => {
      selfImproveState.running = false;
      selfImproveState.child = null;
    });

    return res.json({ ok: true, startedAt: selfImproveState.startedAt, logPath });
  } catch {
    return res.status(500).json({ error: "failed_to_start" });
  }
});

app.get("/api/self-improve/status", async (_req, res) => {
  const tail = await readTailText(selfImproveState.logPath, 20_000);
  res.json({
    ok: true,
    running: Boolean(selfImproveState.running),
    startedAt: selfImproveState.startedAt,
    logPath: selfImproveState.logPath,
    tail
  });
});

app.post("/api/self-improve/stop", async (_req, res) => {
  if (!selfImproveState.running || !selfImproveState.child) {
    return res.status(409).json({ error: "not_running" });
  }
  try {
    selfImproveState.child.kill("SIGTERM");
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "stop_failed" });
  }
});

app.get("/api/config", async (_req, res) => {
  try {
    const cfg = await loadConfig();
    const models = await listModels();
    const presets = await getPresetMap();
    const workspaceDir = cfg?.agents?.defaults?.workspace ?? WORKSPACE;
    const sandboxRoot = cfg?.agents?.defaults?.sandbox?.workspaceRoot ?? null;
    const gateway = cfg?.gateway ?? {};
    res.json({
      workspaceDir,
      sandboxRoot,
      gateway: {
        port: gateway.port,
        bind: gateway.bind,
        mode: gateway.mode,
        authMode: gateway?.auth?.mode,
        authToken: maskToken(gateway?.auth?.token),
        remoteUrl: gateway?.remote?.url ?? null,
        remoteToken: maskToken(gateway?.remote?.token)
      },
      models,
      presets
    });
  } catch {
    res.status(500).json({ error: "failed_to_load_config" });
  }
});

app.get("/api/models", async (_req, res) => {
  try {
    const models = await listModels();
    res.json({ models });
  } catch {
    res.status(500).json({ error: "failed_to_load_models" });
  }
});

app.get("/api/mcp/servers", async (_req, res) => {
  try {
    const cfg = await loadMcpConfig();
    const servers = cfg?.servers ?? {};
    const entries = Object.entries(servers).map(([name, value]) => ({
      name,
      type: value?.type ?? null,
      url: value?.url ?? null
    }));
    res.json({ ok: true, servers: entries });
  } catch {
    res.status(500).json({ ok: false, error: "failed_to_load_mcp_config" });
  }
});

app.post("/api/mcp/:server/tools/list", async (req, res) => {
  const serverName = String(req.params.server ?? "").trim();
  if (!serverName) return res.status(400).json({ ok: false, error: "server_required" });
  const resp = await getMcpTools(serverName);
  if (!resp.ok) {
    // Helpful hint for Figma MCP (common case)
    let hint = null;
    if (serverName === "figma-desktop") {
      const server = await getMcpServer(serverName);
      const url = String(server?.url ?? "");
      const detail = String(resp.detail ?? "").toLowerCase();
      if (url.includes("mcp.figma.com") && (detail.includes("unauthorized") || detail.includes("forbidden"))) {
        hint =
          "Figma MCP 인증이 필요합니다. 토큰을 `WORKSPACE/.secrets/figma.token`(1줄)로 저장하거나 환경변수 `FIGMA_OAUTH_TOKEN`을 설정한 뒤 다시 시도하세요.";
      } else {
        hint =
          "Figma Desktop에서 Dev Mode를 켠 뒤, MCP Server(로컬) 기능이 활성화되어 있어야 합니다. (예: http://127.0.0.1:3845/mcp)";
      }
    }
    return res.status(502).json({ ok: false, error: resp.error, detail: resp.detail ?? null, hint });
  }
  const tools = (resp.tools ?? []).map((t) => ({
    name: t?.name ?? null,
    description: t?.description ?? null,
    inputSchema: t?.inputSchema ?? t?.input_schema ?? null
  }));
  return res.json({ ok: true, tools });
});

app.post("/api/mcp/:server/tools/call", async (req, res) => {
  const serverName = String(req.params.server ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const args = req.body?.arguments ?? {};
  if (!serverName) return res.status(400).json({ ok: false, error: "server_required" });
  if (!name) return res.status(400).json({ ok: false, error: "tool_name_required" });

  const resp = await mcpJsonRpc({
    serverName,
    method: "tools/call",
    params: { name, arguments: args }
  });
  if (!resp.ok) {
    return res.status(502).json({ ok: false, error: resp.error, detail: resp.detail ?? null });
  }
  const text = extractMcpText(resp.result);
  return res.json({ ok: true, result: resp.result ?? null, text });
});

app.get("/api/sessions", async (_req, res) => {
  const sessions = await listSessions();
  res.json(sessions);
});

app.get("/api/sessions/:id", async (req, res) => {
  try {
    const session = await loadSession(req.params.id);
    res.json(session);
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});

app.delete("/api/sessions/:id", async (req, res) => {
  const sessionId = String(req.params.id ?? "").trim();
  if (!sessionId) return res.status(400).json({ error: "session_required" });
  const activeMeta =
    state.active?.metaPath ? await readJson(state.active.metaPath).catch(() => null) : null;
  if (activeMeta?.sessionId === sessionId) {
    return res.status(409).json({ error: "in_progress" });
  }
  try {
    const ok = await trashSessionFile(sessionId);
    if (!ok) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true, deletedId: sessionId });
  } catch {
    return res.status(500).json({ error: "delete_failed" });
  }
});

app.patch("/api/sessions/:id/project", async (req, res) => {
  const sessionId = String(req.params.id ?? "").trim();
  if (!sessionId) return res.status(400).json({ error: "session_required" });
  const id = String(req.body?.id ?? "").trim();
  const type = normalizeProjectType(req.body?.type);
  const value = String(req.body?.value ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  if (!value) return res.status(400).json({ error: "project_value_required" });
  try {
    const updated = await updateSession(sessionId, (session) => {
      const normalized = normalizeSession(session);
      return {
        ...normalized,
        project: normalizeProjectRef({
          ...normalized.project,
          id: id || undefined,
          type,
          value,
          name: name || undefined
        })
      };
    });
    return res.json({ ok: true, session: updated });
  } catch {
    return res.status(404).json({ error: "not_found" });
  }
});

app.post("/api/chat/new", async (req, res) => {
  if (state.active) {
    return res.status(409).json({ error: "already_running" });
  }
  try {
    const agentModeRaw = String(req.body?.agentMode ?? "ask").trim().toLowerCase();
    const agentMode = agentModeRaw === "plan" || agentModeRaw === "code" ? agentModeRaw : "ask";
    const permission = normalizePermission(req.body?.permission ?? DEFAULT_PERMISSION);
    const requestedModelId = String(req.body?.modelId ?? "").trim();
    const models = await listModels();
    const effectiveModel =
      requestedModelId && models.some((m) => m.id === requestedModelId)
        ? requestedModelId
        : pickModelId(agentMode, models);
    if (!effectiveModel) {
      return res.status(503).json({
        error: "model_unavailable",
        mode: agentMode,
        requiredModel: AGENT_MODELS[agentMode] ?? null
      });
    }
    const modelPreset = agentModeToPreset(agentMode);
    const session = await createSession({
      title: "New chat",
      request: "",
      modelPreset,
      modelId: effectiveModel,
      approvals: req.body?.approvals,
      agentMode,
      permission,
      project: req.body?.project
    });
    res.json({ session });
  } catch {
    res.status(500).json({ error: "failed_to_create" });
  }
});

app.post("/api/chat/send", async (req, res) => {
  const messageRaw = String(req.body?.message ?? "").trim();
  const incomingSessionId = String(req.body?.sessionId ?? "").trim();
  const permissionRaw = req.body?.permission;
  const permission = permissionRaw === undefined ? null : normalizePermission(permissionRaw);
  const requestedAgentMode = String(req.body?.agentMode ?? "").trim().toLowerCase();
  const explicitMode =
    requestedAgentMode === "ask" || requestedAgentMode === "plan" || requestedAgentMode === "code";
  const inferred = inferAgentMode(messageRaw);
  const agentMode =
    explicitMode
      ? requestedAgentMode
      : inferred.mode;
  const message = inferred.text.trim();
  const requestedModelId = String(req.body?.modelId ?? "").trim();
  const models = await listModels();
  const effectiveModel =
    requestedModelId && models.some((m) => m.id === requestedModelId)
      ? requestedModelId
      : pickModelId(agentMode, models);
  if (!effectiveModel) {
    return res.status(503).json({
      error: "model_unavailable",
      mode: agentMode,
      requiredModel: AGENT_MODELS[agentMode] ?? null
    });
  }
  const modelPreset = agentModeToPreset(agentMode);
  const planMode = agentMode === "plan" ? true : Boolean(req.body?.planMode);

  if (!message) {
    return res.status(400).json({ error: "message_required" });
  }
  if (state.active) {
    return res.status(409).json({ error: "already_running" });
  }

  try {
    let sessionId = incomingSessionId;
    if (!sessionId) {
      const session = await createSession({
        request: message,
        modelPreset,
        modelId: effectiveModel,
        approvals: req.body?.approvals,
        agentMode,
        permission: permission ?? DEFAULT_PERMISSION,
        project: req.body?.project
      });
      sessionId = session.id;
      await updateSession(sessionId, (s) => ({
        ...normalizeSession(s),
        pipeline: {
          ...(s.pipeline ?? {}),
          planOnly: planMode,
          auto: !planMode,
          phase: agentMode === "ask" ? "acting" : "planning",
          pendingContinue: false
        }
      }));
    } else {
      const existing = await loadSession(sessionId);
      const lockedCode = isLockedCodeThread(existing);
      // Any ask inside a locked code-thread is treated as an inline follow-up question.
      // It must not overwrite request/mode/pipeline, regardless of whether the mode was explicit.
      const followupAsk = lockedCode && agentMode === "ask";

      await appendMessage(sessionId, { role: "user", kind: "user", text: message });

      await updateSession(sessionId, (s) => {
        const normalized = normalizeSession(s);
        // Follow-up 질문(ask)은 code-thread의 request/mode/state를 덮어쓰지 않는다.
        if (followupAsk) {
          return {
            ...normalized,
            permission: permission ?? normalized.permission,
            approvals: { ...normalized.approvals, ...(req.body?.approvals ?? {}) }
          };
        }

        const title =
          normalized.title && normalized.title !== "New chat"
            ? normalized.title
            : message.slice(0, 60) || "New chat";
        return {
          ...normalized,
          title,
          status: agentMode === "ask" ? "running" : "planning",
          request: message,
          modelPreset,
          modelId: effectiveModel,
          agentMode,
          permission: permission ?? normalized.permission,
          project:
            req.body?.project && typeof req.body.project === "object"
              ? normalizeProjectRef({
                  ...normalized.project,
                  ...req.body.project
                })
              : normalized.project,
          approvals: { ...normalized.approvals, ...(req.body?.approvals ?? {}) },
          pipeline: {
            ...(normalized.pipeline ?? {}),
            planOnly: planMode,
            auto: !planMode,
            phase: agentMode === "ask" ? "acting" : "planning",
            pendingContinue: false
          }
        };
      });
    }

    // Optional: If the user provided a Figma URL, pull a small amount of design context via MCP once,
    // store it in the session, and inject into subsequent prompts.
    const figmaRef = extractFigmaRef(message);
    if (figmaRef) {
      const ctx = await buildFigmaMcpContext(message);
      if (ctx.ok && ctx.text) {
        await updateSession(sessionId, (s) => {
          const normalized = normalizeSession(s);
          return {
            ...normalized,
            pipeline: {
              ...(normalized.pipeline ?? {}),
              mcpContext: {
                ...(normalized.pipeline?.mcpContext ?? {}),
                figma: {
                  ok: true,
                  ref: ctx.ref ?? figmaRef,
                  fetchedAt: new Date().toISOString(),
                  text: ctx.text
                }
              }
            }
          };
        });
        await appendMessage(sessionId, {
          role: "assistant",
          kind: "assistant",
          text: "Figma MCP에서 디자인 정보를 불러왔습니다. 이 컨텍스트를 바탕으로 작업을 진행합니다."
        });
      } else {
        await updateSession(sessionId, (s) => {
          const normalized = normalizeSession(s);
          return {
            ...normalized,
            pipeline: {
              ...(normalized.pipeline ?? {}),
              mcpContext: {
                ...(normalized.pipeline?.mcpContext ?? {}),
                figma: {
                  ok: false,
                  ref: ctx.ref ?? figmaRef,
                  fetchedAt: new Date().toISOString(),
                  error: ctx.error ?? "unknown",
                  detail: String(ctx.detail ?? "").slice(0, 800)
                }
              }
            }
          };
        });

        const hint =
          ctx.error === "mcp_unreachable" || ctx.error === "mcp_timeout"
            ? "Figma Desktop 앱에서 Dev Mode를 켠 뒤, MCP Server(로컬) 기능을 활성화해야 합니다. (보통 http://127.0.0.1:3845/mcp)"
            : ctx.error === "figma_node_not_found"
              ? "Figma Desktop에서 해당 문서를 열고 활성 탭으로 만든 뒤, 해당 프레임/컴포넌트를 클릭(선택)하고 다시 실행해 주세요."
            : ctx.error === "no_usable_figma_tools"
              ? "Figma MCP에 연결은 됐지만 사용할 수 있는 도구를 자동으로 고르지 못했습니다. `POST /api/mcp/figma-desktop/tools/list`로 도구 목록을 확인한 뒤, 어떤 도구를 쓸지 지정해 주세요."
              : "Figma MCP 컨텍스트를 자동으로 가져오지 못했습니다.";

        await appendMessage(sessionId, {
          role: "assistant",
          kind: "assistant",
          text: `Figma MCP 컨텍스트를 불러오지 못했습니다. (${ctx.error ?? "unknown"})\n\n힌트: ${hint}`
        });

        await updateSession(sessionId, (s) => {
          const n = normalizeSession(s);
          return {
            ...n,
            status: "failed",
            pipeline: {
              ...(n.pipeline ?? {}),
              phase: "needs_user",
              nextAction: {
                type: "needs_user",
                description: "Figma Desktop에서 노드를 선택한 뒤 다시 요청하세요.",
                recommended: true
              }
            }
          };
        });

        // If the request includes a Figma link and we couldn't load MCP context, do not continue
        // to run LLM steps that will stall or hallucinate. Ask the user to fix MCP first.
        // (The UI can keep the thread; user action is required.)
        return res.json({ session: await loadSession(sessionId), run: null, rewritten: false });
      }
    }

    // Web RAG (URL-based): if the user included URLs, fetch + retrieve a small grounded context block.
    const urls = extractUrls(message, 2);
    if (urls.length) {
      const rag = await buildWebRagContext(message);
      await updateSession(sessionId, (s) => {
        const n = normalizeSession(s);
        return {
          ...n,
          pipeline: {
            ...(n.pipeline ?? {}),
            rag: {
              ...(n.pipeline?.rag ?? {}),
              urls: rag.ok ? (rag.urls ?? urls) : urls,
              references: rag.ok ? (rag.references ?? []) : [],
              fetchedAt: new Date().toISOString(),
              webContext: rag.ok ? (rag.webContext ?? "") : "",
              method: rag.ok ? (rag.method ?? "unknown") : "none",
              error: rag.ok ? null : rag.error ?? "fetch_failed"
            }
          }
        };
      });
    }

    const session = await loadSession(sessionId);
    const contextPrefix = await buildContextPrefix(session);
    const { text: rewrittenPrompt, rewritten } = rewriteWorkspacePaths(message);

    if (agentMode === "ask") {
      const direct = await askDirectFromOllama({
        modelId: effectiveModel,
        request: rewrittenPrompt
      });
      if (direct) {
        await appendMessage(sessionId, {
          role: "assistant",
          kind: "assistant",
          text: direct
        });
        await updateSession(sessionId, (s) => {
          const n = normalizeSession(s);
          const history = [
            ...(n.history ?? []),
            ensureHistoryEntry({
              type: "ask",
              runId: null,
              status: "success",
              summary: toOneLine(direct, 160),
              detail: direct,
              execution_summary: buildExecutionSummary({
                worldChange: { filesCreated: [], filesModified: [], filesDeleted: [] },
                result: "success",
                commandsExecuted: [],
                testsExecuted: [],
                nextSuggestedActions: []
              })
            })
          ];
          return {
            ...n,
            status: "success",
            lastAnswer: direct,
            history,
            pipeline: {
              ...(n.pipeline ?? {}),
              phase: "done",
              pendingContinue: false,
              activeRunId: null,
              nextAction: { type: "auto", description: "", recommended: true }
            }
          };
        });
        return res.json({ session: await loadSession(sessionId), run: null, rewritten });
      }

      if (await isDockerLikelyUnavailable()) {
        const fallbackText =
          "현재 Docker 엔진이 비활성 상태라 Ask 런타임을 시작하지 못했습니다. Docker Desktop을 켠 뒤 다시 요청해 주세요.";
        await appendMessage(sessionId, {
          role: "assistant",
          kind: "assistant",
          text: fallbackText
        });
        await updateSession(sessionId, (s) => {
          const n = normalizeSession(s);
          return {
            ...n,
            status: "success",
            lastAnswer: fallbackText,
            pipeline: {
              ...(n.pipeline ?? {}),
              phase: "done",
              pendingContinue: false,
              activeRunId: null,
              nextAction: { type: "needs_user", description: "Docker Desktop 실행 후 다시 시도해 주세요.", recommended: true }
            }
          };
        });
        return res.json({ session: await loadSession(sessionId), run: null, rewritten });
      }
      const askPrompt = buildAskPrompt({ request: rewrittenPrompt, contextPrefix });
      const run = await startRun({
        prompt: askPrompt,
        modelId: effectiveModel,
        kind: "ask",
        sessionId,
        preserveSessionState: isLockedCodeThread(session)
      });
      return res.json({ session: await loadSession(sessionId), run, rewritten });
    }

    const planPrompt = buildPlanPrompt({ request: rewrittenPrompt, contextPrefix });
    const run = await startRun({
      prompt: planPrompt,
      modelId: effectiveModel,
      kind: "plan",
      sessionId
    });
    return res.json({ session: await loadSession(sessionId), run, rewritten });
  } catch {
    res.status(500).json({ error: "failed_to_start" });
  }
});

app.post("/api/chat/continue", async (req, res) => {
  const sessionId = String(req.body?.sessionId ?? "").trim();
  const planOverride = String(req.body?.plan ?? "").trim();
  const approvals = req.body?.approvals ?? {};
  const permissionRaw = req.body?.permission;
  const permission = permissionRaw === undefined ? null : normalizePermission(permissionRaw);

  if (!sessionId) {
    return res.status(400).json({ error: "session_required" });
  }
  if (state.active) {
    return res.status(409).json({ error: "already_running" });
  }

  try {
    const session = await loadSession(sessionId);
    const effectiveModel = String(req.body?.modelId ?? session.modelId ?? "");

    const nextPlan = planOverride || session.plan || "";
    await updateSession(sessionId, (current) => ({
      ...normalizeSession(current),
      plan: nextPlan,
      planEdited: Boolean(planOverride) && planOverride !== (current.plan ?? ""),
      approvals: { ...current.approvals, ...approvals },
      permission: permission ?? current.permission,
      pipeline: {
        ...(current.pipeline ?? {}),
        planOnly: false,
        auto: true,
        pendingContinue: false
      }
    }));

    const refreshed = await loadSession(sessionId);
    const approvalsOk = approvalsSatisfied(
      refreshed.requiredApprovals,
      refreshed.approvals,
      refreshed.permission
    );
    if (!approvalsOk) {
      await updateSession(sessionId, (s) => ({
        ...normalizeSession(s),
        pipeline: { ...(s.pipeline ?? {}), phase: "needs_approval", pendingContinue: true }
      }));
      return res.status(409).json({ error: "needs_approval" });
    }

    // Resume code-mode loop by moving to act step.
    if (refreshed.agentMode === "code") {
      await updateSession(sessionId, (s) => {
        const n = normalizeSession(s);
        const attempt = Math.max(1, Number(n.pipeline?.loop?.attempt ?? 0) || 0);
        return {
          ...n,
          status: "running",
          pipeline: {
            ...(n.pipeline ?? {}),
            phase: "idle",
            pendingContinue: false,
            loop: { ...(n.pipeline?.loop ?? {}), step: "act", attempt },
            nextAction: { type: "auto", description: "", recommended: true }
          }
        };
      });
    }

    const contextPrefix = await buildContextPrefix(refreshed);
    const { text: rewrittenRequest, rewritten } = rewriteWorkspacePaths(refreshed.request);
    const actPrompt = buildActPrompt({
      request: rewrittenRequest,
      plan: refreshed.plan,
      approvals: refreshed.approvals,
      permission: refreshed.permission,
      contextPrefix
    });

    const run = await startRun({
      prompt: actPrompt,
      modelId: effectiveModel,
      kind: "act",
      sessionId
    });
    res.json({ run, rewritten });
  } catch {
    res.status(500).json({ error: "failed_to_start" });
  }
});

app.post("/api/plan", async (req, res) => {
  const request = String(req.body?.request ?? "").trim();
  const modelPreset = String(req.body?.modelPreset ?? "assistant");
  const modelId = String(req.body?.modelId ?? "").trim();
  if (!request) {
    return res.status(400).json({ error: "request_required" });
  }
  if (state.active) {
    return res.status(409).json({ error: "already_running" });
  }
  try {
    const presets = await getPresetMap();
    const effectiveModel = modelId || presets[modelPreset] || modelId;
    const session = await createSession({
      request,
      modelPreset,
      modelId: effectiveModel,
      approvals: req.body?.approvals,
      project: req.body?.project
    });
    const { text: rewrittenPrompt, rewritten } = rewriteWorkspacePaths(request);
    const contextPrefix = await buildContextPrefix(session);
    const planPrompt = buildPlanPrompt({ request: rewrittenPrompt, contextPrefix });
    const run = await startRun({
      prompt: planPrompt,
      modelId: effectiveModel,
      kind: "plan",
      sessionId: session.id
    });
    res.json({ session, run, rewritten });
  } catch {
    res.status(500).json({ error: "failed_to_start" });
  }
});

app.post("/api/act", async (req, res) => {
  const sessionId = String(req.body?.sessionId ?? "").trim();
  const plan = String(req.body?.plan ?? "").trim();
  const approvals = req.body?.approvals ?? {};
  if (!sessionId) {
    return res.status(400).json({ error: "session_required" });
  }
  if (state.active) {
    return res.status(409).json({ error: "already_running" });
  }
  try {
    const session = await loadSession(sessionId);
    const effectiveModel = String(req.body?.modelId ?? session.modelId ?? "");
    const { text: rewrittenRequest, rewritten } = rewriteWorkspacePaths(
      session.request
    );
    const contextPrefix = await buildContextPrefix(session);
    const actPrompt = buildActPrompt({
      request: rewrittenRequest,
      plan,
      approvals,
      permission: session.permission,
      contextPrefix
    });
    await updateSession(sessionId, (current) => ({
      ...current,
      plan,
      planEdited: plan !== (current.plan ?? ""),
      approvals: { ...current.approvals, ...approvals }
    }));
    const run = await startRun({
      prompt: actPrompt,
      modelId: effectiveModel,
      kind: "act",
      sessionId
    });
    res.json({ run, rewritten });
  } catch {
    res.status(500).json({ error: "failed_to_start" });
  }
});

app.get("/api/runs", async (_req, res) => {
  const runs = await listRuns();
  res.json(runs);
});

app.get("/api/runs/:id", async (req, res) => {
  const metaPath = path.join(RUNS_DIR, `${req.params.id}.json`);
  try {
    const meta = await readJson(metaPath);
    res.json(meta);
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});

app.post("/api/runs/:id/stop", async (req, res) => {
  if (!state.active || !state.active.agent) {
    return res.status(409).json({ error: "not_running" });
  }
  const runId = String(req.params.id ?? "").trim();
  const activeMeta = state.active?.metaPath ? await readJson(state.active.metaPath).catch(() => null) : null;
  if (!runId || (activeMeta?.id && activeMeta.id !== runId)) {
    return res.status(409).json({ error: "different_run_active", activeRunId: activeMeta?.id ?? null });
  }
  try {
    const targetRunId = state.active.id;
    const targetPid = Number(state.active.agent.pid || 0);
    state.active.stopRequested = true;
    state.active.agent.kill("SIGTERM");
    // Some OpenClaw runs may ignore SIGTERM; escalate to SIGKILL.
    setTimeout(() => {
      if (!state.active || state.active.id !== targetRunId) return;
      try {
        state.active.timeoutRequested = true;
      } catch {}
      try {
        if (targetPid > 0) {
          spawn("pkill", ["-TERM", "-P", String(targetPid)]);
        }
      } catch {}
      try {
        state.active.agent.kill("SIGKILL");
      } catch {}
      try {
        if (targetPid > 0) {
          spawn("pkill", ["-KILL", "-P", String(targetPid)]);
        }
      } catch {}
    }, 3000);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "stop_failed" });
  }
});

app.get("/api/runs/:id/summary", async (req, res) => {
  try {
    const logPath = path.join(RUNS_DIR, `${req.params.id}.log`);
    const raw = await fsp.readFile(logPath, "utf-8");
    const summary = extractRunSummary(raw);
    res.json(summary);
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});

app.get("/api/runs/:id/log", async (req, res) => {
  const offset = Number(req.query.offset ?? 0);
  const logPath = path.join(RUNS_DIR, `${req.params.id}.log`);
  const chunk = await readLogChunk(logPath, Number.isNaN(offset) ? 0 : offset);
  res.json(chunk);
});

app.get("/api/runs/:id/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let offset = Number(req.query.offset ?? 0);
  if (Number.isNaN(offset)) offset = 0;
  let closed = false;

  const logPath = path.join(RUNS_DIR, `${req.params.id}.log`);
  const metaPath = path.join(RUNS_DIR, `${req.params.id}.json`);

  const send = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const timer = setInterval(async () => {
    if (closed) return;
    const chunk = await readLogChunk(logPath, offset);
    if (chunk.data) {
      send("log", { data: chunk.data, nextOffset: chunk.nextOffset });
      offset = chunk.nextOffset;
    }
    if (chunk.eof) {
      try {
        const meta = await readJson(metaPath);
        if (meta.status !== "running") {
          send("done", { status: meta.status });
          clearInterval(timer);
          res.end();
        }
      } catch {
        // ignore
      }
    }
  }, 1000);

  req.on("close", () => {
    closed = true;
    clearInterval(timer);
  });
});

app.get("/api/runs/:id/tools", async (req, res) => {
  const metaPath = path.join(RUNS_DIR, `${req.params.id}.json`);
  try {
    const meta = await readJson(metaPath);
    const logPath = meta.gatewayLogPath ?? getGatewayLogPath();
    const raw = await readTail(logPath, 2_000_000);
    let events = parseToolEvents(raw);

    if (!events.length) {
      const openclawDir = OPENCLAW_LOG_DIR;
      const files = await fsp.readdir(openclawDir).catch(() => []);
      const candidates = files
        .filter((name) => name.startsWith("openclaw-") && name.endsWith(".log"))
        .map((name) => path.join(openclawDir, name))
        .sort();
      const sessionId = meta.openclawSessionId ?? `ui-${req.params.id}`;
      for (const candidate of candidates.reverse()) {
        const tail = await readTail(candidate, 2_000_000);
        const runId = findRunIdForSession(tail, sessionId);
        if (!runId) continue;
        events = parseToolEvents(tail, runId);
        if (events.length) break;
      }
    }

    res.json({ events });
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});

app.get("/api/runs/:id/artifacts", async (_req, res) => {
  try {
    const runId = String(_req.params.id ?? "").trim();
    if (runId) {
      const metaPath = path.join(RUNS_DIR, `${runId}.json`);
      const meta = await readJson(metaPath).catch(() => null);
      if (meta?.artifacts) {
        return res.json({
          files: meta.artifacts.files ?? [],
          diff: meta.artifacts.diff ?? "",
          baselineDirty: Boolean(meta.artifacts.baselineDirty),
          worldChange: meta.artifacts.worldChange ?? null
        });
      }
    }
    const diffArtifacts = await getDiffArtifacts();
    return res.json({
      files: diffArtifacts.files,
      diff: diffArtifacts.diff,
      baselineDirty: false,
      worldChange: null
    });
  } catch {
    res.status(500).json({ error: "failed_to_collect_artifacts" });
  }
});

app.get("/api/fs/list", async (req, res) => {
  try {
    const inputPath = String(req.query.path ?? "");
    const resolved = resolveClientPath(inputPath);
    const entries = await fsp.readdir(resolved, { withFileTypes: true });
    const result = entries.map((entry) => ({
      name: entry.name,
      path: toClientPath(path.join(resolved, entry.name)),
      type: entry.isDirectory() ? "dir" : "file"
    }));
    res.json({
      path: toClientPath(resolved),
      entries: result
    });
  } catch (err) {
    res.status(400).json({ error: "invalid_path" });
  }
});

app.get("/api/fs/read", async (req, res) => {
  try {
    const inputPath = String(req.query.path ?? "");
    const resolved = resolveClientPath(inputPath);
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) {
      return res.status(400).json({ error: "not_a_file" });
    }
    const limit = Math.min(Number(req.query.limit ?? 20000), 200000);
    const handle = await fsp.open(resolved, "r");
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    await handle.close();
    res.json({
      path: toClientPath(resolved),
      content: buffer.slice(0, bytesRead).toString("utf-8")
    });
  } catch {
    res.status(400).json({ error: "invalid_path" });
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "../dist");

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

const PORT = Number(process.env.PORT ?? 4310);

ensureDirs()
  .then(() => migrateGlobalMemory())
  .catch(() => {})
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`OpenClaw UI server listening on ${PORT}`);
    });
  });
