# Known Limitations

## Platform Boundaries

- **No native in-process UI embedding**: The sidecar runs as a separate HTTP server. There is no way to embed UI directly into Claude Code's terminal output. The web dashboard requires a browser.
- **No zero-install distribution**: Requires Node.js 18+ and manual setup. No npm package, no binary distribution.
- **Node.js 18+ required**: Uses `Array.findLastIndex`, `AbortSignal.timeout`, and ES module syntax that require Node.js 18.0+.
- **macOS-focused**: Terminal spawning (`osascript`, iTerm2 AppleScript) is macOS-specific. Linux support via `tmux` fallback exists but is less tested. Windows support is minimal (batch scripts).

## Bridge Limitations

- **Single bridge instance**: Only one native bridge process per sidecar. Multiple teams share the same bridge.
- **Heartbeat-based health**: Bridge health relies on periodic heartbeats. A frozen process with active PID but no heartbeats will show as "stale" but not immediately "down."
- **Request queue is filesystem-based**: Bridge requests are JSON files in a directory. High throughput (>100 req/s) may hit filesystem limitations.
- **Bridge adds latency**: Native bridge operations add ~50-200ms overhead compared to direct coordinator operations.

## Scale Limits

- **Tested up to**: 20 team members, 200 tasks, 50 concurrent actions. Beyond that is uncharted territory.
- **Snapshot size**: Snapshots grow linearly with team size. At 50+ members with full history, JSON serialization may become noticeable (~10-50ms).
- **Timeline log**: Append-only JSONL with no rotation. Long-running instances will accumulate large log files.
- **Metrics history**: Capped at configurable limit (default 100 snapshots). Older data is evicted.

## Security Model

- **Token-based auth**: Simple bearer token, not OAuth/SSO. Tokens are generated at startup and stored in plaintext files.
- **CSRF protection**: Token-based, per-session. Not suitable for multi-user deployments.
- **No HTTPS**: HTTP only. Intended for local use (127.0.0.1). Do not expose to networks without a reverse proxy.
- **No role-based access control**: All authenticated users have full access to all operations.

## Cost Estimation

- **Heuristic-based**: Cost estimates use static pricing tables, not actual API billing data.
- **No real-time billing**: Cannot query actual Anthropic API usage from within the system.
- **Model pricing may drift**: Hardcoded pricing may become outdated. Update `cost/pricing-cache.json` when prices change.

## Coordinator vs Native

- **Coordinator is filesystem-based**: All state is JSON files. No database, no transactions, no ACID guarantees.
- **Race conditions possible**: Concurrent writes to the same task file can cause data loss. Mitigated by file locking but not eliminated.
- **Worker state is best-effort**: Session status relies on shell hooks updating JSON files. If hooks fail, status is stale.

## Auto-Rebalance

- **Cooldown-gated**: Auto-rebalance won't fire more than once per cooldown period (default 60s), even if conditions persist.
- **No task migration**: Auto-rebalance can assign new tasks but cannot migrate in-progress work without explicit reassignment.
- **Heuristic scoring**: Load scores and dispatch readiness are heuristic. They may not reflect actual worker capacity.
