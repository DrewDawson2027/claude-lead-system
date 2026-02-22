#!/usr/bin/env bash
# Claude Lead System — one-command installer
# Usage: curl -fsSL https://raw.githubusercontent.com/DrewDawson2027/claude-lead-system/main/install.sh | bash

set -euo pipefail

REPO="https://github.com/DrewDawson2027/claude-lead-system.git"
CLAUDE_DIR="$HOME/.claude"
TMP_DIR=$(mktemp -d)
MODE="full"

usage() {
  cat <<USAGE
Claude Lead System installer

Usage: install.sh [--mode lite|hybrid|full]

Modes:
  lite    Sidecar + wrapper + coordinator + settings merge (minimal/no hooks)
  hybrid  Sidecar + coordinator + hooks + settings merge
  full    Full install (default): hybrid plus full hook/policy template wiring
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

case "$MODE" in
  lite|hybrid|full) ;;
  *)
    echo "Invalid mode: $MODE (expected lite|hybrid|full)" >&2
    exit 1
    ;;
esac

echo ""
echo "  Claude Lead System — Installer"
echo "  ================================"
echo "  Mode: $MODE"
echo ""

# ── Preflight checks ────────────────────────────────────────────────
check_dep() {
  if ! command -v "$1" &>/dev/null; then
    echo "  ✗  Missing dependency: $1"
    echo "     Install with: $2"
    exit 1
  fi
  echo "  ✓  $1 found"
}

echo "Checking dependencies..."
check_dep git   "https://git-scm.com"
check_dep jq    "brew install jq  /  apt install jq  /  choco install jq"
check_dep node  "https://nodejs.org (v18+)"
check_dep bash  "(should be pre-installed)"
echo ""

# ── Clone ────────────────────────────────────────────────────────────
echo "Cloning repository..."
git clone --depth 1 "$REPO" "$TMP_DIR/claude-lead-system" --quiet
echo ""

SRC="$TMP_DIR/claude-lead-system"

# ── Backup existing hooks ────────────────────────────────────────────
if [ "$MODE" != "lite" ] && [ -d "$CLAUDE_DIR/hooks" ]; then
  BACKUP="$CLAUDE_DIR/hooks.backup.$(date +%Y%m%d%H%M%S)"
  echo "  ⚠  Existing hooks found — backing up to $BACKUP"
  cp -r "$CLAUDE_DIR/hooks" "$BACKUP"
fi

# ── Copy files ───────────────────────────────────────────────────────
echo "Installing files..."
mkdir -p "$CLAUDE_DIR/hooks/session-state" "$CLAUDE_DIR/commands" "$CLAUDE_DIR/mcp-coordinator"
mkdir -p "$CLAUDE_DIR/agents" "$CLAUDE_DIR/lead-tools"
mkdir -p "$CLAUDE_DIR/master-agents/coder/refs" "$CLAUDE_DIR/master-agents/researcher/refs"
mkdir -p "$CLAUDE_DIR/master-agents/architect/refs" "$CLAUDE_DIR/master-agents/workflow/refs"
mkdir -p "$CLAUDE_DIR/lead-sidecar"

if [ "$MODE" != "lite" ]; then
  cp -r "$SRC/hooks/"           "$CLAUDE_DIR/hooks/"
  chmod +x "$CLAUDE_DIR/hooks/"*.sh
  echo "  ✓  Hooks installed"
else
  echo "  ✓  Lite mode: skipping hook install"
fi
cp -r "$SRC/commands/"        "$CLAUDE_DIR/commands/"
cp -r "$SRC/mcp-coordinator/" "$CLAUDE_DIR/mcp-coordinator/"
rm -rf "$CLAUDE_DIR/lead-sidecar"
cp -r "$SRC/sidecar/"         "$CLAUDE_DIR/lead-sidecar/"
chmod +x "$CLAUDE_DIR/lead-sidecar/bin/"* 2>/dev/null || true
echo "  ✓  Commands, MCP coordinator, and Sidecar installed"

# ── Master agents ────────────────────────────────────────────────────
echo ""
echo "Installing master agents..."
cp "$SRC/agents/"*.md "$CLAUDE_DIR/agents/"
echo "  ✓  Master agents + role agents installed"

# ── Mode files + reference cards ─────────────────────────────────────
echo "Installing mode files and reference cards..."
cp "$SRC/modes/coder/"*.md "$CLAUDE_DIR/master-agents/coder/"
cp "$SRC/modes/coder/refs/"*.md "$CLAUDE_DIR/master-agents/coder/refs/" 2>/dev/null || true
cp "$SRC/modes/researcher/"*.md "$CLAUDE_DIR/master-agents/researcher/"
cp "$SRC/modes/researcher/refs/"*.md "$CLAUDE_DIR/master-agents/researcher/refs/" 2>/dev/null || true
cp "$SRC/modes/architect/"*.md "$CLAUDE_DIR/master-agents/architect/"
cp "$SRC/modes/architect/refs/"*.md "$CLAUDE_DIR/master-agents/architect/refs/" 2>/dev/null || true
cp "$SRC/modes/workflow/"*.md "$CLAUDE_DIR/master-agents/workflow/"
cp "$SRC/MANIFEST.md" "$CLAUDE_DIR/master-agents/"
echo "  ✓  17 modes + 18 reference cards installed"

# ── Lead tools ───────────────────────────────────────────────────────
cp "$SRC/lead-tools/"* "$CLAUDE_DIR/lead-tools/" 2>/dev/null || true
chmod +x "$CLAUDE_DIR/lead-tools/"*.sh 2>/dev/null || true
echo "  ✓  Lead tools installed"

# ── Install MCP deps ─────────────────────────────────────────────────
echo ""
echo "Installing MCP coordinator dependencies..."
(cd "$CLAUDE_DIR/mcp-coordinator" && npm install --silent)
echo "  ✓  npm packages installed"

# ── Sidecar deps (dependency-free today, keep hook for future additions) ──────
echo "Preparing sidecar..."
if [ -f "$CLAUDE_DIR/lead-sidecar/package.json" ]; then
  (cd "$CLAUDE_DIR/lead-sidecar" && npm install --silent --omit=dev >/dev/null 2>&1 || true)
fi
mkdir -p "$HOME/.local/bin"
ln -sf "$CLAUDE_DIR/lead-sidecar/bin/claudex" "$HOME/.local/bin/claudex"
ln -sf "$CLAUDE_DIR/lead-sidecar/bin/sidecarctl" "$HOME/.local/bin/sidecarctl"
echo "  ✓  Sidecar wrapper commands linked in ~/.local/bin (add to PATH if needed)"

# ── Settings ─────────────────────────────────────────────────────────
echo ""
echo "Merging settings.local.json ($MODE mode)..."
if [ ! -f "$CLAUDE_DIR/lead-sidecar/templates/settings.full.json" ]; then
  cp "$SRC/settings/settings.local.json" "$CLAUDE_DIR/lead-sidecar/templates/settings.full.json"
fi
node "$CLAUDE_DIR/lead-sidecar/bin/merge-settings.mjs" --mode "$MODE"
echo "  ✓  settings.local.json merged (backup created automatically if file existed)"

# ── Cleanup ──────────────────────────────────────────────────────────
rm -rf "$TMP_DIR"

# ── Health check ─────────────────────────────────────────────────────
if [ "$MODE" != "lite" ]; then
  echo ""
  echo "Running health check..."
  echo ""
  bash "$CLAUDE_DIR/hooks/health-check.sh"
else
  echo ""
  echo "Lite mode installed. Starting sidecar once to verify runtime..."
  "$CLAUDE_DIR/lead-sidecar/bin/claudex" --mode lite --sidecar-only --open-dashboard || true
fi

echo ""
echo "  ✅  Installation complete!"
echo "  Launch with: claudex   (wrapper starts sidecar + patches settings idempotently)"
echo "  Or type /lead in any Claude Code session to use coordinator tools."
if ! echo ":$PATH:" | grep -q ":$HOME/.local/bin:"; then
  echo "  Note: ~/.local/bin is not on PATH in this shell. Add it to use 'claudex' directly."
fi
echo ""
