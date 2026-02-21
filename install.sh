#!/usr/bin/env bash
# Claude Lead System — one-command installer
# Usage: curl -fsSL https://raw.githubusercontent.com/DrewDawson2027/claude-lead-system/main/install.sh | bash

set -euo pipefail

REPO="https://github.com/DrewDawson2027/claude-lead-system.git"
CLAUDE_DIR="$HOME/.claude"
TMP_DIR=$(mktemp -d)

echo ""
echo "  Claude Lead System — Installer"
echo "  ================================"
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
if [ -d "$CLAUDE_DIR/hooks" ]; then
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

cp -r "$SRC/hooks/"           "$CLAUDE_DIR/hooks/"
cp -r "$SRC/commands/"        "$CLAUDE_DIR/commands/"
cp -r "$SRC/mcp-coordinator/" "$CLAUDE_DIR/mcp-coordinator/"
chmod +x "$CLAUDE_DIR/hooks/"*.sh
echo "  ✓  Hooks, commands, and MCP coordinator installed"

# ── Master agents ────────────────────────────────────────────────────
echo ""
echo "Installing master agents..."
cp "$SRC/agents/"*.md "$CLAUDE_DIR/agents/"
echo "  ✓  4 master agents installed"

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

# ── Settings ─────────────────────────────────────────────────────────
if [ ! -f "$CLAUDE_DIR/settings.local.json" ]; then
  sed "s|__HOME__|$HOME|g" "$SRC/settings/settings.local.json" > "$CLAUDE_DIR/settings.local.json"
  echo "  ✓  settings.local.json created"
else
  echo "  ⚠  settings.local.json already exists — merge manually from:"
  echo "     $SRC/settings/settings.local.json"
fi

# ── Cleanup ──────────────────────────────────────────────────────────
rm -rf "$TMP_DIR"

# ── Health check ─────────────────────────────────────────────────────
echo ""
echo "Running health check..."
echo ""
bash "$CLAUDE_DIR/hooks/health-check.sh"

echo ""
echo "  ✅  Installation complete!"
echo "  Type /lead in any Claude Code session to get started."
echo ""
