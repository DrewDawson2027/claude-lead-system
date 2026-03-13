#!/usr/bin/env bash
set -euo pipefail

PATH_ID="${1:-}"
COMMAND_ENV_KEY="${2:-}"

if [ -z "$PATH_ID" ] || [ -z "$COMMAND_ENV_KEY" ]; then
  echo "Usage: bash bench/workloads/ab-path-runner.sh <path_id> <command_env_key>" >&2
  exit 2
fi

emit_event() {
  local event_type="$1"
  local count="${2:-1}"
  local detail="${3:-}"
  node bench/ab-log-event.mjs --type "$event_type" --count "$count" --detail "$detail" >/dev/null
}

compute_sha256() {
  local file_path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file_path" | awk '{print $1}'
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file_path" | awk '{print $1}'
    return
  fi
  echo "sha256-unavailable"
}

read_metric_value() {
  local json_file="$1"
  local field="$2"
  node -e '
    const fs = require("fs");
    const [filePath, key] = process.argv.slice(1);
    if (!fs.existsSync(filePath)) {
      process.stdout.write("0");
      process.exit(0);
    }
    try {
      const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const value = Number(doc?.[key] ?? 0);
      process.stdout.write(Number.isFinite(value) && value > 0 ? String(Math.floor(value)) : "0");
    } catch {
      process.stdout.write("0");
    }
  ' "$json_file" "$field"
}

MODE="${AB_WORKLOAD_RUN_MODE:-live}"
ALLOW_MOCK_FALLBACK="${AB_WORKLOAD_ALLOW_MOCK_FALLBACK:-0}"

if [ "$MODE" = "mock" ]; then
  export AB_HARNESS_PATH="$PATH_ID"
  exec bash bench/workloads/ab-example-workload.sh
fi

PROMPT_FILE="${AB_HARNESS_WORKLOAD_PROMPT_FILE:-}"
if [ -z "$PROMPT_FILE" ] || [ ! -f "$PROMPT_FILE" ]; then
  echo "ab-path-runner: missing or unreadable AB_HARNESS_WORKLOAD_PROMPT_FILE for path=$PATH_ID" >&2
  emit_event workload_failed 1 "path=${PATH_ID} reason=missing_prompt_file"
  exit 2
fi

PROMPT_SHA256="$(compute_sha256 "$PROMPT_FILE")"
export AB_WORKLOAD_PROMPT_FILE="$PROMPT_FILE"
export AB_WORKLOAD_PROMPT_SHA256="$PROMPT_SHA256"
export AB_WORKLOAD_PATH_ID="$PATH_ID"
export AB_WORKLOAD_ID="${AB_HARNESS_WORKLOAD_ID:-unspecified-workload}"

WORKFLOW_METRICS_FILE="${AB_WORKFLOW_METRICS_FILE:-/tmp/ab-workflow-metrics-${AB_HARNESS_RUN_ID:-na}-${PATH_ID}-${AB_HARNESS_TRIAL:-0}.json}"
export AB_WORKFLOW_METRICS_FILE

RUNNER_COMMAND="${!COMMAND_ENV_KEY:-}"
if [ -z "$RUNNER_COMMAND" ]; then
  if [ "$ALLOW_MOCK_FALLBACK" = "1" ]; then
    export AB_HARNESS_PATH="$PATH_ID"
    exec bash bench/workloads/ab-example-workload.sh
  fi
  echo "ab-path-runner: missing required env var ${COMMAND_ENV_KEY} for path=${PATH_ID}" >&2
  echo "ab-path-runner: set AB_WORKLOAD_RUN_MODE=mock for synthetic telemetry smoke runs" >&2
  emit_event workload_failed 1 "path=${PATH_ID} reason=missing_runner_command env=${COMMAND_ENV_KEY}"
  exit 2
fi

emit_event workload_started 1 "path=${PATH_ID} mode=live prompt_sha256=${PROMPT_SHA256}"

set +e
bash -lc "$RUNNER_COMMAND"
STATUS=$?
set -e

if [ "$STATUS" -eq 0 ]; then
  COMPLETION_UNITS="$(read_metric_value "$WORKFLOW_METRICS_FILE" "completion_units")"
  if [ "$COMPLETION_UNITS" -lt 1 ]; then
    COMPLETION_UNITS=1
  fi
  emit_event workload_completed "$COMPLETION_UNITS" "path=${PATH_ID} mode=live"

  HUMAN_INTERVENTIONS="$(read_metric_value "$WORKFLOW_METRICS_FILE" "human_intervention_count")"
  if [ "$HUMAN_INTERVENTIONS" -gt 0 ]; then
    emit_event human_intervention "$HUMAN_INTERVENTIONS" "source=workflow_metrics"
  fi

  CONFLICT_INCIDENTS="$(read_metric_value "$WORKFLOW_METRICS_FILE" "conflict_incidents")"
  if [ "$CONFLICT_INCIDENTS" -gt 0 ]; then
    emit_event conflict_incident "$CONFLICT_INCIDENTS" "source=workflow_metrics"
  fi

  RESUME_ATTEMPTS="$(read_metric_value "$WORKFLOW_METRICS_FILE" "resume_attempts")"
  if [ "$RESUME_ATTEMPTS" -gt 0 ]; then
    emit_event resume_attempt "$RESUME_ATTEMPTS" "source=workflow_metrics"
  fi

  RESUME_SUCCESSES="$(read_metric_value "$WORKFLOW_METRICS_FILE" "resume_successes")"
  if [ "$RESUME_SUCCESSES" -gt 0 ]; then
    emit_event resume_success "$RESUME_SUCCESSES" "source=workflow_metrics"
  fi
else
  emit_event workload_failed 1 "path=${PATH_ID} mode=live exit=${STATUS}"
fi

exit "$STATUS"
