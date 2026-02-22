# Token Management Migration Guide (Legacy Cost Commands -> Canonical Ops/Cost CLI)

## Summary
This guide covers migration from overlapping legacy cost/runtime commands to the canonical Tier-5 command model:
- `claude-token-guard ops ...`
- `claude-token-guard cost ...`
- `claude-token-guard hooks ...`

Legacy commands and MCP tools remain supported for a compatibility window and now emit deprecation metadata.

## CLI Command Mapping
- `cost_runtime.py summary` -> `claude-token-guard cost overview`
- `cost_runtime.py budget-status` -> `claude-token-guard cost budget status`
- `cost_runtime.py set-budget` -> `claude-token-guard cost budget set`
- `cost_runtime.py cost-trends` -> `claude-token-guard ops trends`
- `cost_runtime.py burn-rate-check` -> `claude-token-guard ops alerts check --kind burn-rate`
- `cost_runtime.py anomaly-check` -> `claude-token-guard ops alerts check --kind anomaly`
- `token-guard.py --session-recap` -> `claude-token-guard ops session-recap`

## MCP Tool Mapping
- `coord_cost_summary` -> `coord_cost_overview`
- `coord_cost_budget_status` -> `coord_cost_budget`
- `coord_cost_trends` -> `coord_ops_trends`
- `coord_cost_daily_report` -> `coord_ops_today` (markdown mode) or `coord_ops_today` + `markdown=true`
- `coord_cost_burn_rate_check` / `coord_cost_anomaly_check` -> `coord_ops_alerts` / `coord_ops_today`

## Compatibility Window Behavior
- Legacy commands continue to return valid outputs.
- Legacy MCP tools now include:
  - `deprecated: true`
  - `canonical_tool`
  - `canonical_command`
- Mixed v1/v2 hook logs remain readable by reports and recaps.

## Operator Upgrade Steps
1. Run `claude-token-guard ops today --json` and validate snapshot output.
2. Update scripts/automations to use canonical commands.
3. Keep legacy callers during transition; inspect deprecation metadata to prioritize migration.
4. Run `claude-token-guard hooks verify --full` (or repo regression runner) after rollout.

## Rollback
- Canonical commands are additive; rollback is usually just switching callers back to legacy commands.
- Hook/cost schema changes are backward-compatible during the compatibility window.
