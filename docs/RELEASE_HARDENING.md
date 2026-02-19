# Release Hardening Gates

This document describes the quality gates that must pass before merging to `main`.

## CI Gates (`.github/workflows/ci.yml`)

All jobs must be green:

| Job | What it checks |
|-----|---------------|
| `lint-shell` | All `.sh` files pass `shellcheck` |
| `lint-python` | Python hooks compile (`py_compile`) and pass `ruff` |
| `lint-js` | `mcp-coordinator/index.js` and `lib.js` pass `node --check` |
| `test-unit` | 28 unit tests in `mcp-coordinator/tests/unit.test.js` (via `node --test`) |
| `test-unit` (e2e step) | 8 e2e tests in `mcp-coordinator/tests/e2e.test.js` (filesystem protocol) |
| `test-hooks` | `tests/hooks-smoke.sh` + `tests/health-check-regression.sh` |

## Manual Checklist Before Merging

### Security
- [ ] No command injection paths in `mcp-coordinator/index.js` (all user-controlled IDs go through `sanitizeId`)
- [ ] `model` and `agent` values are validated with `sanitizeModel`/`sanitizeId` before shell injection
- [ ] `task_id`, `pipeline_id`, `pipeline task.name` are sanitized before use in file paths
- [ ] `session_id` is sanitized before use in all inbox/session file paths

### Privacy
- [ ] No personal paths (e.g., `/Users/<name>/`) in any committed file
- [ ] No private project references (e.g., Atlas, specific project names) in committed files
- [ ] `settings/settings.local.json` is a generic template free of personal content

### Portability
- [ ] All shell scripts use `stat -f %m` (macOS) with `stat -c %Y` (Linux) fallback
- [ ] Windows fallback for `coord_wake_session` uses inbox messaging (no AppleScript on Windows)
- [ ] No dependency on `rg` (ripgrep) — use `grep` for CI scripts

### Test Quality
- [ ] Unit tests cover all `lib.js` exported functions
- [ ] E2E tests cover session file, inbox, worker, and pipeline protocols
- [ ] No timing-dependent assertions (all tests use deterministic filesystem state)
- [ ] `npm ci` works (requires `package-lock.json` committed)

### Documentation
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] README sections match actual behavior

## Adding New Features

When adding a new MCP tool to `index.js`:
1. Add input sanitization for any ID/path/model/agent parameter using `sanitizeId`/`sanitizeModel`
2. Add a unit test for any new utility function added to `lib.js`
3. Add an e2e test for the filesystem protocol contract if it writes new file types
4. Update this document if a new security/privacy gate is needed
