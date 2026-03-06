#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-dist/release-assets}"

cd "$OUT_DIR"

if ! command -v cosign >/dev/null 2>&1; then
  echo "FAIL: cosign is required to sign release metadata" >&2
  exit 1
fi

for f in release.json checksums.txt; do
  if [[ ! -f "$f" ]]; then
    echo "FAIL: missing metadata file to sign: $f" >&2
    exit 1
  fi
  cosign sign-blob --yes \
    --output-signature "${f}.sig" \
    --output-certificate "${f}.pem" \
    "$f" >/dev/null
done

echo "Signed metadata:"
echo "  $OUT_DIR/release.json(.sig/.pem)"
echo "  $OUT_DIR/checksums.txt(.sig/.pem)"
