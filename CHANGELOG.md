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
- Coordinator inbox parser fuzz/property tests (`mcp-coordinator/test/inbox-fuzz.test.mjs`)
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
- `mcp-coordinator/index.js`: `coord_check_inbox` now uses atomic drain (`rename`) to avoid dropping concurrently-arriving messages
- `mcp-coordinator/index.js`: worker/session conflict checks now use normalized canonical paths (removed basename-only matching)
- `mcp-coordinator/index.js`: `coord_send_message` now rejects unknown sessions by default (`allow_offline=true` enables explicit offline queueing)
- `mcp-coordinator/index.js`: Windows worker flow now records a PID file so `coord_kill_worker` can terminate running workers consistently
- `mcp-coordinator/index.js`: PID handling now validates numeric IDs before shelling out (`isProcessAlive`, `killProcess`)
- `mcp-coordinator/index.js`: custom `task_id`/`pipeline_id` collisions are rejected to prevent result overwrites
- `mcp-coordinator/index.js`: `coord_detect_conflicts` now errors on unknown detector session IDs instead of resolving paths from the coordinator cwd
- `mcp-coordinator/index.js`: directory path validation now rejects unsafe control chars and embedded double quotes
- `hooks/session-end.sh`: per-session guard state files are cleaned up on session close
- `hooks/check-inbox.sh`: strips terminal control characters before printing inbound/worker output
- `mcp-coordinator/index.js`: replaced shell-based process/terminal execution (`execSync`) with `spawnSync`/`execFileSync` and direct process signals
- `mcp-coordinator/index.js`: Windows worker launch now uses generated `.ps1` files with argument passing (`powershell -File`) instead of inline one-liners
- `mcp-coordinator/index.js`: enforced secure filesystem modes for coordinator state (`0700` dirs, `0600` files), plus symlink/owner checks
- `mcp-coordinator/index.js`: added message-size/rate limits and bounded inbox drain to prevent resource exhaustion
- `hooks/token-guard.py`: fail-open is now configurable via `TOKEN_GUARD_FAIL_OPEN=1` (default fail-closed), with hardened state directory/file permissions
- Removed remaining project-specific examples/references from docs/prompts

### Changed
- `README.md`: complete rewrite with badges, hero description, architecture diagram, platform table, enriched session file example, one-line install, and full components reference
- `settings/settings.local.json`: replaced with portable minimal template focused on coordinator + lead hooks
- `install.sh`: expands `__HOME__` placeholder in settings template during install
- CI expanded with coordinator E2E, platform matrix, and Node/Python compatibility matrix
- README now includes benchmark table, before/after outcomes, and release-hardening references
- `mcp-coordinator/test/e2e-worker-pipeline.test.mjs`: lifecycle e2e coverage now runs on non-Windows platforms by default (not Linux-only)
- Added supply-chain workflow (`.github/workflows/supply-chain.yml`) for SBOM generation and release provenance attestation
- Supply-chain workflow now generates keyless cosign signatures/certificates and verifies signed release bundles
- CI now enforces performance SLOs with `tests/perf-gate.mjs`

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
