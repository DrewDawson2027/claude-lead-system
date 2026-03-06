#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-DrewDawson2027/claude-lead-system}"
BRANCH="${2:-main}"
REQUIRED_CHECKS="${REQUIRED_CHECKS:-CI,supply-chain-policy}"

if ! command -v gh >/dev/null 2>&1; then
  echo "FAIL: gh CLI is required for branch protection verification" >&2
  exit 1
fi

json=$(gh api "repos/${REPO}/branches/${BRANCH}/protection" 2>/dev/null || true)
if [[ -z "$json" || "$json" == *"Not Found"* ]]; then
  echo "FAIL: branch protection not configured for ${REPO}:${BRANCH}" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required for branch protection verification" >&2
  exit 1
fi

strict=$(echo "$json" | jq -r '.required_status_checks.strict // false')
if [[ "$strict" != "true" ]]; then
  echo "FAIL: required status checks strict mode is not enabled" >&2
  exit 1
fi

enforce_admins=$(echo "$json" | jq -r '.enforce_admins.enabled // false')
if [[ "$enforce_admins" != "true" ]]; then
  echo "FAIL: enforce_admins must be enabled" >&2
  exit 1
fi

required_reviews=$(echo "$json" | jq -r '.required_pull_request_reviews.required_approving_review_count // 0')
if [[ "$required_reviews" -lt 1 ]]; then
  echo "FAIL: at least one approving review is required" >&2
  exit 1
fi

required_signatures=$(echo "$json" | jq -r '.required_signatures.enabled // false')
if [[ "$required_signatures" != "true" ]]; then
  echo "FAIL: required_signatures must be enabled" >&2
  exit 1
fi

conversation_resolution=$(echo "$json" | jq -r '.required_conversation_resolution.enabled // false')
if [[ "$conversation_resolution" != "true" ]]; then
  echo "FAIL: required conversation resolution must be enabled" >&2
  exit 1
fi

contexts=$(echo "$json" | jq -r '.required_status_checks.contexts[]?')
IFS=',' read -r -a required_checks <<< "$REQUIRED_CHECKS"
for required in "${required_checks[@]}"; do
  required="$(echo "$required" | xargs)"
  [ -n "$required" ] || continue
  if ! echo "$contexts" | grep -Fxq "$required"; then
    echo "FAIL: required status checks do not include '$required'" >&2
    echo "      found: $(echo "$contexts" | tr '\n' ',' | sed 's/,$//')" >&2
    exit 1
  fi
done

echo "PASS: branch protection policy validated (${REPO}:${BRANCH})"
