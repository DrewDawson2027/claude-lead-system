# Token Management Data Contracts (Schema v2)

## Files

- `~/.claude/hooks/session-state/audit.jsonl`
- `~/.claude/hooks/session-state/agent-metrics.jsonl`
- `~/.claude/hooks/session-state/<session>.json`
- `~/.claude/hooks/session-state/<session>-reads.json`

## Compatibility policy

- Writers emit schema v2 fields and retain legacy fields (`session`, `type`, `desc`, `reason`) during the compatibility window.
- Readers (`token-guard.py --report`, `--usage`, `health-check.sh`) accept mixed v1/v2 logs.

## `audit.jsonl` (decision records)

Required v2 fields:

- `schema_version`
- `record_type` = `audit_decision`
- `ts`
- `event`
- `rule_id`
- `reason_code`
- `session_key` (sanitized)
- `subagent_type`
- `decision_id`
- `desc_present`
- `desc_hash`
- `message`

Legacy compatibility fields retained:

- `session`
- `type`
- `desc`
- `reason` (when present)

## `agent-metrics.jsonl` (tagged union)

Common fields:

- `schema_version`
- `record_type` (`lifecycle` or `usage`)
- `ts`
- `session_key`
- `session` (legacy compatibility)

Lifecycle records (`record_type=lifecycle`):

- `event` = `start|stop`
- `agent_type`
- `agent_id`
- `decision_id` (best effort)
- `duration_seconds` (+ `duration_known` on stop)

Usage records (`record_type=usage`):

- `event` = `agent_completed`
- `agent_type` (never empty; defaults to `unknown`)
- `agent_id`
- `decision_id` (best effort)
- token totals (`input/output/cache_*`, `api_calls`, `total_tokens`)
- `cost_usd`
- parser quality (`transcript_found`, `usage_records_parsed`, `usage_records_skipped`)
- `correlated`

## State files

`<session>.json`:

- `schema_version`
- `session_key`
- `agent_count`
- `agents[]`
- `blocked_attempts[]`
- `pending_spawns[]` (correlation scaffold)
- `last_decision_ts`
- `fault_counters`

`<session>-reads.json`:

- `schema_version`
- `session_key`
- `reads[]` with `path`, `normalized_path`, `path_hash`, `timestamp`
- `last_sequential_warn`

## Data quality checks

`health-check.sh` now reports:

- v1/v2 audit mix
- invalid legacy session fields (e.g. path-like values)
- untagged metrics records
- empty `agent_type` usage records
- repo/live hook drift count (when repo is present)
