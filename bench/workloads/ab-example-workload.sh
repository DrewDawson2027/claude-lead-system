#!/usr/bin/env bash
set -euo pipefail

# Example workload adapter for bench/ab-harness.mjs.
#
# This script is intentionally deterministic for reproducible local runs.
# It can emit mock telemetry records for harness validation.
# Replace the body with your real workload command if desired.

PATH_ID="${AB_HARNESS_PATH:-unknown}"
TRIAL="${AB_HARNESS_TRIAL:-0}"
SEED="${AB_HARNESS_SEED:-0}"

# Optional mock telemetry targets (for local harness testing)
MOCK_AGENT_METRICS_JSONL="${AB_MOCK_AGENT_METRICS_JSONL:-}"
MOCK_TRANSCRIPT_JSONL="${AB_MOCK_TRANSCRIPT_JSONL:-}"
MOCK_ACTIVITY_JSONL="${AB_MOCK_ACTIVITY_JSONL:-}"
MOCK_CONFLICTS_JSONL="${AB_MOCK_CONFLICTS_JSONL:-}"
MOCK_RESULTS_DIR="${AB_MOCK_RESULTS_DIR:-}"

mkdir -p "$(dirname "${AB_HARNESS_EVENTS_JSONL:-/tmp/ab-events.jsonl}")"

# Emit workload-start marker.
node bench/ab-log-event.mjs --type workload_started --count 1 --detail "path=${PATH_ID} trial=${TRIAL}" >/dev/null

# Deterministic mock profile by path.
case "$PATH_ID" in
  native)
    TOK_IN=12500
    TOK_OUT=3400
    SLEEP_S=0.12
    INTERVENTIONS=1
    CONFLICTS=1
    RESUME_ATTEMPTS=1
    RESUME_SUCCESSES=0
    ;;
  lead_coordinator)
    TOK_IN=11800
    TOK_OUT=3200
    SLEEP_S=0.11
    INTERVENTIONS=1
    CONFLICTS=0
    RESUME_ATTEMPTS=1
    RESUME_SUCCESSES=1
    ;;
  lead_overlay)
    TOK_IN=12100
    TOK_OUT=3300
    SLEEP_S=0.115
    INTERVENTIONS=1
    CONFLICTS=0
    RESUME_ATTEMPTS=1
    RESUME_SUCCESSES=1
    ;;
  *)
    TOK_IN=12000
    TOK_OUT=3200
    SLEEP_S=0.10
    INTERVENTIONS=1
    CONFLICTS=0
    RESUME_ATTEMPTS=0
    RESUME_SUCCESSES=0
    ;;
esac

sleep "$SLEEP_S"

# Optional mock agent-metrics JSONL usage entry.
if [ -n "$MOCK_AGENT_METRICS_JSONL" ]; then
  mkdir -p "$(dirname "$MOCK_AGENT_METRICS_JSONL")"
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  TOTAL=$((TOK_IN + TOK_OUT))
  cat >> "$MOCK_AGENT_METRICS_JSONL" <<JSON
{"schema_version":2,"record_type":"usage","ts":"${NOW}","event":"agent_completed","agent_type":"implementer","agent_id":"ab-${PATH_ID}-${TRIAL}","session_key":"ab${TRIAL}","input_tokens":${TOK_IN},"output_tokens":${TOK_OUT},"cache_read_tokens":0,"cache_creation_tokens":0,"api_calls":1,"total_tokens":${TOTAL},"cost_usd":0.0}
JSON
fi

# Optional mock transcript JSONL usage entry.
if [ -n "$MOCK_TRANSCRIPT_JSONL" ]; then
  mkdir -p "$(dirname "$MOCK_TRANSCRIPT_JSONL")"
  cat >> "$MOCK_TRANSCRIPT_JSONL" <<JSON
{"message":{"usage":{"input_tokens":${TOK_IN},"output_tokens":${TOK_OUT},"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}
JSON
fi

# Optional mock activity/conflicts logs.
if [ -n "$MOCK_ACTIVITY_JSONL" ]; then
  mkdir -p "$(dirname "$MOCK_ACTIVITY_JSONL")"
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "{\"ts\":\"${NOW}\",\"session\":\"ab${TRIAL}\",\"tool\":\"Edit\",\"file\":\"src/auth.ts\",\"project\":\"ab\"}" >> "$MOCK_ACTIVITY_JSONL"
fi

if [ -n "$MOCK_CONFLICTS_JSONL" ] && [ "$CONFLICTS" -gt 0 ]; then
  mkdir -p "$(dirname "$MOCK_CONFLICTS_JSONL")"
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "{\"ts\":\"${NOW}\",\"detector\":\"ab${TRIAL}\",\"files\":[\"src/auth.ts\"],\"conflicts\":[\"peer\"]}" >> "$MOCK_CONFLICTS_JSONL"
fi

# Optional mock resume metadata.
if [ -n "$MOCK_RESULTS_DIR" ] && [ "$RESUME_ATTEMPTS" -gt 0 ]; then
  mkdir -p "$MOCK_RESULTS_DIR"
  META_FILE="$MOCK_RESULTS_DIR/task-${PATH_ID}-${TRIAL}.meta.json"
  if [ ! -f "$META_FILE" ]; then
    echo '{"task_id":"task-placeholder","resume_count":0}' > "$META_FILE"
  fi
  if [ "$RESUME_SUCCESSES" -gt 0 ]; then
    cat > "$META_FILE" <<JSON
{"task_id":"task-${PATH_ID}-${TRIAL}","resume_count":1,"resumed_from_session":"session-${PATH_ID}-${TRIAL}"}
JSON
  else
    cat > "$META_FILE" <<JSON
{"task_id":"task-${PATH_ID}-${TRIAL}","resume_count":1}
JSON
  fi
fi

# Emit structured harness events for non-token metrics.
node bench/ab-log-event.mjs --type human_intervention --count "$INTERVENTIONS" --detail "manual approvals" >/dev/null
if [ "$CONFLICTS" -gt 0 ]; then
  node bench/ab-log-event.mjs --type conflict_incident --count "$CONFLICTS" --detail "file overlap" >/dev/null
fi
if [ "$RESUME_ATTEMPTS" -gt 0 ]; then
  node bench/ab-log-event.mjs --type resume_attempt --count "$RESUME_ATTEMPTS" --detail "resume invoked" >/dev/null
fi
if [ "$RESUME_SUCCESSES" -gt 0 ]; then
  node bench/ab-log-event.mjs --type resume_success --count "$RESUME_SUCCESSES" --detail "resume succeeded" >/dev/null
fi
node bench/ab-log-event.mjs --type workload_completed --count 1 --detail "workload success" >/dev/null

echo "workload path=${PATH_ID} trial=${TRIAL} seed=${SEED} complete"
