# Security

## Threat Model

This project runs local hooks and local MCP tools with shell access. Primary risks:

- command injection via untrusted tool arguments
- malformed JSON state that breaks coordination
- unsafe path handling for result/pipeline files
- accidental exposure of sensitive local config in committed defaults
- hostile local browser origins attempting cross-port API access

Detailed browser-localhost threat model: `docs/THREAT_MODEL_LOCAL_BROWSER.md`

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

## Sidecar Browser Access Security Model

The lead-sidecar HTTP server provides a local dashboard and API. Its security model:

### Network Binding

- Binds to `127.0.0.1` only (never `0.0.0.0`)
- Not accessible from the network — local machine only
- Optional unix-socket transport via `--unix-socket` / `LEAD_SIDECAR_UNIX_SOCKET`
- Optional TLS/mTLS via `--tls-cert`, `--tls-key`, optional `--tls-ca`, `--mtls`

### Same-Origin Enforcement

- `requireSameOrigin()` checks the `Origin` header against `http://127.0.0.1:{port}`
- Requests from different origins (other ports, `localhost`, external domains) are rejected with `403 ORIGIN_REJECTED`
- `OPTIONS` preflight returns `204` with appropriate CORS headers for the matching origin only

### CSRF Protection

- Browser-origin mutating requests require `X-Sidecar-CSRF` header
- CSRF token obtained from `GET /ui/bootstrap.json` (same-origin only)
- CSRF is a second factor for browser requests and does not replace bearer auth when token mode is enabled

### Bearer Token Auth

- `LEAD_SIDECAR_REQUIRE_TOKEN=1` enables token requirement for all mutating requests
- Token generated at startup, stored in `~/.claude/lead-sidecar/runtime/api.token` with `0600` permissions
- Sent via `Authorization: Bearer <token>` header
- Token rotation: `POST /maintenance/rotate-api-token`
- Health telemetry exposes token age and rotation timestamp (`GET /health`)
- Alert threshold: `LEAD_SIDECAR_API_TOKEN_MAX_AGE_HOURS` adds `api_token_age_exceeded` degraded reason when breached

### Structured Security Audit Export (SIEM)

- `GET /health/security-audit/export` returns schema-versioned JSON payloads
- Schema version: `sidecar-security-audit/v1`
- JSON schema: `docs/SECURITY_AUDIT_SCHEMA.json`

### Rate Limiting

- Per-IP+path sliding window rate limiter
- Returns `429 RATE_LIMITED` with `Retry-After`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining` headers
- Configurable via `LEAD_SIDECAR_RATE_LIMIT` environment variable

### Replay Protection

- Opt-in: `LEAD_SIDECAR_REPLAY_PROTECTION=1`
- Nonce-based: client sends `X-Sidecar-Nonce`, server tracks seen nonces with TTL
- Duplicate nonces rejected with `409 REPLAY_DETECTED`

### Content Security Policy

- `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`
- Prevents XSS and clickjacking

### API Versioning

- `/v1/` prefix for versioned endpoints
- Legacy aliases (bare paths) return `Deprecation: true`, `Sunset`, and `Link` headers
- Standardized error schema: `{ error_code, message, request_id }`

### Request Validation

- `BODY_ALLOWLISTS` per-route key allowlists reject unexpected POST body keys
- All string fields capped at 100KB, arrays at 1000 elements
- Path parameters validated before filesystem access

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

## Vulnerability Disclosure Policy

### Reporting a Vulnerability

**Preferred:** Use [GitHub Private Security Advisory](https://github.com/DrewDawson2027/claude-lead-system/security/advisories/new) for responsible disclosure.

**Fallback:** Open a GitHub issue prefixed with `[SECURITY]` — but only for non-critical concerns. Critical vulnerabilities should always use the private advisory.

### What to Include

- Component affected (hooks, sidecar, installer, coordinator)
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (optional)

### Response Timeline

| Phase                | Timeline                              |
| -------------------- | ------------------------------------- |
| Acknowledge receipt  | Within 72 hours                       |
| Initial assessment   | Within 7 days                         |
| Fix development      | Best effort, typically within 30 days |
| Advisory publication | After fix is released                 |

### Coordinated Disclosure

We follow a 90-day coordinated disclosure window:

- After reporting, the reporter agrees not to publicly disclose the vulnerability for 90 days
- We will work to develop and release a fix within that window
- If we are unable to fix the issue within 90 days, we will coordinate with the reporter on a disclosure timeline
- The reporter will be credited in the security advisory and CHANGELOG unless they opt out

### Out of Scope

- Social engineering attacks
- Denial of service (the project is designed for single-user local operation)
- Issues in dependencies (report upstream; we monitor via Dependabot)
- Issues already disclosed in GitHub Issues or Advisories
- Theoretical attacks without a proof-of-concept
