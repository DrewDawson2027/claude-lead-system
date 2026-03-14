#!/usr/bin/env bash
# scripts/e2e/e3-plan-approval.sh — Live E2E verification for E3: Plan Approval Flow
#
# What this proves:
#   A worker spawned in permission_mode=plan sends a plan_approval_request
#   via coord_send_protocol. The lead calls coord_send_protocol with
#   type=plan_approval_response + approve=true. The worker resumes
#   implementation (exits plan-wait state).
#
# Status before this run:
#   Code path ✅  Integration tests ✅  Live worker-in-plan-mode run ⏳ pending
#
# Usage:  bash scripts/e2e/e3-plan-approval.sh
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${CYAN}[E3]${NC} $*"; }
ok()    { echo -e "${GREEN}[PASS]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }
prompt(){ echo -e "${YELLOW}[MANUAL]${NC} $*"; }

INBOX_DIR="$HOME/.claude/terminals/inbox"
RESULTS_DIR="$HOME/.claude/terminals/results"
ACTIVITY_LOG="$HOME/.claude/terminals/activity.jsonl"

# ── Prerequisites ─────────────────────────────────────────────────────────────
info "Checking prerequisites..."
command -v claude >/dev/null 2>&1 || fail "claude binary not found"
command -v tmux    >/dev/null 2>&1 || fail "tmux not found"
command -v jq      >/dev/null 2>&1 || fail "jq not found"

# ── Phase 1: Spawn a worker in plan mode ──────────────────────────────────────
info "Phase 1: Spawn a worker with permission_mode=plan"
echo ""
prompt "In a coordinator terminal, run:"
prompt "  coord_create_team (team_name=e2e-approval)"
prompt "  coord_spawn_worker ("
prompt "    team=e2e-approval,"
prompt "    worker_name=planner,"
prompt "    task='Write a refactoring plan for mcp-coordinator/lib/tasks.js',"
prompt "    permission_mode=plan"
prompt "  )"
prompt ""
prompt "The worker enters plan mode (pauses before tool use) and calls"
prompt "  coord_send_protocol type=plan_approval_request"
prompt ""
prompt "Press ENTER once the worker has sent the plan_approval_request"
prompt "(visible as a message in the lead's inbox or in activity.jsonl):"
read -r _

prompt "Paste the worker's session ID (8 chars):"
read -r WORKER_SESSION
WORKER_SESSION="${WORKER_SESSION// /}"
[ -z "$WORKER_SESSION" ] && fail "No worker session ID provided."
WORKER_INBOX="$INBOX_DIR/${WORKER_SESSION}.jsonl"

# ── Phase 2: Lead sends approval ──────────────────────────────────────────────
info "Phase 2: Lead approves the plan"
echo ""
prompt "In the coordinator, run:"
prompt "  coord_send_protocol ("
prompt "    type=plan_approval_response,"
prompt "    approve=true,"
prompt "    to=${WORKER_SESSION}"
prompt "  )"
prompt ""
prompt "The worker should exit plan-wait and begin implementing."
prompt "Press ENTER once you see the worker resume in its tmux pane:"
read -r _

# ── Phase 3: Verify ──────────────────────────────────────────────────────────
info "Phase 3: Verifying approval artifacts..."

PASS_COUNT=0; FAIL_COUNT=0

check() {
  local desc="$1"; local condition="$2"
  if eval "$condition"; then
    ok "$desc"; PASS_COUNT=$((PASS_COUNT+1))
  else
    echo -e "${RED}[FAIL]${NC} $desc"; FAIL_COUNT=$((FAIL_COUNT+1))
  fi
}

# Worker inbox should have the [APPROVED] message
check "worker inbox file exists"                              "[ -f '$WORKER_INBOX' ]"
check "inbox contains APPROVED signal"                        "grep -qi 'APPROVED' '$WORKER_INBOX' 2>/dev/null"

# Activity log should show the protocol exchange
if [ -f "$ACTIVITY_LOG" ]; then
  check "activity log has plan_approval_request entry"        "grep -q 'plan_approval_request' '$ACTIVITY_LOG'"
  check "activity log has plan_approval_response entry"       "grep -q 'plan_approval_response' '$ACTIVITY_LOG'"
else
  echo -e "${YELLOW}[SKIP]${NC} activity.jsonl not found (may not exist yet)"
fi

# Result file should show worker ran tools (task has output)
RESULT_FILE=$(ls "$RESULTS_DIR"/*.txt 2>/dev/null | grep -v prompt | tail -1 || true)
if [ -n "$RESULT_FILE" ]; then
  RESULT_SIZE=$(wc -c < "$RESULT_FILE" 2>/dev/null | tr -d ' ')
  check "worker result file is non-empty (worker resumed)"    "[ '$RESULT_SIZE' -gt 0 ]"
fi

echo ""
echo "────────────────────────────────────────"
echo "E3 Plan Approval: $PASS_COUNT passed, $FAIL_COUNT failed"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}Status: VERIFIED — update CLAUDE.md E3 live run to '✅ verified'${NC}"
else
  echo -e "${RED}Status: FAILED — check worker inbox and activity log${NC}"
  echo "Worker inbox: $WORKER_INBOX"
  [ -f "$WORKER_INBOX" ] && cat "$WORKER_INBOX" | head -5
fi
