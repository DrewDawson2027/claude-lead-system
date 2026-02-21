"""Unit tests for token-guard.py PreToolUse hook."""
import json
import os
import subprocess
import sys
import tempfile
import shutil

import pytest

HOOK_PATH = os.path.join(os.path.dirname(__file__), "..", "hooks", "token-guard.py")


def run_guard(input_data, env_overrides=None, state_dir=None):
    """Run token-guard.py with given JSON input, return (exit_code, stdout, stderr)."""
    env = os.environ.copy()
    if state_dir:
        # Monkey-patch STATE_DIR via env injection isn't supported,
        # so we use a wrapper approach
        pass
    if env_overrides:
        env.update(env_overrides)
    proc = subprocess.run(
        [sys.executable, HOOK_PATH],
        input=json.dumps(input_data),
        capture_output=True,
        text=True,
        env=env,
        timeout=10,
    )
    return proc.returncode, proc.stdout, proc.stderr


@pytest.fixture
def state_dir(tmp_path):
    """Provide a clean state directory and patch STATE_DIR."""
    sd = tmp_path / "session-state"
    sd.mkdir(mode=0o700)
    return sd


@pytest.fixture
def patched_hook(tmp_path, state_dir):
    """Create a patched copy of token-guard.py with STATE_DIR pointing to tmp."""
    src = open(HOOK_PATH, "r").read()
    patched = src.replace(
        'STATE_DIR = os.path.expanduser("~/.claude/hooks/session-state")',
        f'STATE_DIR = "{state_dir}"',
    )
    hook_file = tmp_path / "token-guard-test.py"
    hook_file.write_text(patched)
    return str(hook_file)


def run_patched(patched_hook, input_data, env_overrides=None):
    """Run patched token-guard with temp state dir."""
    env = os.environ.copy()
    if env_overrides:
        env.update(env_overrides)
    proc = subprocess.run(
        [sys.executable, patched_hook],
        input=json.dumps(input_data),
        capture_output=True,
        text=True,
        env=env,
        timeout=10,
    )
    return proc.returncode, proc.stdout, proc.stderr


def make_input(tool_name="Task", session_id="abcd1234", **tool_input):
    return {
        "tool_name": tool_name,
        "session_id": session_id,
        "tool_input": tool_input,
    }


class TestPassthrough:
    """Non-Task calls should always pass through."""

    def test_non_task_tool_passes(self, patched_hook):
        rc, _, _ = run_patched(patched_hook, make_input(tool_name="Read"))
        assert rc == 0

    def test_bash_tool_passes(self, patched_hook):
        rc, _, _ = run_patched(patched_hook, make_input(tool_name="Bash"))
        assert rc == 0


class TestAlwaysAllowed:
    """Lightweight agent types should always be allowed."""

    def test_claude_code_guide_allowed(self, patched_hook):
        rc, _, _ = run_patched(
            patched_hook,
            make_input(subagent_type="claude-code-guide"),
        )
        assert rc == 0

    def test_statusline_setup_allowed(self, patched_hook):
        rc, _, _ = run_patched(
            patched_hook,
            make_input(subagent_type="statusline-setup"),
        )
        assert rc == 0


class TestAgentCap:
    """Agent cap enforcement."""

    def test_first_agent_allowed(self, patched_hook):
        rc, _, _ = run_patched(
            patched_hook,
            make_input(subagent_type="general-purpose", description="test"),
        )
        assert rc == 0

    def test_cap_blocks_after_max(self, patched_hook):
        # Spawn 3 agents (the max)
        for i in range(3):
            rc, _, _ = run_patched(
                patched_hook,
                make_input(subagent_type=f"type-{i}", description=f"agent {i}"),
            )
            assert rc == 0, f"Agent {i} should be allowed"

        # 4th should be blocked
        rc, _, stderr = run_patched(
            patched_hook,
            make_input(subagent_type="type-extra", description="too many"),
        )
        assert rc == 2
        assert "BLOCKED" in stderr
        assert "cap" in stderr.lower() or "3" in stderr


class TestOnePerSession:
    """One-per-session type enforcement."""

    def test_explore_blocked_on_second(self, patched_hook):
        # First Explore allowed
        rc, _, _ = run_patched(
            patched_hook,
            make_input(subagent_type="Explore", description="first"),
        )
        assert rc == 0

        # Second Explore blocked
        rc, _, stderr = run_patched(
            patched_hook,
            make_input(subagent_type="Explore", description="second"),
        )
        assert rc == 2
        assert "BLOCKED" in stderr

    def test_plan_blocked_on_second(self, patched_hook):
        rc, _, _ = run_patched(
            patched_hook,
            make_input(subagent_type="Plan", description="first plan"),
        )
        assert rc == 0

        rc, _, stderr = run_patched(
            patched_hook,
            make_input(subagent_type="Plan", description="second plan"),
        )
        assert rc == 2
        assert "BLOCKED" in stderr


class TestSessionIdValidation:
    """Session ID validation."""

    def test_invalid_session_id_blocks(self, patched_hook):
        rc, _, stderr = run_patched(
            patched_hook,
            make_input(session_id="bad!"),
        )
        assert rc == 2
        assert "session_id" in stderr.lower()

    def test_empty_session_id_blocks(self, patched_hook):
        rc, _, stderr = run_patched(
            patched_hook,
            make_input(session_id=""),
        )
        assert rc == 2

    def test_short_session_id_blocks(self, patched_hook):
        rc, _, stderr = run_patched(
            patched_hook,
            make_input(session_id="abc"),
        )
        assert rc == 2


class TestInvalidPayload:
    """Invalid JSON payload handling."""

    def test_invalid_json_blocks(self, patched_hook):
        env = os.environ.copy()
        proc = subprocess.run(
            [sys.executable, patched_hook],
            input="not json",
            capture_output=True,
            text=True,
            env=env,
            timeout=10,
        )
        assert proc.returncode == 2
        assert "BLOCKED" in proc.stderr


class TestSkipRules:
    """TOKEN_GUARD_SKIP_RULES bypasses."""

    def test_skip_session_id_bypasses(self, patched_hook):
        rc, _, _ = run_patched(
            patched_hook,
            make_input(session_id="bad!"),
            env_overrides={"TOKEN_GUARD_SKIP_RULES": "session_id"},
        )
        assert rc == 0

    def test_skip_payload_bypasses(self, patched_hook):
        env = os.environ.copy()
        env["TOKEN_GUARD_SKIP_RULES"] = "payload"
        proc = subprocess.run(
            [sys.executable, patched_hook],
            input="not json",
            capture_output=True,
            text=True,
            env=env,
            timeout=10,
        )
        assert proc.returncode == 0


class TestExtractTargetDirs:
    """extract_target_dirs function testing."""

    def test_extracts_start_pattern(self, patched_hook):
        rc, _, _ = run_patched(
            patched_hook,
            make_input(
                subagent_type="Explore",
                description="explore",
                prompt="START: ~/Projects/my-app/\nSKIP: tests/",
            ),
        )
        assert rc == 0
