# Known Limitations

## Platform Boundaries

- **No native in-process UI embedding** `[Low]`: The sidecar runs as a separate HTTP server. There is no way to embed UI directly into Claude Code's terminal output. The web dashboard requires a browser. **Workaround:** Open `http://127.0.0.1:{port}` in any browser.

- **No zero-install distribution** `[Medium]`: Requires Node.js 18+ and manual setup. No npm package, no binary distribution. **Workaround:** Use signed release install (`install.sh --version ... --source-tarball ... --checksum-file ... --release-manifest ...`).

- **Node.js 18+ required** `[Medium]`: Uses `Array.findLastIndex`, `AbortSignal.timeout`, and ES module syntax that require Node.js 18.0+. **Workaround:** Install Node.js 18+ via nvm, fnm, or official installer.

- **macOS-focused terminal spawning** `[Medium]`: Terminal spawning (`osascript`, iTerm2 AppleScript) is macOS-specific. Linux support via `tmux` fallback exists but is less tested. Windows support is minimal (batch scripts). **Workaround:** Linux users should install tmux. Windows users should use Git Bash + Windows Terminal.

## Bridge Limitations

- **Single bridge instance** `[Low]`: Only one native bridge process per sidecar. Multiple teams share the same bridge. **Workaround:** Bridge handles multiplexing internally; no action needed for most use cases.

- **Heartbeat-based health** `[Low]`: Bridge health relies on periodic heartbeats. A frozen process with active PID but no heartbeats will show as "stale" but not immediately "down." **Workaround:** Maintenance sweep (`POST /maintenance/run`) cleans up stale bridges.

- **Request queue is filesystem-based** `[Low]`: Bridge requests are JSON files in a directory. High throughput (>100 req/s) may hit filesystem limitations. **Workaround:** Keep request volume under 50 req/s for reliable operation.

- **Bridge adds latency** `[Low]`: Native bridge operations add ~50-200ms overhead compared to direct coordinator operations. **Workaround:** Use coordinator MCP tools directly for latency-sensitive operations.

## Scale Limits

- **Tested up to 20 team members** `[Medium]`: 20 team members, 200 tasks, 50 concurrent actions. Beyond that is uncharted territory. **Workaround:** Split large teams into multiple smaller teams.

- **Snapshot size grows linearly** `[Low]`: Snapshots grow linearly with team size. At 50+ members with full history, JSON serialization may become noticeable (~10-50ms). **Workaround:** Use maintenance sweep to clean old data.

- **Timeline log has no rotation** `[Medium]`: Append-only JSONL with no automatic rotation. Long-running instances will accumulate large log files. **Workaround:** Run `POST /maintenance/run` periodically or set up a cron/LaunchAgent for log rotation.

- **Metrics history is capped** `[Low]`: Capped at configurable limit (default 100 snapshots). Older data is evicted. **Workaround:** Export metrics via `GET /metrics/history` before they age out.

## Security Model

- **Token-based auth only** `[Medium]`: Simple bearer token, not OAuth/SSO. Tokens are generated at startup and stored in plaintext files. **Workaround:** Set file permissions to `0600` (done automatically). Rotate tokens via `POST /maintenance/rotate-api-token`.

- **CSRF protection is per-session** `[Low]`: Token-based, per-session. Not suitable for multi-user deployments. **Workaround:** This is a local-machine tool; multi-user is not a target use case.

- **HTTP default transport** `[Medium]`: Default mode binds `http://127.0.0.1`. TLS/mTLS is optional and must be explicitly enabled (`--tls-cert`, `--tls-key`, optional `--tls-ca`, `--mtls`). **Workaround:** Enable sidecar TLS/mTLS directly, or terminate TLS with a reverse proxy for broader network exposure.

- **No role-based access control** `[Low]`: All authenticated users have full access to all operations. **Workaround:** Use file-system permissions and token auth to restrict access to the local user.

## Cost Estimation

- **Heuristic-based** `[Low]`: Cost estimates use static pricing tables, not actual API billing data. **Workaround:** Cross-reference with Anthropic billing dashboard for accurate costs.

- **No real-time billing** `[Low]`: Cannot query actual Anthropic API usage from within the system. **Workaround:** Check the Anthropic console for real-time usage.

- **Model pricing may drift** `[Low]`: Hardcoded pricing may become outdated. **Workaround:** Update `cost/pricing-cache.json` when prices change.

## Coordinator vs Native

- **Coordinator is filesystem-based** `[Medium]`: All state is JSON files. No database, no transactions, no ACID guarantees. **Workaround:** Use checkpoints (`POST /checkpoints/create`) before destructive operations.

- **Race conditions possible** `[Medium]`: Concurrent writes to the same task file can cause data loss. Mitigated by file locking but not eliminated. **Workaround:** Use the sidecar API (which serializes writes) instead of direct file manipulation.

- **Worker state is best-effort** `[Low]`: Session status relies on shell hooks updating JSON files. If hooks fail, status is stale. **Workaround:** Run `bash ~/.claude/hooks/health-check.sh` to validate hook configuration.

## Auto-Rebalance

- **Cooldown-gated** `[Low]`: Auto-rebalance won't fire more than once per cooldown period (default 60s), even if conditions persist. **Workaround:** Trigger manual rebalance via `POST /teams/{name}/rebalance`.

- **No task migration** `[Medium]`: Auto-rebalance can assign new tasks but cannot migrate in-progress work without explicit reassignment. **Workaround:** Manually reassign in-progress tasks via the API or dashboard.

- **Heuristic scoring** `[Low]`: Load scores and dispatch readiness are heuristic. They may not reflect actual worker capacity. **Workaround:** Monitor via `GET /teams` and adjust manually if scores seem off.
