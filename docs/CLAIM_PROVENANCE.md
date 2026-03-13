# Claim Provenance

Maps every major README claim to its proof artifact and verification command.
Broad positioning claims still require human judgment; this table is only for claims that have a concrete proof artifact or verification path.

## Verification Table

| Claim                                   | Proof Artifact                       | Verification Command                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical claim posture source is the single sync authority | `docs/CLAIM_POSTURE_SOURCE.json`, `scripts/claim-posture-sync.mjs` | `node scripts/claim-posture-sync.mjs --check`                                                                                                                                                                                                                                                   |
| 80%+ coordinator line-coverage gate (current ~86.75% on 2026-03-12 local validation) | `mcp-coordinator/coverage/`          | `cd mcp-coordinator && npm run test:coverage`                                                                                                                                                                                                                                                               |
| CI platform coverage: macOS, Linux, Windows | CI `Platform Launch Matrix` jobs | `RUN_ID="$(gh run list --workflow ci.yml -L 1 --json databaseId --jq '.[0].databaseId')" && gh run view "$RUN_ID" --json jobs --jq '.jobs[] | select(.name | startswith("Platform Launch Matrix")) | {name, conclusion, startedAt, completedAt}'`                                                                                                                   |
| Node 18/20, Python 3.10/3.11 compatible | CI `Compatibility Matrix` jobs       | `RUN_ID="$(gh run list --workflow ci.yml -L 1 --json databaseId --jq '.[0].databaseId')" && gh run view "$RUN_ID" --json jobs --jq '.jobs[] | select(.name | startswith("Compatibility Matrix")) | {name, conclusion, startedAt, completedAt}'`                                                                                                                    |
| Signed releases with cosign             | `.github/workflows/supply-chain.yml` | `cosign verify-blob --signature checksums.txt.sig --certificate checksums.txt.pem ...`                                                                                                                                                                                                                      |
| SBOM included                           | `sbom.spdx.json` release asset       | Download from GitHub Release assets                                                                                                                                                                                                                                                                         |
| Single installer entrypoint             | `install.sh`                         | `bash install.sh --version vX.Y.Z --checksum-file checksums.txt --checksum-signature checksums.txt.sig --checksum-cert checksums.txt.pem --release-manifest release.json --release-manifest-signature release.json.sig --release-manifest-cert release.json.pem --source-tarball claude-lead-system.tar.gz` |
| Coordinator benchmark thresholds        | `bench/latest-results.json`          | `node bench/coord-benchmark.mjs`                                                                                                                                                                                                                                                                            |
| Performance gate in CI                  | `tests/perf-gate.mjs`                | `node tests/perf-gate.mjs`                                                                                                                                                                                                                                                                                  |
| 80%+ coverage gate                      | CI `coverage` job                    | `cd mcp-coordinator && npm run test:coverage`                                                                                                                                                                                                                                                               |
| Shell hooks linted                      | CI `lint-shell` job                  | `shellcheck hooks/*.sh hooks/lib/*.sh`                                                                                                                                                                                                                                                                      |
| Python hooks linted                     | CI `lint-python` job                 | `ruff check hooks/*.py`                                                                                                                                                                                                                                                                                     |
| CI action SHAs pinned                   | `.github/workflows/*.yml`            | `grep -r 'uses:' .github/workflows/ | grep -v '#' || echo 'No unpinned action references found'`                                                                                                                                                                                                                 |
| Installer smoke tested                  | CI `smoke-install` job               | `bash tests/smoke-install.sh --ref HEAD --mode full`                                                                                                                                                                                                                                                        |
| Hook integration tested                 | CI `integration-tests` job           | `bash tests/hooks-smoke.sh`                                                                                                                                                                                                                                                                                 |
| Token system regression tested          | CI `token-system-regression` job     | `python3 scripts/run_token_system_regression.py`                                                                                                                                                                                                                                                            |
| Fresh-checkout certification command set | `scripts/certify-a-plus.mjs`, `reports/a-plus-cert.json` | `npm run cert:a-plus:fresh`                                                                                                                                                                                                                                                              |
| Installed-runtime health-check scope    | `hooks/health-check.sh`              | `bash ~/.claude/hooks/health-check.sh`                                                                                                                                                                                                                                                                      |

## How to Verify a Specific Claim

### Coverage claim

```bash
npm run audit:coverage-claim
# If coverage artifacts are missing, this command generates fresh coverage first.
# Output includes configured gate and measured coverage from this checkout.
```

## Release Discipline Policy

- Canonical public-cert branch: `main`
- Canonical cert flow command: `npm run cert:a-plus:fresh`
- Canonical cert artifact: `reports/a-plus-cert.json`
- `A+` is only valid when the cert flow passes on the exact `main` source branch with a clean worktree

### Fresh-checkout certification claim

```bash
npm run cert:a-plus:fresh
cat reports/a-plus-cert.json
# Runs the canonical 8-step cert flow and emits deterministic literal output + JSON report.
```

### CI platform coverage claim

```bash
# View latest CI run results
RUN_ID="$(gh run list --workflow ci.yml -L 1 --json databaseId --jq '.[0].databaseId')"
gh run view "$RUN_ID" --json jobs --jq '.jobs[] | select(.name | startswith("Platform Launch Matrix"))'
```

This verifies that CI exercised the repo on those runners. It does not, by itself, prove equal runtime maturity or equal UX across all operating systems.

### Signed release claim

```bash
# Download release artifacts
gh release download v1.2.0 -R DrewDawson2027/claude-lead-system

# Verify with cosign
cosign verify-blob \
  --signature checksums.txt.sig \
  --certificate checksums.txt.pem \
  --certificate-identity-regexp "^https://github.com/DrewDawson2027/claude-lead-system/.github/workflows/release-bundle\\.yml@refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+([-.][A-Za-z0-9._-]+)?$" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  checksums.txt
```

### Performance claim

```bash
# Run benchmark locally
node bench/coord-benchmark.mjs

# Compare against latest published results
cat bench/latest-results.json | jq '.coordinator_benchmark | {speedup_ratio_avg, session_json_read_p95_ms: .session_json_read.p95_ms, transcript_scan_p95_ms: .transcript_scan.p95_ms, snapshot_build_p95_ms}'
```

## Automation

CI-backed claims in the table above are verified automatically on every push to `main` and every PR:

- Coverage: `coverage` job
- Docs + claim drift parity: `docs-audit` job (`npm run docs:audit`)
- Platform support: `Platform Launch Matrix` jobs
- Compatibility: `Compatibility Matrix` jobs
- Performance: `perf-gate` job
- Smoke install: `smoke-install` job
- Hooks: `integration-tests` job
- Canonical A+ cert artifact: `cert-a-plus-main` job (pushes to `main` only)

## References

- `.github/workflows/ci.yml` — All CI job definitions
- `.github/workflows/supply-chain.yml` — Signing + SBOM
- `docs/BENCH_METHODOLOGY.md` — Benchmark methodology
- `docs/TAG_VERIFICATION.md` — Release verification
