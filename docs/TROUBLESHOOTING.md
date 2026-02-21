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
- Windows Terminal (`wt`) must be installed for tab/split support.

### Linux: Terminal Not Opening
- Supported: gnome-terminal, konsole, kitty, alacritty, xterm.
- If none detected, workers fall back to `nohup` background execution.

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
