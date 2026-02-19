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
```

## Areas that need help

- **Windows `coord_wake_session`** — currently falls back to inbox. Native Windows Terminal focus + keystroke injection would be a great addition.
- **tmux / zellij support** — `openTerminalWithCommand` in `index.js` could gain a `tmux` branch.
- **Hook tests** — there are no automated tests for the shell hooks. A simple bash test harness would be valuable.
- **Windows `fcntl` replacement** — `token-guard.py` and `read-efficiency-guard.py` use `fcntl` which doesn't exist on Windows. A cross-platform file locking solution (e.g. `filelock` package) would enable true Windows Python support.

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
