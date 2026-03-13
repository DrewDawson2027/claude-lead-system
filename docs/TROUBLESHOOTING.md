# Troubleshooting

Common issues and solutions for the claude-lead-system.

## Sessions Not Appearing

**Symptom:** `coord_list_sessions` returns empty or missing sessions.

**Causes:**

1. **SessionStart hook not configured.** Check `settings.local.json` has a `SessionStart` hook pointing to `session-register.sh`.
2. **Hook failed silently.** Check `~/.claude/terminals/debug-session-register.log` for errors.
3. **jq not installed.** All hooks require `jq`. Install: `brew install jq` (macOS) or `apt install jq` (Linux).

**Fix:** Run `bash ~/.claude/hooks/health-check.sh` to validate all hooks and dependencies.

## Heartbeat Not Updating

**Symptom:** `last_active` timestamps are stale even though the session is active.

**Causes:**

1. **PostToolUse hook not configured.** Check `settings.local.json` has `terminal-heartbeat.sh` in PostToolUse.
2. **Rate limiting working correctly.** Heartbeats only fire every 5 seconds. Check `session-*.json` files directly.
3. **Lock file stuck (macOS).** On stock macOS without `flock`, the system uses `mkdir`-based locks. Stale locks auto-expire after 60 seconds.

**Fix:** Remove stale locks if needed: `rm -rf /tmp/claude-heartbeat-*.lock.d`

## Messages Not Delivered

**Symptom:** `coord_wake_session` or inbox messages don't reach the target session.

**Causes:**

1. **PreToolUse hook not configured.** `check-inbox.sh` must be in PreToolUse hooks.
2. **Session is truly idle.** If the session has no pending tool calls, the inbox hook won't fire. Use `coord_wake_session` which sends an Enter keystroke to trigger the hook.
3. **Wrong session ID.** Session IDs are the first 8 characters. Check with `coord_list_sessions`.

## Workers Fail to Spawn

**Symptom:** `coord_spawn_worker` returns an error or the terminal doesn't open.

**Causes:**

1. **`claude` CLI not in PATH.** Workers use `claude -p` (pipe mode). Verify: `which claude`.
2. **No terminal emulator detected.** On headless servers, workers fall back to `nohup` background processes.
3. **Task ID collision.** If you pass a custom `task_id` that already exists, spawning is rejected. Omit `task_id` for auto-generation.

**Fix:** Check worker output: `coord_get_result task_id="<id>"`

## Conflict Detection Misses

**Symptom:** Two sessions edit the same file but `coord_detect_conflicts` doesn't catch it.

**Causes:**

1. **Session started before hooks installed.** The session needs a heartbeat to populate `files_touched`.
2. **File edited with Bash instead of Edit/Write.** Only `Edit` and `Write` tool uses populate `files_touched`.

**Fix:** Use the `conflict-guard.sh` PreToolUse hook (if installed) for real-time pre-edit conflict warnings.

## Token Guard Blocking Tool Calls

**Symptom:** Tool calls are blocked with "BLOCKED" messages from `token-guard.py`.

**Causes:**

1. **Agent limit reached.** Default is 5 agents per session. Check `~/.claude/hooks/token-guard-config.json`.
2. **Read efficiency guard.** Repeated reads of the same file are blocked after 3 reads.

**Fix:** Adjust limits in `token-guard-config.json`, or set specific skip rules via `TOKEN_GUARD_SKIP_RULES`.

## Platform-Specific Issues

### macOS: iTerm2 Split Not Working

- Requires iTerm2 v3.0+. Falls back to Terminal.app tabs.
- AppleScript permissions must be granted in System Preferences > Privacy > Automation.

### Windows: Hooks Not Running

- Shell hooks require Git Bash or WSL. Stock cmd.exe cannot run `.sh` files.
- Windows Terminal (`wt`) must be installed for tab support.

### Linux: Terminal Not Opening

- Supported: gnome-terminal, konsole, kitty, alacritty, xterm.
- If none detected, workers fall back to `nohup` background execution.

## Installer Issues

### Installer Fails: "Missing dependency: jq"

**Cause:** `jq` is not installed. Required for all JSON manipulation in hooks.

**Fix:**

- macOS: `brew install jq`
- Ubuntu/Debian: `sudo apt install jq`
- Windows: `choco install jq`

### Installer Fails: "checksum mismatch"

**Cause:** Downloaded installer or tarball doesn't match the checksums.txt file.

**Fix:**

1. Re-download `checksums.txt` from the GitHub release page
2. Verify you downloaded the correct version's checksums
3. Re-download the tarball/installer
4. If using `--source-tarball`, ensure the tarball and checksums.txt are from the same release

### Installer Fails: npm install error

**Cause:** Node.js version too old or npm cache corrupt.

**Fix:**

1. Check Node.js version: `node --version` (must be 18+)
2. Clear npm cache: `npm cache clean --force`
3. Retry with a policy-valid installer command:
   - Signed release path (recommended): run the full release command from the README Installation section (includes `--version`, `--source-tarball`, `--checksum-file`, `--checksum-signature`, `--checksum-cert`, `--release-manifest`, `--release-manifest-signature`, and `--release-manifest-cert`).
   - Dev/nightly ref path (advanced): `bash install.sh --ref main --allow-unsigned-release`

## Sidecar Auth Issues

### Sidecar: 403 Origin Rejected

**Symptom:** Browser requests to the dashboard return `403` with `error_code: "ORIGIN_REJECTED"`.

**Cause:** The browser URL doesn't match the sidecar's expected origin. Common mismatch: using `localhost` instead of `127.0.0.1`.

**Fix:** Access the dashboard at `http://127.0.0.1:{port}` exactly (not `http://localhost:{port}`). The same-origin check is strict about hostname matching.

### Sidecar: 401 Auth Required

**Symptom:** API requests return `401` with `error_code: "AUTH_REQUIRED"`.

**Cause:** Token auth is enabled but no bearer token was provided.

**Fix:**

- For development: Set `LEAD_SIDECAR_REQUIRE_TOKEN=0` to disable token requirement
- For production: Read the token from `~/.claude/lead-sidecar/runtime/api.token` and send as `Authorization: Bearer <token>` header

### Sidecar: 403 CSRF Required

**Symptom:** POST requests from the browser return `403` with `error_code: "CSRF_REQUIRED"`.

**Cause:** Browser-origin mutation requests require a CSRF token.

**Fix:**

1. Fetch the CSRF token: `curl http://127.0.0.1:{port}/ui/bootstrap.json`
2. Send the token as `X-Sidecar-CSRF: <token>` header on all browser-origin POST/PUT/PATCH/DELETE requests
3. If `LEAD_SIDECAR_REQUIRE_TOKEN=1`, also send `Authorization: Bearer <token>` on mutating requests
4. The dashboard JavaScript handles this automatically — this only affects custom browser-based API calls

### Sidecar: 429 Rate Limited

**Symptom:** Requests return `429` with `error_code: "RATE_LIMITED"`.

**Cause:** Too many requests from the same IP to the same endpoint.

**Fix:**

1. Check the `Retry-After` header for when to retry
2. Check `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers to understand limits
3. Adjust the limit: `LEAD_SIDECAR_RATE_LIMIT=300` (default: 180 requests per window)

## Health Check

Run the built-in health check to validate everything:

```bash
bash ~/.claude/hooks/health-check.sh
```

This checks:

- All hook scripts exist and are executable
- jq, python3, claude CLI are available
- settings.local.json is valid and hooks are configured
- MCP coordinator is reachable
- State directories have correct permissions
