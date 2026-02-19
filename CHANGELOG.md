# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- One-line `install.sh` installer for macOS and Linux
- `LICENSE` file (MIT)
- `CONTRIBUTING.md` with setup instructions and contribution areas
- `CHANGELOG.md`
- GitHub Actions CI: shellcheck, Python syntax + ruff lint, Node.js syntax check
- `engines` field in `mcp-coordinator/package.json` (requires Node ≥ 18)
- Coordinator validation tests (`mcp-coordinator/test/validation.test.mjs`)
- Hook smoke tests (`tests/hooks-smoke.sh`) and CI integration-test job
- `docs/ARCHITECTURE.md` and `docs/SECURITY.md`
- Worker/pipeline E2E tests (`mcp-coordinator/test/e2e-worker-pipeline.test.mjs`)
- Platform launch command tests (`mcp-coordinator/test/platform-launch.test.mjs`)
- Benchmark harness and snapshot (`bench/coord-benchmark.mjs`, `bench/latest-results.json`)
- Release hardening bundle (`docs/RELEASE_HARDENING.md`)
- Demo asset pack and narration script (`assets/demo/*`)
- Committed visual proof assets (`assets/demo/demo.gif`, `assets/demo/before-after.png`)
- Health-check regression test (`tests/health-check-regression.sh`)

### Fixed
- `hooks/session-register.sh`: removed raw input debug logging that could expose sensitive session metadata; replaced with structured field logging
- `hooks/check-inbox.sh`: atomic inbox drain via `mv` before read — prevents message loss if hook crashes mid-delivery
- `hooks/session-register.sh`: switched to `jq --arg` JSON writing to prevent malformed JSON on special characters
- `hooks/token-guard.py` and `hooks/read-efficiency-guard.py`: cross-platform lock support (Windows + Unix)
- `mcp-coordinator/index.js`: strict argument sanitization for IDs, models, agents, and pipeline step names
- `hooks/health-check.sh`: validates coordinator MCP config and unresolved settings placeholders
- `hooks/terminal-heartbeat.sh`: removed project-specific backward-compat logging
- Removed remaining project-specific examples/references from docs/prompts

### Changed
- `README.md`: complete rewrite with badges, hero description, architecture diagram, platform table, enriched session file example, one-line install, and full components reference
- `settings/settings.local.json`: replaced with portable minimal template focused on coordinator + lead hooks
- `install.sh`: expands `__HOME__` placeholder in settings template during install
- CI expanded with coordinator E2E, platform matrix, and Node/Python compatibility matrix
- README now includes benchmark table, before/after outcomes, and release-hardening references

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
