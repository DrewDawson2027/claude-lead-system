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

### Fixed
- `hooks/session-register.sh`: removed raw input debug logging that could expose sensitive session metadata; replaced with structured field logging
- `hooks/check-inbox.sh`: atomic inbox drain via `mv` before read — prevents message loss if hook crashes mid-delivery

### Changed
- `README.md`: complete rewrite with badges, hero description, architecture diagram, platform table, enriched session file example, one-line install, and full components reference

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
