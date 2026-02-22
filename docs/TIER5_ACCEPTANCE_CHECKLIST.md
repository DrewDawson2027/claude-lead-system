# Tier-5 Token Management Acceptance Checklist

## Enforcement
- [ ] Token guard and read-efficiency guard block with `exit 2`
- [ ] Canonical `rule_id` and `reason_code` are logged for decisions
- [ ] Path alias duplicate reads are blocked
- [ ] Type-switching and cooldown protections remain covered by tests

## Reliability
- [ ] Core hook tests pass (`token-guard`, `read-efficiency`, `self-heal`)
- [ ] `self-heal.py` remains always-exit-0
- [ ] `health-check.sh` reports schema/data-quality status
- [ ] Repo/live drift can be detected

## Measurement
- [ ] `agent-metrics.jsonl` usage records are tagged (`record_type=usage`)
- [ ] Lifecycle records are tagged (`record_type=lifecycle`)
- [ ] Empty `agent_type` is normalized to `unknown`
- [ ] `token-guard --report` and `--usage` read mixed v1/v2 logs

## Security / Integrity
- [ ] Persisted session identifiers are sanitized (`session_key`)
- [ ] Logs/state remain JSON/JSONL under concurrent use
- [ ] Backward-compatible legacy fields are still present during migration

## Operability / Public readiness
- [ ] Plugin installer copies shared contract modules (`guard_*`)
- [ ] Plugin hook registration paths match repo layout (`hooks/`, not stale `scripts/`)
- [ ] Data contract docs are published
- [ ] Install manifest exists and is kept current
