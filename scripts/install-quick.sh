#!/usr/bin/env bash
set -euo pipefail

# Claude Lead System — quick npm installer
# Usage: curl -fsSL https://raw.githubusercontent.com/DrewDawson2027/claude-lead-system/main/scripts/install-quick.sh | bash

echo "Claude Lead System — quick install"
echo "==================================="

# Check Node 18+
node_version=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [[ "${node_version:-0}" -lt 18 ]]; then
  echo "Error: Node.js 18+ required. Current: $(node -v 2>/dev/null || echo 'not found')" >&2
  echo "Install Node.js: https://nodejs.org" >&2
  exit 1
fi
echo "✓ Node.js $(node -v)"

# Check jq
if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq required." >&2
  echo "  macOS:  brew install jq" >&2
  echo "  Linux:  sudo apt install jq  (or  sudo dnf install jq)" >&2
  exit 1
fi
echo "✓ jq $(jq --version)"

# Check python3
if ! command -v python3 >/dev/null 2>&1; then
  echo "Warning: python3 not found — hook scripts won't run." >&2
else
  echo "✓ python3 $(python3 --version)"
fi

# Install
echo ""
echo "Installing claude-lead-system globally..."
npm install -g claude-lead-system

# Verify sidecar starts
echo ""
echo "Verifying installation..."
if claudex --sidecar-only 2>/dev/null; then
  echo "✓ Sidecar started successfully"
else
  echo "Note: Run 'claudex --sidecar-only' manually to verify sidecar." >&2
fi

echo ""
echo "Done. Run 'claudex' to start, then type /lead."
