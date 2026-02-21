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
- all hook entry points validate `session_id` against `^[A-Za-z0-9_-]{8,64}$`, normalize to 8 chars, and fail-closed on invalid values before file access

4. Cross-platform locking in Python hooks
- Unix: `fcntl`
- Windows: `msvcrt`

5. Portable default settings
- repository template avoids personal MCP servers and environment-specific allowlists

6. Guard default posture
- `hooks/token-guard.py` is fail-closed by default for malformed payloads and unexpected internal errors
- granular bypass via `TOKEN_GUARD_SKIP_RULES=rule1,rule2` (valid rules: `state_dir`, `payload`, `session_id`, `internal`) — each skip is logged to stderr
- `hooks/read-efficiency-guard.py` uses the same secure local state directory/file permission model (`0700`/`0600`)

7. Wake safety
- terminal wake sends Enter keystroke only — never injects typed message content
- all message content is delivered through inbox files, not terminal keystroke injection
- the `allow_unsafe_terminal_message` parameter was removed to eliminate keystroke injection as an attack surface

8. Pre-edit conflict detection
- `hooks/conflict-guard.sh` (PreToolUse on Edit/Write) checks all active sessions' `files_touched` arrays before allowing writes
- advisory only (never blocks edits) — warns on stderr when another session has modified the same file

9. Atomic file locking
- `terminal-heartbeat.sh` uses `flock` for rate limiting and stale detection (prevents TOCTOU races)
- `activity.jsonl` appends are protected by `flock` to prevent concurrent write corruption

8. Worker result routing safety
- worker completion output is delivered to an explicit session inbox (`notify_session_id`) instead of being globally broadcast to whichever terminal runs next
- untargeted completions are not marked reported, preventing silent loss

9. Rate-limit integrity
- coordinator message rate-limit state uses an exclusive file lock to prevent read-modify-write races under concurrent calls

10. CI action integrity
- GitHub Actions workflows are pinned to full commit SHAs (not floating tags)

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
