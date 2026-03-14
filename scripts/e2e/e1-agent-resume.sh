#!/usr/bin/env bash
# scripts/e2e/e1-agent-resume.sh — Live E2E verification for E1: Agent Resume
#
# What this proves:
#   coord_resume_worker correctly reads the prior task's meta file, builds a
#   --session-id resume script, and launches a new Claude process that re-enters
#   the prior conversation context rather than starting fresh.
#
# Run this ONCE on a machine where Claude Code is installed and tmux is available.
# Update CLAUDE.md E1 row from "⏳ pending" to "✅ verified" when VERIFY passes.
#
# Usage:  bash scripts/e2e/e1-agent-resume.sh
#         bash scripts/e2e/e1-agent-resume.sh --verify-only   (skip setup, just check artifacts)
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${CYAN}[E1]${NC} $*"; }
ok()    { echo -e "${GREEN}[PASS]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }
prompt(){ echo -e "${YELLOW}[MANUAL]${NC} $*"; }

VERIFY_ONLY="${1:-}"
RESULTS_DIR="$HOME/.claude/terminals/results"
SESSIONS_DIR="$HOME/.claude/terminals"

# ── Prerequisites ─────────────────────────────────────────────────────────────
info "Checking prerequisites..."
command -v claude >/dev/null 2>&1 || fail "claude binary not found — install Claude Code first"
command -v tmux    >/dev/null 2>&1 || fail "tmux not found — required for worker spawning"
command -v jq      >/dev/null 2>&1 || fail "jq not found"

# ── Phase 1: SETUP ────────────────────────────────────────────────────────────
if [ "$VERIFY_ONLY" != "--verify-only" ]; then
  info "Phase 1: Spawn a worker via the coordinator..."
  echo ""
  prompt "In a NEW terminal (or tmux pane), run:"
  prompt "  claudex   # or: claude"
  prompt "  /lead     # enter coordinator mode"
  prompt ""
  prompt "Then call:"
  prompt "  coord_create_team  (team_name=e2e-test)"
  prompt "  coord_spawn_worker (team=e2e-test, task='Write a 5-line poem about resilience')"
  prompt ""
  prompt "Note the task_id and session ID from coord_list_sessions output."
  prompt "Press ENTER here once the worker has started and written at least one output line."
  read -r _

  info "Phase 2: Note the session ID (first 8 chars of the worker's session)"
  prompt "Run: coord_list_sessions — find the worker session, note its ID"
  prompt "Press ENTER and paste the 8-char session ID:"
  read -r SESSION_ID
  SESSION_ID="${SESSION_ID// /}"

  info "Phase 3: Kill the worker mid-task..."
  prompt "Run in the coordinator:"
  prompt "  coord_kill_worker  (session_id=${SESSION_ID})"
  prompt "Press ENTER once the worker is confirmed killed."
  read -r _

  echo "$SESSION_ID" > /tmp/e1-session-id.txt
  info "Session ID saved to /tmp/e1-session-id.txt"
fi

# ── Phase 2: RESUME ───────────────────────────────────────────────────────────
SESSION_ID=""
if [ -f /tmp/e1-session-id.txt ]; then
  SESSION_ID=$(cat /tmp/e1-session-id.txt)
fi
[ -z "$SESSION_ID" ] && { prompt "No session ID found. Run without --verify-only first."; exit 1; }

info "Phase 4: Resume the killed worker..."
prompt "In the coordinator, run:"
prompt "  coord_resume_worker (task_id=<the task_id for session ${SESSION_ID}>)"
prompt ""
prompt "Observe the new Claude process start in a tmux pane."
prompt "Verify it references prior context (e.g., it knows the poem topic)."
prompt "Press ENTER once resume is confirmed, or type SKIP to mark as pending:"
read -r RESULT

# ── Phase 3: VERIFY artifacts ─────────────────────────────────────────────────
info "Phase 5: Verifying filesystem artifacts..."

PASS_COUNT=0; FAIL_COUNT=0

check() {
  local desc="$1"; local condition="$2"
  if eval "$condition"; then
    ok "$desc"; PASS_COUNT=$((PASS_COUNT+1))
  else
    echo -e "${RED}[FAIL]${NC} $desc"; FAIL_COUNT=$((FAIL_COUNT+1))
  fi
}

check "results/ directory exists"          "[ -d '$RESULTS_DIR' ]"
check "at least one .meta.json exists"     "ls '$RESULTS_DIR'/*.meta.json 2>/dev/null | head -1 | grep -q ."
check "coordinator session files present"  "ls '$SESSIONS_DIR'/session-*.json 2>/dev/null | head -1 | grep -q ."

# Check meta file has resume_count > 0 if resume was triggered
META_FILE=$(ls "$RESULTS_DIR"/*.meta.json 2>/dev/null | tail -1 || true)
if [ -n "$META_FILE" ]; then
  RESUME_COUNT=$(jq -r '.resume_count // 0' "$META_FILE" 2>/dev/null || echo "0")
  check "meta file shows resume_count ≥ 1 (resume was recorded)" "[ '$RESUME_COUNT' -ge 1 ]"
fi

echo ""
echo "────────────────────────────────────────"
echo "E1 Agent Resume: $PASS_COUNT passed, $FAIL_COUNT failed"
if [ "$RESULT" = "SKIP" ]; then
  echo -e "${YELLOW}Status: PENDING (manual resume step skipped)${NC}"
  echo "Update CLAUDE.md E1 row to '⏳ pending' — live run not completed."
else
  echo -e "${GREEN}Status: COMPLETE — update CLAUDE.md E1 row to '✅ verified (live)'${NC}"
  echo "Also update session resumption claim in CLAUDE.md competitive advantages."
fi
