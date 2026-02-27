#!/usr/bin/env bash
# generate-manifest.sh — Generates release.json manifest with artifact hashes.
#
# Usage:
#   bash scripts/release/generate-manifest.sh [--outdir dist/release-assets] [--version vX.Y.Z]
#
# Expects build artifacts in --outdir (default: dist/release-assets).
# Outputs release.json in the same directory.

set -euo pipefail

OUTDIR="dist/release-assets"
VERSION="${GITHUB_REF_NAME:-unknown}"
COMMIT="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"

while [ $# -gt 0 ]; do
  case "$1" in
    --outdir)  OUTDIR="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --help|-h)
      echo "Usage: generate-manifest.sh [--outdir DIR] [--version vX.Y.Z]"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[ -d "$OUTDIR" ] || { echo "Output directory not found: $OUTDIR" >&2; exit 1; }

sha256_file() {
  local target="$1"
  if [ ! -f "$target" ]; then
    echo ""
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$target" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$target" | awk '{print $1}'
  else
    echo "error:no-sha256-tool"
  fi
}

artifact_entry() {
  local file="$1"
  local path="$OUTDIR/$file"
  local hash
  hash=$(sha256_file "$path")
  if [ -n "$hash" ]; then
    printf '{"file":"%s","sha256":"%s"}' "$file" "$hash"
  else
    printf 'null'
  fi
}

artifact_entry_nosig() {
  local file="$1"
  local path="$OUTDIR/$file"
  if [ -f "$path" ]; then
    printf '{"file":"%s"}' "$file"
  else
    printf 'null'
  fi
}

GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Enforce canonical tarball contract.
TARBALL_NAME="claude-lead-system.tar.gz"
if [ ! -f "$OUTDIR/$TARBALL_NAME" ]; then
  echo "Missing required artifact: $OUTDIR/$TARBALL_NAME" >&2
  exit 1
fi

cat > "$OUTDIR/release.json" <<MANIFEST
{
  "version": "$VERSION",
  "generated_at": "$GENERATED_AT",
  "commit": "$COMMIT",
  "artifacts": {
    "tarball": $(artifact_entry "$TARBALL_NAME"),
    "installer": $(artifact_entry "install.sh"),
    "checksums": $(artifact_entry "checksums.txt"),
    "sbom": $(artifact_entry "sbom.spdx.json"),
    "signature": $(artifact_entry_nosig "checksums.txt.sig"),
    "certificate": $(artifact_entry_nosig "checksums.txt.pem")
  },
  "compatibility": {
    "node": ["18", "20"],
    "python": ["3.10", "3.11"],
    "platforms": ["macos", "linux", "windows"]
  }
}
MANIFEST

echo "Generated: $OUTDIR/release.json"
