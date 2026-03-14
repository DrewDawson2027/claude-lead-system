#!/usr/bin/env bash
# scripts/e2e/e2-p2p-messaging.sh — Live E2E verification for E2: P2P Messaging
#
# What this proves:
#   A real worker process (claude -p) can call coord_send_message with
#   target_name=<peer>, and the message appears in the peer's inbox file.
#   The cross-process path (two separate Node.js processes, same filesystem)
#   is already verified by e2e-p2p-worker-dm.test.mjs. This runbook adds
#   the tmux/live-Claude layer on top.
#
# Status before this run:
#   Code path ✅  Integration tests ✅  Live tmux run ⏳ pending
#
# Usage:  bash scripts/e2e/e2-p2p-messaging.sh
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${CYAN}[E2]${NC} $*"; }
ok()    { echo -e "${GREEN}[PASS]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }
prompt(){ echo -e "${YELLOW}[MANUAL]${NC} $*"; }

INBOX_DIR="$HOME/.claude/terminals/inbox"

# ── Prerequisites ─────────────────────────────────────────────────────────────
info "Checking prerequisites..."
command -v claude >/dev/null 2>&1 || fail "claude binary not found"
command -v tmux    >/dev/null 2>&1 || fail "tmux not found"
command -v jq      >/dev/null 2>&1 || fail "jq not found"

# ── Phase 1: Spawn two workers ────────────────────────────────────────────────
info "Phase 1: Spawn two workers — alpha and beta"
echo ""
prompt "In a coordinator terminal, run:"
prompt "  coord_create_team (team_name=e2e-p2p)"
prompt "  coord_spawn_worker (team=e2e-p2p, worker_name=alpha, task='Wait for instructions')"
prompt "  coord_spawn_worker (team=e2e-p2p, worker_name=beta,  task='Wait for instructions')"
prompt ""
prompt "Note the session ID of BETA (the message recipient)."
prompt "Press ENTER once both workers are active (visible in coord_list_sessions):"
read -r _

prompt "Paste beta's session ID (8 chars):"
read -r BETA_SESSION
BETA_SESSION="${BETA_SESSION// /}"
[ -z "$BETA_SESSION" ] && fail "No beta session ID provided."
echo "$BETA_SESSION" > /tmp/e2-beta-session.txt

# ── Phase 2: Send message from alpha to beta ──────────────────────────────────
info "Phase 2: Alpha sends a message to beta"
echo ""
prompt "In the coordinator, tell alpha to call:"
prompt "  coord_send_message (from=alpha, target_name=beta, content='ping from alpha')"
prompt ""
prompt "(You can do this by messaging alpha's inbox with the instruction, then"
prompt " watching alpha's tmux pane call the tool, OR call it directly from the lead.)"
prompt ""
prompt "Press ENTER once the send_message call is confirmed:"
read -r _

# ── Phase 3: Verify inbox ─────────────────────────────────────────────────────
info "Phase 3: Verifying beta's inbox..."

PASS_COUNT=0; FAIL_COUNT=0

check() {
  local desc="$1"; local condition="$2"
  if eval "$condition"; then
    ok "$desc"; PASS_COUNT=$((PASS_COUNT+1))
  else
    echo -e "${RED}[FAIL]${NC} $desc"; FAIL_COUNT=$((FAIL_COUNT+1))
  fi
}

INBOX_FILE="$INBOX_DIR/${BETA_SESSION}.jsonl"
check "inbox directory exists"                  "[ -d '$INBOX_DIR' ]"
check "beta's inbox file exists"                "[ -f '$INBOX_FILE' ]"
check "inbox contains 'ping' from alpha"        "grep -q 'ping' '$INBOX_FILE' 2>/dev/null"
check "message has correct 'from' field"        "jq -r '.from' '$INBOX_FILE' 2>/dev/null | grep -q 'alpha'"

echo ""
echo "────────────────────────────────────────"
echo "E2 P2P Messaging: $PASS_COUNT passed, $FAIL_COUNT failed"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}Status: VERIFIED — update CLAUDE.md E2 live tmux row to '✅ verified'${NC}"
else
  echo -e "${RED}Status: FAILED — check coordinator logs and inbox dir${NC}"
  echo "Inbox dir contents:"
  ls -la "$INBOX_DIR/" 2>/dev/null || echo "(empty or missing)"
fi
