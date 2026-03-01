# Claude Lead System

Power tools for Claude Code Agent Teams. Conflict detection, activity logging, observability, and terminal orchestration — the features Agent Teams doesn't have. Installed via `/lead` slash command.

## Stack

- **Runtime:** Node.js ≥18
- **Language:** TypeScript + JavaScript (ESM)
- **Testing:** Node test runner + Python tests (pytest), shell smoke tests
- **Benchmarks:** `bench/` (mjs scripts)
- **CI:** GitHub Actions (see `.github/workflows/`)
- **Install:** `./install.sh` (copies plugin to `~/.claude/`)

## Run Commands

```bash
./install.sh                    # install plugin into ~/.claude/
node tests/perf-gate.mjs        # performance gate tests
bash tests/hooks-smoke.sh       # hook smoke tests
bash tests/test-hooks.sh        # full hook test suite
python3 tests/test_token_guard.py    # token guard Python tests
node bench/coord-benchmark.mjs  # coordination benchmark
```

## Architecture

```
agents/             # Agent definitions and dispatch
plugin/             # Claude Code plugin entry (install.sh + hooks)
  install.sh        # plugin installer
bench/              # Benchmarks (bridge-validator, coord, demo scenarios)
tests/              # Test suite (perf-gate, hooks, token guard, mode-path lint)
settings/           # Plugin settings
  settings.local.json
docs/               # Operator playbooks, migration guides, data contracts
MANIFEST.md         # File manifest + compatibility matrix
```

## Key Concepts

- **Conflict detection** — pre-edit file conflict checking across sessions (zero token cost, runs outside context window)
- **Activity log** — universal cross-session activity log
- **Terminal orchestration** — native tab spawning, sequential pipelines
- **Token management** — token guard hooks, cold ops caching, CI badges
- Entry point: type `/lead` in any Claude Code session

## Conventions

- Hooks must run outside the context window — never add context-consuming logic to hook files
- Performance gate must pass before any release (`node tests/perf-gate.mjs`)
- Token system changes require running `tests/test_token_guard.py` + `tests/health-check-regression.sh`

## Current Focus

Token system stability: CI/publish workflows, cold ops caching, coverage badges. Fix: coverage gate disabled in badge publish job.

## Do Not Touch

- `bench/latest-results.json` — auto-generated benchmark snapshot, don't hand-edit
- `CHANGELOG.md` — updated by release automation
