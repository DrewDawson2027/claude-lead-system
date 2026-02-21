# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- **Master Agent System**: 4 consolidated master agents (`master-coder`, `master-researcher`, `master-architect`, `master-workflow`) with on-demand mode loading
- 17 mode files across 4 agent types (build, debug, refactor, scrape, school, deep, academic, competitor, market, system, api, database, frontend, gsd, feature, git, autonomous)
- 18 reference cards (quick-reference cheat sheets loaded on-demand)
- `MANIFEST.md` system registry documenting all agents, modes, and hooks
- `hooks/agent-lifecycle.sh`: SubagentStart/SubagentStop lifecycle tracking with duration calculation
- `hooks/agent-metrics.py`: real per-invocation token metering via subagent transcript JSONL parsing
- `hooks/pre-compact-save.sh`: PreCompact hook saves session state before context compaction
- `hooks/hook_utils.py`: shared Python utilities for hook scripts
- `hooks/self-heal.py`: SessionStart auto-repair for missing/corrupt files
- `hooks/mcp-readiness.py`: SessionStart MCP server availability validation
- `hooks/token-guard-config.json`: configurable token guard limits (agent cap, thresholds)
- `hooks/README.md`: hook documentation
- `lead-tools/`: shell scripts for lead orchestration (detect_conflicts, get_result, send_message, spawn_worker)
- `plugin/`: Claude Code plugin distribution files (plugin.json, hooks.json, install.sh)
- Agent Teams orchestration in `master-workflow` (TeamCreate, SendMessage, shared task lists)
- Prompt caching architecture documentation across all agent definitions
- `lib/gc.js`: Auto-garbage collection for old results, sessions, and pipelines (runs once per server boot, 24h default)
- `batQuote()` helper for safe Windows .bat script string escaping (prevents cmd.exe metacharacter injection)
- `docs/TROUBLESHOOTING.md`: Common failure modes and solutions
- `docs/AGENT_TEAMS_INTEGRATION.md`: Four concrete patterns for using claude-lead-system with Agent Teams
- Cross-platform portable locking: `portable_flock_try()`, `portable_flock_release()`, `portable_flock_append()` in `hooks/lib/portable.sh`
- GC test coverage in `security.test.mjs`
- `batQuote` test coverage and fuzz test (200 random ASCII inputs) in `validation.test.mjs`
- Branch coverage push: 64% → 75%+ (40 new targeted tests across security, platform-launch, validation, e2e)
- Shell hook unit tests: worker completion routing, heartbeat auto-stale marking (34 total)
- CI now runs shell hook unit tests (`test-hooks.sh`) and Python hook unit tests (`pytest`)
- `isSafeTTYPath` validation tests, `readJSONLLimited` truncation/error tests
- README: "Who Is This For" section, positioning resilience note, accurate benchmark table

### Changed
- `hooks/token-guard.py`: now displays real metered token data alongside heuristic estimates in report
- `install.sh`: now installs agents, mode files, reference cards, and lead-tools in addition to hooks and MCP coordinator
- Modularized MCP coordinator: monolithic `index.js` split into 10 modules under `lib/` (security, helpers, constants, sessions, messaging, conflicts, workers, pipelines, gc, platform/)
- `commands/lead.md`: Removed references to dead tools; updated messaging guidance to use `coord_wake_session`
- `docs/SECURITY.md`: Updated to document `TOKEN_GUARD_SKIP_RULES` (replaces `FAIL_OPEN`), Enter-only wake safety, pre-edit conflict detection, atomic locking
- `docs/ARCHITECTURE.md`: Updated goal statement ("Complement Agent Teams"), added `conflict-guard.sh` and `portable.sh` to hook layer
- `README.md`: Repositioned as "Power Tools for Agent Teams" with comparison table, updated security model references, added coverage gate
- `bench/coord-benchmark.mjs`: Rewritten to measure actual coordinator operations (session read, boot scan, conflict detection) instead of strawman transcript-vs-JSON comparison
- Coverage gate: 80%+ line coverage enforced in CI (currently 88%+)

### Removed
- `coord_send_message` tool (superseded by `coord_wake_session` which delivers via inbox + Enter keystroke)
- `coord_register_work` tool (superseded by automatic heartbeat-based `files_touched` tracking)
- `coord_assign_task` tool (superseded by Claude Code Agent Teams' native `TaskCreate`)
- `handleSendMessage`, `handleRegisterWork`, `handleAssignTask` handler functions and all associated tests

### Fixed
- `hooks/terminal-heartbeat.sh`: Rate limiting and concurrent file locking now works on stock macOS (was silently no-op due to missing `flock`); replaced with portable `mkdir`-based lock fallback
- `hooks/terminal-heartbeat.sh`: Removed spurious `transcript: "unknown"` from heartbeat-fallback session creation
- `mcp-coordinator/lib/pipelines.js`: Windows .bat pipeline scripts now use `batQuote()` for all interpolated paths (was using raw string interpolation)
- `hooks/session-register.sh`: Debug log auto-truncates to 150 lines (prevents unbounded growth)
- `mcp-coordinator/lib/platform/common.js`, `lib/pipelines.js`: Replaced GNU-only `env -u CLAUDECODE` with POSIX `unset CLAUDECODE &&`
- `mcp-coordinator/lib/security.js`, `lib/messaging.js`, `lib/sessions.js`: Added stderr logging to 5 non-trivial catch blocks (was bare `catch {}`)
- `README.md`: Replaced misleading "207x faster" transcript comparison with actual coordinator benchmark table; removed dead `coord_send_message` and `assign` references

### Security
- Defense in depth: regex validation + `shellQuote`/`batQuote` + filesystem hardening (0700/0600 + symlink check + ownership check)
- Windows ACL hardening with `icacls` verification
- Granular `TOKEN_GUARD_SKIP_RULES` replaces blanket `FAIL_OPEN`
- Keystroke injection removed entirely — wake sends Enter keystroke only, message delivered via inbox
- `flock`-based TOCTOU protection on heartbeat rate limit and activity log appends
- All CI action SHAs pinned (no floating tags)
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
- Authorship/provenance artifacts: `.github/CODEOWNERS`, `CITATION.cff`, `docs/PROVENANCE.md`
- Release operations toolkit: `docs/RELEASE_CHECKLIST.md`, `scripts/release/preflight.sh`, `scripts/release/verify-release.sh`

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
- `mcp-coordinator/index.js`: direct terminal wake now defaults to Enter-only safety mode; typed message injection requires `allow_unsafe_terminal_message=true`
- `mcp-coordinator/index.js`: Windows ACL hardening now strips broad principals and rejects inherited ACLs during verification
- `mcp-coordinator/index.js`: fixed Windows `SendKeys` escaping for wake messages by switching to explicit per-character escaping in generated PowerShell
- `hooks/read-efficiency-guard.py`: added secure state dir/file permissions (`0700`/`0600`) aligned with `token-guard.py`
- `hooks/session-end.sh`: switched `.ended` timestamp update to `jq --arg` (removed fragile shell interpolation)
- `hooks/check-inbox.sh`: now strips C1 control characters (`0x80-0x9F`) in addition to C0 range
- Hooks (`session-register`, `session-end`, `terminal-heartbeat`, `check-inbox`, `token-guard`, `read-efficiency-guard`) now validate `session_id` (`^[A-Za-z0-9_-]{8,64}$`) and fail-closed before file access
- `hooks/check-inbox.sh`: worker completion routing now targets explicit session inbox (`notify_session_id`) and avoids cross-session stdout leakage
- `hooks/check-inbox.sh`: completion routing now uses per-task lock to avoid duplicate/missed routing races
- `mcp-coordinator/index.js`: message rate limiter now uses exclusive file lock to avoid concurrent read-modify-write races
- `mcp-coordinator/index.js`: hardened Unix shell quoting for worker/pipeline paths (including apostrophes)
- `mcp-coordinator/index.js`: `sanitizeShortSessionId` now enforces minimum 8-character session IDs
- `hooks/read-efficiency-guard.py`: state-directory hardening is now fail-closed (matches secure posture of `token-guard.py`)
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
- `lint-js` CI job now uses lockfile cache path + `npm ci` for deterministic installs
- Performance gate now uses multi-run median aggregation to reduce CI timing flake
- Inbox fuzz tests now use deterministic seeded corpus generation
- `coord_spawn_worker` now accepts `session_id` as an alias for `notify_session_id`
- Supply-chain workflow now uploads verification artifacts (`tar.gz`, `.sig`, `.pem`, `sbom.spdx.json`) directly to published GitHub Releases

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
