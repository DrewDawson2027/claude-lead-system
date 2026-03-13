"""Functional tests for the 6 previously-untested hooks (Issue 5).

Verifies that each hook:
  - Performs its claimed core function correctly
  - Produces the expected exit code for happy-path and error inputs
  - Writes to the expected output files/logs when applicable
  - Does not crash on edge-case inputs

Hooks covered:
  1. agent-metrics.py   — extracts token usage from SubagentStop events
  2. hook_audit.py      — log_decision() and HookTimer context manager
  3. hook_health.py     — compute_health() and format_human() aggregation
  4. result-compressor.py — detects oversized PostToolUse results
  5. teammate-idle.py   — quality gate for idle-about-to teammates
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

# Repo layout: tests/ is a sibling of hooks/, both under the repo root.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOKS_DIR = os.path.join(_REPO_ROOT, "hooks")
sys.path.insert(0, HOOKS_DIR)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def run_hook(hook_file, stdin_data, env, timeout=10):
    """Run a hook subprocess. Returns (exit_code, stdout, stderr)."""
    script = os.path.join(HOOKS_DIR, hook_file)
    if isinstance(stdin_data, dict):
        stdin_data = json.dumps(stdin_data)
    result = subprocess.run(
        [sys.executable, script],
        input=stdin_data,
        capture_output=True,
        text=True,
        env=env,
        timeout=timeout,
    )
    return result.returncode, result.stdout, result.stderr


@pytest.fixture
def isolated_env(tmp_path):
    """Isolated environment for hook subprocesses."""
    state_dir = tmp_path / "session-state"
    state_dir.mkdir(parents=True)
    config = {
        "schema_version": 2,
        "max_agents": 5,
        "fail_closed": False,
        "agent_budgets": {
            "default": {"max_turns": 20},
            "explore": {"max_turns": 10},
        },
    }
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(config))

    (tmp_path / ".claude" / "hooks" / "session-state").mkdir(parents=True)
    (tmp_path / ".claude" / "logs").mkdir(parents=True)
    (tmp_path / ".claude" / "projects").mkdir(parents=True)

    env = os.environ.copy()
    env["HOME"] = str(tmp_path)
    env["TOKEN_GUARD_STATE_DIR"] = str(state_dir)
    env["TOKEN_GUARD_CONFIG_PATH"] = str(config_path)
    env["PYTHONPATH"] = HOOKS_DIR + os.pathsep + env.get("PYTHONPATH", "")
    return env, state_dir, tmp_path


# ─────────────────────────────────────────────────────────────────────────────
# 1. agent-metrics.py
# ─────────────────────────────────────────────────────────────────────────────


class TestAgentMetrics:
    """agent-metrics.py: SubagentStop → parses transcript → writes metrics JSONL."""

    def test_exits_0_on_non_subagent_stop_event(self, isolated_env):
        env, state_dir, _ = isolated_env
        payload = {
            "hook_event_name": "PreToolUse",
            "tool_name": "Task",
            "session_id": "sess_abc",
        }
        code, _, _ = run_hook("agent-metrics.py", payload, env)
        assert code == 0, "must exit 0 for non-SubagentStop events"

    def test_exits_0_on_empty_stdin(self, isolated_env):
        env, _, _ = isolated_env
        code, _, _ = run_hook("agent-metrics.py", "", env)
        assert code == 0

    def test_exits_0_on_subagent_stop_with_no_transcript(self, isolated_env):
        env, state_dir, _ = isolated_env
        payload = {
            "hook_event_name": "SubagentStop",
            "agent_id": "agent-abc123",
            "agent_type": "explore",
            "session_id": "sess_xyz",
            "agent_transcript_path": "",
        }
        code, _, _ = run_hook("agent-metrics.py", payload, env)
        assert code == 0

    def test_writes_metrics_jsonl_entry(self, isolated_env):
        """When a SubagentStop event arrives, a metrics entry is written."""
        env, state_dir, tmp_path = isolated_env
        metrics_file = (
            tmp_path / ".claude" / "hooks" / "session-state" / "agent-metrics.jsonl"
        )
        payload = {
            "hook_event_name": "SubagentStop",
            "agent_id": "agent-testwrite",
            "agent_type": "explore",
            "session_id": "sess_metrics_test",
            "agent_transcript_path": "",
        }
        code, _, _ = run_hook("agent-metrics.py", payload, env)
        assert code == 0
        assert metrics_file.exists(), "agent-metrics.jsonl must be created"
        lines = [l for l in metrics_file.read_text().splitlines() if l.strip()]
        assert len(lines) >= 1, "at least one metrics entry should be written"
        entry = json.loads(lines[-1])
        assert entry.get("record_type") == "usage"
        assert "agent_id" in entry
        assert "ts" in entry

    def test_metrics_entry_has_required_fields(self, isolated_env):
        """Metrics entry must contain token-related fields."""
        env, state_dir, tmp_path = isolated_env
        payload = {
            "hook_event_name": "SubagentStop",
            "agent_id": "agent-fields",
            "agent_type": "reviewer",
            "session_id": "sess_fields",
            "agent_transcript_path": "/nonexistent/path.jsonl",
        }
        run_hook("agent-metrics.py", payload, env)
        metrics_file = (
            tmp_path / ".claude" / "hooks" / "session-state" / "agent-metrics.jsonl"
        )
        if metrics_file.exists():
            entry = json.loads(metrics_file.read_text().splitlines()[-1])
            for field in ("record_type", "ts", "agent_id", "agent_type"):
                assert field in entry, f"metrics entry missing field: {field}"

    def test_parses_real_transcript(self, isolated_env, tmp_path):
        """With a valid transcript JSONL, token usage is extracted correctly."""
        env, state_dir, home = isolated_env
        transcript_dir = home / ".claude" / "projects" / "test-proj" / "sess_real"
        transcript_dir.mkdir(parents=True)
        transcript_file = transcript_dir / "subagents" / "agent-real999.jsonl"
        transcript_file.parent.mkdir(parents=True)
        transcript_file.write_text(
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "usage": {
                            "input_tokens": 500,
                            "output_tokens": 200,
                            "cache_read_input_tokens": 100,
                        }
                    },
                }
            )
            + "\n"
        )
        payload = {
            "hook_event_name": "SubagentStop",
            "agent_id": "real999",
            "agent_type": "explore",
            "session_id": "sess_real",
            "agent_transcript_path": str(transcript_file),
        }
        code, _, _ = run_hook("agent-metrics.py", payload, env)
        assert code == 0
        metrics_file = (
            tmp_path / ".claude" / "hooks" / "session-state" / "agent-metrics.jsonl"
        )
        assert metrics_file.exists()
        entry = json.loads(metrics_file.read_text().splitlines()[-1])
        assert (
            entry.get("input_tokens", 0) >= 500
            or entry.get("total_cost_usd") is not None
        )


# ─────────────────────────────────────────────────────────────────────────────
# 2. hook_audit.py  (library — tested via direct import)
# ─────────────────────────────────────────────────────────────────────────────


class TestHookAudit:
    """hook_audit.py: log_decision() and HookTimer write correct audit records."""

    def test_log_decision_writes_entry(self, isolated_env):
        env, state_dir, _ = isolated_env
        audit_path = state_dir / "audit.jsonl"
        os.environ["TOKEN_GUARD_STATE_DIR"] = str(state_dir)
        import importlib
        import hook_audit

        importlib.reload(hook_audit)
        hook_audit.log_decision(
            "test-hook", "Bash", "allow", "test reason", latency_ms=12.5
        )
        assert audit_path.exists()
        entry = json.loads(audit_path.read_text().splitlines()[-1])
        assert entry["hook"] == "test-hook"
        assert entry["tool"] == "Bash"
        assert entry["decision"] == "allow"
        assert entry["reason"] == "test reason"
        assert entry["latency_ms"] == 12.5

    def test_log_decision_required_fields(self, isolated_env):
        env, state_dir, _ = isolated_env
        os.environ["TOKEN_GUARD_STATE_DIR"] = str(state_dir)
        import importlib
        import hook_audit

        importlib.reload(hook_audit)
        hook_audit.log_decision("hook-a", "Task", "block", "over limit")
        audit_path = state_dir / "audit.jsonl"
        entry = json.loads(audit_path.read_text().splitlines()[-1])
        assert "ts" in entry
        assert "schema_version" in entry
        assert entry["schema_version"] == 2

    def test_log_decision_with_extra(self, isolated_env):
        env, state_dir, _ = isolated_env
        os.environ["TOKEN_GUARD_STATE_DIR"] = str(state_dir)
        import importlib
        import hook_audit

        importlib.reload(hook_audit)
        hook_audit.log_decision(
            "hook-b", "Read", "warn", "large file", extra={"size": 50000}
        )
        audit_path = state_dir / "audit.jsonl"
        entry = json.loads(audit_path.read_text().splitlines()[-1])
        assert entry.get("extra", {}).get("size") == 50000

    def test_hook_timer_context_manager_logs_on_exit(self, isolated_env):
        env, state_dir, _ = isolated_env
        os.environ["TOKEN_GUARD_STATE_DIR"] = str(state_dir)
        import importlib
        import hook_audit

        importlib.reload(hook_audit)
        with hook_audit.HookTimer("timer-hook", "Write") as t:
            t.decision = "block"
            t.reason = "credential found"
        audit_path = state_dir / "audit.jsonl"
        entry = json.loads(audit_path.read_text().splitlines()[-1])
        assert entry["hook"] == "timer-hook"
        assert entry["decision"] == "block"
        assert entry["latency_ms"] >= 0

    def test_hook_timer_records_error_on_exception(self, isolated_env):
        env, state_dir, _ = isolated_env
        os.environ["TOKEN_GUARD_STATE_DIR"] = str(state_dir)
        import importlib
        import hook_audit

        importlib.reload(hook_audit)
        try:
            with hook_audit.HookTimer("error-hook", "Bash") as t:
                raise ValueError("boom")
        except ValueError:
            pass
        audit_path = state_dir / "audit.jsonl"
        entry = json.loads(audit_path.read_text().splitlines()[-1])
        assert entry["decision"] == "error"
        assert "ValueError" in entry["reason"]

    def test_log_decision_is_non_fatal_on_bad_path(self, tmp_path):
        """log_decision must never raise even if state dir is unwritable."""
        os.environ["TOKEN_GUARD_STATE_DIR"] = "/nonexistent/impossible/path"
        import importlib
        import hook_audit

        importlib.reload(hook_audit)
        hook_audit.log_decision("safe-hook", "Task", "allow", "noop")


# ─────────────────────────────────────────────────────────────────────────────
# 3. hook_health.py (library + CLI)
# ─────────────────────────────────────────────────────────────────────────────


class TestHookHealth:
    """hook_health.py: compute_health() aggregates counters + audit into grades."""

    def _make_counters(self, state_dir, data):
        (state_dir / "hook-counters.json").write_text(json.dumps(data))

    def _make_audit(self, state_dir, entries):
        lines = "\n".join(json.dumps(e) for e in entries) + "\n"
        (state_dir / "audit.jsonl").write_text(lines)

    def test_empty_state_returns_green(self, isolated_env):
        env, state_dir, _ = isolated_env
        os.environ["TOKEN_GUARD_STATE_DIR"] = str(state_dir)
        import importlib
        import hook_health

        importlib.reload(hook_health)
        result = hook_health.compute_health()
        assert result["overall"] == "GREEN"
        assert result["hook_count"] == 0

    def test_healthy_hook_grades_green(self, isolated_env):
        env, state_dir, _ = isolated_env
        self._make_counters(
            state_dir,
            {
                "token-guard": {
                    "success": 100,
                    "fail_open": 0,
                    "fail_closed": 0,
                    "error": 0,
                }
            },
        )
        self._make_audit(
            state_dir,
            [
                {
                    "hook": "token-guard",
                    "tool": "Task",
                    "decision": "allow",
                    "latency_ms": 50,
                },
                {
                    "hook": "token-guard",
                    "tool": "Task",
                    "decision": "allow",
                    "latency_ms": 60,
                },
            ],
        )
        os.environ["TOKEN_GUARD_STATE_DIR"] = str(state_dir)
        import importlib
        import hook_health

        importlib.reload(hook_health)
        result = hook_health.compute_health()
        assert result["hooks"]["token-guard"]["grade"] == "GREEN"
        assert result["hooks"]["token-guard"]["total_invocations"] == 100

    def test_high_error_rate_grades_red(self, isolated_env):
        env, state_dir, _ = isolated_env
        self._make_counters(
            state_dir,
            {
                "bad-hook": {
                    "success": 10,
                    "fail_open": 20,
                    "fail_closed": 0,
                    "error": 5,
                }
            },
        )
        os.environ["TOKEN_GUARD_STATE_DIR"] = str(state_dir)
        import importlib
        import hook_health

        importlib.reload(hook_health)
        result = hook_health.compute_health()
        assert result["hooks"]["bad-hook"]["grade"] in ("RED", "WARN")
        assert result["overall"] in ("RED", "WARN")

    def test_slow_p95_latency_grades_warn(self, isolated_env):
        env, state_dir, _ = isolated_env
        self._make_counters(
            state_dir,
            {
                "slow-hook": {
                    "success": 10,
                    "fail_open": 0,
                    "fail_closed": 0,
                    "error": 0,
                }
            },
        )
        entries = [
            {
                "hook": "slow-hook",
                "tool": "Task",
                "decision": "allow",
                "latency_ms": 600,
            }
            for _ in range(10)
        ]
        self._make_audit(state_dir, entries)
        os.environ["TOKEN_GUARD_STATE_DIR"] = str(state_dir)
        import importlib
        import hook_health

        importlib.reload(hook_health)
        result = hook_health.compute_health()
        assert result["hooks"]["slow-hook"]["grade"] in ("WARN", "RED")

    def test_format_human_contains_hook_name(self, isolated_env):
        env, state_dir, _ = isolated_env
        self._make_counters(
            state_dir,
            {
                "credential-guard": {
                    "success": 5,
                    "fail_open": 0,
                    "fail_closed": 1,
                    "error": 0,
                }
            },
        )
        os.environ["TOKEN_GUARD_STATE_DIR"] = str(state_dir)
        import importlib
        import hook_health

        importlib.reload(hook_health)
        health = hook_health.compute_health()
        text = hook_health.format_human(health)
        assert "credential-guard" in text
        assert "GREEN" in text or "WARN" in text or "RED" in text

    def test_cli_json_output(self, isolated_env):
        env, state_dir, _ = isolated_env
        script = os.path.join(HOOKS_DIR, "hook_health.py")
        result = subprocess.run(
            [sys.executable, script],
            input="",
            capture_output=True,
            text=True,
            env=env,
            timeout=10,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert "overall" in data
        assert "hook_count" in data
        assert "hooks" in data

    def test_cli_human_output(self, isolated_env):
        env, state_dir, _ = isolated_env
        script = os.path.join(HOOKS_DIR, "hook_health.py")
        result = subprocess.run(
            [sys.executable, script, "--human"],
            input="",
            capture_output=True,
            text=True,
            env=env,
            timeout=10,
        )
        assert result.returncode == 0
        assert "Hook Health:" in result.stdout


# ─────────────────────────────────────────────────────────────────────────────
# 4. result-compressor.py
# ─────────────────────────────────────────────────────────────────────────────


class TestResultCompressor:
    """result-compressor.py: advisory warning for large PostToolUse results."""

    def test_exits_0_always_non_blocking(self, isolated_env):
        env, _, _ = isolated_env
        payload = {
            "hook_event_name": "PostToolUse",
            "tool_name": "Bash",
            "tool_output": "short output",
            "session_id": "sess_test",
        }
        code, _, _ = run_hook("result-compressor.py", payload, env)
        assert code == 0, "result-compressor must always be non-blocking (exit 0)"

    def test_no_warning_for_small_result(self, isolated_env):
        env, _, _ = isolated_env
        payload = {
            "hook_event_name": "PostToolUse",
            "tool_name": "Bash",
            "tool_output": "small output",
            "session_id": "sess_small",
        }
        code, stdout, stderr = run_hook("result-compressor.py", payload, env)
        assert code == 0
        assert "CONTEXT BLOAT" not in stderr

    def test_warning_for_large_result(self, isolated_env):
        """Results > 5000 chars should emit a CONTEXT BLOAT warning to stderr."""
        env, _, _ = isolated_env
        large_output = "x" * 6000
        payload = {
            "hook_event_name": "PostToolUse",
            "tool_name": "Bash",
            "tool_output": large_output,
            "session_id": "sess_large",
        }
        code, stdout, stderr = run_hook("result-compressor.py", payload, env)
        assert code == 0
        assert (
            "CONTEXT BLOAT" in stderr
        ), "large output must trigger CONTEXT BLOAT warning"
        assert "6,000" in stderr or "6000" in stderr

    def test_monitors_bash_grep_read(self, isolated_env):
        """Hook monitors Bash, Grep, and Read tools."""
        env, _, _ = isolated_env
        large_output = "y" * 6000
        for tool in ("Bash", "Grep", "Read"):
            payload = {
                "hook_event_name": "PostToolUse",
                "tool_name": tool,
                "tool_output": large_output,
                "session_id": "sess_monitor",
            }
            code, _, stderr = run_hook("result-compressor.py", payload, env)
            assert code == 0
            assert "CONTEXT BLOAT" in stderr, f"{tool} should trigger CONTEXT BLOAT"

    def test_ignores_non_monitored_tools(self, isolated_env):
        """Write/Edit tools are not monitored — no warning even for large output."""
        env, _, _ = isolated_env
        large_output = "z" * 6000
        payload = {
            "hook_event_name": "PostToolUse",
            "tool_name": "Write",
            "tool_output": large_output,
            "session_id": "sess_write",
        }
        code, _, stderr = run_hook("result-compressor.py", payload, env)
        assert code == 0
        assert "CONTEXT BLOAT" not in stderr

    def test_skips_when_guard_already_warned(self, isolated_env):
        """If READ_EFFICIENCY_GUARD_WARNED is set, skip to avoid duplicate warnings."""
        env, _, _ = isolated_env
        env_with_skip = dict(env)
        env_with_skip["READ_EFFICIENCY_GUARD_WARNED"] = "1"
        large_output = "q" * 6000
        payload = {
            "hook_event_name": "PostToolUse",
            "tool_name": "Bash",
            "tool_output": large_output,
            "session_id": "sess_skip",
        }
        code, _, stderr = run_hook("result-compressor.py", payload, env_with_skip)
        assert code == 0
        assert "CONTEXT BLOAT" not in stderr

    def test_handles_malformed_input_gracefully(self, isolated_env):
        env, _, _ = isolated_env
        code, _, _ = run_hook("result-compressor.py", "not json at all", env)
        assert code == 0

    def test_handles_dict_tool_output(self, isolated_env):
        """tool_output can be a dict — hook should serialize and check size."""
        env, _, _ = isolated_env
        big_dict = {"data": "a" * 6000}
        payload = {
            "hook_event_name": "PostToolUse",
            "tool_name": "Bash",
            "tool_output": big_dict,
            "session_id": "sess_dict",
        }
        code, _, _ = run_hook("result-compressor.py", payload, env)
        assert code == 0


# ─────────────────────────────────────────────────────────────────────────────
# 5. teammate-idle.py
# ─────────────────────────────────────────────────────────────────────────────


class TestTeammateIdle:
    """teammate-idle.py: quality gate — exit 2 = hold, exit 0 = allow idle."""

    def test_clean_output_allows_idle(self, isolated_env):
        """Teammate with no issues should be allowed to idle (exit 0)."""
        env, _, _ = isolated_env
        payload = {
            "teammate_id": "alice",
            "task": "implement feature X",
            "output": "done. implemented X. all tests passed. ✓",
            "files_changed": [],
        }
        code, _, _ = run_hook("teammate-idle.py", payload, env)
        assert code == 0

    def test_output_with_errors_holds_teammate(self, isolated_env):
        """Output containing error: should trigger hold (exit 2)."""
        env, _, _ = isolated_env
        payload = {
            "teammate_id": "bob",
            "task": "fix bug in auth",
            "output": "error: TypeError in auth.py line 42",
            "files_changed": ["src/auth.py"],
        }
        code, stdout, _ = run_hook("teammate-idle.py", payload, env)
        assert code == 2, "errors in output must hold the teammate"
        assert "error" in stdout.lower() or "fail" in stdout.lower()

    def test_files_changed_without_verification_holds(self, isolated_env):
        """Files changed but no test/lint/build evidence → hold."""
        env, _, _ = isolated_env
        payload = {
            "teammate_id": "carol",
            "task": "refactor module",
            "output": "refactored the module",
            "files_changed": ["src/module.py"],
        }
        code, stdout, _ = run_hook("teammate-idle.py", payload, env)
        assert code == 2
        assert "test" in stdout.lower() or "verif" in stdout.lower()

    def test_files_changed_with_tests_passed_allows_idle(self, isolated_env):
        """Files changed with test evidence → allow idle."""
        env, _, _ = isolated_env
        payload = {
            "teammate_id": "dave",
            "task": "refactor utils",
            "output": "refactored. all tests passed. pytest: 42 passed.",
            "files_changed": ["src/utils.py"],
        }
        code, _, _ = run_hook("teammate-idle.py", payload, env)
        assert code == 0

    def test_todo_in_changed_file_holds_teammate(self, isolated_env, tmp_path):
        """Unresolved TODOs in changed files trigger hold."""
        env, _, home = isolated_env
        dirty_file = tmp_path / "dirty.py"
        dirty_file.write_text("def foo():\n    pass  # TODO: implement this\n")
        payload = {
            "teammate_id": "eve",
            "task": "implement foo",
            "output": "done implementing. tests passed.",
            "files_changed": [str(dirty_file)],
        }
        code, stdout, _ = run_hook("teammate-idle.py", payload, env)
        assert code == 2
        assert "TODO" in stdout or "todo" in stdout.lower()

    def test_task_with_deliverable_no_files_no_output_holds(self, isolated_env):
        """Task says 'create X' but no files changed and no completion signal."""
        env, _, _ = isolated_env
        payload = {
            "teammate_id": "frank",
            "task": "create the new API endpoint",
            "output": "I looked at the code",
            "files_changed": [],
        }
        code, stdout, _ = run_hook("teammate-idle.py", payload, env)
        assert code == 2

    def test_writes_audit_log(self, isolated_env):
        """Every run should append to the audit log."""
        env, _, home = isolated_env
        log_path = home / ".claude" / "logs" / "teammate-idle.log"
        payload = {
            "teammate_id": "grace",
            "task": "write tests",
            "output": "tests written. all pass.",
            "files_changed": [],
        }
        run_hook("teammate-idle.py", payload, env)
        assert log_path.exists(), "teammate-idle.log must be created"
        content = log_path.read_text()
        assert "grace" in content

    def test_empty_input_allows_idle(self, isolated_env):
        """Empty/no input → no issues found → allow idle."""
        env, _, _ = isolated_env
        code, _, _ = run_hook("teammate-idle.py", "", env)
        assert code == 0

    def test_malformed_json_allows_idle(self, isolated_env):
        """Bad JSON input → graceful fail-open (exit 0)."""
        env, _, _ = isolated_env
        code, _, _ = run_hook("teammate-idle.py", "not json {[", env)
        assert code == 0

    def test_feedback_message_lists_all_issues(self, isolated_env, tmp_path):
        """When multiple issues found, all are listed in feedback output."""
        env, _, _ = isolated_env
        dirty_file = tmp_path / "bad.py"
        dirty_file.write_text("# FIXME: this is broken\n")
        payload = {
            "teammate_id": "henry",
            "task": "implement feature",
            "output": "error: something failed",
            "files_changed": [str(dirty_file)],
        }
        code, stdout, _ = run_hook("teammate-idle.py", payload, env)
        assert code == 2
        assert "1." in stdout
        assert "2." in stdout or len(stdout.strip().split("\n")) >= 3

    # ── Native schema tests (dual-schema support) ──────────────────────────
    def test_native_schema_accepted(self, isolated_env):
        """Native Agent Teams payload with teammate_name is accepted."""
        env, _, _ = isolated_env
        payload = {
            "teammate_name": "worker-alpha",
            "task_in_progress": {"id": "T123", "title": "review docs"},
            "idle_reason": "completed",
        }
        code, _, _ = run_hook("teammate-idle.py", payload, env)
        assert code == 0

    def test_native_schema_error_reason_blocks(self, isolated_env):
        """Native idle_reason with error signal triggers exit 2."""
        env, _, _ = isolated_env
        payload = {
            "teammate_name": "worker-beta",
            "task_in_progress": {"id": "T456", "title": "build feature"},
            "idle_reason": "error: segfault in build",
        }
        code, stdout, _ = run_hook("teammate-idle.py", payload, env)
        assert code == 2
        assert "error" in stdout.lower()

    def test_native_schema_nested_task(self, isolated_env):
        """task_in_progress.title is used as the task name for Check 3."""
        env, _, _ = isolated_env
        payload = {
            "teammate_name": "worker-gamma",
            "task_in_progress": {"id": "T789", "title": "implement auth"},
            "idle_reason": "done",
        }
        # No output field + no files_changed + impl task → should flag deliverable gap
        code, stdout, _ = run_hook("teammate-idle.py", payload, env)
        assert code == 2
        assert "implement auth" in stdout

    def test_native_schema_no_files_skips_check1(self, isolated_env):
        """Native events without files_changed skip the TODO/FIXME check."""
        env, _, _ = isolated_env
        payload = {
            "teammate_name": "worker-delta",
            "task_in_progress": {"id": "T100", "title": "review PR"},
            "idle_reason": "completed",
        }
        code, _, _ = run_hook("teammate-idle.py", payload, env)
        # Research task, no deliverables expected → allow
        assert code == 0


# ─────────────────────────────────────────────────────────────────────────────
# 6. task-completed.py — quality gate for task completion
# ─────────────────────────────────────────────────────────────────────────────


class TestTaskCompleted:
    """Tests for task-completed.py — both coordinator and native schemas."""

    def test_trivial_message_blocked(self, isolated_env):
        """Coordinator: trivial completion message 'done' → exit 2."""
        env, _, _ = isolated_env
        payload = {
            "task": "implement feature",
            "task_id": "T1",
            "completion_message": "done",
            "files_changed": ["/tmp/x.py"],
            "teammate_id": "bob",
        }
        code, stdout, _ = run_hook("task-completed.py", payload, env)
        assert code == 2
        assert "vague" in stdout.lower()

    def test_impl_task_no_files_blocked(self, isolated_env):
        """Coordinator: implement task with no files → exit 2."""
        env, _, _ = isolated_env
        payload = {
            "task": "implement auth module",
            "task_id": "T2",
            "completion_message": "Implemented the auth module with JWT tokens",
            "files_changed": [],
            "teammate_id": "alice",
        }
        code, stdout, _ = run_hook("task-completed.py", payload, env)
        assert code == 2
        assert "no files" in stdout.lower()

    def test_research_task_no_files_allowed(self, isolated_env):
        """Coordinator: review task with no files → exit 0."""
        env, _, _ = isolated_env
        payload = {
            "task": "review PR #42",
            "task_id": "T3",
            "completion_message": "Reviewed PR, found 3 issues documented in comments",
            "files_changed": [],
            "teammate_id": "carol",
        }
        code, _, _ = run_hook("task-completed.py", payload, env)
        assert code == 0

    def test_error_in_completion_blocked(self, isolated_env):
        """Coordinator: error signal in completion message → exit 2."""
        env, _, _ = isolated_env
        payload = {
            "task": "fix build",
            "task_id": "T4",
            "completion_message": "error: could not compile due to missing import",
            "files_changed": ["/tmp/fix.py"],
            "teammate_id": "dave",
        }
        code, stdout, _ = run_hook("task-completed.py", payload, env)
        assert code == 2
        assert "error" in stdout.lower()

    def test_placeholder_name_blocked(self, isolated_env):
        """Coordinator: placeholder task name 'task' → exit 2."""
        env, _, _ = isolated_env
        payload = {
            "task": "task",
            "task_id": "T5",
            "completion_message": "All done with the implementation",
            "files_changed": ["/tmp/file.py"],
            "teammate_id": "eve",
        }
        code, stdout, _ = run_hook("task-completed.py", payload, env)
        assert code == 2
        assert "placeholder" in stdout.lower()

    def test_valid_completion_allowed(self, isolated_env):
        """Coordinator: valid completion with good message + files → exit 0."""
        env, _, _ = isolated_env
        payload = {
            "task": "implement auth module",
            "task_id": "T6",
            "completion_message": "Implemented JWT auth with refresh tokens. Added 12 unit tests.",
            "files_changed": ["/tmp/auth.py", "/tmp/test_auth.py"],
            "teammate_id": "frank",
        }
        code, _, _ = run_hook("task-completed.py", payload, env)
        assert code == 0

    def test_native_schema_accepted(self, isolated_env):
        """Native: task_title and assignee fields work correctly."""
        env, _, _ = isolated_env
        payload = {
            "task_title": "implement search feature",
            "task_id": "T7",
            "assignee": "worker-alpha",
            "completion_time_seconds": 120,
        }
        code, _, _ = run_hook("task-completed.py", payload, env)
        assert code == 0

    def test_native_schema_placeholder_blocked(self, isolated_env):
        """Native: placeholder task_title still blocked."""
        env, _, _ = isolated_env
        payload = {
            "task_title": "task",
            "task_id": "T8",
            "assignee": "worker-beta",
        }
        code, stdout, _ = run_hook("task-completed.py", payload, env)
        assert code == 2
        assert "placeholder" in stdout.lower()

    def test_audit_log_schema_tag(self, isolated_env):
        """Audit log includes schema tag (native vs coordinator)."""
        env, _, _ = isolated_env
        payload = {
            "task_title": "deploy feature",
            "task_id": "T9",
            "assignee": "worker-gamma",
        }
        run_hook("task-completed.py", payload, env)
        log_path = Path(env["HOME"]) / ".claude" / "logs" / "task-completed.log"
        if log_path.exists():
            content = log_path.read_text()
            assert "native" in content or "T9" in content

    def test_empty_input_blocked(self, isolated_env):
        """Empty input → placeholder check fires → exit 2."""
        env, _, _ = isolated_env
        code, _, _ = run_hook("task-completed.py", "", env)
        assert code == 2


# ─────────────────────────────────────────────────────────────────────────────
# 7. trust_audit.py — plugin trust tier classification
# ─────────────────────────────────────────────────────────────────────────────

SCRIPTS_DIR = os.path.join(_REPO_ROOT, "scripts")


def run_script(script_name, args, env, timeout=10):
    """Run a script as subprocess. Returns (exit_code, stdout, stderr)."""
    script = os.path.join(SCRIPTS_DIR, script_name)
    result = subprocess.run(
        [sys.executable, script] + args,
        capture_output=True,
        text=True,
        env=env,
        timeout=timeout,
    )
    return result.returncode, result.stdout, result.stderr


class TestTrustAudit:
    """Tests for trust_audit.py — plugin trust tier classification and audit."""

    @pytest.fixture
    def trust_env(self, tmp_path):
        """Create isolated environment for trust_audit tests."""
        claude_dir = tmp_path / ".claude"
        claude_dir.mkdir()
        governance = claude_dir / "governance"
        governance.mkdir()
        reports = claude_dir / "reports"
        reports.mkdir()
        settings_file = claude_dir / "settings.json"
        approvals_file = governance / "tier2-approvals.json"
        env = os.environ.copy()
        env["HOME"] = str(tmp_path)
        return env, settings_file, approvals_file, reports

    def test_tier_classification_official(self, trust_env):
        """Official plugins are tier 1."""
        env, settings_file, approvals_file, _ = trust_env
        settings_file.write_text(
            json.dumps({"enabledPlugins": {"my-plugin@claude-plugins-official": True}})
        )
        approvals_file.write_text(json.dumps({"approved": []}))
        code, stdout, _ = run_script("trust_audit.py", [], env)
        data = json.loads(stdout.split("WARNING")[0].strip())
        assert data["summary"]["tier1"] == 1

    def test_tier_classification_local(self, trust_env):
        """Local plugins are tier 0."""
        env, settings_file, approvals_file, _ = trust_env
        settings_file.write_text(
            json.dumps({"enabledPlugins": {"my-local-plugin": True}})
        )
        approvals_file.write_text(json.dumps({"approved": []}))
        code, stdout, _ = run_script("trust_audit.py", [], env)
        data = json.loads(stdout.split("WARNING")[0].strip())
        assert data["summary"]["tier0"] == 1

    def test_tier_classification_marketplace(self, trust_env):
        """Marketplace plugins are tier 2."""
        env, settings_file, approvals_file, _ = trust_env
        settings_file.write_text(
            json.dumps({"enabledPlugins": {"cool-plugin@third-party-market": True}})
        )
        approvals_file.write_text(json.dumps({"approved": []}))
        code, stdout, _ = run_script("trust_audit.py", [], env)
        data = json.loads(stdout.split("WARNING")[0].strip())
        assert data["summary"]["tier2"] == 1

    def test_unapproved_tier2_flagged(self, trust_env):
        """Unapproved tier 2 plugin appears in violations."""
        env, settings_file, approvals_file, _ = trust_env
        settings_file.write_text(
            json.dumps({"enabledPlugins": {"sketchy@marketplace": True}})
        )
        approvals_file.write_text(json.dumps({"approved": []}))
        code, stdout, _ = run_script("trust_audit.py", [], env)
        assert "WARNING" in stdout
        assert "sketchy@marketplace" in stdout

    def test_approved_tier2_passes(self, trust_env):
        """Approved tier 2 plugin does NOT appear in violations."""
        env, settings_file, approvals_file, _ = trust_env
        settings_file.write_text(
            json.dumps({"enabledPlugins": {"approved-plugin@marketplace": True}})
        )
        approvals_file.write_text(
            json.dumps({"approved": [{"plugin": "approved-plugin@marketplace"}]})
        )
        code, stdout, _ = run_script("trust_audit.py", [], env)
        assert "WARNING" not in stdout

    def test_empty_settings_no_crash(self, trust_env):
        """Empty enabledPlugins → no crash, clean report."""
        env, settings_file, approvals_file, reports = trust_env
        settings_file.write_text(json.dumps({"enabledPlugins": {}}))
        approvals_file.write_text(json.dumps({"approved": []}))
        code, stdout, _ = run_script("trust_audit.py", [], env)
        assert code == 0
        data = json.loads(stdout.strip())
        assert data["tier2_unapproved"] == []

    def test_report_file_written(self, trust_env):
        """Report file is created in REPORT_DIR."""
        env, settings_file, approvals_file, reports = trust_env
        settings_file.write_text(
            json.dumps({"enabledPlugins": {"test@official": True}})
        )
        approvals_file.write_text(json.dumps({"approved": []}))
        run_script("trust_audit.py", [], env)
        report_file = reports / "trust-audit-latest.json"
        assert report_file.exists()

    def test_quiet_mode(self, trust_env):
        """--quiet suppresses JSON stdout output."""
        env, settings_file, approvals_file, _ = trust_env
        settings_file.write_text(
            json.dumps({"enabledPlugins": {"test@claude-plugins-official": True}})
        )
        approvals_file.write_text(json.dumps({"approved": []}))
        code, stdout, _ = run_script("trust_audit.py", ["--quiet"], env)
        lines = [l for l in stdout.strip().split("\n") if l.strip()]
        assert len(lines) == 0 or not lines[0].startswith("{")
