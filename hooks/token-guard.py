#!/usr/bin/env python3
"""
Token Guard: PreToolUse hook that enforces agent spawning limits.

Rules enforced:
1. Max 1 Explore agent per session
2. Max 1 research agent per session (deep-researcher, ssrn-researcher, etc.)
3. Max 3 total agents per session (was 5 — tightened)
4. Max 1 of any subagent_type per session (no duplicates ever)
5. No parallel spawns within 30s window

Blocked calls get stderr feedback telling Claude what to do instead.
"""

import json
import sys
import os
import time
from contextlib import contextmanager

if os.name == "nt":
    import msvcrt
else:
    import fcntl

STATE_DIR = os.path.expanduser("~/.claude/hooks/session-state")
os.makedirs(STATE_DIR, exist_ok=True)

# Configurable limits
MAX_AGENTS = 3
PARALLEL_WINDOW_SECONDS = 30

# Types that are limited to 1 per session
ONE_PER_SESSION = {
    "Explore",
    "deep-researcher",
    "ssrn-researcher",
    "competitor-tracker",
    "gtm-strategist",
    "Plan",
}

# Types that are always allowed (lightweight, no exploration)
ALWAYS_ALLOWED = {
    "claude-code-guide",
    "statusline-setup",
    "haiku",
}


@contextmanager
def file_lock(path):
    """Cross-platform advisory file lock."""
    with open(path, "w") as lf:
        if os.name == "nt":
            lf.write("0")
            lf.flush()
            lf.seek(0)
            msvcrt.locking(lf.fileno(), msvcrt.LK_LOCK, 1)
        else:
            fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                lf.seek(0)
                msvcrt.locking(lf.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lf, fcntl.LOCK_UN)


def main():
    input_data = json.load(sys.stdin)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})
    session_id = input_data.get("session_id", "unknown")

    # Only gate Task tool calls
    if tool_name != "Task":
        sys.exit(0)

    subagent_type = tool_input.get("subagent_type", "")
    description = tool_input.get("description", "")

    # Skip gating for lightweight agents
    if subagent_type in ALWAYS_ALLOWED:
        sys.exit(0)

    state_file = os.path.join(STATE_DIR, f"{session_id}.json")

    # File-locked state access (prevents race conditions from parallel tool calls)
    lock_file = state_file + ".lock"
    with file_lock(lock_file):
        state = load_state(state_file)
        now = time.time()

        # RULE 1: One-per-session types (Explore, deep-researcher, etc.)
        if subagent_type in ONE_PER_SESSION:
            existing = [a for a in state["agents"] if a["type"] == subagent_type]
            if existing:
                block(f"BLOCKED: Already spawned a {subagent_type} agent this session. "
                      f"Max 1 per session. Merge your queries into one agent, or use "
                      f"Grep/Read/WebSearch directly instead of spawning another.")

        # RULE 2: No duplicate subagent_types (enforce max 1)
        existing_same = [a for a in state["agents"] if a["type"] == subagent_type]
        if existing_same:
            block(f"BLOCKED: Already spawned {subagent_type} in this session. "
                  f"Max 1 of any subagent type. Use tools directly instead.")

        # RULE 3: Session agent cap
        if state["agent_count"] >= MAX_AGENTS:
            block(f"BLOCKED: Agent cap reached ({MAX_AGENTS}/session). "
                  f"You've spawned {state['agent_count']} agents already. "
                  f"Use Grep/Read/WebSearch tools directly instead of spawning agents.")

        # RULE 4: No spawns within 30s of same type (catches "same turn" spawns)
        recent_same = [
            a for a in state["agents"]
            if a["type"] == subagent_type
            and (now - a["timestamp"]) < PARALLEL_WINDOW_SECONDS
        ]
        if recent_same:
            block(f"BLOCKED: Another {subagent_type} agent was spawned {now - recent_same[0]['timestamp']:.0f}s ago. "
                  f"Wait or merge into one agent. Overlap Check: combine queries into a single prompt.")

        # ALLOWED — record and proceed
        agent_record = {
            "type": subagent_type,
            "description": description,
            "timestamp": now
        }

        # For Explore agents, extract target directories from the prompt
        # so read-efficiency-guard.py can detect duplicate reads
        if subagent_type == "Explore":
            prompt = tool_input.get("prompt", "")
            target_dirs = extract_target_dirs(prompt)
            if target_dirs:
                agent_record["target_dirs"] = target_dirs

        state["agent_count"] += 1
        state["agents"].append(agent_record)
        save_state(state_file, state)

    sys.exit(0)  # Allow


def block(reason):
    """Block the tool call with feedback to Claude."""
    print(reason, file=sys.stderr)
    sys.exit(2)


def load_state(path):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"agent_count": 0, "agents": []}


def save_state(path, state):
    with open(path, "w") as f:
        json.dump(state, f, indent=2)


def extract_target_dirs(prompt):
    """Extract directory paths from an Explore agent's prompt.

    Looks for common patterns like:
    - START: ~/Projects/my-app/
    - ~/Projects/foo/
    - /Users/.../src/
    """
    import re
    dirs = []
    # Match paths that look like directories (end with / or contain src/, lib/, etc.)
    patterns = [
        r'(?:START:\s*)(~?/[^\s\n]+)',  # START: /path/to/dir
        r'(~?/[^\s\n]*(?:Projects|Desktop|src|lib)/[^\s\n]*)',  # Common project paths
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, prompt):
            path = match.group(1).rstrip('/')
            # Expand ~ to home dir
            path = os.path.expanduser(path)
            if path not in dirs:
                dirs.append(path)
    return dirs


if __name__ == "__main__":
    main()
