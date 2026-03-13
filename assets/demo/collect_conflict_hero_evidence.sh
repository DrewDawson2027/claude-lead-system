#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_DIR="${TMPDIR:-/tmp}/claude-lead-conflict-hero"
LEAD_ID=""
WORKER_A_ID=""
WORKER_B_ID=""
RECORDING_FILE=""
CONFLICT_SHOT=""
DIRECTIVE_SHOT=""
CLEARED_SHOT=""
ARTIFACT_DIR="$PROJECT_DIR/.demo-artifacts"
RECORDING_DIR="$ARTIFACT_DIR/recording"
STAMP="$(date +%Y%m%d-%H%M%S)"
EVIDENCE_DIR="$ARTIFACT_DIR/evidence/$STAMP"
RAW_DIR="$ARTIFACT_DIR/raw"
SHOT_DIR="$ARTIFACT_DIR/screenshots"
TERMINALS_DIR="${HOME}/.claude/terminals"
INBOX_DIR="$TERMINALS_DIR/inbox"

usage() {
  cat <<'EOF'
Usage: collect_conflict_hero_evidence.sh [--project PATH] [--lead SESSION_ID] [--worker-a SESSION_ID] [--worker-b SESSION_ID] [--recording FILE] [--conflict-shot FILE] [--directive-shot FILE] [--cleared-shot FILE]
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project)
      PROJECT_DIR="$2"
      shift 2
      ;;
    --lead)
      LEAD_ID="$2"
      shift 2
      ;;
    --worker-a)
      WORKER_A_ID="$2"
      shift 2
      ;;
    --worker-b)
      WORKER_B_ID="$2"
      shift 2
      ;;
    --recording)
      RECORDING_FILE="$2"
      shift 2
      ;;
    --conflict-shot)
      CONFLICT_SHOT="$2"
      shift 2
      ;;
    --directive-shot)
      DIRECTIVE_SHOT="$2"
      shift 2
      ;;
    --cleared-shot)
      CLEARED_SHOT="$2"
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

ARTIFACT_DIR="$PROJECT_DIR/.demo-artifacts"
RECORDING_DIR="$ARTIFACT_DIR/recording"
EVIDENCE_DIR="$ARTIFACT_DIR/evidence/$STAMP"
RAW_DIR="$ARTIFACT_DIR/raw"
SHOT_DIR="$ARTIFACT_DIR/screenshots"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Project directory not found: $PROJECT_DIR" >&2
  exit 1
fi

if [ ! -d "$RECORDING_DIR" ]; then
  echo "Recording bundle not found: $RECORDING_DIR" >&2
  echo "Run assets/demo/prepare_conflict_hero_demo.sh first." >&2
  exit 1
fi

mkdir -p "$EVIDENCE_DIR"
mkdir -p "$RAW_DIR" "$SHOT_DIR"
mkdir -p "$EVIDENCE_DIR/code-pointers" "$EVIDENCE_DIR/recording"

copy_if_exists() {
  local src="$1"
  local dest="$2"
  if [ -e "$src" ]; then
    cp "$src" "$dest"
  fi
}

copy_proof_asset() {
  local explicit_path="$1"
  local canonical_path="$2"
  local evidence_name="$3"
  if [ -n "$explicit_path" ] && [ -e "$explicit_path" ]; then
    if [ "$explicit_path" != "$canonical_path" ]; then
      cp "$explicit_path" "$canonical_path"
    fi
  fi
  if [ -e "$canonical_path" ]; then
    cp "$canonical_path" "$EVIDENCE_DIR/$evidence_name"
  fi
}

copy_if_exists "$TERMINALS_DIR/activity.jsonl" "$EVIDENCE_DIR/activity.jsonl"
copy_if_exists "$TERMINALS_DIR/conflicts.jsonl" "$EVIDENCE_DIR/conflicts.jsonl"

copy_if_exists "$RECORDING_DIR/worker-a-prompt.txt" "$EVIDENCE_DIR/recording/worker-a-prompt.txt"
copy_if_exists "$RECORDING_DIR/worker-b-prompt.txt" "$EVIDENCE_DIR/recording/worker-b-prompt.txt"
copy_if_exists "$RECORDING_DIR/lead-commands.txt" "$EVIDENCE_DIR/recording/lead-commands.txt"
copy_if_exists "$RECORDING_DIR/operator-script.md" "$EVIDENCE_DIR/recording/operator-script.md"
copy_if_exists "$RECORDING_DIR/recording-checklist.md" "$EVIDENCE_DIR/recording/recording-checklist.md"
copy_if_exists "$RECORDING_DIR/session-ids-template.txt" "$EVIDENCE_DIR/recording/session-ids-template.txt"

LATEST_PREFLIGHT_DIR="$(find "$ARTIFACT_DIR/evidence" -maxdepth 1 -type d -name 'preflight-*' 2>/dev/null | sort | tail -n 1)"
if [ -n "$LATEST_PREFLIGHT_DIR" ] && [ -d "$LATEST_PREFLIGHT_DIR" ]; then
  mkdir -p "$EVIDENCE_DIR/preflight"
  copy_if_exists "$LATEST_PREFLIGHT_DIR/preflight-summary.md" "$EVIDENCE_DIR/preflight/preflight-summary.md"
  copy_if_exists "$LATEST_PREFLIGHT_DIR/command-receipts.txt" "$EVIDENCE_DIR/preflight/command-receipts.txt"
fi

copy_if_exists "$REPO_ROOT/mcp-coordinator/lib/conflicts.js" "$EVIDENCE_DIR/code-pointers/conflicts.js"
copy_if_exists "$REPO_ROOT/mcp-coordinator/lib/messaging.js" "$EVIDENCE_DIR/code-pointers/messaging.js"
copy_if_exists "$REPO_ROOT/commands/lead.md" "$EVIDENCE_DIR/code-pointers/lead.md"

copy_proof_asset "$RECORDING_FILE" "$RAW_DIR/uncut-proof-recording.mp4" "uncut-proof-recording.mp4"
copy_proof_asset "$CONFLICT_SHOT" "$SHOT_DIR/screenshot-conflict-found.png" "screenshot-conflict-found.png"
copy_proof_asset "$DIRECTIVE_SHOT" "$SHOT_DIR/screenshot-directive-sent.png" "screenshot-directive-sent.png"
copy_proof_asset "$CLEARED_SHOT" "$SHOT_DIR/screenshot-conflict-cleared.png" "screenshot-conflict-cleared.png"

for session_id in "$LEAD_ID" "$WORKER_A_ID" "$WORKER_B_ID"; do
  if [ -n "$session_id" ]; then
    copy_if_exists "$TERMINALS_DIR/session-$session_id.json" "$EVIDENCE_DIR/session-$session_id.json"
    copy_if_exists "$INBOX_DIR/$session_id.jsonl" "$EVIDENCE_DIR/inbox-$session_id.jsonl"
  fi
done

cat > "$EVIDENCE_DIR/session-ids.txt" <<EOF
lead=$LEAD_ID
worker_a=$WORKER_A_ID
worker_b=$WORKER_B_ID
EOF

{
  echo "timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "project_dir=$PROJECT_DIR"
  echo "repo_root=$REPO_ROOT"
  echo "lead_session=$LEAD_ID"
  echo "worker_a_session=$WORKER_A_ID"
  echo "worker_b_session=$WORKER_B_ID"
  echo
  echo "== sw_vers =="
  sw_vers 2>/dev/null || true
  echo
  echo "== uname -a =="
  uname -a 2>/dev/null || true
  echo
  echo "== node --version =="
  node --version 2>/dev/null || true
  echo
  echo "== git --version =="
  git --version 2>/dev/null || true
  echo
  echo "== git -C project status --short =="
  git -C "$PROJECT_DIR" status --short 2>/dev/null || true
  echo
  echo "== git -C project log --oneline -1 =="
  git -C "$PROJECT_DIR" log --oneline -1 2>/dev/null || true
} > "$EVIDENCE_DIR/environment-and-receipts.txt"

cat > "$EVIDENCE_DIR/timing-notes-template.md" <<EOF
# Timing Notes

- Conflict detection latency:
- Directive delivery latency:
- Worker pivot timestamp:
- Cleared conflict timestamp:
- Notes on any delay or manual pause:
EOF

cat > "$EVIDENCE_DIR/code-pointers.md" <<EOF
# Code Pointers

- mcp-coordinator/lib/conflicts.js
- mcp-coordinator/lib/messaging.js
- commands/lead.md
EOF

cat > "$EVIDENCE_DIR/README.md" <<EOF
# Conflict Hero Evidence Bundle

- Project: $PROJECT_DIR
- Captured at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- Raw recordings directory: $RAW_DIR
- Screenshots directory: $SHOT_DIR
- Lead session: ${LEAD_ID:-not-provided}
- Worker A session: ${WORKER_A_ID:-not-provided}
- Worker B session: ${WORKER_B_ID:-not-provided}

Included bundle contents:
- activity.jsonl
- conflicts.jsonl
- session JSON receipts
- inbox JSONL receipts for provided session IDs
- recording prompts and operator script
- session ID template
- latest preflight summary and command receipts
- environment-and-receipts.txt
- code pointers and copied source files

Required proof assets:
- uncut-proof-recording.mp4
- screenshot-conflict-found.png
- screenshot-directive-sent.png
- screenshot-conflict-cleared.png
- session-ids.txt
- timing-notes-template.md
EOF

cat <<EOF
Conflict-hero evidence bundle created:
  $EVIDENCE_DIR

Proof assets expected at:
  $RAW_DIR/uncut-proof-recording.mp4
  $SHOT_DIR/screenshot-conflict-found.png
  $SHOT_DIR/screenshot-directive-sent.png
  $SHOT_DIR/screenshot-conflict-cleared.png

Session receipt file:
  $EVIDENCE_DIR/session-ids.txt

Timing notes template:
  $EVIDENCE_DIR/timing-notes-template.md
EOF
