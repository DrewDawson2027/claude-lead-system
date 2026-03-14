#!/usr/bin/env bash
# scripts/lead-status-watch.sh — Live polling display of all active worker sessions
#
# Bridges the UX gap with native's Shift+Down worker cycling.
# Reads ~/.claude/terminals/session-*.json every N seconds and renders
# a table of worker name, status, current task, and time since last activity.
#
# Usage:
#   bash scripts/lead-status-watch.sh            # refresh every 2s
#   bash scripts/lead-status-watch.sh --interval 5
#   bash scripts/lead-status-watch.sh --once      # single snapshot, no loop
set -euo pipefail

INTERVAL=2
ONCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval) INTERVAL="$2"; shift 2 ;;
    --once)     ONCE=true; shift ;;
    *)          shift ;;
  esac
done

SESSIONS_DIR="$HOME/.claude/terminals"
INBOX_DIR="$HOME/.claude/terminals/inbox"

# ANSI helpers (use $'...' so bash expands \033 as ESC)
BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'; CYAN=$'\033[0;36m'

now_epoch() { date +%s; }

# Format seconds into human-readable "Xs" / "Xm Ys" / "Xh"
human_age() {
  local secs="$1"
  if   [ "$secs" -lt 60 ];   then echo "${secs}s ago"
  elif [ "$secs" -lt 3600 ]; then echo "$((secs/60))m $((secs%60))s ago"
  else                             echo "$((secs/3600))h ago"
  fi
}

# Return inbox queue depth for a session
inbox_depth() {
  local sid="$1"
  local f="$INBOX_DIR/${sid}.jsonl"
  [ -f "$f" ] && wc -l < "$f" | tr -d ' ' || echo "0"
}

render() {
  local NOW
  NOW=$(now_epoch)

  # Collect session data via Python (handles JSON parsing cleanly)
  SESSION_DATA=$(python3 - "$SESSIONS_DIR" "$NOW" <<'PY'
import json, os, sys, time
from pathlib import Path

sessions_dir = Path(sys.argv[1])
now = int(sys.argv[2])

rows = []
for f in sorted(sessions_dir.glob("session-*.json")):
    try:
        d = json.loads(f.read_text())
    except Exception:
        continue
    sid        = d.get("session", "?")[:8]
    status     = d.get("status", "unknown")
    worker     = d.get("worker_name") or d.get("project") or "—"
    task       = (d.get("current_task") or "—")[:42]
    branch     = (d.get("branch") or "—")[:24]
    la_str     = d.get("last_active", "")
    try:
        la_epoch = int(time.mktime(time.strptime(la_str, "%Y-%m-%dT%H:%M:%SZ")))
        age_secs = max(0, now - la_epoch)
    except Exception:
        age_secs = -1
    rows.append((sid, status, worker, task, branch, age_secs))

# Sort: active first, then by most recently active
rows.sort(key=lambda r: (0 if r[1] == "active" else 1, r[5]))
for row in rows:
    print("\t".join(str(x) for x in row))
PY
)

  # Header
  printf "${BOLD}%-10s %-10s %-18s %-44s %-26s %-12s %-6s${RESET}\n" \
    "SESSION" "STATUS" "WORKER" "CURRENT TASK" "BRANCH" "LAST ACTIVE" "INBOX"
  printf '%0.s─' {1..130}; echo

  if [ -z "$SESSION_DATA" ]; then
    echo -e "${DIM}  No session files found in $SESSIONS_DIR${RESET}"
    return
  fi

  ACTIVE=0; STALE=0; TOTAL=0
  while IFS=$'\t' read -r sid status worker task branch age_secs; do
    TOTAL=$((TOTAL+1))

    # Status colour
    case "$status" in
      active)  STATUS_COL="${GREEN}${status}${RESET}" ;;
      stale)   STATUS_COL="${DIM}${status}${RESET}";  STALE=$((STALE+1)) ;;
      *)       STATUS_COL="${YELLOW}${status}${RESET}" ;;
    esac
    [ "$status" = "active" ] && ACTIVE=$((ACTIVE+1))

    # Age
    if [ "$age_secs" -lt 0 ]; then
      AGE_STR="unknown"
    else
      AGE_STR=$(human_age "$age_secs")
      [ "$age_secs" -gt 300 ] && AGE_STR="${DIM}${AGE_STR}${RESET}"
    fi

    # Inbox depth
    DEPTH=$(inbox_depth "$sid")
    [ "$DEPTH" -gt 0 ] && DEPTH_STR="${CYAN}${DEPTH} msg${RESET}" || DEPTH_STR="${DIM}—${RESET}"

    printf "%-10s %-10b %-18s %-44s %-26s %-12b %-6b\n" \
      "$sid" "$STATUS_COL" "${worker:0:18}" "${task:0:44}" "${branch:0:26}" "$AGE_STR" "$DEPTH_STR"

  done <<< "$SESSION_DATA"

  printf '%0.s─' {1..130}; echo
  echo -e "  ${BOLD}${ACTIVE} active${RESET} · ${STALE} stale · ${TOTAL} total  ${DIM}(refresh: ${INTERVAL}s — Ctrl+C to exit)${RESET}"
}

# ── Main loop ────────────────────────────────────────────────────────────────
if $ONCE; then
  render
  exit 0
fi

# Continuous loop with clear-screen
while true; do
  clear
  echo -e "${BOLD}Lead System — Worker Status${RESET}  $(date '+%Y-%m-%d %H:%M:%S')"
  echo ""
  render
  sleep "$INTERVAL"
done
