#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${TMPDIR:-/tmp}/claude-lead-conflict-hero"

usage() {
  cat <<'EOF'
Usage: preflight_conflict_hero_demo.sh [--target PATH]
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      TARGET_DIR="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

ARTIFACT_DIR="$TARGET_DIR/.demo-artifacts"
RECORDING_DIR="$ARTIFACT_DIR/recording"
STAMP="$(date +%Y%m%d-%H%M%S)"
PREFLIGHT_DIR="$ARTIFACT_DIR/evidence/preflight-$STAMP"
SUMMARY_FILE="$PREFLIGHT_DIR/preflight-summary.md"
RECEIPTS_FILE="$PREFLIGHT_DIR/command-receipts.txt"
STATUS=0

require_file() {
  local path="$1"
  if [ ! -e "$path" ]; then
    echo "Missing required file: $path" >&2
    STATUS=1
  fi
}

require_contains() {
  local path="$1"
  local needle="$2"
  if [ ! -f "$path" ] || ! grep -Fq "$needle" "$path"; then
    echo "Missing required content in $path: $needle" >&2
    STATUS=1
  fi
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    STATUS=1
  fi
}

if [ ! -d "$TARGET_DIR" ]; then
  echo "Project directory not found: $TARGET_DIR" >&2
  echo "Run assets/demo/prepare_conflict_hero_demo.sh first." >&2
  exit 1
fi

mkdir -p "$PREFLIGHT_DIR"

require_command git
require_command node
require_command osascript
require_file "$TARGET_DIR/src/auth.ts"
require_file "$TARGET_DIR/tests/auth.integration.test.ts"
require_file "$RECORDING_DIR/worker-a-prompt.txt"
require_file "$RECORDING_DIR/worker-b-prompt.txt"
require_file "$RECORDING_DIR/lead-commands.txt"
require_file "$RECORDING_DIR/operator-script.md"
require_file "$RECORDING_DIR/recording-checklist.md"
require_file "$SCRIPT_DIR/setup_conflict_hero_terminals.sh"
require_file "$SCRIPT_DIR/collect_conflict_hero_evidence.sh"
require_contains "$RECORDING_DIR/worker-a-prompt.txt" "src/auth.ts"
require_contains "$RECORDING_DIR/worker-b-prompt.txt" "tests/auth.integration.test.ts"
require_contains "$RECORDING_DIR/lead-commands.txt" "/lead"
require_contains "$RECORDING_DIR/lead-commands.txt" "conflicts"
require_contains "$RECORDING_DIR/lead-commands.txt" "tell <worker-b-session-id> stop editing src/auth.ts"
require_contains "$RECORDING_DIR/operator-script.md" "## Pre-record"
require_contains "$RECORDING_DIR/operator-script.md" "## On-record"
require_contains "$RECORDING_DIR/operator-script.md" "## Post-record"
require_contains "$RECORDING_DIR/operator-script.md" "collect_conflict_hero_evidence.sh"
require_contains "$RECORDING_DIR/recording-checklist.md" 'uncut-proof-recording.mp4'

ITERM_VERSION="not-checked"
if command -v osascript >/dev/null 2>&1; then
  ITERM_VERSION="$(osascript -e 'tell application "iTerm2" to version' 2>/dev/null || echo unavailable)"
  if [ "$ITERM_VERSION" = "unavailable" ]; then
    echo "Unable to query iTerm2 version via AppleScript." >&2
    STATUS=1
  fi
fi

GIT_HEAD="unavailable"
GIT_STATUS="unavailable"
if git -C "$TARGET_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_HEAD="$(git -C "$TARGET_DIR" rev-parse --short HEAD 2>/dev/null || echo unavailable)"
  GIT_STATUS="$(git -C "$TARGET_DIR" status --short 2>/dev/null || true)"
fi

NODE_VERSION="$(node --version 2>/dev/null || echo unavailable)"
GIT_VERSION="$(git --version 2>/dev/null || echo unavailable)"
MAC_VERSION="$(sw_vers 2>/dev/null || true)"
UNAME_VALUE="$(uname -a 2>/dev/null || true)"

cat > "$SUMMARY_FILE" <<EOF
# Conflict Hero Demo Preflight

- Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- Project directory: $TARGET_DIR
- Recording directory: $RECORDING_DIR
- Git head: $GIT_HEAD
- Node version: $NODE_VERSION
- Git version: $GIT_VERSION
- iTerm2 version: $ITERM_VERSION
- Status: $( [ "$STATUS" -eq 0 ] && printf 'PASS' || printf 'FAIL' )

## Required files

- src/auth.ts
- tests/auth.integration.test.ts
- .demo-artifacts/recording/worker-a-prompt.txt
- .demo-artifacts/recording/worker-b-prompt.txt
- .demo-artifacts/recording/lead-commands.txt
- .demo-artifacts/recording/operator-script.md
- .demo-artifacts/recording/recording-checklist.md

## Next commands

1. bash assets/demo/setup_conflict_hero_terminals.sh "$TARGET_DIR"
2. Paste the prompts from the recording directory into the worker panes.
3. Start recording only after both workers have visibly touched src/auth.ts.
4. Run the exact lead commands from .demo-artifacts/recording/lead-commands.txt.
EOF

{
  echo "== conflict hero preflight =="
  echo "timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "target_dir=$TARGET_DIR"
  echo "recording_dir=$RECORDING_DIR"
  echo "git_head=$GIT_HEAD"
  echo "node_version=$NODE_VERSION"
  echo "git_version=$GIT_VERSION"
  echo "iterm2_version=$ITERM_VERSION"
  echo
  echo "== sw_vers =="
  printf '%s\n' "$MAC_VERSION"
  echo
  echo "== uname -a =="
  printf '%s\n' "$UNAME_VALUE"
  echo
  echo "== git status --short =="
  printf '%s\n' "$GIT_STATUS"
  echo
  echo "== git log --oneline -1 =="
  git -C "$TARGET_DIR" log --oneline -1 2>/dev/null || true
} > "$RECEIPTS_FILE"

if [ "$STATUS" -ne 0 ]; then
  echo "Conflict-hero preflight failed. See: $SUMMARY_FILE" >&2
  exit 1
fi

cat <<EOF
Conflict-hero preflight passed.

Summary:
  $SUMMARY_FILE

Command receipts:
  $RECEIPTS_FILE

Next:
  bash assets/demo/setup_conflict_hero_terminals.sh "$TARGET_DIR"
EOF
