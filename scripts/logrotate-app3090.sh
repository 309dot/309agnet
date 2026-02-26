#!/bin/zsh
set -euo pipefail

BASE_DIR="${BASE_DIR:-/Users/309agent/.openclaw/workspace-orchestrator/.openclaw}"
MAX_BYTES=${MAX_BYTES:-$((20 * 1024 * 1024))} # 20MB
KEEP=${KEEP:-7}
TS=$(date '+%Y-%m-%d %H:%M:%S %Z')

logs=(
  "$BASE_DIR/app3090.out.log"
  "$BASE_DIR/app3090.err.log"
  "$BASE_DIR/healthcheck-app3090.log"
  "$BASE_DIR/healthcheck-app3090.agent.out.log"
  "$BASE_DIR/healthcheck-app3090.agent.err.log"
)

rotate_one() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  local size
  size=$(stat -f%z "$file")
  (( size < MAX_BYTES )) && return 0

  for ((i=KEEP; i>=1; i--)); do
    local prev="$file.$i.gz"
    local next="$file.$((i+1)).gz"
    [[ -f "$prev" ]] && mv "$prev" "$next"
  done

  gzip -c "$file" > "$file.1.gz"
  : > "$file"

  local prune="$file.$((KEEP+1)).gz"
  [[ -f "$prune" ]] && rm -f "$prune"

  echo "[$TS] rotated $file size=${size}" >> "$BASE_DIR/logrotate-app3090.log"
}

mkdir -p "$BASE_DIR"
for log_file in "${logs[@]}"; do
  rotate_one "$log_file"
done
