# Engineering Standards Checklist

Living checklist tracking adherence to "top tier" open source engineering standards.

## Code Quality

| Standard                                                 | Status | Evidence                                                                            |
| -------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| All public mutations validated server-side               | Done   | `BODY_ALLOWLISTS` in `sidecar/server/http/validation.ts`                            |
| Consistent error envelopes                               | Done   | All routes use `sendError()` with `{ error_code, message, request_id }`             |
| Claim-doc drift checks automated for governed claims     | Done   | `scripts/check-claim-drift.sh` in CI (`claim-drift` job) and local verification     |
| TODO/HACK/FIXME markers absent in coordinator/sidecar runtime code | Done   | `rg -n "TODO|HACK|FIXME" mcp-coordinator/lib sidecar/server` returns no matches; `hooks/teammate-idle.py` intentionally contains TODO/FIXME scanner patterns |
| High-risk code paths have direct tests                   | Done   | `auth-matrix.test.mjs`, `security-hardening.test.mjs`, `resilience-http.test.mjs`   |

## Security

| Standard                                 | Status | Evidence                                                           |
| ---------------------------------------- | ------ | ------------------------------------------------------------------ |
| Exact browser origin policy              | Done   | `requireSameOrigin()` in `sidecar/server/http/security.ts`         |
| No secret disclosure in bootstrap        | Done   | `GET /ui/bootstrap.json` returns only CSRF token                   |
| Mutating routes all gated                | Done   | Rate limit + bearer auth + CSRF chain in `create-server.ts`        |
| Installer + source artifacts checksummed | Done   | SHA256SUMS in `release-bundle.yml`                                 |
| Signed checksum verification path        | Done   | Cosign signing in `.github/workflows/supply-chain.yml`             |
| Clear threat model + disclosure process  | Done   | `docs/SECURITY.md` with 72-hour SLA, 90-day coordinated disclosure |

## Reliability

| Standard                                  | Status | Evidence                                                             |
| ----------------------------------------- | ------ | -------------------------------------------------------------------- |
| Core local gate reproducible              | Done   | `npm run ci:local`                                                   |
| Fresh-checkout certification reproducible | Done   | `npm run cert:a-plus:fresh` (9-command cert runner with live metrics) |
| Installed runtime health audited          | Done   | `bash ~/.claude/hooks/health-check.sh` (installed/blessed-path runtime only) |
| Hook tests and regressions pass           | Done   | `tests/hooks-smoke.sh`, `tests/test-hooks.sh`, pytest in CI          |
| Crash/restart/repair tested               | Done   | `repair.test.mjs`, `checkpoint.test.mjs`, `resilience-http.test.mjs` |
| Limits and quotas documented and enforced | Done   | `docs/OPERATIONAL_SLOS.md`, rate limiter, body size caps             |
| Upgrade compatibility tested              | Done   | `compatibility-matrix` CI job (Node 18/20, Python 3.10/3.11)         |

## Release Trust

| Standard                                             | Status | Evidence                                                         |
| ---------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| Versioned install docs                               | Done   | `docs/UPGRADE_GUIDE.md`                                          |
| Checksums for installer and tarball                  | Done   | `release-bundle.yml` generates SHA256SUMS                        |
| Signatures + provenance visible and verifiable       | Done   | `docs/TAG_VERIFICATION.md`, `.github/workflows/supply-chain.yml` |
| Fresh-install CI smoke tests on all target platforms | Done   | `smoke-install` CI job (ubuntu/macOS/Windows)                    |

## Proof / Claims

| Standard                                 | Status | Evidence                                                  |
| ---------------------------------------- | ------ | --------------------------------------------------------- |
| Benchmark methodology documented         | Done   | `docs/BENCH_METHODOLOGY.md`                               |
| Claims linked to evidence                | Done   | `docs/CLAIM_PROVENANCE.md` verification table             |
| Demo assets current with release version | Done   | `scripts/check-demo-assets.sh` in CI                      |
| Coverage claim auto-audited              | Done   | `scripts/check-coverage-claim.mjs` in CI (`coverage` job) |

## How to Verify

```bash
# Fresh-checkout certification (process-level A+ command set)
npm run cert:a-plus:fresh

# Installed runtime health check (blessed-path scope, not raw checkout)
bash ~/.claude/hooks/health-check.sh

# Run all checks locally
npm run ci:local                              # Local composite gate (lint/test/docs audits)
bash scripts/check-claim-drift.sh             # Claim-doc drift
bash scripts/check-demo-assets.sh             # Demo asset freshness
cd sidecar && npx tsx --test test/*.test.mjs  # Sidecar tests
cd mcp-coordinator && npm run test:coverage   # Coordinator coverage
```

## References

- `docs/CLAIM_PROVENANCE.md` — README claim → proof mapping
- `docs/OPERATIONAL_SLOS.md` — Performance targets
- `docs/SECURITY.md` — Threat model and disclosure policy
- `.github/workflows/ci.yml` — All CI job definitions
