# Security

## Threat Model
This project runs local hooks and local MCP tools with shell access. Primary risks:
- command injection via untrusted tool arguments
- malformed JSON state that breaks coordination
- unsafe path handling for result/pipeline files
- accidental exposure of sensitive local config in committed defaults

## Current Controls
1. Input validation in coordinator
- strict patterns for IDs, model names, agent names
- normalized/sanitized pipeline step names
- directory argument guards against empty/newline injection

2. File safety
- worker/pipeline IDs restricted to safe character set
- no path separators allowed in task/pipeline identifiers
- coordinator state directories/files use owner-restricted modes (`0700` dirs, `0600` files) on Unix
- on Windows, coordinator applies explicit ACL hardening with `icacls` to remove inheritance and grant current-user access

3. Hook JSON safety
- session registry writes via `jq --arg` instead of string interpolation

4. Cross-platform locking in Python hooks
- Unix: `fcntl`
- Windows: `msvcrt`

5. Portable default settings
- repository template avoids personal MCP servers and environment-specific allowlists

6. Guard default posture
- `hooks/token-guard.py` is fail-closed by default for malformed payloads and unexpected internal errors
- fail-open is explicit via `TOKEN_GUARD_FAIL_OPEN=1`

## Operational Best Practices
- run `bash ~/.claude/hooks/health-check.sh` after install
- keep `~/.claude` permissions restricted to your user
- avoid giving untrusted prompts direct control over orchestration arguments
- review worker outputs before applying destructive shell commands

## Security Testing Checklist
- reject invalid `task_id` / `pipeline_id`
- reject unsafe `model` and `agent` values
- ensure session JSON remains valid with quoted paths
- ensure Windows lock fallback does not crash hooks

## Reporting
If you discover a security issue, open a private security report or a GitHub issue with repro details and minimal proof-of-concept.
