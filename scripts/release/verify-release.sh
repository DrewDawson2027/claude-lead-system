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
IDENTITY_REGEX="^https://github.com/${REPO}/.github/workflows/(release-bundle|supply-chain)\\.yml@refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+([-.][A-Za-z0-9._-]+)?$"

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
  --pattern "install.sh" \
  --pattern "checksums.txt" \
  --pattern "checksums.txt.sig" \
  --pattern "checksums.txt.pem" \
  --pattern "release.json" \
  --pattern "release.json.sig" \
  --pattern "release.json.pem" \
  --pattern "sbom.spdx.json" \
  --dir "$WORKDIR"

cd "$WORKDIR"

sha256_file() {
  local f="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    echo "FAIL: missing shasum/sha256sum" >&2
    exit 1
  fi
}

for f in claude-lead-system.tar.gz claude-lead-system.tar.gz.sig claude-lead-system.tar.gz.pem sbom.spdx.json; do
  [[ -f "$f" ]] || { echo "FAIL: missing asset $f" >&2; exit 1; }
done

echo "Verifying cosign signature + identity..."
cosign verify-blob \
  --certificate claude-lead-system.tar.gz.pem \
  --signature claude-lead-system.tar.gz.sig \
  --certificate-identity-regexp "$IDENTITY_REGEX" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  claude-lead-system.tar.gz >/dev/null

echo "Checking SBOM format..."
jq -e '.spdxVersion and .packages' sbom.spdx.json >/dev/null

if [[ -f release.json && -f release.json.sig && -f release.json.pem ]]; then
  echo "Verifying release manifest signature..."
  cosign verify-blob \
    --certificate release.json.pem \
    --signature release.json.sig \
    --certificate-identity-regexp "$IDENTITY_REGEX" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    release.json >/dev/null
fi

if [[ -f checksums.txt && -f install.sh ]]; then
  echo "Verifying installer checksum..."
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c checksums.txt >/dev/null
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c checksums.txt >/dev/null
  else
    echo "FAIL: missing shasum/sha256sum for installer checksum verification" >&2
    exit 1
  fi
fi

if [[ -f checksums.txt && -f checksums.txt.sig && -f checksums.txt.pem ]]; then
  echo "Verifying checksum file signature..."
  cosign verify-blob \
    --certificate checksums.txt.pem \
    --signature checksums.txt.sig \
    --certificate-identity-regexp "$IDENTITY_REGEX" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    checksums.txt >/dev/null
fi

if [[ -f release.json ]]; then
  echo "Verifying manifest hash bindings..."
  tar_sha=$(sha256_file claude-lead-system.tar.gz)
  sbom_sha=$(sha256_file sbom.spdx.json)
  jq -e --arg tar "$tar_sha" --arg sbom "$sbom_sha" '
    .artifacts.tarball.sha256 == $tar and
    .artifacts.sbom.sha256 == $sbom
  ' release.json >/dev/null || {
    echo "FAIL: release.json artifact hashes do not match tarball/sbom" >&2
    exit 1
  }
fi

echo "PASS: release artifacts verified for $REPO@$TAG"
