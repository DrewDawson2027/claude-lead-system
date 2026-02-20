# Release Hardening Bundle

This document defines what must pass before a release tag is created.

## Compatibility Guarantees

The project guarantees support for:
- Node.js `18.x` and `20.x` for `mcp-coordinator`
- Python `3.10+` for hook guards
- `jq` available on PATH for shell hooks
- OS targets: macOS, Linux, Windows (with inbox fallback where terminal injection is unavailable)

## Versioned Test Matrix

| Dimension | Versions / Targets | Validation |
|---|---|---|
| Node.js | 18, 20 | `npm run test:unit`, `node --check` |
| Python | 3.10, 3.11 | `python3 -m py_compile` + `ruff` |
| OS | ubuntu-latest, macos-latest, windows-latest | platform launch unit tests |
| Hook runtime | ubuntu-latest | `tests/hooks-smoke.sh` |
| Health-check behavior | ubuntu-latest | `tests/health-check-regression.sh` |
| Worker/pipeline lifecycle | ubuntu-latest | `npm run test:e2e` |

## Release Gates (must pass)

1. CI workflow green on `main`
2. Coordinator unit tests green (`test:unit`)
3. Coordinator E2E worker/pipeline tests green (`test:e2e`)
4. Hook smoke tests green (`tests/hooks-smoke.sh`)
5. Health-check regression tests green (`tests/health-check-regression.sh`)
6. Changelog updated under `Unreleased`
7. README benchmark and proof links updated for current release
8. Supply-chain workflow produced `sbom.spdx.json` + provenance attestation

## Supply Chain Integrity

- Workflow: `.github/workflows/supply-chain.yml`
- Produces a repository bundle (`claude-lead-system.tar.gz`) and SPDX SBOM (`sbom.spdx.json`)
- Publishes GitHub artifact attestation for the release bundle using `actions/attest-build-provenance`

## Manual Verification Checklist

1. Run install script on a fresh profile
2. Confirm `health-check.sh` shows healthy status
3. Start two Claude sessions and verify:
- inbox messaging
- conflict detection
- worker spawn/result
- pipeline run/status

## Release Tagging Policy

- Semantic versioning (`MAJOR.MINOR.PATCH`)
- Tag only from `main` after all gates pass
- Include benchmark snapshot (`bench/latest-results.json`) in release notes
