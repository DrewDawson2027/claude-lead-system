# Claim Provenance

Maps every major README claim to its proof artifact and verification command.

## Verification Table

| Claim                                   | Proof Artifact                       | Verification Command                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 88%+ test coverage                      | `mcp-coordinator/coverage/`          | `cd mcp-coordinator && npm run test:coverage`                                                                                                                                                                                                                                                               |
| Cross-platform: macOS, Linux, Windows   | CI `platform-matrix` job             | `gh run view --job platform-matrix`                                                                                                                                                                                                                                                                         |
| Node 18/20, Python 3.10/3.11 compatible | CI `compatibility-matrix` job        | `gh run view --job compatibility-matrix`                                                                                                                                                                                                                                                                    |
| Signed releases with cosign             | `.github/workflows/supply-chain.yml` | `cosign verify-blob --signature checksums.txt.sig --certificate checksums.txt.pem ...`                                                                                                                                                                                                                      |
| SBOM included                           | `sbom.spdx.json` release asset       | Download from GitHub Release assets                                                                                                                                                                                                                                                                         |
| One-command install                     | `install.sh`                         | `bash install.sh --version vX.Y.Z --checksum-file checksums.txt --checksum-signature checksums.txt.sig --checksum-cert checksums.txt.pem --release-manifest release.json --release-manifest-signature release.json.sig --release-manifest-cert release.json.pem --source-tarball claude-lead-system.tar.gz` |
| Coordinator benchmark thresholds        | `bench/latest-results.json`          | `node bench/coord-benchmark.mjs`                                                                                                                                                                                                                                                                            |
| Performance gate in CI                  | `tests/perf-gate.mjs`                | `node tests/perf-gate.mjs`                                                                                                                                                                                                                                                                                  |
| 80%+ coverage gate                      | CI `coverage` job                    | `cd mcp-coordinator && npm run test:coverage`                                                                                                                                                                                                                                                               |
| Shell hooks linted                      | CI `lint-shell` job                  | `shellcheck hooks/*.sh`                                                                                                                                                                                                                                                                                     |
| Python hooks linted                     | CI `lint-python` job                 | `ruff check hooks/*.py`                                                                                                                                                                                                                                                                                     |
| CI action SHAs pinned                   | `.github/workflows/*.yml`            | `grep -r 'uses:' .github/workflows/ \| grep -v '#'`                                                                                                                                                                                                                                                         |
| Installer smoke tested                  | CI `smoke-install` job               | `bash tests/smoke-install.sh --ref HEAD --mode lite`                                                                                                                                                                                                                                                        |
| Hook integration tested                 | CI `integration-tests` job           | `bash tests/hooks-smoke.sh`                                                                                                                                                                                                                                                                                 |
| Token system regression tested          | CI `token-system-regression` job     | `python3 scripts/run_token_system_regression.py`                                                                                                                                                                                                                                                            |

## How to Verify a Specific Claim

### Coverage claim

```bash
cd mcp-coordinator
npm run test:coverage
# Output shows line coverage percentage — must be 80%+
```

### Cross-platform claim

```bash
# View latest CI run results
gh run list --workflow ci.yml -L 1
gh run view <run-id> --job platform-matrix
```

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
cat bench/latest-results.json | jq '.results | to_entries[] | "\(.key): \(.value.median_ms)ms"'
```

## Automation

All claims are verified automatically in CI on every push to `main` and every PR:

- Coverage: `coverage` job
- Platform support: `platform-matrix` job
- Compatibility: `compatibility-matrix` job
- Performance: `perf-gate` job
- Smoke install: `smoke-install` job
- Hooks: `integration-tests` job

## References

- `.github/workflows/ci.yml` — All CI job definitions
- `.github/workflows/supply-chain.yml` — Signing + SBOM
- `docs/BENCH_METHODOLOGY.md` — Benchmark methodology
- `docs/TAG_VERIFICATION.md` — Release verification
