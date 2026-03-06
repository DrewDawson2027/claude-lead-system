#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
OUT_DIR="${1:-$ROOT/dist/release-assets}"
BUNDLE_PATH="${2:-}"

mkdir -p "$OUT_DIR"
cp "$ROOT/install.sh" "$OUT_DIR/install.sh"
if [[ -n "$BUNDLE_PATH" ]]; then
  [[ -f "$BUNDLE_PATH" ]] || { echo "FAIL: bundle not found: $BUNDLE_PATH" >&2; exit 1; }
  cp "$BUNDLE_PATH" "$OUT_DIR/$(basename "$BUNDLE_PATH")"
fi

cd "$OUT_DIR"
checksum_targets=(install.sh)
if [[ -f "claude-lead-system.tar.gz" ]]; then
  checksum_targets+=("claude-lead-system.tar.gz")
else
  while IFS= read -r bundle; do
    checksum_targets+=("$bundle")
  done < <(find . -maxdepth 1 -type f -name '*.tar.gz' -print | sed 's#^\./##' | sort)
fi

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${checksum_targets[@]}" > checksums.txt
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${checksum_targets[@]}" > checksums.txt
else
  echo "FAIL: need shasum or sha256sum to build checksums.txt" >&2
  exit 1
fi

if command -v cosign >/dev/null 2>&1; then
  cosign sign-blob --yes checksums.txt --output-signature checksums.txt.sig --output-certificate checksums.txt.pem >/dev/null
  echo "Built installer assets with checksum signature:"
  echo "  $OUT_DIR/install.sh"
  echo "  $OUT_DIR/checksums.txt"
  echo "  $OUT_DIR/checksums.txt.sig"
  echo "  $OUT_DIR/checksums.txt.pem"
else
  echo "Built installer assets (unsigned checksums; cosign not found):"
  echo "  $OUT_DIR/install.sh"
  echo "  $OUT_DIR/checksums.txt"
fi
