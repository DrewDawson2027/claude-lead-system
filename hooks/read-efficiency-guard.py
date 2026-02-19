#!/usr/bin/env python3
"""
Read Efficiency Guard: PostToolUse hook that warns about token-wasting read patterns.

Advisory only — never blocks (always exit 0). Warns via stderr.

Patterns detected:
1. Sequential reads: 4+ single Read calls within 60s without parallel batching
2. Post-Explore duplicates: Reading files in a directory tree already explored by an Explore agent
"""

import json
import sys
import os
import time
import fcntl

STATE_DIR = os.path.expanduser("~/.claude/hooks/session-state")
os.makedirs(STATE_DIR, exist_ok=True)

SEQUENTIAL_THRESHOLD = 4  # Warn after this many sequential reads
SEQUENTIAL_WINDOW = 60  # Seconds window for sequential detection


def main():
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})
    session_id = input_data.get("session_id", "unknown")

    if tool_name != "Read":
        sys.exit(0)

    file_path = tool_input.get("file_path", "")
    if not file_path:
        sys.exit(0)

    state_file = os.path.join(STATE_DIR, f"{session_id}-reads.json")
    lock_file = state_file + ".lock"

    with open(lock_file, "w") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            state = load_state(state_file)
            now = time.time()

            # Record this read
            state["reads"].append({"path": file_path, "timestamp": now})

            # Prune old reads (older than 5 min)
            state["reads"] = [r for r in state["reads"] if now - r["timestamp"] < 300]

            # CHECK 1: Sequential reads warning
            recent = [r for r in state["reads"] if now - r["timestamp"] < SEQUENTIAL_WINDOW]
            if len(recent) >= SEQUENTIAL_THRESHOLD:
                warn(
                    f"TOKEN EFFICIENCY: {len(recent)} sequential Read calls in {SEQUENTIAL_WINDOW}s. "
                    f"Batch independent reads into parallel groups of 3-4 per turn to save tokens. "
                    f"(Parallelism Checkpoint rule)"
                )

            # CHECK 2: Post-Explore duplicate warning
            explore_dirs = get_explore_dirs(session_id)
            if explore_dirs:
                for explore_dir in explore_dirs:
                    if file_path.startswith(explore_dir):
                        warn(
                            f"TOKEN EFFICIENCY: Reading '{os.path.basename(file_path)}' which is inside "
                            f"'{explore_dir}' — a directory already mapped by your Explore agent. "
                            f"Trust the Explore output instead of re-reading. "
                            f"(No Duplicate Reads After Explore rule)"
                        )
                        break

            save_state(state_file, state)

        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)

    sys.exit(0)  # Always allow — advisory only


def warn(message):
    """Output warning via stderr (advisory, not blocking)."""
    print(message, file=sys.stderr)


def get_explore_dirs(session_id):
    """Check token-guard state for Explore agents and extract their target directories."""
    guard_state_file = os.path.join(STATE_DIR, f"{session_id}.json")
    try:
        with open(guard_state_file, "r") as f:
            guard_state = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []

    dirs = []
    for agent in guard_state.get("agents", []):
        if agent.get("type") == "Explore":
            desc = agent.get("description", "")
            # Extract directory hints from the agent description
            # Common patterns: "Explore trust-engine codebase", "Explore atlas/"
            # We track the directories the Explore was pointed at
            for known_dir in agent.get("target_dirs", []):
                dirs.append(known_dir)

    return dirs


def load_state(path):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"reads": []}


def save_state(path, state):
    with open(path, "w") as f:
        json.dump(state, f, indent=2)


if __name__ == "__main__":
    main()
