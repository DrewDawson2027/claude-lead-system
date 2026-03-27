#!/usr/bin/env bash
# Install git hooks for the claude-lead-system repo.
# Usage: bash scripts/install-hooks.sh
set -euo pipefail

HOOKS_DIR="$(git rev-parse --git-dir)/hooks"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat > "$HOOKS_DIR/pre-commit" << 'HOOK'
#!/usr/bin/env bash
# pre-commit: syntax-check staged JS + secrets detection
set -euo pipefail

# ── JS/MJS syntax check ──────────────────────────────────────────────
staged_js=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|mjs)$' || true)

js_failed=0
if [ -n "$staged_js" ]; then
  while IFS= read -r file; do
    if ! node --check "$file" 2>&1; then
      echo "❌  Syntax error in: $file"
      js_failed=1
    fi
  done <<< "$staged_js"
fi

# ── Secrets detection ─────────────────────────────────────────────────
all_staged=$(git diff --cached --name-only --diff-filter=ACM || true)
secrets_failed=0

if [ -n "$all_staged" ]; then
  secrets_pattern='(PRIVATE.KEY|BEGIN RSA|BEGIN EC|BEGIN OPENSSH|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_|xoxb-|xoxp-|AKIA[0-9A-Z]{16}|password\s*=\s*["\x27][^"\x27]{8,}|secret\s*=\s*["\x27][^"\x27]{8,}|token\s*=\s*["\x27][^"\x27]{8,})'

  while IFS= read -r file; do
    [ -f "$file" ] || continue
    size=$(wc -c < "$file" 2>/dev/null || echo 0)
    [ "$size" -lt 1048576 ] || continue

    if git diff --cached -- "$file" | grep -qEi "$secrets_pattern" 2>/dev/null; then
      echo "🔑  Potential secret detected in: $file"
      secrets_failed=1
    fi
  done <<< "$all_staged"

  if echo "$all_staged" | grep -qE '\.(pem|key|pfx|p12|keystore)$'; then
    echo "🔑  Sensitive file type staged for commit"
    secrets_failed=1
  fi

  if echo "$all_staged" | grep -qE '\.env$|\.env\.local$|\.env\.production$'; then
    echo "🔑  .env file staged for commit"
    secrets_failed=1
  fi
fi

# ── Results ───────────────────────────────────────────────────────────
failed=0
if [ "$js_failed" -eq 1 ]; then
  echo ""
  echo "Commit blocked: fix syntax errors above."
  failed=1
fi

if [ "$secrets_failed" -eq 1 ]; then
  echo ""
  echo "Commit blocked: potential secrets detected. Remove them or add to .gitignore."
  echo "To bypass (UNSAFE): git commit --no-verify"
  failed=1
fi

[ "$failed" -eq 1 ] && exit 1

if [ -n "$staged_js" ]; then
  echo "✅  All staged JS/MJS files passed syntax check."
fi
echo "✅  No secrets detected in staged changes."
HOOK

chmod +x "$HOOKS_DIR/pre-commit"
echo "✅  Git hooks installed."
