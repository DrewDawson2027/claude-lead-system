#!/usr/bin/env python3
"""Agent Metrics — extracts real token usage from subagent transcripts.

Triggered by SubagentStop hook. Reads the agent's transcript JSONL,
sums actual input/output tokens from API responses, and logs precise
cost data. This solves the "no per-invocation token metering" limitation
by parsing what Claude Code already records.
"""
import json
import sys
import os
from datetime import datetime, timezone

METRICS_DIR = os.path.expanduser("~/.claude/hooks/session-state")
METRICS_FILE = os.path.join(METRICS_DIR, "agent-metrics.jsonl")

# Sonnet 4.6 pricing (per 1K tokens)
COST_PER_1K_INPUT = 0.003    # $3/M input
COST_PER_1K_OUTPUT = 0.015   # $15/M output
COST_PER_1K_CACHE_READ = 0.0003  # $0.30/M cache read (90% discount)


def parse_transcript(transcript_path: str) -> dict:
    """Parse a subagent transcript JSONL and sum token usage."""
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_creation_tokens": 0,
        "api_calls": 0,
    }

    if not transcript_path or not os.path.isfile(transcript_path):
        return totals

    try:
        with open(transcript_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                msg = entry.get("message", {})
                if not isinstance(msg, dict):
                    continue

                usage = msg.get("usage")
                if not usage or not isinstance(usage, dict):
                    continue

                totals["input_tokens"] += usage.get("input_tokens", 0)
                totals["output_tokens"] += usage.get("output_tokens", 0)
                totals["cache_read_tokens"] += usage.get("cache_read_input_tokens", 0)
                totals["cache_creation_tokens"] += usage.get("cache_creation_input_tokens", 0)
                totals["api_calls"] += 1
    except (OSError, PermissionError):
        pass

    return totals


def calculate_cost(totals: dict) -> float:
    """Calculate estimated cost from token counts."""
    # Input tokens that aren't cache reads
    fresh_input = totals["input_tokens"] - totals["cache_read_tokens"]
    if fresh_input < 0:
        fresh_input = 0

    cost = (
        (fresh_input / 1000) * COST_PER_1K_INPUT
        + (totals["cache_read_tokens"] / 1000) * COST_PER_1K_CACHE_READ
        + (totals["output_tokens"] / 1000) * COST_PER_1K_OUTPUT
    )
    return round(cost, 4)


def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    event = input_data.get("hook_event_name", "")
    if event != "SubagentStop":
        sys.exit(0)

    agent_type = input_data.get("agent_type", "unknown")
    agent_id = input_data.get("agent_id", "unknown")
    session_id = input_data.get("session_id", "unknown")[:8]
    transcript_path = input_data.get("agent_transcript_path", "")

    # Parse real token usage from transcript
    totals = parse_transcript(transcript_path)
    cost = calculate_cost(totals)

    os.makedirs(METRICS_DIR, exist_ok=True)

    # Log detailed metrics
    metric = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "event": "agent_completed",
        "agent_type": agent_type,
        "agent_id": agent_id,
        "session": session_id,
        "input_tokens": totals["input_tokens"],
        "output_tokens": totals["output_tokens"],
        "cache_read_tokens": totals["cache_read_tokens"],
        "cache_creation_tokens": totals["cache_creation_tokens"],
        "api_calls": totals["api_calls"],
        "total_tokens": totals["input_tokens"] + totals["output_tokens"],
        "cost_usd": cost,
    }

    with open(METRICS_FILE, "a") as f:
        f.write(json.dumps(metric) + "\n")

    # Auto-truncate
    try:
        with open(METRICS_FILE, "r") as f:
            lines = f.readlines()
        if len(lines) > 500:
            with open(METRICS_FILE, "w") as f:
                f.writelines(lines[-400:])
    except OSError:
        pass


if __name__ == "__main__":
    main()
