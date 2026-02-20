# Contributing to Claude Lead System

Thanks for your interest! Contributions are welcome.

## Setup

```bash
git clone https://github.com/DrewDawson2027/claude-lead-system.git
cd claude-lead-system
cd mcp-coordinator && npm install
```

## Testing hooks

```bash
bash hooks/health-check.sh
bash tests/hooks-smoke.sh
bash tests/health-check-regression.sh
cd mcp-coordinator && npm test
cd mcp-coordinator && npm run test:e2e
```

## Release quality

- Follow the release gates in [docs/RELEASE_HARDENING.md](docs/RELEASE_HARDENING.md)
- Update `bench/latest-results.json` when performance-sensitive behavior changes

## Areas that need help

- **Windows `coord_wake_session`** — currently falls back to inbox. Native Windows Terminal focus + keystroke injection would be a great addition.
- **tmux / zellij support** — `openTerminalWithCommand` in `index.js` could gain a `tmux` branch.
- **Hook test depth** — shell hooks have smoke/regression coverage, but deeper race-condition and portability tests would improve confidence.

## PR guidelines

- Keep PRs focused — one feature or fix per PR
- Update the README components table if you add a file
- Test on your platform before submitting
- Add a comment to any non-obvious bash/jq expression

## Reporting bugs

Open an issue with:
- Your OS and terminal emulator
- Output of `bash ~/.claude/hooks/health-check.sh`
- What you expected vs. what happened
