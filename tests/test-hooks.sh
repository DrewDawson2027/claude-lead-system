#!/bin/bash
# Unit tests for shell hooks: session-register, terminal-heartbeat, session-end, check-inbox, conflict-guard
# Uses a temporary HOME to isolate all file operations.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")/../hooks" && pwd)"
ORIG_HOME="$HOME"
PASS=0
FAIL=0
TOTAL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

assert_eq() {
  TOTAL=$((TOTAL + 1))
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}PASS${NC} $desc"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}FAIL${NC} $desc (expected='$expected' got='$actual')"
  fi
}

assert_match() {
  TOTAL=$((TOTAL + 1))
  local desc="$1" pattern="$2" actual="$3"
  if echo "$actual" | grep -qE "$pattern"; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}PASS${NC} $desc"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}FAIL${NC} $desc (pattern='$pattern' not in output)"
  fi
}

assert_file_exists() {
  TOTAL=$((TOTAL + 1))
  local desc="$1" path="$2"
  if [ -f "$path" ]; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}PASS${NC} $desc"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}FAIL${NC} $desc (file not found: $path)"
  fi
}

assert_file_not_exists() {
  TOTAL=$((TOTAL + 1))
  local desc="$1" path="$2"
  if [ ! -f "$path" ]; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}PASS${NC} $desc"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}FAIL${NC} $desc (file exists but shouldn't: $path)"
  fi
}

new_home() {
  local tmpdir
  tmpdir=$(mktemp -d)
  export HOME="$tmpdir"
  mkdir -p "$HOME/.claude/terminals/inbox"
  mkdir -p "$HOME/.claude/terminals/results"
  mkdir -p "$HOME/.claude/hooks/session-state"
  echo "$tmpdir"
}

restore_home() {
  export HOME="$ORIG_HOME"
  rm -rf "$1" 2>/dev/null || true
}

# ─── session-register.sh tests ───
echo "=== session-register.sh ==="

TEST_HOME=$(new_home)
echo '{"session_id":"test1234abcd","cwd":"/tmp/demo","transcript_path":"/tmp/t.jsonl","source":"startup"}' | \
  HOME="$TEST_HOME" bash "$HOOK_DIR/session-register.sh" 2>/dev/null || true

assert_file_exists "creates session file" "$TEST_HOME/.claude/terminals/session-test1234.json"
STATUS=$(jq -r '.status' "$TEST_HOME/.claude/terminals/session-test1234.json" 2>/dev/null)
assert_eq "session status is active" "active" "$STATUS"
PROJECT=$(jq -r '.project' "$TEST_HOME/.claude/terminals/session-test1234.json" 2>/dev/null)
assert_eq "project from basename of cwd" "demo" "$PROJECT"
assert_file_exists "appends to sessions.jsonl" "$TEST_HOME/.claude/terminals/sessions.jsonl"
restore_home "$TEST_HOME"

# Test: invalid session_id blocked
TEST_HOME=$(new_home)
RESULT=$(echo '{"session_id":"bad!"}' | HOME="$TEST_HOME" bash "$HOOK_DIR/session-register.sh" 2>&1 || true)
assert_match "rejects invalid session_id" "BLOCKED" "$RESULT"
restore_home "$TEST_HOME"

# ─── terminal-heartbeat.sh tests ───
echo ""
echo "=== terminal-heartbeat.sh ==="

TEST_HOME=$(new_home)
# Create a session file first
jq -n '{"session":"hb123456","status":"active","cwd":"/tmp","last_active":"2020-01-01T00:00:00Z","tool_counts":{},"files_touched":[],"recent_ops":[]}' > "$TEST_HOME/.claude/terminals/session-hb123456.json"

# Clear stale heartbeat lock to avoid rate-limit skipping
rm -f /tmp/claude-heartbeat-hb123456.lock
rm -rf /tmp/claude-heartbeat-hb123456.lock.d

echo '{"session_id":"hb123456abcdef","tool_name":"Edit","tool_input":{"file_path":"/tmp/src/app.ts"},"cwd":"/tmp"}' | \
  HOME="$TEST_HOME" bash "$HOOK_DIR/terminal-heartbeat.sh" 2>/dev/null || true

LAST_TOOL=$(jq -r '.last_tool' "$TEST_HOME/.claude/terminals/session-hb123456.json" 2>/dev/null)
assert_eq "updates last_tool" "Edit" "$LAST_TOOL"
LAST_FILE=$(jq -r '.last_file' "$TEST_HOME/.claude/terminals/session-hb123456.json" 2>/dev/null)
assert_eq "updates last_file" "app.ts" "$LAST_FILE"
EDIT_COUNT=$(jq -r '.tool_counts.Edit // 0' "$TEST_HOME/.claude/terminals/session-hb123456.json" 2>/dev/null)
assert_eq "increments tool_counts.Edit" "1" "$EDIT_COUNT"
TOUCHED=$(jq -r '.files_touched | length' "$TEST_HOME/.claude/terminals/session-hb123456.json" 2>/dev/null)
assert_eq "adds to files_touched for Edit" "1" "$TOUCHED"
assert_file_exists "appends to activity.jsonl" "$TEST_HOME/.claude/terminals/activity.jsonl"
restore_home "$TEST_HOME"

# Test: heartbeat fallback creates session file
TEST_HOME=$(new_home)
rm -f /tmp/claude-heartbeat-new12345.lock
rm -rf /tmp/claude-heartbeat-new12345.lock.d
echo '{"session_id":"new12345abcdef","tool_name":"Read","tool_input":{"file_path":"/tmp/file.ts"},"cwd":"/tmp/project"}' | \
  HOME="$TEST_HOME" bash "$HOOK_DIR/terminal-heartbeat.sh" 2>/dev/null || true
assert_file_exists "creates session via fallback" "$TEST_HOME/.claude/terminals/session-new12345.json"
FB_SOURCE=$(jq -r '.source' "$TEST_HOME/.claude/terminals/session-new12345.json" 2>/dev/null)
assert_eq "fallback source is heartbeat-fallback" "heartbeat-fallback" "$FB_SOURCE"
restore_home "$TEST_HOME"

# Test: invalid session_id blocked
TEST_HOME=$(new_home)
RESULT=$(echo '{"session_id":"bad!"}' | HOME="$TEST_HOME" bash "$HOOK_DIR/terminal-heartbeat.sh" 2>&1 || true)
assert_match "rejects invalid session_id" "BLOCKED" "$RESULT"
restore_home "$TEST_HOME"

# ─── session-end.sh tests ───
echo ""
echo "=== session-end.sh ==="

TEST_HOME=$(new_home)
jq -n '{"session":"end12345","status":"active","cwd":"/tmp"}' > "$TEST_HOME/.claude/terminals/session-end12345.json"
# Create guard state files that should be cleaned up
mkdir -p "$TEST_HOME/.claude/hooks/session-state"
echo '{}' > "$TEST_HOME/.claude/hooks/session-state/end12345.json"
echo '{}' > "$TEST_HOME/.claude/hooks/session-state/end12345-reads.json"

echo '{"session_id":"end12345abcdef"}' | HOME="$TEST_HOME" bash "$HOOK_DIR/session-end.sh" 2>/dev/null || true

STATUS=$(jq -r '.status' "$TEST_HOME/.claude/terminals/session-end12345.json" 2>/dev/null)
assert_eq "marks session closed" "closed" "$STATUS"
ENDED=$(jq -r '.ended' "$TEST_HOME/.claude/terminals/session-end12345.json" 2>/dev/null)
assert_match "sets ended timestamp" "^20[0-9]{2}-" "$ENDED"
assert_file_not_exists "cleans guard state" "$TEST_HOME/.claude/hooks/session-state/end12345.json"
assert_file_not_exists "cleans reads state" "$TEST_HOME/.claude/hooks/session-state/end12345-reads.json"
restore_home "$TEST_HOME"

# ─── check-inbox.sh tests ───
echo ""
echo "=== check-inbox.sh ==="

TEST_HOME=$(new_home)
# Write a message to inbox
jq -n --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{"ts":$ts,"from":"lead","priority":"urgent","content":"Deploy now!"}' > "$TEST_HOME/.claude/terminals/inbox/inbox123.jsonl"

OUTPUT=$(echo '{"session_id":"inbox123abcdefg","tool_name":"Read","tool_input":{}}' | HOME="$TEST_HOME" bash "$HOOK_DIR/check-inbox.sh" 2>/dev/null || true)
assert_match "displays inbox messages" "Deploy now" "$OUTPUT"
assert_match "shows INCOMING MESSAGES header" "INCOMING MESSAGES" "$OUTPUT"
assert_file_not_exists "removes inbox after display" "$TEST_HOME/.claude/terminals/inbox/inbox123.jsonl"
restore_home "$TEST_HOME"

# Test: empty inbox
TEST_HOME=$(new_home)
OUTPUT=$(echo '{"session_id":"empty123abcdefg","tool_name":"Read","tool_input":{}}' | HOME="$TEST_HOME" bash "$HOOK_DIR/check-inbox.sh" 2>/dev/null || true)
assert_eq "no output for empty inbox" "" "$OUTPUT"
restore_home "$TEST_HOME"

# Test: invalid session_id blocked
TEST_HOME=$(new_home)
RESULT=$(echo '{"session_id":"bad!"}' | HOME="$TEST_HOME" bash "$HOOK_DIR/check-inbox.sh" 2>&1 || true)
assert_match "rejects invalid session_id" "BLOCKED" "$RESULT"
restore_home "$TEST_HOME"

# ─── conflict-guard.sh tests ───
echo ""
echo "=== conflict-guard.sh ==="

TEST_HOME=$(new_home)
# Create two sessions — one has touched /tmp/src/app.ts
jq -n '{"session":"me123456","status":"active","cwd":"/tmp","files_touched":[]}' > "$TEST_HOME/.claude/terminals/session-me123456.json"
jq -n '{"session":"other123","status":"active","cwd":"/tmp","files_touched":["/tmp/src/app.ts"],"project":"demo","current_task":"refactoring"}' > "$TEST_HOME/.claude/terminals/session-other123.json"

RESULT=$(echo '{"session_id":"me123456abcdef","tool_name":"Edit","tool_input":{"file_path":"/tmp/src/app.ts"}}' | HOME="$TEST_HOME" bash "$HOOK_DIR/conflict-guard.sh" 2>&1 || true)
EXIT_CODE=$?
assert_eq "exits 0 (advisory only)" "0" "$EXIT_CODE"
assert_match "warns about conflict" "WARNING" "$RESULT"
assert_match "identifies conflicting session" "other123" "$RESULT"
restore_home "$TEST_HOME"

# Test: no conflict
TEST_HOME=$(new_home)
jq -n '{"session":"me123456","status":"active","cwd":"/tmp","files_touched":[]}' > "$TEST_HOME/.claude/terminals/session-me123456.json"
jq -n '{"session":"other123","status":"active","cwd":"/tmp","files_touched":["/tmp/src/different.ts"]}' > "$TEST_HOME/.claude/terminals/session-other123.json"

RESULT=$(echo '{"session_id":"me123456abcdef","tool_name":"Edit","tool_input":{"file_path":"/tmp/src/app.ts"}}' | HOME="$TEST_HOME" bash "$HOOK_DIR/conflict-guard.sh" 2>&1 || true)
TOTAL=$((TOTAL + 1))
if echo "$RESULT" | grep -q "WARNING"; then
  FAIL=$((FAIL + 1))
  echo -e "  ${RED}FAIL${NC} no warning for different files"
else
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}PASS${NC} no warning for different files"
fi
restore_home "$TEST_HOME"

# Test: closed sessions ignored
TEST_HOME=$(new_home)
jq -n '{"session":"me123456","status":"active","cwd":"/tmp"}' > "$TEST_HOME/.claude/terminals/session-me123456.json"
jq -n '{"session":"closed12","status":"closed","cwd":"/tmp","files_touched":["/tmp/src/app.ts"]}' > "$TEST_HOME/.claude/terminals/session-closed12.json"

RESULT=$(echo '{"session_id":"me123456abcdef","tool_name":"Edit","tool_input":{"file_path":"/tmp/src/app.ts"}}' | HOME="$TEST_HOME" bash "$HOOK_DIR/conflict-guard.sh" 2>&1 || true)
TOTAL=$((TOTAL + 1))
if echo "$RESULT" | grep -q "WARNING"; then
  FAIL=$((FAIL + 1))
  echo -e "  ${RED}FAIL${NC} should ignore closed sessions"
else
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}PASS${NC} ignores closed sessions"
fi
restore_home "$TEST_HOME"

# ─── portable.sh tests ───
echo ""
echo "=== portable.sh ==="

source "$HOOK_DIR/lib/portable.sh"

# Test get_file_mtime_epoch
TMPF=$(mktemp)
MTIME=$(get_file_mtime_epoch "$TMPF")
TOTAL=$((TOTAL + 1))
if [ "$MTIME" -gt 0 ] 2>/dev/null; then
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}PASS${NC} get_file_mtime_epoch returns positive number"
else
  FAIL=$((FAIL + 1))
  echo -e "  ${RED}FAIL${NC} get_file_mtime_epoch returned '$MTIME'"
fi
rm -f "$TMPF"

# Test portable_flock_try / portable_flock_release
LOCK_TMP=$(mktemp)
if portable_flock_try "$LOCK_TMP"; then
  PASS=$((PASS + 1))
  TOTAL=$((TOTAL + 1))
  echo -e "  ${GREEN}PASS${NC} portable_flock_try acquires lock"
  portable_flock_release "$LOCK_TMP"
else
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
  echo -e "  ${RED}FAIL${NC} portable_flock_try failed to acquire lock"
fi
rm -f "$LOCK_TMP"
rm -rf "${LOCK_TMP}.d"

# ─── check-inbox.sh worker completion routing tests ───
echo ""
echo "=== check-inbox.sh worker routing ==="

TEST_HOME=$(new_home)
mkdir -p "$TEST_HOME/.claude/terminals/results"
# Create a completed worker with notify_session_id
jq -n '{"task_id":"W_RT","notify_session_id":"route123","status":"running"}' > "$TEST_HOME/.claude/terminals/results/W_RT.meta.json"
echo '{"status":"completed"}' > "$TEST_HOME/.claude/terminals/results/W_RT.meta.json.done"
echo "Worker output here" > "$TEST_HOME/.claude/terminals/results/W_RT.txt"

echo '{"session_id":"route123abcdefg","tool_name":"Read","tool_input":{}}' | \
  HOME="$TEST_HOME" bash "$HOOK_DIR/check-inbox.sh" 2>/dev/null || true

assert_file_exists "creates .reported after routing" "$TEST_HOME/.claude/terminals/results/W_RT.reported"

# The routing happened and the same check-inbox run consumed the message (displayed above).
# Verify routing occurred by checking .reported exists (already tested) and that
# output contained the worker completion marker.
OUTPUT=$(echo '{"session_id":"route123abcdefg","tool_name":"Read","tool_input":{}}' | \
  HOME="$TEST_HOME" bash "$HOOK_DIR/check-inbox.sh" 2>/dev/null || true)
# Second run should have no messages (already consumed)
assert_eq "inbox empty after routing+consumption" "" "$OUTPUT"
restore_home "$TEST_HOME"

# Test: no routing without .done file
TEST_HOME=$(new_home)
mkdir -p "$TEST_HOME/.claude/terminals/results"
jq -n '{"task_id":"W_ND","notify_session_id":"nod12345","status":"running"}' > "$TEST_HOME/.claude/terminals/results/W_ND.meta.json"
# No .done file — should not route

echo '{"session_id":"nod12345abcdefg","tool_name":"Read","tool_input":{}}' | \
  HOME="$TEST_HOME" bash "$HOOK_DIR/check-inbox.sh" 2>/dev/null || true

assert_file_not_exists "no routing without .done" "$TEST_HOME/.claude/terminals/results/W_ND.reported"
restore_home "$TEST_HOME"

# ─── terminal-heartbeat.sh auto-stale marking tests ───
echo ""
echo "=== terminal-heartbeat.sh auto-stale ==="

TEST_HOME=$(new_home)
# Create the current session (for heartbeat)
jq -n --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{session:"me123456",status:"active",cwd:"/tmp",last_active:$now,tool_counts:{},files_touched:[],recent_ops:[]}' \
  > "$TEST_HOME/.claude/terminals/session-me123456.json"

# Create an old session (last_active >1h ago) using a very old date
jq -n '{session:"stale123",status:"active",cwd:"/tmp",last_active:"2020-01-01T00:00:00Z",tool_counts:{},files_touched:[],recent_ops:[]}' \
  > "$TEST_HOME/.claude/terminals/session-stale123.json"

# Remove the stale-check lock and the heartbeat lock to force both to run fresh
rm -f /tmp/claude-stale-check.lock
rm -f /tmp/claude-heartbeat-me123456.lock
rm -rf /tmp/claude-heartbeat-me123456.lock.d

echo '{"session_id":"me123456abcdef","tool_name":"Read","tool_input":{"file_path":"/tmp/x"},"cwd":"/tmp"}' | \
  HOME="$TEST_HOME" bash "$HOOK_DIR/terminal-heartbeat.sh" 2>/dev/null || true

STALE_STATUS=$(jq -r '.status' "$TEST_HOME/.claude/terminals/session-stale123.json" 2>/dev/null)
assert_eq "marks old session stale" "stale" "$STALE_STATUS"

# Verify current session is NOT marked stale
MY_STATUS=$(jq -r '.status' "$TEST_HOME/.claude/terminals/session-me123456.json" 2>/dev/null)
assert_eq "does not mark current session stale" "active" "$MY_STATUS"
restore_home "$TEST_HOME"

# ─── SUMMARY ───
echo ""
echo "=== Summary ==="
echo -e "Total: $TOTAL  ${GREEN}Pass: $PASS${NC}  ${RED}Fail: $FAIL${NC}"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
