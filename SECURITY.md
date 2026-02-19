# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest (main) | ✅ |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them via [GitHub's private vulnerability reporting](https://github.com/DrewDawson2027/claude-lead-system/security/advisories/new) or by emailing the repository maintainer directly.

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

You can expect an acknowledgement within 48 hours and a fix or mitigation plan within 7 days for confirmed issues.

## Security Model

**What this tool does:**
- Reads/writes JSON files in `~/.claude/terminals/` (session state, inboxes, results)
- Fires shell hooks on every Claude Code tool call
- Optionally runs an MCP server over stdio (local process only)

**Trust boundary:**
- All data lives locally in `~/.claude/` — nothing is sent to a remote server
- The MCP coordinator communicates only via stdio (Claude Code → local process)
- `coord_spawn_worker` runs `claude -p` as a subprocess — it inherits your environment

**Known design constraints:**
- Inbox files in `~/.claude/terminals/inbox/` are plain JSONL — they are not encrypted. Any process with read access to your home directory can read them.
- Session IDs passed to MCP tools are validated and sanitized before use in file paths (see `mcp-coordinator/lib.js: sanitizeId`).
