#!/bin/bash
# Agent Lifecycle Metrics — logs subagent start/stop for duration tracking and cost analysis
# Triggered by SubagentStart and SubagentStop hooks
# Part of the Master Agent System's observability layer
INPUT=$(cat)

EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // "unknown"')
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"')
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // "unknown"')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

METRICS_DIR="$HOME/.claude/hooks/session-state"
METRICS_FILE="$METRICS_DIR/agent-metrics.jsonl"
mkdir -p "$METRICS_DIR"

if [ "$EVENT" = "SubagentStart" ]; then
  jq -c -n \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg event "start" \
    --arg agent_type "$AGENT_TYPE" \
    --arg agent_id "$AGENT_ID" \
    --arg session "${SESSION_ID:0:8}" \
    '{ts:$ts, event:$event, agent_type:$agent_type, agent_id:$agent_id, session:$session}' \
    >> "$METRICS_FILE"

elif [ "$EVENT" = "SubagentStop" ]; then
  # Calculate duration if we have a start timestamp
  START_TS=$(grep "\"agent_id\":\"$AGENT_ID\"" "$METRICS_FILE" 2>/dev/null | grep '"event":"start"' | tail -1 | jq -r '.ts // empty')
  DURATION=""
  if [ -n "$START_TS" ]; then
    START_EPOCH=$(date -jf "%Y-%m-%dT%H:%M:%SZ" "$START_TS" "+%s" 2>/dev/null || date -d "$START_TS" "+%s" 2>/dev/null || echo "")
    END_EPOCH=$(date -u "+%s")
    if [ -n "$START_EPOCH" ]; then
      DURATION=$((END_EPOCH - START_EPOCH))
    fi
  fi

  jq -c -n \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg event "stop" \
    --arg agent_type "$AGENT_TYPE" \
    --arg agent_id "$AGENT_ID" \
    --arg session "${SESSION_ID:0:8}" \
    --arg duration "${DURATION:-unknown}" \
    '{ts:$ts, event:$event, agent_type:$agent_type, agent_id:$agent_id, session:$session, duration_seconds:$duration}' \
    >> "$METRICS_FILE"
fi

# Auto-truncate metrics log (keep last 500 entries)
if [ -f "$METRICS_FILE" ]; then
  LINES=$(wc -l < "$METRICS_FILE" 2>/dev/null | tr -d ' ')
  if [ "$LINES" -gt 500 ]; then
    tail -400 "$METRICS_FILE" > "$METRICS_FILE.tmp"
    mv "$METRICS_FILE.tmp" "$METRICS_FILE"
  fi
fi

exit 0
