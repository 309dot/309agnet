#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="/Users/a309/Documents/Agent309/wOpenclaw"
STATE_DIR="$WORKSPACE/.openclaw-state"
CONFIG_PATH="$STATE_DIR/openclaw.json"
PROMPT_FILE="$WORKSPACE/openclaw_task_loop_prompt.md"
LOG_DIR="$WORKSPACE/tasks/logs"
LOG_FILE="$LOG_DIR/run-$(date +%Y%m%d%H%M%S).log"
GATEWAY_PORT=19011
SESSION_ID="devloop-$(date +%Y%m%d%H%M%S)"
AGENT_TIMEOUT_SEC=180
SELECTED_TASK_FILE="$WORKSPACE/tasks/.selected"
TEMP_CONFIG_PATH=""

mkdir -p "$LOG_DIR"

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Missing config: $CONFIG_PATH" >&2
  exit 1
fi
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Missing prompt: $PROMPT_FILE" >&2
  exit 1
fi

export OPENCLAW_STATE_DIR="$STATE_DIR"

TASK_PATH_HOST="$(
  python3 - <<'PY'
from pathlib import Path
inbox = Path("/Users/a309/Documents/Agent309/wOpenclaw/tasks/inbox")
files = [p for p in inbox.glob("*.md") if p.is_file()]
if not files:
    raise SystemExit(2)
files.sort(key=lambda p: p.stat().st_mtime)
print(str(files[0]))
PY
  2>/dev/null || true
)"
if [[ -z "${TASK_PATH_HOST:-}" ]]; then
  echo "No tasks."
  exit 0
fi

TASK_BASENAME="$(basename "$TASK_PATH_HOST")"
# CLI 로컬 실행은 호스트 경로를 그대로 사용한다.
TASK_PATH_SANDBOX="$TASK_PATH_HOST"
echo "$TASK_PATH_SANDBOX" > "$SELECTED_TASK_FILE"

MODEL_ID="$("$WORKSPACE/scripts/select_model.py" "$TASK_PATH_HOST" 2>/dev/null || true)"
if [[ -z "${MODEL_ID:-}" ]]; then
  MODEL_ID="qwen3-coder:30b"
fi

TEMP_CONFIG_PATH="$STATE_DIR/openclaw.tmp.$(date +%Y%m%d%H%M%S).json"
MODEL_ID="$MODEL_ID" CONFIG_PATH="$CONFIG_PATH" TEMP_CONFIG_PATH="$TEMP_CONFIG_PATH" python3 - <<'PY'
import json
import os

config_path = os.environ["CONFIG_PATH"]
temp_path = os.environ["TEMP_CONFIG_PATH"]
model_id = os.environ["MODEL_ID"]

with open(config_path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

cfg.setdefault("agents", {}).setdefault("defaults", {}).setdefault("model", {})
cfg["agents"]["defaults"]["model"]["primary"] = f"ollama/{model_id}"

with open(temp_path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2)
PY

# 모델이 config에 없으면 조용히 fallback하지 않고 명시적으로 실패시킨다.
MODEL_ID="$MODEL_ID" CONFIG_PATH="$CONFIG_PATH" python3 - <<'PY'
import json
import os
import sys

config_path = os.environ["CONFIG_PATH"]
model_id = os.environ["MODEL_ID"]

with open(config_path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

models = (
    cfg.get("models", {})
    .get("providers", {})
    .get("ollama", {})
    .get("models", [])
)
ids = {str(m.get("id", "")).strip() for m in models if isinstance(m, dict)}
if model_id not in ids:
    print(f"Model not configured: {model_id}", file=sys.stderr)
    sys.exit(1)
PY

export OPENCLAW_CONFIG_PATH="$TEMP_CONFIG_PATH"

# Start gateway in background
/Users/a309/.openclaw/bin/openclaw gateway --port "$GATEWAY_PORT" --bind loopback >"$LOG_DIR/gateway-$(date +%Y%m%d%H%M%S).log" 2>&1 &
GATEWAY_PID=$!

# Give gateway time to start
sleep 2

# Run agent once
/Users/a309/.openclaw/bin/openclaw agent \
  --session-id "$SESSION_ID" \
  --message "$(cat "$PROMPT_FILE")" \
  --json \
  > "$LOG_FILE" 2>&1 &
AGENT_PID=$!
TIMED_OUT=0
for _ in $(seq 1 "$AGENT_TIMEOUT_SEC"); do
  if ! kill -0 "$AGENT_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if kill -0 "$AGENT_PID" >/dev/null 2>&1; then
  TIMED_OUT=1
  echo "[TIMEOUT] agent exceeded ${AGENT_TIMEOUT_SEC}s. Sending SIGTERM..." >> "$LOG_FILE"
  kill "$AGENT_PID" >/dev/null 2>&1 || true
  sleep 2
fi
if kill -0 "$AGENT_PID" >/dev/null 2>&1; then
  echo "[TIMEOUT] agent still running. Sending SIGKILL..." >> "$LOG_FILE"
  kill -9 "$AGENT_PID" >/dev/null 2>&1 || true
fi
wait "$AGENT_PID" >/dev/null 2>&1 || true

# Stop gateway
kill "$GATEWAY_PID" >/dev/null 2>&1 || true

cleanup_file() {
  local target="$1"
  if [[ -z "$target" ]]; then
    return 0
  fi
  if command -v trash >/dev/null 2>&1; then
    trash "$target" >/dev/null 2>&1 || true
  else
    rm -f "$target" >/dev/null 2>&1 || true
  fi
}

cleanup_file "$TEMP_CONFIG_PATH"
cleanup_file "$SELECTED_TASK_FILE"

if [[ "$TIMED_OUT" -eq 1 ]]; then
  echo "FAILED (timeout). Log: $LOG_FILE" >&2
  exit 1
fi

echo "DONE. Log: $LOG_FILE"
