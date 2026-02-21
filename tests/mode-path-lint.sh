#!/usr/bin/env bash
# Mode Path Linter — validates all file paths referenced in agent definitions exist in the repo
# Checks: agents/*.md keyword tables reference modes/ paths that actually exist
# Also: mode files referencing ref card paths that actually exist
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ERRORS=0

echo "Mode path linter"
echo "================"
echo ""

# Map ~/.claude/master-agents/ paths to repo modes/ paths
# Agent .md files use absolute ~/.claude/ paths; in the repo these live under modes/ and agents/
resolve_path() {
  local path="$1"
  # ~/.claude/master-agents/coder/build-mode.md -> modes/coder/build-mode.md
  echo "$path" | sed 's|~/.claude/master-agents/|modes/|' | sed 's|`||g'
}

# 1. Check all paths in agent keyword tables
echo "Checking agent keyword tables..."
for agent_file in "$REPO_ROOT"/agents/*.md; do
  agent_name=$(basename "$agent_file")
  # Extract paths that look like ~/.claude/master-agents/.../*.md
  paths=$(grep -oE '~/.claude/master-agents/[^ |`]+\.md' "$agent_file" 2>/dev/null || true)
  if [ -z "$paths" ]; then
    echo "  WARN: $agent_name has no mode file references"
    continue
  fi
  while IFS= read -r ref_path; do
    repo_path=$(resolve_path "$ref_path")
    if [ ! -f "$REPO_ROOT/$repo_path" ]; then
      echo "  FAIL: $agent_name references $ref_path"
      echo "        expected at $repo_path — NOT FOUND"
      ERRORS=$((ERRORS + 1))
    fi
  done <<< "$paths"
  count=$(echo "$paths" | wc -l | tr -d ' ')
  echo "  OK: $agent_name — $count paths verified"
done

echo ""

# 2. Check ref card paths in agent files
# Agents reference ref cards in two forms:
#   - Absolute: ~/.claude/master-agents/coder/refs/testing-py.md
#   - Relative: refs/testing-py.md (relative to the agent's mode directory)
echo "Checking reference card paths..."
for agent_file in "$REPO_ROOT"/agents/*.md; do
  agent_name=$(basename "$agent_file")
  ref_count=0

  # Determine the agent's mode directory from agent name (master-coder -> coder)
  agent_type=$(echo "$agent_name" | sed 's/master-//' | sed 's/\.md//')

  # Check absolute ref paths
  abs_refs=$(grep -oE '~/.claude/master-agents/[^ |`]+/refs/[^ |`]+\.md' "$agent_file" 2>/dev/null || true)
  if [ -n "$abs_refs" ]; then
    while IFS= read -r ref_path; do
      repo_path=$(resolve_path "$ref_path")
      if [ ! -f "$REPO_ROOT/$repo_path" ]; then
        echo "  FAIL: $agent_name references $ref_path"
        echo "        expected at $repo_path — NOT FOUND"
        ERRORS=$((ERRORS + 1))
      fi
      ref_count=$((ref_count + 1))
    done <<< "$abs_refs"
  fi

  # Check relative ref paths (refs/something.md in backticks)
  rel_refs=$(grep -oE '`refs/[^`]+\.md`' "$agent_file" 2>/dev/null | sed 's/`//g' || true)
  if [ -n "$rel_refs" ]; then
    while IFS= read -r ref_path; do
      repo_path="modes/$agent_type/$ref_path"
      if [ ! -f "$REPO_ROOT/$repo_path" ]; then
        echo "  FAIL: $agent_name references $ref_path"
        echo "        expected at $repo_path — NOT FOUND"
        ERRORS=$((ERRORS + 1))
      fi
      ref_count=$((ref_count + 1))
    done <<< "$rel_refs"
  fi

  if [ "$ref_count" -gt 0 ]; then
    echo "  OK: $agent_name — $ref_count ref card paths verified"
  fi
done

echo ""

# 3. Check that every mode file in modes/ is referenced by at least one agent
echo "Checking for orphaned mode files..."
for mode_file in "$REPO_ROOT"/modes/*/*.md; do
  # Skip refs/ subdirectory files for this check
  if [[ "$mode_file" == */refs/* ]]; then
    continue
  fi
  relative=$(echo "$mode_file" | sed "s|$REPO_ROOT/||")
  # Convert to the ~/.claude/ form agents use
  absolute_form=$(echo "$relative" | sed 's|modes/|~/.claude/master-agents/|')
  if ! grep -rq "$absolute_form" "$REPO_ROOT/agents/" 2>/dev/null; then
    echo "  WARN: $relative is not referenced by any agent"
  fi
done

echo ""

# 4. Check that every ref card in modes/*/refs/ is referenced by at least one agent
echo "Checking for orphaned ref cards..."
for ref_file in "$REPO_ROOT"/modes/*/refs/*.md; do
  [ -f "$ref_file" ] || continue
  relative=$(echo "$ref_file" | sed "s|$REPO_ROOT/||")
  filename=$(basename "$ref_file")
  # Check both absolute form (~/.claude/master-agents/.../refs/X.md) and relative (refs/X.md)
  absolute_form=$(echo "$relative" | sed 's|modes/|~/.claude/master-agents/|')
  relative_form="refs/$filename"
  if ! grep -rq "$absolute_form" "$REPO_ROOT/agents/" 2>/dev/null && \
     ! grep -rq "$relative_form" "$REPO_ROOT/agents/" 2>/dev/null; then
    echo "  WARN: $relative is not referenced by any agent"
  fi
done

echo ""

# Summary
if [ "$ERRORS" -gt 0 ]; then
  echo "FAILED: $ERRORS broken path(s) found"
  exit 1
else
  echo "PASSED: All mode file and ref card paths are valid"
  exit 0
fi
