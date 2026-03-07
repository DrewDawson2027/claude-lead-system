#!/usr/bin/env bash
# autonomous-dispatcher.sh — Setup a git worktree slot for parallel autonomous work.
#
# Usage:
#   autonomous-dispatcher.sh <"task description"> [target_repo_path]
#
# Outputs (to stdout):
#   SLOT_PATH=/Users/.../slot-N
#   BRANCH=auto/20260228-implement-oauth-flow
#   REPO_PATH=/path/to/repo
#   STATUS=ready|no_slot|no_repo
#
# Side effects:
#   - Claims a worktree slot (writes lock file)
#   - Creates or checks out feature branch in that slot
#   - Sets up .claude/context.md in slot with task description
#
# On failure: outputs STATUS=no_slot or STATUS=no_repo (never aborts with non-0)

set -uo pipefail

TASK="${1:-autonomous task}"
# REPO_PATH is exported for child processes spawned from this script
export REPO_PATH="${2:-$PWD}"
PICK="$HOME/.claude/hooks/worktree-pick.sh"

# ── 1. Claim a slot ──────────────────────────────────────────────────────────
if [ ! -x "$PICK" ]; then
  echo "STATUS=no_slot"
  echo "ERROR=worktree-pick.sh not found at $PICK"
  exit 0
fi

SLOT=$("$PICK" claim "${CLAUDE_SESSION_ID:-$$}" 2>/dev/null)
if [ "$SLOT" = "NO_SLOT_AVAILABLE" ] || [ -z "$SLOT" ]; then
  echo "STATUS=no_slot"
  echo "SLOT_STATUS=$("$PICK" status 2>/dev/null | tr '\n' ' ')"
  exit 0
fi

# ── 2. Verify the slot has a git worktree ───────────────────────────────────
if [ ! -f "$SLOT/.git" ]; then
  echo "STATUS=no_repo"
  echo "REASON=slot $SLOT has no .git file — needs git worktree add"
  "$PICK" release "$SLOT" 2>/dev/null
  exit 0
fi

# ── 3. Derive branch name from task description ──────────────────────────────
DATE=$(date +%Y%m%d)
SLUG=$(echo "$TASK" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-//' | cut -c1-45 | sed 's/-$//')
BRANCH="auto/${DATE}-${SLUG}"

# ── 4. Check out / create the branch in the slot ────────────────────────────
cd "$SLOT" || { echo "STATUS=no_slot"; exit 0; }

git checkout -b "$BRANCH" 2>&1 || git checkout "$BRANCH" 2>&1
CHECKOUT_EXIT=$?

if [ $CHECKOUT_EXIT -ne 0 ]; then
  # If branch already exists from a different base, use it
  EXISTING=$(git branch --list "$BRANCH" 2>/dev/null)
  if [ -z "$EXISTING" ]; then
    # Try from main or master
    BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||' || echo "main")
    git checkout -b "$BRANCH" "$BASE" 2>/dev/null || true
  fi
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# ── 5. Write task context into slot ─────────────────────────────────────────
mkdir -p "$SLOT/.claude"
cat > "$SLOT/.claude/current-task.md" << TASK_EOF
# Autonomous Task

**Task**: $TASK
**Slot**: $SLOT
**Branch**: $CURRENT_BRANCH
**Started**: $(date -u +%Y-%m-%dT%H:%M:%SZ)
**Session**: ${CLAUDE_SESSION_ID:-unknown}

## Instructions
Work exclusively in this worktree directory.
Commit changes to the \`$CURRENT_BRANCH\` branch.
When done, the caller will merge into main.

## This slot is locked during work.
To release manually: ~/.claude/hooks/worktree-pick.sh release "$SLOT"
TASK_EOF

# ── 6. Output results ────────────────────────────────────────────────────────
echo "STATUS=ready"
echo "SLOT_PATH=$SLOT"
echo "BRANCH=$CURRENT_BRANCH"
echo "SLOT_DIR=$SLOT"

exit 0
