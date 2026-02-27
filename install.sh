#!/usr/bin/env bash
# Claude Lead System — one-command installer
# Usage: Download release install.sh + checksums.txt, verify checksum, then run:
#   bash install.sh --version vX.Y.Z --source-tarball claude-lead-system.tar.gz \
#     --checksum-file checksums.txt --checksum-signature checksums.txt.sig --checksum-cert checksums.txt.pem \
#     --release-manifest release.json --release-manifest-signature release.json.sig --release-manifest-cert release.json.pem

set -euo pipefail

REPO="https://github.com/DrewDawson2027/claude-lead-system.git"
CLAUDE_DIR="$HOME/.claude"
TMP_DIR=$(mktemp -d)
MODE="full"
CLONE_REF="${INSTALL_REF:-main}"
VERSION_TAG=""
REF_FLAG_SET=false
VERSION_FLAG_SET=false
CHECKSUM_FILE=""
CHECKSUM_SIG=""
CHECKSUM_CERT=""
ENFORCE_SIGNED=false
SOURCE_TARBALL=""
COSIGN_IDENTITY_REGEX="${INSTALL_COSIGN_IDENTITY_REGEX:-^https://github.com/DrewDawson2027/claude-lead-system/.github/workflows/(release-bundle|supply-chain)\\.yml@refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+([-.][A-Za-z0-9._-]+)?$}"
COSIGN_OIDC_ISSUER="${INSTALL_COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"
SLSA_REPO="${INSTALL_SLSA_REPO:-DrewDawson2027/claude-lead-system}"
RELEASE_MANIFEST=""
RELEASE_MANIFEST_SIG=""
RELEASE_MANIFEST_CERT=""
ALLOW_UNSIGNED_RELEASE=false
SKIP_ATTESTATION_VERIFY=false
UNINSTALL=false
INSTALL_MARKER="$CLAUDE_DIR/.lead-system-install.json"
VERIFY_ONLY=false

usage() {
  cat <<USAGE
Claude Lead System installer

Usage: install.sh [--mode lite|hybrid|full] [--version vX.Y.Z | --ref <branch-or-tag>] [--checksum-file <checksums.txt>] [--source-tarball <release.tar.gz>] [--uninstall]

Modes:
  lite    Sidecar + wrapper + coordinator + settings merge (minimal/no hooks)
  hybrid  Sidecar + coordinator + hooks + settings merge
  full    Full install (default): hybrid plus full hook/policy template wiring

Version / integrity:
  --version vX.Y.Z       Install from a release tag (preferred)
  --ref <branch-or-tag>  Install from a specific branch or tag (advanced/dev, requires --allow-unsigned-release)
  --checksum-file <file> Verify this installer against checksums.txt before continuing
  --checksum-signature <file>  Cosign signature file for checksums.txt verification
  --checksum-cert <file>       Cosign certificate for keyless (Fulcio) verification
  --enforce-signed-checksums   Require --checksum-file + --checksum-signature; abort if missing or invalid
  --source-tarball <f>   Install from a local release tarball (verifiable source content path)
  --release-manifest <file>              release.json manifest file
  --release-manifest-signature <file>    Signature for release.json
  --release-manifest-cert <file>         Cosign certificate for release.json verification
  --allow-unsigned-release               DEV ONLY: required for unverified ref installs; also bypasses enforced signed release checks
  --skip-attestation-verify              DEV ONLY: skip SLSA attestation verification
  --slsa-repo <owner/repo>               Repo used for attestation verification (default: DrewDawson2027/claude-lead-system)
  --uninstall                            Remove Claude Lead System install from ~/.claude
  --verify-only                          Run integrity/provenance verification then exit
USAGE
}

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
  echo "No SHA256 tool found (need shasum or sha256sum)." >&2
  return 1
}

verify_checksum_entry() {
  local target_path="$1"
  local checksum_file="$2"
  local target_name
  target_name="$(basename "$target_path")"
  if [ ! -f "$target_path" ]; then
    echo "  ✗  file not found for checksum verification: $target_path" >&2
    exit 1
  fi
  if [ ! -f "$checksum_file" ]; then
    echo "  ✗  checksum file not found: $checksum_file" >&2
    exit 1
  fi
  local expected actual
  expected=$(awk -v name="$target_name" '$2==name{print $1}' "$checksum_file" | tail -n 1)
  if [ -z "$expected" ]; then
    echo "  ✗  checksum entry for $target_name not found in $checksum_file" >&2
    exit 1
  fi
  actual=$(sha256_file "$target_path")
  if [ "$actual" != "$expected" ]; then
    echo "  ✗  checksum mismatch for $target_name" >&2
    echo "     expected: $expected" >&2
    echo "     actual:   $actual" >&2
    exit 1
  fi
  echo "  ✓  $target_name checksum verified"
}

verify_installer_checksum() {
  local checksum_file="$1"
  local script_path="${BASH_SOURCE[0]:-$0}"
  if [ ! -f "$script_path" ]; then
    echo "  ✗  Cannot verify installer checksum when running from stdin (download install.sh first)." >&2
    exit 1
  fi
  verify_checksum_entry "$script_path" "$checksum_file"
}

verify_checksum_signature() {
  local checksum_file="$1"
  local sig_file="$2"
  local cert_file="${3:-}"
  if ! command -v cosign >/dev/null 2>&1; then
    if [ "$ENFORCE_SIGNED" = true ]; then
      echo "  ✗  cosign not found — required by --enforce-signed-checksums" >&2
      echo "     Install with: go install github.com/sigstore/cosign/v2/cmd/cosign@latest" >&2
      exit 1
    fi
    echo "  ⚠  cosign not found — skipping signature verification (install cosign for signed checksum support)"
    return 0
  fi
  if [ ! -f "$sig_file" ]; then
    echo "  ✗  Signature file not found: $sig_file" >&2
    exit 1
  fi
  local cosign_args=("verify-blob" "--signature" "$sig_file")
  if [ -n "$cert_file" ]; then
    if [ ! -f "$cert_file" ]; then
      echo "  ✗  Certificate file not found: $cert_file" >&2
      exit 1
    fi
    cosign_args+=(
      "--certificate" "$cert_file"
      "--certificate-identity-regexp" "$COSIGN_IDENTITY_REGEX"
      "--certificate-oidc-issuer" "$COSIGN_OIDC_ISSUER"
    )
  else
    local key_file
    key_file="$(dirname "$sig_file")/cosign.pub"
    if [ ! -f "$key_file" ]; then
      echo "  ✗  No --checksum-cert provided and cosign.pub not found alongside signature" >&2
      exit 1
    fi
    cosign_args+=("--key" "$key_file")
  fi
  cosign_args+=("$checksum_file")
  if cosign "${cosign_args[@]}" 2>/dev/null; then
    echo "  ✓  checksums.txt signature verified (cosign)"
  else
    echo "  ✗  checksums.txt signature verification FAILED" >&2
    if [ "$ENFORCE_SIGNED" = true ]; then
      exit 1
    fi
    echo "  ⚠  Continuing without signature verification (use --enforce-signed-checksums to abort on failure)"
  fi
}

verify_release_manifest_binding() {
  local manifest_file="$1"
  local tarball_path="$2"
  local checksum_file="$3"
  if ! command -v jq >/dev/null 2>&1; then
    echo "  ✗  jq required for release manifest verification" >&2
    exit 1
  fi
  if [ ! -f "$manifest_file" ]; then
    echo "  ✗  release manifest not found: $manifest_file" >&2
    exit 1
  fi
  local tar_name expected_checksum manifest_tar_sha
  tar_name="$(basename "$tarball_path")"
  expected_checksum=$(awk -v name="$tar_name" '$2==name{print $1}' "$checksum_file" | tail -n 1)
  if [ -z "$expected_checksum" ]; then
    echo "  ✗  checksum entry for $tar_name missing in $checksum_file" >&2
    exit 1
  fi
  manifest_tar_sha=$(jq -r '.artifacts.tarball.sha256 // empty' "$manifest_file")
  if [ -z "$manifest_tar_sha" ]; then
    echo "  ✗  release manifest missing artifacts.tarball.sha256" >&2
    exit 1
  fi
  if [ "$manifest_tar_sha" != "$expected_checksum" ]; then
    echo "  ✗  release manifest tarball hash mismatch" >&2
    echo "     manifest: $manifest_tar_sha" >&2
    echo "     checksum: $expected_checksum" >&2
    exit 1
  fi
  echo "  ✓  release manifest hash binding verified"
}

verify_release_manifest_signature() {
  local manifest_file="$1"
  local sig_file="$2"
  local cert_file="$3"
  if [ ! -f "$sig_file" ] || [ ! -f "$cert_file" ]; then
    echo "  ✗  release manifest signature/certificate missing" >&2
    exit 1
  fi
  if ! command -v cosign >/dev/null 2>&1; then
    echo "  ✗  cosign required for release manifest verification" >&2
    exit 1
  fi
  if cosign verify-blob \
    --signature "$sig_file" \
    --certificate "$cert_file" \
    --certificate-identity-regexp "$COSIGN_IDENTITY_REGEX" \
    --certificate-oidc-issuer "$COSIGN_OIDC_ISSUER" \
    "$manifest_file" 2>/dev/null; then
    echo "  ✓  release manifest signature verified"
  else
    echo "  ✗  release manifest signature verification FAILED" >&2
    exit 1
  fi
}

verify_slsa_attestation() {
  local tarball_path="$1"
  if ! command -v gh >/dev/null 2>&1; then
    echo "  ✗  gh CLI required for SLSA attestation verification" >&2
    echo "     Install GitHub CLI or pass --skip-attestation-verify for dev installs." >&2
    exit 1
  fi
  if gh attestation verify "$tarball_path" --repo "$SLSA_REPO" >/dev/null 2>&1; then
    echo "  ✓  SLSA attestation verified via GitHub provenance"
  else
    echo "  ✗  SLSA attestation verification FAILED for $tarball_path ($SLSA_REPO)" >&2
    exit 1
  fi
}

uninstall_lead_system() {
  echo ""
  echo "Uninstalling Claude Lead System from $CLAUDE_DIR ..."
  rm -rf \
    "$CLAUDE_DIR/mcp-coordinator" \
    "$CLAUDE_DIR/lead-sidecar" \
    "$CLAUDE_DIR/lead-tools" \
    "$CLAUDE_DIR/commands" \
    "$CLAUDE_DIR/agents" \
    "$CLAUDE_DIR/master-agents"
  rm -f "$HOME/.local/bin/claudex" "$HOME/.local/bin/sidecarctl" "$INSTALL_MARKER"
  echo "  ✓  removed installed components"
  echo ""
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --version)
      VERSION_TAG="${2:-}"
      CLONE_REF="$VERSION_TAG"
      VERSION_FLAG_SET=true
      shift 2
      ;;
    --ref)
      CLONE_REF="${2:-}"
      REF_FLAG_SET=true
      shift 2
      ;;
    --checksum-file)
      CHECKSUM_FILE="${2:-}"
      shift 2
      ;;
    --checksum-signature)
      CHECKSUM_SIG="${2:-}"
      shift 2
      ;;
    --checksum-cert)
      CHECKSUM_CERT="${2:-}"
      shift 2
      ;;
    --enforce-signed-checksums)
      ENFORCE_SIGNED=true
      shift
      ;;
    --source-tarball)
      SOURCE_TARBALL="${2:-}"
      shift 2
      ;;
    --release-manifest)
      RELEASE_MANIFEST="${2:-}"
      shift 2
      ;;
    --release-manifest-signature)
      RELEASE_MANIFEST_SIG="${2:-}"
      shift 2
      ;;
    --release-manifest-cert)
      RELEASE_MANIFEST_CERT="${2:-}"
      shift 2
      ;;
    --allow-unsigned-release)
      ALLOW_UNSIGNED_RELEASE=true
      shift
      ;;
    --skip-attestation-verify)
      SKIP_ATTESTATION_VERIFY=true
      shift
      ;;
    --slsa-repo)
      SLSA_REPO="${2:-}"
      shift 2
      ;;
    --uninstall)
      UNINSTALL=true
      shift
      ;;
    --verify-only)
      VERIFY_ONLY=true
      shift
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

if [ "$UNINSTALL" = true ]; then
  uninstall_lead_system
fi

if [ -n "$VERSION_TAG" ] && ! [[ "$VERSION_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9._-]+)?$ ]]; then
  echo "Invalid version tag: $VERSION_TAG (expected vX.Y.Z)" >&2
  exit 1
fi

if [ "$VERSION_FLAG_SET" = true ] && [ "$REF_FLAG_SET" = true ]; then
  echo "Do not pass both --version and --ref. Use --version for verified release installs or --ref with --allow-unsigned-release for dev installs." >&2
  exit 1
fi

if [ -z "$CLONE_REF" ]; then
  echo "Invalid ref: empty" >&2
  exit 1
fi

if [ -n "$SOURCE_TARBALL" ] && [ ! -f "$SOURCE_TARBALL" ]; then
  echo "Invalid --source-tarball path: $SOURCE_TARBALL" >&2
  exit 1
fi

if [ -n "$SOURCE_TARBALL" ] && [ -z "$CHECKSUM_FILE" ]; then
  echo "--source-tarball requires --checksum-file so the source archive can be verified." >&2
  exit 1
fi

if [ "$ENFORCE_SIGNED" = true ]; then
  if [ -z "$CHECKSUM_FILE" ] || [ -z "$CHECKSUM_SIG" ]; then
    echo "--enforce-signed-checksums requires both --checksum-file and --checksum-signature" >&2
    exit 1
  fi
fi

RELEASE_MODE=false
if [ -n "$VERSION_TAG" ]; then
  RELEASE_MODE=true
fi

if [ "$RELEASE_MODE" = false ] && [ -z "$SOURCE_TARBALL" ] && [ "$ALLOW_UNSIGNED_RELEASE" = false ]; then
  echo "Ref installs are dev-only and require --allow-unsigned-release." >&2
  echo "For highest-trust installs, use --version with verified release artifacts instead." >&2
  exit 1
fi

if [ "$RELEASE_MODE" = true ] && [ "$ALLOW_UNSIGNED_RELEASE" = false ]; then
  ENFORCE_SIGNED=true
  if [ -z "$CHECKSUM_FILE" ] || [ -z "$CHECKSUM_SIG" ] || [ -z "$CHECKSUM_CERT" ]; then
    echo "Release mode requires --checksum-file, --checksum-signature, and --checksum-cert" >&2
    echo "Use --allow-unsigned-release only for dev/nightly flows." >&2
    exit 1
  fi
  if [ -z "$SOURCE_TARBALL" ]; then
    echo "Release mode requires --source-tarball so installed repository content is verified." >&2
    echo "Use --allow-unsigned-release only for dev/nightly flows." >&2
    exit 1
  fi
  if [ -z "$RELEASE_MANIFEST" ] || [ -z "$RELEASE_MANIFEST_SIG" ] || [ -z "$RELEASE_MANIFEST_CERT" ]; then
    echo "Release source installs require --release-manifest, --release-manifest-signature, and --release-manifest-cert" >&2
    exit 1
  fi
fi

echo ""
echo "  Claude Lead System — Installer"
echo "  ================================"
echo "  Mode: $MODE"
echo "  Ref:  $CLONE_REF"
if [ -n "$SOURCE_TARBALL" ]; then
  echo "  Source tarball: $SOURCE_TARBALL"
fi
echo ""

if [ -n "$CHECKSUM_FILE" ]; then
  echo "Verifying installer checksum..."
  verify_installer_checksum "$CHECKSUM_FILE"
  if [ -n "$SOURCE_TARBALL" ]; then
    echo "Verifying source tarball checksum..."
    verify_checksum_entry "$SOURCE_TARBALL" "$CHECKSUM_FILE"
  fi
  if [ -n "$CHECKSUM_SIG" ]; then
    echo "Verifying checksums.txt signature..."
    verify_checksum_signature "$CHECKSUM_FILE" "$CHECKSUM_SIG" "$CHECKSUM_CERT"
  fi
  if [ -n "$SOURCE_TARBALL" ] && [ -n "$RELEASE_MANIFEST" ]; then
    echo "Verifying release manifest checksum binding..."
    verify_checksum_entry "$RELEASE_MANIFEST" "$CHECKSUM_FILE"
    echo "Verifying release manifest signature..."
    verify_release_manifest_signature "$RELEASE_MANIFEST" "$RELEASE_MANIFEST_SIG" "$RELEASE_MANIFEST_CERT"
    verify_release_manifest_binding "$RELEASE_MANIFEST" "$SOURCE_TARBALL" "$CHECKSUM_FILE"
  fi
  if [ "$RELEASE_MODE" = true ] && [ -n "$SOURCE_TARBALL" ] && [ "$SKIP_ATTESTATION_VERIFY" = false ]; then
    echo "Verifying SLSA attestation..."
    verify_slsa_attestation "$SOURCE_TARBALL"
  fi
  echo ""
fi

if [ "$VERIFY_ONLY" = true ]; then
  echo "Verification-only mode complete."
  exit 0
fi

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

# ── Source acquisition (verified tarball or git clone) ───────────────
if [ -n "$SOURCE_TARBALL" ]; then
  echo "Extracting verified source tarball..."
  EXTRACT_DIR="$TMP_DIR/source"
  mkdir -p "$EXTRACT_DIR"
  tar -xzf "$SOURCE_TARBALL" -C "$EXTRACT_DIR"
  SRC="$EXTRACT_DIR"
  if [ ! -d "$SRC/hooks" ] || [ ! -d "$SRC/mcp-coordinator" ]; then
    shopt -s nullglob
    subdirs=("$EXTRACT_DIR"/*)
    shopt -u nullglob
    if [ "${#subdirs[@]}" -eq 1 ] && [ -d "${subdirs[0]}" ] && [ -d "${subdirs[0]}/hooks" ] && [ -d "${subdirs[0]}/mcp-coordinator" ]; then
      SRC="${subdirs[0]}"
    fi
  fi
  [ -d "$SRC/hooks" ] || { echo "  ✗  Extracted source missing hooks/ directory: $SOURCE_TARBALL" >&2; exit 1; }
  [ -d "$SRC/mcp-coordinator" ] || { echo "  ✗  Extracted source missing mcp-coordinator/ directory: $SOURCE_TARBALL" >&2; exit 1; }
  echo ""
else
  echo "Cloning repository..."
  git clone --depth 1 --branch "$CLONE_REF" "$REPO" "$TMP_DIR/claude-lead-system" --quiet
  echo ""
  SRC="$TMP_DIR/claude-lead-system"
fi

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
printf '{\"installed_at\":\"%s\",\"mode\":\"%s\",\"ref\":\"%s\"}\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$MODE" "$CLONE_REF" > "$INSTALL_MARKER"

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
