"""Unit tests for token-guard.py PreToolUse hook."""
import json
import os
import shutil
import subprocess
import sys

import pytest

HOOKS_DIR = os.path.join(os.path.dirname(__file__), "..", "hooks")
HOOK_PATH = os.path.join(HOOKS_DIR, "token-guard.py")


@pytest.fixture
def state_dir(tmp_path):
    """Provide a clean state directory."""
    sd = tmp_path / "session-state"
    sd.mkdir(mode=0o700)
    return sd


@pytest.fixture
def patched_hook(tmp_path, state_dir):
    """Copy token-guard.py + hook_utils.py to temp dir with env-based STATE_DIR."""
    # Copy hook_utils.py so imports work
    shutil.copy(os.path.join(HOOKS_DIR, "hook_utils.py"), tmp_path / "hook_utils.py")
    # Copy token-guard-config.json if it exists
    # Create test config with 0s cooldown so rapid-fire spawns work in tests
    config_dst = tmp_path / "token-guard-config.json"
    config_dst.write_text(json.dumps({
        "global_cooldown_seconds": 0,
        "parallel_window_seconds": 0,
    }))
    # Copy the hook itself
    shutil.copy(HOOK_PATH, tmp_path / "token-guard-test.py")
    return str(tmp_path / "token-guard-test.py"), str(state_dir), str(config_dst)


def run_patched(patched_hook_tuple, input_data, env_overrides=None):
    """Run patched token-guard with temp state dir."""
    hook_file, state_dir, config_path = patched_hook_tuple
    env = os.environ.copy()
    env["TOKEN_GUARD_STATE_DIR"] = state_dir
    env["TOKEN_GUARD_CONFIG_PATH"] = config_path
    if env_overrides:
        env.update(env_overrides)
    proc = subprocess.run(
        [sys.executable, hook_file],
        input=json.dumps(input_data),
        capture_output=True,
        text=True,
        env=env,
        timeout=10,
    )
    return proc.returncode, proc.stdout, proc.stderr


def make_input(tool_name="Task", session_id="abcd1234efgh", **tool_input):
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
            make_input(subagent_type="general-purpose", description="test task for agent"),
        )
        assert rc == 0

    def test_cap_blocks_after_max(self, patched_hook):
        # Spawn agents up to max (default 5)
        for i in range(5):
            rc, _, stderr = run_patched(
                patched_hook,
                make_input(subagent_type=f"type-{i}", description=f"unique agent task number {i}"),
            )
            assert rc == 0, f"Agent {i} should be allowed, stderr: {stderr}"

        # Next should be blocked
        rc, _, stderr = run_patched(
            patched_hook,
            make_input(subagent_type="type-extra", description="one too many agents"),
        )
        assert rc == 2
        assert "BLOCKED" in stderr


class TestOnePerSession:
    """One-per-session type enforcement."""

    def test_explore_blocked_on_second(self, patched_hook):
        # First Explore allowed
        rc, _, _ = run_patched(
            patched_hook,
            make_input(subagent_type="Explore", description="explore the codebase architecture"),
        )
        assert rc == 0

        # Second Explore blocked
        rc, _, stderr = run_patched(
            patched_hook,
            make_input(subagent_type="Explore", description="explore more things in codebase"),
        )
        assert rc == 2
        assert "BLOCKED" in stderr

    def test_plan_blocked_on_second(self, patched_hook):
        rc, _, _ = run_patched(
            patched_hook,
            make_input(subagent_type="Plan", description="plan the implementation strategy"),
        )
        assert rc == 0

        rc, _, stderr = run_patched(
            patched_hook,
            make_input(subagent_type="Plan", description="plan another approach to problem"),
        )
        assert rc == 2
        assert "BLOCKED" in stderr


class TestInvalidPayload:
    """Invalid JSON payload handling."""

    def test_invalid_json_passes(self, patched_hook):
        """Upstream token-guard fails open on invalid JSON."""
        hook_file, state_dir, config_path = patched_hook
        env = os.environ.copy()
        env["TOKEN_GUARD_STATE_DIR"] = state_dir
        env["TOKEN_GUARD_CONFIG_PATH"] = config_path
        proc = subprocess.run(
            [sys.executable, hook_file],
            input="not json",
            capture_output=True,
            text=True,
            env=env,
            timeout=10,
        )
        assert proc.returncode == 0  # Fail-open on bad input


class TestExtractTargetDirs:
    """extract_target_dirs function testing."""

    def test_extracts_start_pattern(self, patched_hook):
        rc, _, _ = run_patched(
            patched_hook,
            make_input(
                subagent_type="Explore",
                description="explore the project layout",
                prompt="START: ~/Projects/my-app/\nSKIP: tests/",
            ),
        )
        assert rc == 0
