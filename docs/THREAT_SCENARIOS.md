# Threat Scenarios and Mitigations

Structured threat analysis for the claude-lead-system sidecar and coordinator.

## Threat Matrix

| # | Threat | Attack Vector | Mitigation | Status |
|---|--------|---------------|------------|--------|
| T1 | Local malicious web app targets sidecar | JavaScript on `evil.example` sends `fetch()` to `http://127.0.0.1:{port}/dispatch` | Same-origin check: `requireSameOrigin()` rejects cross-origin requests. CORS headers only set for matching origin. | Mitigated |
| T2 | Stale lock prevents operations | Process crash leaves lock file; next operation hangs | Lock files include PID + timestamp. `lockMetrics` tracks contention. Maintenance sweep cleans stale locks. Checkpoints for state recovery. | Mitigated |
| T3 | Corrupt state file breaks sidecar | Disk full, concurrent write, or bug produces invalid JSON | `repair/scan` + `repair/fix` endpoints. `repairJSON()` / `repairJSONL()` utilities. Pre-op backups for destructive operations. Schema migration with dry-run. | Mitigated |
| T4 | Token theft from filesystem | Attacker with local file access reads `api.token` | File permissions: `0600` on token files. Token rotation via `POST /maintenance/rotate-api-token`. Token never sent in responses (except rotation endpoint). | Mitigated |
| T5 | Replay attack on sensitive endpoints | Attacker captures and replays a `POST /dispatch` request | Nonce-based replay protection on sensitive routes. `X-Sidecar-Nonce` header + server-side nonce tracking with TTL. | Mitigated (opt-in) |
| T6 | CSRF on browser-based dashboard | User visits malicious page while dashboard is open | CSRF token required for browser-origin mutations. Token obtained from `/ui/bootstrap.json` (same-origin only). | Mitigated |
| T7 | Rate-limit exhaustion / DoS | Automated script hammers mutation endpoints | Per-IP+path sliding window rate limiter. `Retry-After` header. Configurable limits via env vars. | Mitigated |
| T8 | Path traversal in file operations | Body includes `../../etc/passwd` in `file` parameter | All file paths resolved with `path.resolve()` and checked against allowed directories (`diagnosticsDir`, `checkpointsDir`, `backupsDir`). | Mitigated |
| T9 | Body injection / unexpected keys | Extra keys in POST body attempt to modify internal state | `BODY_ALLOWLISTS` per-route. `validateBody()` rejects unexpected keys with `VALIDATION_ERROR`. | Mitigated |
| T10 | Bridge process hijack | Attacker replaces bridge binary on disk | Bridge validation checks PID, heartbeat freshness, and response integrity. File permissions on bridge dirs. | Partially mitigated |

## Detailed Scenarios

### T1: Cross-Origin Sidecar Attack

**Vector:** A malicious website loaded in the user's browser sends `fetch('http://127.0.0.1:7199/dispatch', { method: 'POST', body: '...' })` to dispatch arbitrary tasks.

**Why it matters:** The sidecar binds to `127.0.0.1` which is reachable from any local browser tab.

**Mitigation chain:**
1. `requireSameOrigin()` checks the `Origin` header against `http://127.0.0.1:{port}`
2. Different ports are rejected (e.g., `http://127.0.0.1:3000` is not the sidecar's port)
3. `localhost` vs `127.0.0.1` mismatch is rejected
4. Browser preflight (`OPTIONS`) returns CORS headers only for matching origin
5. Non-browser callers (curl, CLI) are not affected (no `Origin` header → bypasses same-origin check, uses bearer token auth instead)

### T2: Stale Lock

**Vector:** Sidecar crashes mid-write, leaving a lock file that blocks subsequent operations.

**Mitigation chain:**
1. Lock files contain `{ pid, started_at }` metadata
2. `GET /health` reports `lock_age_ms` for monitoring
3. `POST /maintenance/run` cleans locks older than configurable threshold
4. Checkpoint system provides state recovery if corruption occurs

### T3: State File Corruption

**Vector:** Power loss, disk full, or concurrent writes produce malformed JSON in team/task/timeline files.

**Mitigation chain:**
1. `POST /repair/scan` detects corrupt files without modifying them
2. `POST /repair/fix` repairs or isolates corrupt files (with pre-op backup)
3. `repairJSON()` attempts structural repair of malformed JSON
4. `repairJSONL()` filters corrupt lines from append-only logs
5. Schema migration includes dry-run mode (`dry_run: true`)
6. Timeline rebuild via `POST /events/rebuild-check`

### T4: Token Theft

**Vector:** Another user or process on the machine reads the plaintext API token file.

**Mitigation chain:**
1. Token files created with `0600` permissions (owner-read-only)
2. Token rotation: `POST /maintenance/rotate-api-token` generates new token, invalidates old
3. Token never included in health/status responses
4. Token stored in `~/.claude/lead-sidecar/runtime/api.token` (not in repo)

### T5: Request Replay

**Vector:** Network-level capture (local proxy, browser devtools) records a mutation request and replays it.

**Mitigation chain:**
1. Opt-in: `LEAD_SIDECAR_REPLAY_PROTECTION=1` enables nonce checking
2. Client sends `X-Sidecar-Nonce` header with unique value
3. Server tracks seen nonces with configurable TTL (default 5 minutes)
4. Duplicate nonces rejected with `409 REPLAY_DETECTED`

### T8: Path Traversal

**Vector:** POST body includes `{ "file": "../../etc/passwd" }` to access files outside allowed directories.

**Mitigation chain:**
1. All file paths resolved with `path.resolve()` to canonical absolute path
2. Resolved path checked with `startsWith()` against allowed directories
3. Allowed directories: `diagnosticsDir`, `checkpointsDir`, `backupsDir` (all under `~/.claude/terminals/`)
4. Requests outside allowed directories return `400 VALIDATION_ERROR`

## References

- `docs/SECURITY.md` — Full security controls documentation
- `sidecar/server/http/security.ts` — Auth/origin/CSRF/replay implementation
- `sidecar/server/http/validation.ts` — Body validation and allowlists
- `sidecar/test/auth-matrix.test.mjs` — Auth integration tests
