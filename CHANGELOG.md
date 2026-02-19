# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- One-line `install.sh` installer for macOS and Linux
- `LICENSE` file (MIT)
- `CONTRIBUTING.md` with setup instructions and contribution areas
- `CHANGELOG.md`
- GitHub Actions CI: shellcheck, Python syntax + ruff lint, Node.js syntax check, unit/e2e tests, smoke and regression tests
- `engines` field in `mcp-coordinator/package.json` (requires Node ≥ 18)
- `mcp-coordinator/lib.js`: extracted utility module (`readJSON`, `readJSONL`, `getSessionStatus`, `timeAgo`) with new `sanitizeId` and `sanitizeModel` functions for input sanitization
- `mcp-coordinator/tests/unit.test.js`: 28 unit tests for `lib.js` (via Node.js built-in `node:test`)
- `mcp-coordinator/tests/e2e.test.js`: 8 e2e tests for filesystem protocol (session files, inbox, workers, pipelines)
- `mcp-coordinator/package-lock.json`: lock file committed so `npm ci` works reliably in CI
- `tests/hooks-smoke.sh`: CI-safe smoke test for all hook files, Node/Python syntax, and private-reference checks
- `tests/health-check-regression.sh`: regression test verifying settings contract, hook contract, and CI workflow coverage
- `docs/RELEASE_HARDENING.md`: release gate checklist (security, privacy, portability, tests)

### Fixed
- `hooks/session-register.sh`: removed raw input debug logging that could expose sensitive session metadata; replaced with structured field logging
- `hooks/check-inbox.sh`: atomic inbox drain via `mv` before read — prevents message loss if hook crashes mid-delivery
- `mcp-coordinator/index.js`: added input sanitization (`sanitizeId`/`sanitizeModel`) to all tool handlers that use user-controlled values in file paths or shell arguments — prevents path traversal and command injection

### Changed
- `README.md`: complete rewrite with badges, hero description, architecture diagram, platform table, enriched session file example, one-line install, and full components reference
- `settings/settings.local.json`: replaced with a clean, generic template — removed private project references, personal paths, personal MCP servers, and project-specific prompt content
- `hooks/terminal-heartbeat.sh`: removed private project backward-compatibility block (Atlas-specific path handling)
- `.github/workflows/ci.yml`: added `test-unit` (unit + e2e tests) and `test-hooks` (smoke + regression) jobs; switched to `npm ci` with committed lock file; install `jq` in hooks test job
- `mcp-coordinator/package.json`: added `scripts.test:unit` and `scripts.test:e2e`

## [1.0.0] — 2026-02-01

### Added
- Initial release
- `terminal-heartbeat.sh` — rate-limited PostToolUse session enrichment
- `session-register.sh` — SessionStart registry with TTY capture
- `check-inbox.sh` — PreToolUse inbox delivery
- `session-end.sh` — SessionEnd metadata preservation
- `health-check.sh` — hook/dep/settings validator
- `token-guard.py` — agent spawn limiter (max 3/session)
- `read-efficiency-guard.py` — sequential read pattern advisor
- `commands/lead.md` — `/lead` slash command with full orchestration prompt
- `mcp-coordinator/index.js` — MCP server: spawn workers, wake sessions, pipelines, conflict detection
- Cross-platform support: macOS (iTerm2, Terminal.app), Windows (Windows Terminal, PowerShell, cmd), Linux (gnome-terminal, konsole, kitty, alacritty, xterm), Cursor/VS Code
