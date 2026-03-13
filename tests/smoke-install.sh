#!/usr/bin/env bash
# smoke-install.sh — Reusable install smoke test for CI and local dev.
# Runs install.sh in an isolated $HOME, verifies key files exist, cleans up.
#
# Usage:
#   bash tests/smoke-install.sh --ref HEAD --mode full
#   bash tests/smoke-install.sh --source-tarball release.tar.gz --checksum-file checksums.txt --mode full

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults
MODE="full"
REF="HEAD"
VERSION=""
SOURCE_TARBALL=""
CHECKSUM_FILE=""
CHECKSUM_SIG=""
CHECKSUM_CERT=""
RELEASE_MANIFEST=""
RELEASE_MANIFEST_SIG=""
RELEASE_MANIFEST_CERT=""
SKIP_ATTESTATION_VERIFY=false
VERBOSE=false

usage() {
  cat <<USAGE
smoke-install.sh — Install smoke test

Usage: smoke-install.sh [--mode lite|hybrid|full] [--version <vX.Y.Z>] [--ref <branch-or-tag>]
                        [--source-tarball <file>] [--checksum-file <file>]
                        [--checksum-signature <file>] [--checksum-cert <file>]
                        [--release-manifest <file>] [--release-manifest-signature <file>] [--release-manifest-cert <file>]
                        [--skip-attestation-verify]
                        [--verbose]

Runs install.sh in an isolated \$HOME and verifies the result.
Note: ref-based install mode is dev-only and this harness passes --allow-unsigned-release automatically.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)         MODE="${2:-}"; shift 2 ;;
    --version)      VERSION="${2:-}"; shift 2 ;;
    --ref)          REF="${2:-}"; shift 2 ;;
    --source-tarball) SOURCE_TARBALL="${2:-}"; shift 2 ;;
    --checksum-file)  CHECKSUM_FILE="${2:-}"; shift 2 ;;
    --checksum-signature) CHECKSUM_SIG="${2:-}"; shift 2 ;;
    --checksum-cert) CHECKSUM_CERT="${2:-}"; shift 2 ;;
    --release-manifest) RELEASE_MANIFEST="${2:-}"; shift 2 ;;
    --release-manifest-signature) RELEASE_MANIFEST_SIG="${2:-}"; shift 2 ;;
    --release-manifest-cert) RELEASE_MANIFEST_CERT="${2:-}"; shift 2 ;;
    --skip-attestation-verify) SKIP_ATTESTATION_VERIFY=true; shift ;;
    --verbose)      VERBOSE=true; shift ;;
    --help|-h)      usage; exit 0 ;;
    *)              echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

FAKE_HOME=$(mktemp -d "${TMPDIR:-/tmp}/smoke-install-XXXXXX")
trap 'rm -rf "$FAKE_HOME"' EXIT

log() { echo "  [smoke] $*"; }
fail() { echo "  [FAIL]  $*" >&2; exit 1; }
sha256_file() {
  local target="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$target" | awk '{print $1}'
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$target" | awk '{print $1}'
    return 0
  fi
  return 1
}

log "Isolated HOME: $FAKE_HOME"
log "Mode: $MODE | Ref: $REF${VERSION:+ | Version: $VERSION}"

# Build installer args
INSTALL_ARGS=(--mode "$MODE")
if [ -n "$VERSION" ]; then
  INSTALL_ARGS+=(--version "$VERSION")
fi

if [ -n "$SOURCE_TARBALL" ]; then
  [ -f "$SOURCE_TARBALL" ] || fail "Source tarball not found: $SOURCE_TARBALL"
  INSTALL_ARGS+=(--source-tarball "$SOURCE_TARBALL")
  if [ -n "$CHECKSUM_FILE" ]; then
    INSTALL_ARGS+=(--checksum-file "$CHECKSUM_FILE")
  fi
  if [ -n "$CHECKSUM_SIG" ]; then
    INSTALL_ARGS+=(--checksum-signature "$CHECKSUM_SIG")
  fi
  if [ -n "$CHECKSUM_CERT" ]; then
    INSTALL_ARGS+=(--checksum-cert "$CHECKSUM_CERT")
  fi
  if [ -n "$RELEASE_MANIFEST" ]; then
    INSTALL_ARGS+=(--release-manifest "$RELEASE_MANIFEST")
  fi
  if [ -n "$RELEASE_MANIFEST_SIG" ]; then
    INSTALL_ARGS+=(--release-manifest-signature "$RELEASE_MANIFEST_SIG")
  fi
  if [ -n "$RELEASE_MANIFEST_CERT" ]; then
    INSTALL_ARGS+=(--release-manifest-cert "$RELEASE_MANIFEST_CERT")
  fi
elif [ "$REF" = "HEAD" ]; then
  # For HEAD ref, create a local tarball from the working tree so install.sh
  # doesn't need to clone from remote.
  log "Building local tarball from working tree..."
  LOCAL_TAR="$FAKE_HOME/local-source.tar.gz"
  tar --exclude .git -czf "$LOCAL_TAR" -C "$REPO_ROOT" .
  # Create a minimal checksums.txt for the tarball
  LOCAL_CHECKSUMS="$FAKE_HOME/checksums.txt"
  local_tar_sha="$(sha256_file "$LOCAL_TAR" || true)"
  installer_sha="$(sha256_file "$REPO_ROOT/install.sh" || true)"
  if [ -z "${local_tar_sha:-}" ] || [ -z "${installer_sha:-}" ]; then
    fail "No SHA256 tool found"
  fi
  {
    printf '%s  %s\n' "$local_tar_sha" "local-source.tar.gz"
    printf '%s  %s\n' "$installer_sha" "install.sh"
  } > "$LOCAL_CHECKSUMS"
  INSTALL_ARGS+=(--source-tarball "$LOCAL_TAR" --checksum-file "$LOCAL_CHECKSUMS")
else
  INSTALL_ARGS+=(--ref "$REF" --allow-unsigned-release)
fi
if [ "$SKIP_ATTESTATION_VERIFY" = true ]; then
  INSTALL_ARGS+=(--skip-attestation-verify)
fi

# Run installer with isolated HOME
log "Running install.sh ${INSTALL_ARGS[*]}"
if [ "$VERBOSE" = true ]; then
  HOME="$FAKE_HOME" bash "$REPO_ROOT/install.sh" "${INSTALL_ARGS[@]}"
else
  HOME="$FAKE_HOME" bash "$REPO_ROOT/install.sh" "${INSTALL_ARGS[@]}" 2>&1 | tail -20
fi
log "install.sh exited with code $?"

# ── Verification ──────────────────────────────────────────────────────
CLAUDE_DIR="$FAKE_HOME/.claude"
PASS=0
TOTAL=0

check_file() {
  TOTAL=$((TOTAL + 1))
  if [ -f "$1" ]; then
    PASS=$((PASS + 1))
    log "OK: $1"
  else
    log "MISSING: $1"
  fi
}

check_dir() {
  TOTAL=$((TOTAL + 1))
  if [ -d "$1" ]; then
    PASS=$((PASS + 1))
    log "OK: $1/"
  else
    log "MISSING: $1/"
  fi
}

check_exec() {
  TOTAL=$((TOTAL + 1))
  if [ -x "$1" ]; then
    PASS=$((PASS + 1))
    log "OK: $1 (executable)"
  elif [ -f "$1" ]; then
    log "WARN: $1 exists but not executable"
    PASS=$((PASS + 1))
  else
    log "MISSING: $1"
  fi
}

log ""
log "Verifying installed files..."

# Core files
check_dir  "$CLAUDE_DIR/mcp-coordinator"
check_file "$CLAUDE_DIR/mcp-coordinator/index.js"
check_dir  "$CLAUDE_DIR/lead-sidecar"
check_dir  "$CLAUDE_DIR/commands"
check_file "$CLAUDE_DIR/commands/lead.md"
check_dir  "$CLAUDE_DIR/agents"

# Sidecar binaries
check_exec "$CLAUDE_DIR/lead-sidecar/bin/claudex"
check_exec "$CLAUDE_DIR/lead-sidecar/bin/sidecarctl"

# Mode: hybrid/full install hooks
if [ "$MODE" != "lite" ]; then
  check_dir  "$CLAUDE_DIR/hooks"
  check_exec "$CLAUDE_DIR/hooks/health-check.sh"
  check_exec "$CLAUDE_DIR/hooks/session-register.sh"
  check_exec "$CLAUDE_DIR/hooks/terminal-heartbeat.sh"
fi

# Settings should have been merged
check_file "$CLAUDE_DIR/settings.local.json"

# First-run sidecar readiness
TOTAL=$((TOTAL + 1))
PORT_FILE="$CLAUDE_DIR/lead-sidecar/runtime/sidecar.port"
if [ -f "$PORT_FILE" ] && python3 - <<PY >/dev/null 2>&1
import json
data = json.load(open("$PORT_FILE"))
assert data.get("port") or data.get("socket")
PY
then
  PASS=$((PASS + 1))
  log "OK: sidecar first-run readiness file created"
else
  log "FAIL: sidecar first-run readiness file missing or invalid"
fi

# Coordinator syntax check
TOTAL=$((TOTAL + 1))
if node --check "$CLAUDE_DIR/mcp-coordinator/index.js" 2>/dev/null; then
  PASS=$((PASS + 1))
  log "OK: coordinator syntax valid (node --check)"
else
  log "FAIL: coordinator syntax check failed"
fi

# Symlinks in ~/.local/bin
TOTAL=$((TOTAL + 1))
CLAUDEX_LINK="$FAKE_HOME/.local/bin/claudex"
if [ -L "$CLAUDEX_LINK" ]; then
  PASS=$((PASS + 1))
  log "OK: claudex symlink in ~/.local/bin"
elif [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* ]] && [ -e "$CLAUDEX_LINK" ]; then
  PASS=$((PASS + 1))
  log "OK: claudex launcher exists in ~/.local/bin (Windows mode)"
else
  log "MISSING: claudex launcher in ~/.local/bin"
fi

TOTAL=$((TOTAL + 1))
SIDECARCTL_LINK="$FAKE_HOME/.local/bin/sidecarctl"
if [ -L "$SIDECARCTL_LINK" ]; then
  PASS=$((PASS + 1))
  log "OK: sidecarctl symlink in ~/.local/bin"
elif [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* ]] && [ -e "$SIDECARCTL_LINK" ]; then
  PASS=$((PASS + 1))
  log "OK: sidecarctl launcher exists in ~/.local/bin (Windows mode)"
else
  log "MISSING: sidecarctl launcher in ~/.local/bin"
fi

log ""
log "Results: $PASS / $TOTAL checks passed"

if [ "$PASS" -lt "$TOTAL" ]; then
  fail "$((TOTAL - PASS)) check(s) failed"
fi

log "Smoke install PASSED"

log "Verifying uninstall..."
HOME="$FAKE_HOME" bash "$REPO_ROOT/install.sh" --uninstall >/dev/null 2>&1
if [ -d "$CLAUDE_DIR/lead-sidecar" ] || [ -d "$CLAUDE_DIR/mcp-coordinator" ]; then
  fail "uninstall left core directories behind"
fi
log "Smoke uninstall PASSED"
