"""Unit tests for read-efficiency-guard.py PostToolUse hook."""
import json
import os
import shutil
import subprocess
import sys

import pytest

HOOKS_DIR = os.path.join(os.path.dirname(__file__), "..", "hooks")
HOOK_PATH = os.path.join(HOOKS_DIR, "read-efficiency-guard.py")


@pytest.fixture
def state_dir(tmp_path):
    """Provide a clean state directory."""
    sd = tmp_path / "session-state"
    sd.mkdir(mode=0o700)
    return sd


@pytest.fixture
def patched_hook(tmp_path, state_dir):
    """Copy read-efficiency-guard.py + hook_utils.py to temp dir."""
    shutil.copy(os.path.join(HOOKS_DIR, "hook_utils.py"), tmp_path / "hook_utils.py")
    shutil.copy(HOOK_PATH, tmp_path / "read-guard-test.py")
    return str(tmp_path / "read-guard-test.py"), str(state_dir)


def run_patched(patched_hook_tuple, input_data, env_overrides=None):
    hook_file, state_dir = patched_hook_tuple
    env = os.environ.copy()
    env["TOKEN_GUARD_STATE_DIR"] = state_dir
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


def make_input(tool_name="Read", session_id="abcd1234efgh", **tool_input):
    return {
        "tool_name": tool_name,
        "session_id": session_id,
        "tool_input": tool_input,
    }


class TestPassthrough:
    """Non-Read tools should always pass through."""

    def test_bash_passes(self, patched_hook):
        rc, _, _ = run_patched(patched_hook, make_input(tool_name="Bash"))
        assert rc == 0

    def test_write_passes(self, patched_hook):
        rc, _, _ = run_patched(patched_hook, make_input(tool_name="Write"))
        assert rc == 0


class TestSequentialReadWarning:
    """Warns after 4+ sequential reads within 120s window."""

    def test_no_warning_under_threshold(self, patched_hook):
        for i in range(3):
            rc, _, stderr = run_patched(
                patched_hook,
                make_input(file_path=f"/tmp/file{i}.ts"),
            )
            assert rc == 0
            assert "TOKEN EFFICIENCY" not in stderr

    def test_warning_at_threshold(self, patched_hook):
        for i in range(4):
            rc, _, stderr = run_patched(
                patched_hook,
                make_input(file_path=f"/tmp/file{i}.ts"),
            )
            assert rc == 0  # Advisory only, never blocks
        # The 4th read should trigger a warning
        assert "sequential" in stderr.lower() or "TOKEN EFFICIENCY" in stderr


class TestSessionIdValidation:
    """Session ID handling — upstream uses 'unknown' default, no validation."""

    def test_valid_session_id_passes(self, patched_hook):
        rc, _, _ = run_patched(
            patched_hook,
            make_input(session_id="abcd1234efgh", file_path="/tmp/test.ts"),
        )
        assert rc == 0


class TestInvalidPayload:
    """Invalid JSON handling."""

    def test_invalid_json_passes(self, patched_hook):
        """Advisory hook — gracefully exits on bad input."""
        hook_file, state_dir = patched_hook
        env = os.environ.copy()
        env["TOKEN_GUARD_STATE_DIR"] = state_dir
        proc = subprocess.run(
            [sys.executable, hook_file],
            input="not json",
            capture_output=True,
            text=True,
            env=env,
            timeout=10,
        )
        assert proc.returncode == 0  # Advisory, not blocking


class TestEmptyFilePath:
    """Empty file_path should pass through."""

    def test_empty_path_passes(self, patched_hook):
        rc, _, _ = run_patched(
            patched_hook,
            make_input(file_path=""),
        )
        assert rc == 0
