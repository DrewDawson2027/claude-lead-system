#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/demo-project"
TARGET_DIR="${TMPDIR:-/tmp}/claude-lead-conflict-hero"
FORCE=0

usage() {
  cat <<'EOF'
Usage: prepare_conflict_hero_demo.sh [--target PATH] [--force]
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      TARGET_DIR="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
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

if [ ! -d "$TEMPLATE_DIR" ]; then
  echo "Demo template not found: $TEMPLATE_DIR" >&2
  exit 1
fi

if [ -e "$TARGET_DIR" ]; then
  if [ "$FORCE" -ne 1 ]; then
    echo "Target already exists: $TARGET_DIR" >&2
    echo "Re-run with --force to replace it." >&2
    exit 1
  fi
  rm -rf "$TARGET_DIR"
fi

mkdir -p "$(dirname "$TARGET_DIR")"
cp -R "$TEMPLATE_DIR" "$TARGET_DIR"
ARTIFACT_DIR="$TARGET_DIR/.demo-artifacts"
RECORDING_DIR="$ARTIFACT_DIR/recording"
mkdir -p "$ARTIFACT_DIR/raw" "$ARTIFACT_DIR/screenshots" "$ARTIFACT_DIR/evidence" "$RECORDING_DIR"

if command -v git >/dev/null 2>&1; then
  git -C "$TARGET_DIR" init -q
  git -C "$TARGET_DIR" config user.name "Claude Lead Demo"
  git -C "$TARGET_DIR" config user.email "demo@example.com"
  git -C "$TARGET_DIR" add .
  git -C "$TARGET_DIR" commit -q -m "demo baseline"
fi

cat > "$RECORDING_DIR/worker-a-prompt.txt" <<'EOF'
Implement refresh-token support in src/auth.ts. Own src/auth.ts for this take. Keep the work centered in that file unless the lead explicitly reassigns you.
EOF

cat > "$RECORDING_DIR/worker-b-prompt.txt" <<'EOF'
Add auth integration coverage in tests/auth.integration.test.ts. You may inspect src/auth.ts and patch a small missing test seam in src/auth.ts if needed to make the test coverage credible. If the lead tells you to stop touching src/auth.ts, continue only in tests/auth.integration.test.ts and report any remaining auth.ts changes instead of editing them.
EOF

cat > "$RECORDING_DIR/lead-commands.txt" <<'EOF'
/lead
conflicts
tell <worker-b-session-id> stop editing src/auth.ts. worker <worker-a-session-id> owns that file. continue only in tests/auth.integration.test.ts. if auth.ts needs changes, report them instead of editing the file.
conflicts
EOF

cat > "$RECORDING_DIR/session-ids-template.txt" <<'EOF'
lead=
worker_a=
worker_b=
EOF

cat > "$RECORDING_DIR/recording-checklist.md" <<'EOF'
# Conflict Hero Recording Checklist

- Use coordinator mode only.
- Start recording only after both workers are already active in the same repo.
- Keep all three panes visible for the full take.
- No cuts between the first `conflicts` command and the second `conflicts` command.
- Hold 1-2 seconds on the conflict output.
- Hold 2-3 seconds on the cleared output.
- Capture screenshots for conflict found, directive sent, and conflict cleared.
- Save the uncut take as `uncut-proof-recording.mp4`.
EOF

cat > "$RECORDING_DIR/operator-script.md" <<'EOF'
# Conflict Hero Operator Script

## Pre-record

1. Run `bash assets/demo/preflight_conflict_hero_demo.sh --target "${TMPDIR:-/tmp}/claude-lead-conflict-hero"`.
2. Run `bash assets/demo/setup_conflict_hero_terminals.sh "${TMPDIR:-/tmp}/claude-lead-conflict-hero"`.
3. Paste `worker-a-prompt.txt` into the top-right pane.
4. Paste `worker-b-prompt.txt` into the bottom-right pane.
5. Wait until both workers have visibly read or touched `src/auth.ts`.
6. Start the screen recording only after the overlap is already in motion.

## On-record

1. In the lead pane, run `/lead`.
2. Pause until both sessions and `src/auth.ts` are visible.
3. Run `conflicts`.
4. Hold 1-2 seconds on the overlap readout.
5. Run the directive from `lead-commands.txt` with the real session IDs.
6. Keep all three panes visible until Worker B visibly pivots.
7. Re-run `conflicts`.
8. Hold 2-3 seconds on the cleared state.

## Post-record

1. Save `uncut-proof-recording.mp4` into `${TMPDIR:-/tmp}/claude-lead-conflict-hero/.demo-artifacts/raw`.
2. Save the three screenshots into `${TMPDIR:-/tmp}/claude-lead-conflict-hero/.demo-artifacts/screenshots`.
3. Record the session IDs in `session-ids-template.txt`.
4. Run `bash assets/demo/collect_conflict_hero_evidence.sh --project "${TMPDIR:-/tmp}/claude-lead-conflict-hero" --lead <lead-session-id> --worker-a <worker-a-session-id> --worker-b <worker-b-session-id> --recording uncut-proof-recording.mp4 --conflict-shot screenshot-conflict-found.png --directive-shot screenshot-directive-sent.png --cleared-shot screenshot-conflict-cleared.png`.
EOF

cat <<EOF
Conflict-prevention hero demo workspace ready.

Project directory:
  $TARGET_DIR

Recommended pane roles:
  Left: lead
  Top-right: worker-a
  Bottom-right: worker-b

Worker A prompt:
  $RECORDING_DIR/worker-a-prompt.txt

Worker B prompt:
  $RECORDING_DIR/worker-b-prompt.txt

Exact on-record lead commands:
  $RECORDING_DIR/lead-commands.txt

Exact operator script:
  $RECORDING_DIR/operator-script.md

Recording checklist:
  $RECORDING_DIR/recording-checklist.md

Suggested artifact directory:
  $ARTIFACT_DIR
EOF
