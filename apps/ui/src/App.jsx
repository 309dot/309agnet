import React, { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "./components/layout/AppShell.jsx";
import SessionList from "./components/sessions/SessionList.jsx";
import PromptComposer from "./components/composer/PromptComposer.jsx";
import TopBarMinimal from "./components/topbar/TopBarMinimal.jsx";
import ChatThread from "./components/chat/ChatThread.jsx";
import ExecutionSteps from "./components/drawer/ExecutionSteps.jsx";

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/$/, "");
const IS_BROWSER = typeof window !== "undefined";
const IS_LOCAL_HOST =
  IS_BROWSER &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");
const API_CONFIGURED = Boolean(API_BASE) || IS_LOCAL_HOST;
const apiHost = (() => {
  try {
    return API_BASE ? new URL(API_BASE).hostname : "";
  } catch {
    return "";
  }
})();
const IS_LOCALTUNNEL = Boolean(apiHost) && apiHost.endsWith(".loca.lt");
const TUNNEL_HEADERS = IS_LOCALTUNNEL ? { "x-localtunnel-bypass": "1" } : {};
const USE_CREDENTIALS =
  API_BASE &&
  apiHost &&
  !apiHost.endsWith(".loca.lt") &&
  !apiHost.endsWith(".trycloudflare.com");
const apiUrl = (path) => (API_BASE ? `${API_BASE}${path}` : path);
const apiFetch = (path, init) =>
  fetch(apiUrl(path), {
    ...(init ?? {}),
    credentials: API_BASE
      ? USE_CREDENTIALS
        ? "include"
        : "omit"
      : init?.credentials
    ,
    headers: {
      ...(TUNNEL_HEADERS ?? {}),
      ...((init?.headers ?? {}) || {})
    }
  });

const summarizeLog = (logText, lineCount = 6) => {
  if (!logText) return "아직 로그가 없습니다.";
  const lines = logText
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length);
  if (!lines.length) return "아직 로그가 없습니다.";
  return lines.slice(-lineCount).join("\n");
};

const DEFAULT_PROJECT = {
  id: "default",
  name: "wOpenclaw",
  type: "path",
  value: "/Users/a309/Documents/Agent309/wOpenclaw"
};

const normalizeProjectType = (value) => (value === "git" ? "git" : "path");

const buildProjectId = (type, value) => {
  const key = `${normalizeProjectType(type)}:${String(value ?? "").trim()}`;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return `p-${Math.abs(hash).toString(16)}`;
};

const projectNameFromValue = (type, value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unnamed project";
  if (type === "git") {
    const cleaned = raw.replace(/\.git$/i, "").replace(/\/+$/, "");
    const parts = cleaned.split("/").filter(Boolean);
    return parts[parts.length - 1] || cleaned;
  }
  const cleaned = raw.replace(/\/+$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  return parts[parts.length - 1] || cleaned;
};

const normalizeProjectRef = (project) => {
  if (!project || typeof project !== "object") return { ...DEFAULT_PROJECT };
  const type = normalizeProjectType(project.type);
  const value = String(project.value ?? "").trim();
  if (!value) return { ...DEFAULT_PROJECT };
  return {
    id: String(project.id ?? "").trim() || buildProjectId(type, value),
    name: String(project.name ?? "").trim() || projectNameFromValue(type, value),
    type,
    value
  };
};

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [manualProjects, setManualProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("default");
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [sessionDetail, setSessionDetail] = useState(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [log, setLog] = useState("");
  const [lastLogAt, setLastLogAt] = useState(null);
  const [diff, setDiff] = useState("");
  const [changedFiles, setChangedFiles] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [permissionDefault, setPermissionDefault] = useState("full"); // basic|full (이 브라우저 저장)
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [health, setHealth] = useState({ ok: true, running: false });
  const [stopping, setStopping] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);

  const lastSessionIdRef = useRef(null);
  const runWatchRef = useRef({ runId: null, startedAt: 0 });
  const sessionsRef = useRef([]);
  const missingApiNotice =
    "웹 배포에서는 API 서버 주소가 필요합니다. Vercel 환경변수 VITE_API_BASE_URL을 설정하고 다시 배포하세요.";
  const authApiNotice = API_BASE
    ? `API 터널 인증/연결이 필요합니다. 아래 주소를 새 탭에서 열어 확인한 뒤 다시 시도하세요: ${API_BASE}`
    : "API 터널 인증/연결이 필요합니다.";

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("309agent.projects");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const normalized = parsed
        .map((item) => normalizeProjectRef(item))
        .filter((item) => item.id !== DEFAULT_PROJECT.id);
      setManualProjects(normalized);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("309agent.projects", JSON.stringify(manualProjects));
    } catch {
      // ignore
    }
  }, [manualProjects]);

  const sessionsWithProject = useMemo(
    () =>
      (sessions ?? []).map((session) => ({
        ...session,
        project: normalizeProjectRef(session.project),
        lastActivityAt: session.lastActivityAt || session.createdAt || null
      })),
    [sessions]
  );

  const projectBuckets = useMemo(() => {
    const map = new Map();
    map.set(DEFAULT_PROJECT.id, { ...DEFAULT_PROJECT, sessions: [] });
    for (const project of manualProjects) {
      map.set(project.id, { ...project, sessions: [] });
    }
    for (const session of sessionsWithProject) {
      const project = normalizeProjectRef(session.project);
      if (!map.has(project.id)) {
        map.set(project.id, { ...project, sessions: [] });
      }
      map.get(project.id).sessions.push(session);
    }
    return [...map.values()].sort((a, b) => {
      if (a.id === DEFAULT_PROJECT.id) return -1;
      if (b.id === DEFAULT_PROJECT.id) return 1;
      const aRecent = (a.sessions ?? [])
        .map((s) => Date.parse(s.lastActivityAt || s.createdAt || ""))
        .filter((n) => Number.isFinite(n))
        .sort((x, y) => y - x)[0] ?? 0;
      const bRecent = (b.sessions ?? [])
        .map((s) => Date.parse(s.lastActivityAt || s.createdAt || ""))
        .filter((n) => Number.isFinite(n))
        .sort((x, y) => y - x)[0] ?? 0;
      if (aRecent !== bRecent) return bRecent - aRecent;
      return a.name.localeCompare(b.name);
    });
  }, [manualProjects, sessionsWithProject]);

  useEffect(() => {
    if (!activeSessionId) return;
    const active = sessionsWithProject.find((s) => s.id === activeSessionId);
    if (!active?.project?.id) return;
    setSelectedProjectId(active.project.id);
  }, [activeSessionId, sessionsWithProject]);

  useEffect(() => {
    if (projectBuckets.some((p) => p.id === selectedProjectId)) return;
    setSelectedProjectId(DEFAULT_PROJECT.id);
  }, [projectBuckets, selectedProjectId]);

  const activeRun = useMemo(() => {
    const runs = sessionDetail?.runs ?? [];
    if (!runs.length) return null;
    const activeId = sessionDetail?.pipeline?.activeRunId ?? null;
    if (activeId) {
      const found = runs.find((r) => r.id === activeId);
      if (found) return found;
    }
    return [...runs].sort((a, b) =>
      (b.createdAt || "").localeCompare(a.createdAt || "")
    )[0];
  }, [sessionDetail]);

  useEffect(() => {
    const runId = activeRun?.id ?? null;
    if (!runId) return;
    if (runWatchRef.current.runId !== runId) {
      runWatchRef.current = { runId, startedAt: Date.now() };
    }
  }, [activeRun?.id]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("309agent.permissionDefault");
      if (saved === "full") setPermissionDefault("full");
      else if (saved === "basic") setPermissionDefault("basic");
      else setPermissionDefault("full");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1200px)");
    const onChange = () => setIsNarrow(Boolean(mq.matches));
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  useEffect(() => {
    if (!API_CONFIGURED) {
      setHealth({ ok: false, running: false });
      setNotice(missingApiNotice);
    }
  }, [missingApiNotice]);

  useEffect(() => {
    if (!API_CONFIGURED) return;
    let cancelled = false;
    let delayMs = 1000;
    const poll = async () => {
      try {
        const res = await apiFetch("/api/health");
        if (res.status === 511) {
          if (!cancelled) setNotice(authApiNotice);
          if (!cancelled) setHealth({ ok: false, running: false });
          delayMs = 15000;
          if (!cancelled) setTimeout(poll, delayMs);
          return;
        }
        if (!res.ok) throw new Error("bad_status");
        const data = await res.json();
        if (!cancelled) setHealth(data);
        delayMs = 1000;
      } catch {
        if (!cancelled) setHealth({ ok: false, running: false });
        delayMs = Math.min(Math.round(delayMs * 1.8), 15000);
      }
      if (!cancelled) setTimeout(poll, delayMs);
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!API_CONFIGURED) return;
    let mounted = true;
    let delayMs = 2000;
    const fetchSessions = async () => {
      try {
        const res = await apiFetch("/api/sessions");
        if (res.status === 511) {
          if (mounted) setNotice(authApiNotice);
          delayMs = 15000;
          return;
        }
        const data = await res.json();
        if (!mounted) return;
        setSessions(data);
        delayMs = 2000;
        if (!data.length) return;
        if (!activeSessionId) {
          setActiveSessionId(data[0].id);
          return;
        }
        // Active session may have been deleted (404). If so, fall back to the first session.
        if (!data.some((s) => s.id === activeSessionId)) {
          setActiveSessionId(data[0].id);
        }
      } catch {
        delayMs = Math.min(Math.round(delayMs * 1.8), 15000);
      }
    };
    fetchSessions();
    let timer;
    const loop = async () => {
      await fetchSessions();
      if (!mounted) return;
      timer = setTimeout(loop, delayMs);
    };
    timer = setTimeout(loop, delayMs);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (!API_CONFIGURED) return;
    if (!activeSessionId) return;
    let mounted = true;
    let delayMs = 2000;
    const fetchSession = async () => {
      try {
        const res = await apiFetch(`/api/sessions/${activeSessionId}`);
        if (res.status === 511) {
          if (mounted) setNotice(authApiNotice);
          delayMs = 15000;
          return;
        }
        if (res.status === 404) {
          if (!mounted) return;
          setNotice("선택한 세션을 찾을 수 없습니다(삭제됨). 다른 세션으로 전환합니다.");
          setSessionDetail(null);
          setActiveSessionId(null);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        setSessionDetail(data);
        delayMs = 2000;
      } catch {
        delayMs = Math.min(Math.round(delayMs * 1.8), 15000);
      }
    };
    fetchSession();
    let timer;
    const loop = async () => {
      await fetchSession();
      if (!mounted) return;
      timer = setTimeout(loop, delayMs);
    };
    timer = setTimeout(loop, delayMs);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (!sessionDetail?.id) return;
    if (lastSessionIdRef.current !== sessionDetail.id) {
      setDraft("");
      setNotice("");
      setLog("");
      setLastLogAt(null);
      setDiff("");
      setChangedFiles([]);
      lastSessionIdRef.current = sessionDetail.id;
    }
  }, [sessionDetail?.id]);

  const sanitizeUserText = (value) => {
    let text = String(value ?? "");
    if (!text.trim()) return "";
    // Remove tool-call fragments and common meta markers.
    text = text
      .replace(/<tool_call[^>]*>[\s\S]*?<\/tool_call>/g, "")
      .replace(/<tool_call[^>]*>/g, "")
      .replace(/<\/tool_call>/g, "");
    // Drop meta-only lines.
    text = text
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        if (!t) return true;
        if (/^(NEEDS_APPROVAL|CAPABILITY_GAP|GAP_DESC|LEARN_SPEC|EVALUATION_JSON)\s*:/i.test(t)) {
          return false;
        }
        return true;
      })
      .join("\n");
    // If the message looks like broken JSON/object noise, replace it.
    const noisy = (text.match(/[\]\}\{]{1}/g) ?? []).length;
    const letters = (text.match(/[A-Za-z가-힣]/g) ?? []).length;
    if (noisy > 12 && letters < 10) {
      return "(세부 내용은 Developer Drawer에서 확인하세요.)";
    }
    return text.trim();
  };

  const viewMessages = useMemo(() => {
    const base = sessionDetail?.messages ?? [];
    return base
      .filter((m) => m?.role !== "system")
      .map((m) =>
        m?.role === "assistant" ? { ...m, text: sanitizeUserText(m.text) } : m
      )
      .filter((m) => (m?.text ?? "").trim().length > 0);
  }, [sessionDetail?.messages]);

  useEffect(() => {
    if (!API_CONFIGURED) return;
    if (!activeRun) {
      setLog("");
      setLastLogAt(null);
      return;
    }
    setLog("");
    setLastLogAt(null);

    if (!API_BASE || !IS_LOCALTUNNEL) {
      const es = new EventSource(apiUrl(`/api/runs/${activeRun.id}/stream`), {
        withCredentials: Boolean(API_BASE) && Boolean(USE_CREDENTIALS)
      });
      es.addEventListener("log", (event) => {
        const payload = JSON.parse(event.data || "{}");
        if (payload.data) {
          setLog((prev) => prev + payload.data);
          setLastLogAt(Date.now());
        }
      });
      es.addEventListener("done", () => {
        es.close();
      });
      es.onerror = () => {
        es.close();
      };
      return () => {
        es.close();
      };
    }

    // localtunnel can't send custom headers for SSE. Fall back to polling.
    let mounted = true;
    let offset = 0;
    let delayMs = 1000;
    const poll = async () => {
      if (!mounted) return;
      try {
        const res = await apiFetch(`/api/runs/${activeRun.id}/log?offset=${offset}`);
        if (res.status === 511) {
          setNotice(authApiNotice);
          delayMs = 15000;
        } else if (res.ok) {
          const data = await res.json();
          if (data?.data) {
            setLog((prev) => prev + data.data);
            setLastLogAt(Date.now());
          }
          if (typeof data?.nextOffset === "number") offset = data.nextOffset;
          delayMs = 1000;
        }
      } catch {
        delayMs = Math.min(Math.round(delayMs * 1.8), 15000);
      }
      if (mounted) setTimeout(poll, delayMs);
    };
    poll();
    return () => {
      mounted = false;
    };
  }, [activeRun?.id]);

  useEffect(() => {
    if (!API_CONFIGURED) return;
    if (!activeRun || activeRun.status === "running") return;
    if (sessionDetail?.pipeline?.phase !== "done") return;
    const loadArtifacts = async () => {
      try {
        const res = await apiFetch(`/api/runs/${activeRun.id}/artifacts`);
        if (res.ok) {
          const data = await res.json();
          setDiff(data.diff || "");
          setChangedFiles(data.files || []);
        }
      } catch {
        // ignore
      }
    };
    loadArtifacts();
  }, [activeRun?.id, activeRun?.status, sessionDetail?.pipeline?.phase]);

  const actSummary = summarizeLog(log, 6);
  const actLogPreview = summarizeLog(log, 80);

  const globalRunning = Boolean(health?.running);
  const runningThisSession =
    globalRunning && Boolean(sessionDetail?.id) && health?.activeSessionId === sessionDetail?.id;
  const disabledControls = globalRunning || stopping;

  const formatPhaseKo = (phase) => {
    switch (phase) {
      case "planning":
        return "기획";
      case "acting":
        return "작업";
      case "verifying":
        return "검증";
      case "evaluating":
        return "판정";
      case "replanning":
        return "재기획";
      case "needs_approval":
        return "승인 대기";
      case "needs_user":
        return "추가 정보 대기";
      case "done":
        return "완료";
      default:
        return "대기";
    }
  };

  const formatStatusKo = (status) => {
    switch (status) {
      case "success":
        return "완료";
      case "failed":
        return "실패";
      case "cancelled":
        return "중지됨";
      case "running":
        return "실행 중";
      default:
        return "대기";
    }
  };

  const persistPermissionDefault = (next) => {
    const normalized = next === "full" ? "full" : "basic";
    setPermissionDefault(normalized);
    try {
      localStorage.setItem("309agent.permissionDefault", normalized);
    } catch {
      // ignore
    }
  };

  const handleNewChat = async (projectOverride = null) => {
    if (!API_CONFIGURED) {
      setNotice(missingApiNotice);
      return;
    }
    setNotice("");
    if (disabledControls) return;
    const targetProject = normalizeProjectRef(
      projectOverride ??
        projectBuckets.find((project) => project.id === selectedProjectId) ??
        DEFAULT_PROJECT
    );
    try {
        const res = await apiFetch("/api/chat/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permission: permissionDefault,
          project: targetProject
        })
      });
      if (!res.ok) {
        setNotice("새 채팅을 만들지 못했습니다.");
        return;
      }
      const data = await res.json();
      setActiveSessionId(data.session.id);
      setSelectedProjectId(normalizeProjectRef(data.session?.project ?? targetProject).id);
      setDraft("");
    } catch {
      setNotice("서버에 연결할 수 없습니다.");
    }
  };

  const handleDeleteSession = async (sessionId) => {
    if (!API_CONFIGURED) {
      setNotice(missingApiNotice);
      return;
    }
    if (!sessionId) return;
    if (!confirm("이 세션을 삭제할까요?")) return;
    try {
      const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        setNotice(res.status === 409 ? "실행 중인 세션은 삭제할 수 없습니다." : "삭제 실패");
        return;
      }
      if (activeSessionId === sessionId) {
        // 다음 세션을 선택(없으면 새로 생성)
        const next = sessions.find((s) => s.id !== sessionId)?.id ?? null;
        if (next) setActiveSessionId(next);
        else await handleNewChat();
      }
    } catch {
      setNotice("서버에 연결할 수 없습니다.");
    }
  };

  const handleAddProject = (draftProject) => {
    const project = normalizeProjectRef(draftProject);
    setManualProjects((prev) => {
      if (project.id === DEFAULT_PROJECT.id) return prev;
      const exists = prev.some((item) => item.id === project.id);
      if (exists) {
        return prev.map((item) => (item.id === project.id ? project : item));
      }
      return [...prev, project];
    });
    setSelectedProjectId(project.id);
  };

  const handleMoveSessionProject = async (sessionId, project) => {
    if (!API_CONFIGURED) {
      setNotice(missingApiNotice);
      return;
    }
    const targetProject = normalizeProjectRef(project);
    try {
      const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/project`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: targetProject.id,
          type: targetProject.type,
          value: targetProject.value,
          name: targetProject.name
        })
      });
      if (!res.ok) {
        setNotice("세션 이동에 실패했습니다.");
        return;
      }
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId ? { ...session, project: targetProject } : session
        )
      );
      if (activeSessionId === sessionId) {
        setSelectedProjectId(targetProject.id);
      }
      setNotice("");
    } catch {
      setNotice("서버에 연결할 수 없습니다.");
    }
  };

  const patchProjectForSession = async (sessionId, project) => {
    const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/project`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: project.id,
        type: project.type,
        value: project.value,
        name: project.name
      })
    });
    if (!res.ok) throw new Error("patch_failed");
  };

  const handleUpdateProject = async (projectId, draft) => {
    const bucket = projectBuckets.find((p) => p.id === projectId);
    if (!bucket) return;
    const nextProject = normalizeProjectRef({
      id: projectId,
      type: draft?.type ?? bucket.type,
      value: draft?.value ?? bucket.value,
      name: draft?.name ?? bucket.name
    });
    try {
      await Promise.all(
        (bucket.sessions ?? []).map((session) =>
          patchProjectForSession(session.id, nextProject)
        )
      );
      setManualProjects((prev) => {
        const isDefault = projectId === DEFAULT_PROJECT.id;
        if (isDefault) return prev;
        const exists = prev.some((project) => project.id === projectId);
        if (!exists) return [...prev, nextProject];
        return prev.map((project) => (project.id === projectId ? nextProject : project));
      });
      setSessions((prev) =>
        prev.map((session) =>
          normalizeProjectRef(session.project).id === projectId
            ? { ...session, project: nextProject }
            : session
        )
      );
      if (selectedProjectId === projectId) setSelectedProjectId(nextProject.id);
      setNotice("");
    } catch {
      setNotice("프로젝트 수정에 실패했습니다.");
    }
  };

  const handleRenameProject = async (projectId, nextName) => {
    const name = String(nextName ?? "").trim();
    if (!projectId || !name) return;
    const bucket = projectBuckets.find((p) => p.id === projectId);
    if (!bucket) return;
    const renamedProject = { ...bucket, name };
    await handleUpdateProject(projectId, renamedProject);
  };

  const handleDeleteProject = async (projectId) => {
    if (!projectId) return;
    if (projectId === DEFAULT_PROJECT.id) {
      setNotice("기본 프로젝트는 삭제할 수 없습니다.");
      return;
    }
    const bucket = projectBuckets.find((p) => p.id === projectId);
    if (!bucket) return;
    if (!confirm(`프로젝트 '${bucket.name}'을(를) 삭제할까요? 세션은 기본 프로젝트로 이동됩니다.`)) {
      return;
    }
    try {
      await Promise.all(
        (bucket.sessions ?? []).map((session) =>
          patchProjectForSession(session.id, DEFAULT_PROJECT)
        )
      );
      setSessions((prev) =>
        prev.map((session) =>
          normalizeProjectRef(session.project).id === projectId
            ? { ...session, project: { ...DEFAULT_PROJECT } }
            : session
        )
      );
      setManualProjects((prev) => prev.filter((project) => project.id !== projectId));
      if (selectedProjectId === projectId) setSelectedProjectId(DEFAULT_PROJECT.id);
      setNotice("");
    } catch {
      setNotice("프로젝트 삭제에 실패했습니다.");
    }
  };

  const sendChat = async () => {
    if (!API_CONFIGURED) {
      setNotice(missingApiNotice);
      return;
    }
    if (disabledControls) return;
    if (!draft.trim()) return;
    setNotice("");
    try {
      const targetProject = normalizeProjectRef(
        projectBuckets.find((project) => project.id === selectedProjectId) ?? DEFAULT_PROJECT
      );
      const res = await apiFetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionDetail?.id ?? null,
          message: draft,
          agentMode: "auto",
          permission: permissionDefault,
          project: targetProject
        })
      });
      if (!res.ok) {
        setNotice(res.status === 409 ? "이미 실행 중입니다." : "요청을 시작하지 못했습니다.");
        return;
      }
      const data = await res.json();
      if (data?.session?.id) setActiveSessionId(data.session.id);
      setDraft("");
      setNotice(data.rewritten ? "경로(/workspace)가 자동으로 변환되었습니다." : "");
    } catch {
      setNotice("서버에 연결할 수 없습니다.");
    }
  };

  const handleContinue = async (permissionOverride = null) => {
    if (!API_CONFIGURED) {
      setNotice(missingApiNotice);
      return;
    }
    if (!sessionDetail) return;
    if (disabledControls) return;
    setNotice("");
    const permission = permissionOverride ?? permissionDefault;
    try {
      const res = await apiFetch("/api/chat/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionDetail.id,
          permission
        })
      });
      if (!res.ok) {
        setNotice(res.status === 409 ? "승인이 필요합니다." : "실행을 시작하지 못했습니다.");
        return;
      }
      setNotice("");
    } catch {
      setNotice("서버에 연결할 수 없습니다.");
    }
  };

  const handleStop = async () => {
    if (!API_CONFIGURED) {
      setNotice(missingApiNotice);
      return;
    }
    if (!health?.activeRunId) return;
    if (!globalRunning) return;
    setStopping(true);
    setNotice("");
    try {
      const res = await apiFetch(`/api/runs/${health.activeRunId}/stop`, {
        method: "POST"
      });
      if (!res.ok) {
        setNotice("중지를 요청하지 못했습니다.");
      }
    } catch {
      setNotice("서버에 연결할 수 없습니다.");
    } finally {
      setStopping(false);
    }
  };

  const runningState = stopping ? "stopping" : globalRunning ? "running" : "idle";

  const toggleLeft = () => {
    setLeftCollapsed((prev) => {
      const next = !prev;
      // 좁은 화면에서는 좌/우 오버레이를 동시에 열지 않는다.
      if (isNarrow && !next) setDrawerOpen(false);
      return next;
    });
  };

  const toggleDrawer = () => {
    setDrawerOpen((prev) => {
      const next = !prev;
      // 좁은 화면에서는 좌/우 오버레이를 동시에 열지 않는다.
      if (isNarrow && next) setLeftCollapsed(true);
      return next;
    });
  };

  return (
    <AppShell
      onCloseOverlays={() => {
        if (isNarrow) {
          setLeftCollapsed(true);
          setDrawerOpen(false);
        }
      }}
      left={
        <SessionList
          projects={projectBuckets}
          selectedProjectId={selectedProjectId}
          activeId={activeSessionId}
          onSelect={setActiveSessionId}
          onSelectProject={setSelectedProjectId}
          onAddProject={handleAddProject}
          onUpdateProject={handleUpdateProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          onNewChat={handleNewChat}
          onMoveSession={handleMoveSessionProject}
          onDelete={handleDeleteSession}
          onClose={() => setLeftCollapsed(true)}
          collapsed={leftCollapsed}
        />
      }
      center={
        <div className="main-chat">
          <TopBarMinimal
            leftCollapsed={leftCollapsed}
            drawerOpen={drawerOpen}
            onToggleLeft={toggleLeft}
            onToggleDrawer={toggleDrawer}
          />

          <div className="chat-scroll">
            <ChatThread
              messages={viewMessages}
              typing={
                (sessionDetail?.pipeline?.phase === "planning" ||
                  sessionDetail?.pipeline?.phase === "acting" ||
                  sessionDetail?.pipeline?.phase === "verifying") ??
                false
              }
            />
          </div>

          <PromptComposer
            request={draft}
            onChangeRequest={setDraft}
            onSend={sendChat}
            onStop={handleStop}
            runningState={runningState}
            disabled={disabledControls}
            progressUi={(() => {
              const session = sessionDetail ?? null;
              const phase = session?.pipeline?.phase ?? "idle";
              const pendingContinue = Boolean(session?.pipeline?.pendingContinue);
              const running = Boolean(health?.running);
              const sessionActivelyRunning = running && runningThisSession;

              let label = "대기";
              if (!health?.ok) label = "연결 실패";
              else if (running && !runningThisSession) label = "다른 작업 실행 중";
              else if (phase === "needs_approval") label = "승인 필요";
              else if (phase === "needs_user") label = "추가 정보 필요";
              else if (pendingContinue) label = "추가 정보 필요";
              else if (phase === "planning" && sessionActivelyRunning) label = "기획중...";
              else if (phase === "acting" && sessionActivelyRunning) label = "작업중...";
              else if (phase === "verifying" && sessionActivelyRunning) label = "검증중...";
              else if (session?.status === "failed") label = "실패";
              else if (session?.status === "cancelled") label = "중지됨";
              else if (session?.status === "success" || phase === "done") label = "완료됨";

              const healthLed =
                health?.ok === false ? "red" : running ? "green" : "gray";

              const now = Date.now();
              const hasActiveRun = Boolean(health?.activeRunId);
              const startedAt = runWatchRef.current.startedAt || now;
              const lastGrowAt = lastLogAt || null;
              const ageMs = lastGrowAt ? now - lastGrowAt : now - startedAt;
              const LOG_FRESH_MS = 4000;
              const LOG_STALE_MS = 15000;
              const logLed =
                health?.ok === false
                  ? "red"
                  : !hasActiveRun
                    ? "gray"
                    : lastGrowAt && ageMs <= LOG_FRESH_MS
                      ? "green"
                      : ageMs >= LOG_STALE_MS
                        ? "red"
                        : "gray";

              const statusText = (() => {
                const rawStatus = String(session?.status || "-");
                const rawPhase = String(phase || "-");
                const s = formatStatusKo(session?.status);
                const p = formatPhaseKo(phase);
                const runId = String(health?.activeRunId || session?.pipeline?.activeRunId || "");
                const short = runId ? runId.slice(0, 8) : "-";
                return `상태 ${s}(${rawStatus}) · 단계 ${p}(${rawPhase}) · run ${short}`;
              })();

              const actions = [];
              if (running && !runningThisSession && health?.activeSessionId) {
                actions.push({
                  id: "show-running",
                  label: "보기",
                  kind: "ghost",
                  onClick: () => setActiveSessionId(health.activeSessionId)
                });
              }

              if (phase === "needs_approval") {
                actions.push({
                  id: "allow-once",
                  label: "계속",
                  kind: "primary",
                  onClick: () => handleContinue("full")
                });
                actions.push({
                  id: "keep-basic",
                  label: "취소",
                  kind: "ghost",
                  onClick: () => persistPermissionDefault("basic")
                });
                actions.push({
                  id: "allow-always",
                  label: "항상 허용",
                  kind: "link",
                  onClick: () => {
                    persistPermissionDefault("full");
                    handleContinue("full");
                  }
                });
              } else if (pendingContinue) {
                actions.push({
                  id: "continue",
                  label: "계속 실행",
                  kind: "primary",
                  onClick: () => handleContinue()
                });
              }

              const showProgress =
                sessionActivelyRunning ||
                phase === "needs_approval" ||
                phase === "needs_user" ||
                pendingContinue;

              return {
                visible: showProgress,
                label,
                spinning: running && runningThisSession,
                notice: notice || "",
                healthLed,
                logLed,
                statusText,
                actions
              };
            })()}
          />
        </div>
      }
      right={
        <div className="right-drawer">
          <div className="right-drawer-header">
            <button
              className="ghost icon-button"
              type="button"
              title="패널 닫기"
              onClick={() => setDrawerOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="right-drawer-body">
            <ExecutionSteps
              session={sessionDetail}
              actSummary={actSummary}
              actLogPreview={actLogPreview}
              logs={log}
              changedFiles={changedFiles}
              diffText={diff}
            />
          </div>
        </div>
      }
      mode={"assistant"}
      leftCollapsed={leftCollapsed}
      drawerOpen={drawerOpen}
    />
  );
}
