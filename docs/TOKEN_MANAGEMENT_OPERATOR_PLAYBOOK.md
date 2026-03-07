# Token Management Operator Playbook

## Daily Ops (Single Pane)

- Run: `claude-token-guard ops today`
- Use `--json` for automation / dashboards
- Use `--statusline` for compact summaries

## What Just Happened (Session)

- Latest recap: `claude-token-guard ops session-recap --latest`
- Specific session: `claude-token-guard ops session-recap --session-id <id>`

## Alerts

- Status: `claude-token-guard ops alerts status`
- Evaluate manually (no delivery): `claude-token-guard ops alerts evaluate --no-deliver`
- Alert delivery is hook-triggered with dedup; it should not block workflows.

## Troubleshooting

- Hook health: `bash ~/.claude/hooks/health-check.sh`
- Audit stats: `bash ~/.claude/hooks/health-check.sh --stats`
- Hook analytics: `claude-token-guard hooks report`
- Drift check: `claude-token-guard hooks drift`

## Prompt Sync

- Source prompt: `hooks/prompts/task_preflight_checklist.md`
- Sync/verify: `python3 hooks/prompt_sync.py --verify-only`
- Apply to live settings: `python3 hooks/prompt_sync.py --apply-live`

## Canary / Shadow Mode

- Configure per rule in `token-guard-config.json` under `shadow_rules`
- Shadow hits are logged as `warn` events with `would_block=true`
- Use `hooks report` and `ops today` to inspect shadow-only near misses
