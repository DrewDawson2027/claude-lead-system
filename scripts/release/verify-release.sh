#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/release/verify-release.sh <tag> [owner/repo]

Examples:
  scripts/release/verify-release.sh v1.2.3
  scripts/release/verify-release.sh v1.2.3 DrewDawson2027/claude-lead-system
USAGE
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 1
fi

TAG="$1"
REPO="${2:-DrewDawson2027/claude-lead-system}"

for cmd in gh cosign jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "FAIL: missing dependency: $cmd" >&2
    exit 1
  fi
done

if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9._-]+)?$ ]]; then
  echo "FAIL: tag must look like vX.Y.Z (or prerelease variant)." >&2
  exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "Downloading release assets for $REPO@$TAG..."
gh release download "$TAG" \
  --repo "$REPO" \
  --pattern "claude-lead-system.tar.gz" \
  --pattern "claude-lead-system.tar.gz.sig" \
  --pattern "claude-lead-system.tar.gz.pem" \
  --pattern "sbom.spdx.json" \
  --dir "$WORKDIR"

cd "$WORKDIR"

for f in claude-lead-system.tar.gz claude-lead-system.tar.gz.sig claude-lead-system.tar.gz.pem sbom.spdx.json; do
  [[ -f "$f" ]] || { echo "FAIL: missing asset $f" >&2; exit 1; }
done

echo "Verifying cosign signature + identity..."
cosign verify-blob \
  --certificate claude-lead-system.tar.gz.pem \
  --signature claude-lead-system.tar.gz.sig \
  --certificate-identity-regexp "https://github.com/${REPO}/.github/workflows/.+" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  claude-lead-system.tar.gz >/dev/null

echo "Checking SBOM format..."
jq -e '.spdxVersion and .packages' sbom.spdx.json >/dev/null

echo "PASS: release artifacts verified for $REPO@$TAG"
