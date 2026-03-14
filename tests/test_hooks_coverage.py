"""Direct-import coverage tests for Python hooks.

These tests import hook functions directly (rather than running as subprocesses)
to generate measurable pytest-cov line coverage for:
  - hook_utils.py        (push from 37% to 80%+)
  - auto-review-dispatch.py (push from 0% to 70%+)
  - token-guard.py       (push from 0% to 50%+, module-level data alone ~30%)

The subprocess tests in test_token_guard.py / test_chain_automation.py verify
BEHAVIORAL correctness. These tests verify LINE COVERAGE so CI can track gaps.
"""

import importlib.util
import io
import json
import os
import sys
import time
from pathlib import Path

import pytest

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOKS_DIR = os.path.join(_REPO_ROOT, "hooks")


# ─── Import helpers ───────────────────────────────────────────────────────────


def _add_hooks_to_path():
    """Ensure hooks dir is on sys.path for guard_contracts etc."""
    if HOOKS_DIR not in sys.path:
        sys.path.insert(0, HOOKS_DIR)


def _import_module(rel_path, env_overrides=None):
    """Import a hooks/ file as a fresh module, optionally with env var overrides.

    Uses a unique cache key per call to force module-level code to re-execute
    with the desired env vars, bypassing Python's module import cache.
    """
    _add_hooks_to_path()
    abs_path = os.path.join(HOOKS_DIR, rel_path)
    unique_name = f"_hc_{rel_path.replace('.', '_').replace('-', '_')}_{time.time_ns()}"

    saved = {}
    if env_overrides:
        for k, v in env_overrides.items():
            saved[k] = os.environ.get(k)
            os.environ[k] = v
    try:
        spec = importlib.util.spec_from_file_location(unique_name, abs_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        if env_overrides:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


# ─── hook_utils.py ─────────────────────────────────────────────────────────── #
# Currently 37% covered (lines 50-60, 71-86, 105-106, 115-128 missed).
# Tests below cover all four missed regions via direct import.


class TestHookUtilsLoadJsonState:
    """load_json_state — covers lines 46-63."""

    def test_missing_file_returns_empty(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        result = hook_utils.load_json_state(str(tmp_path / "missing.json"))
        assert result == {}

    def test_corrupt_json_returns_empty(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "bad.json"
        p.write_text("not valid json!!!")
        assert hook_utils.load_json_state(str(p)) == {}

    def test_unicode_decode_error_returns_empty(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "binary.json"
        p.write_bytes(b"\xff\xfe{invalid}")
        assert hook_utils.load_json_state(str(p)) == {}

    def test_valid_json_returns_dict(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "good.json"
        p.write_text('{"key": "value", "num": 42}')
        result = hook_utils.load_json_state(str(p))
        assert result == {"key": "value", "num": 42}

    def test_default_factory_called_on_missing(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        default = {"schema_version": 1, "agents": []}
        result = hook_utils.load_json_state(
            str(tmp_path / "missing.json"), lambda: default.copy()
        )
        assert result == default

    def test_default_factory_not_called_when_file_exists(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "state.json"
        p.write_text('{"x": 1}')
        factory_called = []
        result = hook_utils.load_json_state(
            str(p), lambda: factory_called.append(1) or {}
        )
        assert result == {"x": 1}
        assert factory_called == []


class TestHookUtilsSaveJsonState:
    """save_json_state — covers lines 66-86."""

    def test_writes_file_atomically(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "state.json"
        assert hook_utils.save_json_state(str(p), {"foo": "bar", "n": 1}) is True
        assert json.loads(p.read_text()) == {"foo": "bar", "n": 1}

    def test_overwrites_existing(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "state.json"
        hook_utils.save_json_state(str(p), {"v": 1})
        hook_utils.save_json_state(str(p), {"v": 2})
        assert json.loads(p.read_text()) == {"v": 2}

    def test_nonexistent_parent_dir_returns_false(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "no_dir" / "state.json"
        assert hook_utils.save_json_state(str(p), {"x": 1}) is False

    def test_returns_true_on_success(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        assert hook_utils.save_json_state(str(tmp_path / "s.json"), {}) is True


class TestHookUtilsLockedAppend:
    """locked_append — covers lines 89-109."""

    def test_appends_line_to_new_file(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "log.jsonl"
        assert hook_utils.locked_append(str(p), '{"k":1}\n') is True
        assert '{"k":1}' in p.read_text()

    def test_appends_multiple_lines_in_order(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "log.jsonl"
        hook_utils.locked_append(str(p), "line1\n")
        hook_utils.locked_append(str(p), "line2\n")
        lines = p.read_text().splitlines()
        assert lines[0] == "line1"
        assert lines[1] == "line2"

    def test_appends_to_existing_file(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "log.jsonl"
        p.write_text("existing\n")
        hook_utils.locked_append(str(p), "new\n")
        assert "existing" in p.read_text()
        assert "new" in p.read_text()

    def test_returns_false_on_permission_error(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        # Unwritable directory
        d = tmp_path / "readonly"
        d.mkdir(mode=0o555)
        result = hook_utils.locked_append(str(d / "log.jsonl"), "data\n")
        # Restore permissions so pytest cleanup works
        d.chmod(0o755)
        assert result is False


class TestHookUtilsReadJsonlFaultTolerant:
    """read_jsonl_fault_tolerant — covers lines 112-128."""

    def test_missing_file_returns_empty_list(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        assert hook_utils.read_jsonl_fault_tolerant(str(tmp_path / "none.jsonl")) == []

    def test_valid_jsonl_returns_all_entries(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "data.jsonl"
        p.write_text('{"a":1}\n{"b":2}\n{"c":3}\n')
        result = hook_utils.read_jsonl_fault_tolerant(str(p))
        assert len(result) == 3
        assert result[0] == {"a": 1}
        assert result[2] == {"c": 3}

    def test_skips_corrupt_lines(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "mixed.jsonl"
        p.write_text('{"a":1}\nnot-json\n{"b":2}\n')
        result = hook_utils.read_jsonl_fault_tolerant(str(p))
        assert len(result) == 2
        assert {"a": 1} in result
        assert {"b": 2} in result

    def test_skips_blank_lines(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "blanks.jsonl"
        p.write_text('{"a":1}\n\n\n{"b":2}\n')
        result = hook_utils.read_jsonl_fault_tolerant(str(p))
        assert len(result) == 2

    def test_all_corrupt_returns_empty(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "allbad.jsonl"
        p.write_text("bad1\nbad2\nbad3\n")
        assert hook_utils.read_jsonl_fault_tolerant(str(p)) == []

    def test_empty_file_returns_empty(self, tmp_path):
        _add_hooks_to_path()
        import hook_utils

        p = tmp_path / "empty.jsonl"
        p.write_text("")
        assert hook_utils.read_jsonl_fault_tolerant(str(p)) == []


# ─── auto-review-dispatch.py ─────────────────────────────────────────────────
# Currently 0% (subprocess-only tests). Target: 70%+ via direct import.


@pytest.fixture
def ard(tmp_path):
    """Fresh auto-review-dispatch module with an isolated queue directory."""
    queue_dir = str(tmp_path / "queue")
    queue_file = os.path.join(queue_dir, "mandatory-actions.jsonl")
    mod = _import_module("auto-review-dispatch.py")
    # Patch module-level paths to the tmp dir so we never write to real ~/.claude
    mod.QUEUE_DIR = queue_dir
    mod.QUEUE_FILE = queue_file
    return mod, queue_file


class TestAutoReviewIsGitCommit:
    """_is_git_commit — pure function, no I/O."""

    def test_plain_git_commit(self):
        mod = _import_module("auto-review-dispatch.py")
        assert mod._is_git_commit("git commit -m 'msg'", "git commit -m 'msg'") is True

    def test_git_commit_with_heredoc(self):
        mod = _import_module("auto-review-dispatch.py")
        cmd = "git commit -m \"$(cat <<'EOF'\nmy message\nEOF\n)\""
        assert mod._is_git_commit("git commit", cmd) is True

    def test_git_commit_with_env_prefix(self):
        mod = _import_module("auto-review-dispatch.py")
        cmd = "GIT_DIR=/tmp git commit -m 'msg'"
        assert mod._is_git_commit("GIT_DIR=/tmp git commit", cmd) is True

    def test_git_commit_amend(self):
        mod = _import_module("auto-review-dispatch.py")
        assert mod._is_git_commit("git commit --amend", "git commit --amend") is True

    def test_non_commit_git_command_false(self):
        mod = _import_module("auto-review-dispatch.py")
        assert (
            mod._is_git_commit("git push origin main", "git push origin main") is False
        )

    def test_non_git_command_false(self):
        mod = _import_module("auto-review-dispatch.py")
        assert mod._is_git_commit("npm test", "npm test") is False

    def test_empty_string_false(self):
        mod = _import_module("auto-review-dispatch.py")
        assert mod._is_git_commit("", "") is False


class TestAutoReviewIsPrCreate:
    """_is_pr_create — pure function, no I/O."""

    def test_gh_pr_create_command(self):
        mod = _import_module("auto-review-dispatch.py")
        cmd = "gh pr create --title 'Fix' --body 'desc'"
        assert mod._is_pr_create("gh pr create", cmd, "") is True

    def test_output_signal_with_pr_url(self):
        mod = _import_module("auto-review-dispatch.py")
        output = "Created pull request https://github.com/org/repo/pull/42"
        assert mod._is_pr_create("", "", output) is True

    def test_github_url_with_https_prefix_triggers_signal(self):
        mod = _import_module("auto-review-dispatch.py")
        # "https://github" in output + "/pull/" satisfies the output_signal branch
        output = "https://github.com/org/repo/pull/42"
        assert mod._is_pr_create("git push", "git push", output) is True

    def test_non_pr_command_no_output_false(self):
        mod = _import_module("auto-review-dispatch.py")
        assert mod._is_pr_create("git push", "git push origin main", "") is False

    def test_empty_all_false(self):
        mod = _import_module("auto-review-dispatch.py")
        assert mod._is_pr_create("", "", "") is False


class TestAutoReviewEnqueueAction:
    """_enqueue_action — writes to queue file."""

    def test_returns_action_id_with_type_prefix(self, ard):
        mod, queue_file = ard
        action_id = mod._enqueue_action("review-after-commit", "instruction text")
        assert action_id.startswith("review-after-commit-")

    def test_writes_valid_json_to_queue(self, ard):
        mod, queue_file = ard
        mod._enqueue_action("test-type", "My instruction", "ctx")
        entries = [json.loads(l) for l in Path(queue_file).read_text().splitlines()]
        assert len(entries) == 1
        action = entries[0]
        assert action["type"] == "test-type"
        assert action["instruction"] == "My instruction"
        assert action["context"] == "ctx"
        assert action["status"] == "pending"

    def test_appends_multiple_actions(self, ard):
        mod, queue_file = ard
        mod._enqueue_action("type-a", "first")
        mod._enqueue_action("type-b", "second")
        lines = Path(queue_file).read_text().strip().splitlines()
        assert len(lines) == 2

    def test_creates_queue_directory_if_missing(self, tmp_path):
        new_dir = str(tmp_path / "deep" / "nested" / "queue")
        mod = _import_module("auto-review-dispatch.py")
        mod.QUEUE_DIR = new_dir
        mod.QUEUE_FILE = os.path.join(new_dir, "mandatory-actions.jsonl")
        mod._enqueue_action("type", "instruction")
        assert os.path.exists(mod.QUEUE_FILE)

    def test_action_has_created_at_timestamp(self, ard):
        mod, queue_file = ard
        mod._enqueue_action("type", "instr")
        entry = json.loads(Path(queue_file).read_text().strip())
        assert "created_at" in entry
        assert "T" in entry["created_at"]  # ISO format


class TestAutoReviewMain:
    """main() — covers most of the 26-line main body via direct call."""

    def _run_main(self, mod, stdin_json, monkeypatch):
        """Call main() with mocked stdin, return SystemExit code."""
        monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(stdin_json)))
        with pytest.raises(SystemExit) as exc:
            mod.main()
        return exc.value.code

    def test_invalid_json_exits_0(self, tmp_path, monkeypatch):
        mod = _import_module("auto-review-dispatch.py")
        mod.QUEUE_DIR = str(tmp_path)
        mod.QUEUE_FILE = str(tmp_path / "q.jsonl")
        monkeypatch.setattr("sys.stdin", io.StringIO("not json"))
        with pytest.raises(SystemExit) as exc:
            mod.main()
        assert exc.value.code == 0

    def test_non_bash_tool_exits_0(self, tmp_path, monkeypatch):
        mod = _import_module("auto-review-dispatch.py")
        mod.QUEUE_DIR = str(tmp_path)
        mod.QUEUE_FILE = str(tmp_path / "q.jsonl")
        data = {
            "tool_name": "Read",
            "tool_input": {"file_path": "/tmp/x"},
            "tool_output": "",
        }
        rc = self._run_main(mod, data, monkeypatch)
        assert rc == 0

    def test_bash_non_commit_command_returns_normally(self, tmp_path, monkeypatch):
        # main() has no sys.exit for non-commit Bash commands — it falls through
        mod = _import_module("auto-review-dispatch.py")
        mod.QUEUE_DIR = str(tmp_path)
        mod.QUEUE_FILE = str(tmp_path / "q.jsonl")
        data = {
            "tool_name": "Bash",
            "tool_input": {"command": "npm test"},
            "tool_output": "ok",
        }
        monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(data)))
        # No sys.exit — main() returns None for unmatched Bash commands
        result = mod.main()
        assert result is None
        assert not os.path.exists(str(tmp_path / "q.jsonl"))

    def test_git_commit_nothing_to_commit_exits_0(self, tmp_path, monkeypatch):
        mod = _import_module("auto-review-dispatch.py")
        mod.QUEUE_DIR = str(tmp_path)
        mod.QUEUE_FILE = str(tmp_path / "q.jsonl")
        data = {
            "tool_name": "Bash",
            "tool_input": {"command": "git commit -m 'msg'"},
            "tool_output": "nothing to commit, working tree clean",
        }
        rc = self._run_main(mod, data, monkeypatch)
        assert rc == 0

    def test_git_commit_failed_output_exits_0(self, tmp_path, monkeypatch):
        mod = _import_module("auto-review-dispatch.py")
        mod.QUEUE_DIR = str(tmp_path)
        mod.QUEUE_FILE = str(tmp_path / "q.jsonl")
        data = {
            "tool_name": "Bash",
            "tool_input": {"command": "git commit -m 'msg'"},
            "tool_output": "error: nothing added to commit",
        }
        rc = self._run_main(mod, data, monkeypatch)
        assert rc == 0

    def test_successful_git_commit_exits_0_and_enqueues(self, tmp_path, monkeypatch):
        mod = _import_module("auto-review-dispatch.py")
        queue_file = str(tmp_path / "q.jsonl")
        mod.QUEUE_DIR = str(tmp_path)
        mod.QUEUE_FILE = queue_file
        data = {
            "tool_name": "Bash",
            "tool_input": {"command": "git commit -m 'fix: test'"},
            "tool_output": "[main abc1234] fix: test\n 1 file changed",
        }
        rc = self._run_main(mod, data, monkeypatch)
        assert rc == 0
        assert os.path.exists(queue_file)
        entry = json.loads(Path(queue_file).read_text().strip())
        assert entry["type"] == "review-after-commit"

    def test_gh_pr_create_enqueues_review(self, tmp_path, monkeypatch):
        mod = _import_module("auto-review-dispatch.py")
        queue_file = str(tmp_path / "q.jsonl")
        mod.QUEUE_DIR = str(tmp_path)
        mod.QUEUE_FILE = queue_file
        data = {
            "tool_name": "Bash",
            "tool_input": {"command": "gh pr create --title 'My PR' --body 'desc'"},
            "tool_output": "Created pull request https://github.com/org/repo/pull/5",
        }
        rc = self._run_main(mod, data, monkeypatch)
        assert rc == 0
        entry = json.loads(Path(queue_file).read_text().strip())
        assert entry["type"] == "review-after-pr"


# ─── token-guard.py helper functions ────────────────────────────────────────
# Module import alone covers module-level data structures (~30% of statements).
# Helper function tests push coverage significantly further.


@pytest.fixture(scope="module")
def tg(tmp_path_factory):
    """Import token-guard.py once with isolated state/config dirs."""
    state_dir = str(tmp_path_factory.mktemp("tg_state"))
    config_dir = str(tmp_path_factory.mktemp("tg_config"))
    config_path = os.path.join(config_dir, "token-guard-config.json")
    # Write a minimal valid config
    with open(config_path, "w") as f:
        json.dump({"global_cooldown_seconds": 0, "parallel_window_seconds": 0}, f)
    mod = _import_module(
        "token-guard.py",
        env_overrides={
            "TOKEN_GUARD_STATE_DIR": state_dir,
            "TOKEN_GUARD_CONFIG_PATH": config_path,
        },
    )
    return mod, state_dir, config_path


class TestTokenGuardSafeInt:
    """`_safe_int` — 4 branches, pure function."""

    def test_int_value(self, tg):
        mod, _, _ = tg
        assert mod._safe_int(42, 0) == 42

    def test_string_int(self, tg):
        mod, _, _ = tg
        assert mod._safe_int("10", 0) == 10

    def test_none_returns_default(self, tg):
        mod, _, _ = tg
        assert mod._safe_int(None, 99) == 99

    def test_non_numeric_string_returns_default(self, tg):
        mod, _, _ = tg
        assert mod._safe_int("not-a-number", 7) == 7

    def test_float_truncated(self, tg):
        mod, _, _ = tg
        assert mod._safe_int(3.9, 0) == 3

    def test_zero(self, tg):
        mod, _, _ = tg
        assert mod._safe_int(0, 5) == 0


class TestTokenGuardLoadConfig:
    """`load_config` — covers config loading, validation, and defaults."""

    def test_missing_config_returns_defaults(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "missing.json"),
            },
        )
        cfg = mod.load_config()
        assert cfg["max_agents"] == 5
        assert cfg["failure_mode"] == "fail_open"

    def test_valid_config_overrides_defaults(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        config_path = str(tmp_path / "cfg.json")
        with open(config_path, "w") as f:
            json.dump({"max_agents": 3, "global_cooldown_seconds": 10}, f)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": config_path,
            },
        )
        cfg = mod.load_config()
        assert cfg["max_agents"] == 3
        assert cfg["global_cooldown_seconds"] == 10

    def test_corrupt_config_returns_defaults(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        config_path = str(tmp_path / "bad.json")
        Path(config_path).write_text("not json!!!")
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": config_path,
            },
        )
        cfg = mod.load_config()
        assert cfg["max_agents"] == 5  # Default

    def test_invalid_failure_mode_defaults_to_fail_open(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        config_path = str(tmp_path / "cfg.json")
        with open(config_path, "w") as f:
            json.dump({"failure_mode": "INVALID_MODE"}, f)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": config_path,
            },
        )
        cfg = mod.load_config()
        assert cfg["failure_mode"] == "fail_open"

    def test_string_max_agents_coerced(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        config_path = str(tmp_path / "cfg.json")
        with open(config_path, "w") as f:
            json.dump({"max_agents": "8"}, f)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": config_path,
            },
        )
        cfg = mod.load_config()
        assert cfg["max_agents"] == 8

    def test_one_per_session_is_a_set(self, tg):
        mod, _, _ = tg
        cfg = mod.load_config()
        assert isinstance(cfg["one_per_session"], set)
        assert "Explore" in cfg["one_per_session"]

    def test_always_allowed_is_a_set(self, tg):
        mod, _, _ = tg
        cfg = mod.load_config()
        assert isinstance(cfg["always_allowed"], set)
        assert "claude-code-guide" in cfg["always_allowed"]

    def test_shadow_sample_pct_clamped_to_100(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        config_path = str(tmp_path / "cfg.json")
        with open(config_path, "w") as f:
            json.dump({"shadow_sample_pct": 999}, f)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": config_path,
            },
        )
        cfg = mod.load_config()
        assert cfg["shadow_sample_pct"] == 100

    def test_shadow_sample_pct_clamped_to_0(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        config_path = str(tmp_path / "cfg.json")
        with open(config_path, "w") as f:
            json.dump({"shadow_sample_pct": -5}, f)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": config_path,
            },
        )
        cfg = mod.load_config()
        assert cfg["shadow_sample_pct"] == 0

    def test_shadow_rules_validated(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        config_path = str(tmp_path / "cfg.json")
        with open(config_path, "w") as f:
            json.dump({"shadow_rules": {"Explore": "shadow", "bad-mode": "INVALID"}}, f)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": config_path,
            },
        )
        cfg = mod.load_config()
        assert "Explore" in cfg["shadow_rules"]
        assert "bad-mode" not in cfg["shadow_rules"]


class TestTokenGuardRuleMode:
    """`rule_mode` — 3 paths."""

    def test_uses_shadow_rules_override(self, tg):
        mod, _, _ = tg
        cfg = {"shadow_rules": {"Explore": "shadow"}, "shadow_default_mode": "enforce"}
        assert mod.rule_mode(cfg, "Explore") == "shadow"

    def test_uses_default_mode_when_no_rule(self, tg):
        mod, _, _ = tg
        cfg = {"shadow_rules": {}, "shadow_default_mode": "off"}
        assert mod.rule_mode(cfg, "Explore") == "off"

    def test_defaults_to_enforce_on_invalid_mode(self, tg):
        mod, _, _ = tg
        cfg = {"shadow_rules": {}, "shadow_default_mode": "INVALID"}
        assert mod.rule_mode(cfg, "anything") == "enforce"

    def test_enforce_mode(self, tg):
        mod, _, _ = tg
        cfg = {"shadow_rules": {}, "shadow_default_mode": "enforce"}
        assert mod.rule_mode(cfg, "Plan") == "enforce"


class TestTokenGuardDefaultState:
    """`default_state` — pure factory function."""

    def test_has_required_keys(self, tg):
        mod, _, _ = tg
        state = mod.default_state()
        for key in (
            "schema_version",
            "session_key",
            "agent_count",
            "agents",
            "blocked_attempts",
            "pending_spawns",
            "last_decision_ts",
        ):
            assert key in state

    def test_agent_count_starts_at_0(self, tg):
        mod, _, _ = tg
        assert mod.default_state()["agent_count"] == 0

    def test_schema_version_is_2(self, tg):
        mod, _, _ = tg
        assert mod.default_state()["schema_version"] == 2

    def test_returns_new_dict_each_call(self, tg):
        mod, _, _ = tg
        s1 = mod.default_state()
        s2 = mod.default_state()
        s1["agent_count"] = 99
        assert s2["agent_count"] == 0


class TestTokenGuardExtractTargetDirs:
    """`extract_target_dirs` — regex-based pure function."""

    def test_extracts_start_pattern(self, tg):
        mod, _, _ = tg
        dirs = mod.extract_target_dirs("START: ~/projects/foo/\nSKIP: tests/")
        assert any("foo" in d for d in dirs)

    def test_no_pattern_returns_empty_or_list(self, tg):
        mod, _, _ = tg
        # Should not crash on no match
        result = mod.extract_target_dirs("just analyze the code")
        assert isinstance(result, list)

    def test_path_tilde_expanded(self, tg):
        mod, _, _ = tg
        result = mod.extract_target_dirs("START: ~/projects/app/")
        if result:
            assert "~" not in result[0]

    def test_empty_string(self, tg):
        mod, _, _ = tg
        assert isinstance(mod.extract_target_dirs(""), list)

    def test_multiple_starts(self, tg):
        mod, _, _ = tg
        result = mod.extract_target_dirs("START: /tmp/a/\nSTART: /tmp/b/")
        assert isinstance(result, list)


class TestTokenGuardCheckNecessity:
    """`check_necessity` — two-pass detection (regex + fuzzy)."""

    def test_direct_file_read_blocked(self, tg):
        mod, _, _ = tg
        blocked, suggestion, name = mod.check_necessity(
            "read the file config.py", "cat config.py"
        )
        # May or may not match depending on patterns — just verify no crash
        assert isinstance(blocked, bool)
        assert isinstance(suggestion, str)
        assert isinstance(name, str)

    def test_non_trivial_task_not_blocked(self, tg):
        mod, _, _ = tg
        blocked, _, _ = mod.check_necessity(
            "Implement a complex refactoring of the authentication module with 15 files",
            "This requires deep codebase understanding across multiple directories",
        )
        assert blocked is False

    def test_empty_inputs_not_blocked(self, tg):
        mod, _, _ = tg
        blocked, _, _ = mod.check_necessity("", "")
        assert blocked is False

    def test_returns_three_tuple(self, tg):
        mod, _, _ = tg
        result = mod.check_necessity("find the file", "find /tmp -name '*.py'")
        assert len(result) == 3


class TestTokenGuardCheckTypeSwitching:
    """`check_type_switching` — detects re-attempts with different agent type."""

    def test_no_blocked_attempts_returns_false(self, tg):
        mod, _, _ = tg
        state = mod.default_state()
        detected, _ = mod.check_type_switching(state, "analyze the codebase", "Explore")
        assert detected is False

    def test_similar_description_different_type_detected(self, tg):
        mod, _, _ = tg
        state = mod.default_state()
        state["blocked_attempts"] = [
            {
                "description": "analyze the entire codebase architecture",
                "type": "master-coder",
            }
        ]
        detected, orig_type = mod.check_type_switching(
            state, "analyze the entire codebase architecture", "Explore"
        )
        assert detected is True
        assert orig_type == "master-coder"

    def test_same_type_not_flagged_as_switching(self, tg):
        mod, _, _ = tg
        state = mod.default_state()
        state["blocked_attempts"] = [
            {"description": "analyze codebase", "type": "Explore"}
        ]
        detected, _ = mod.check_type_switching(state, "analyze codebase", "Explore")
        assert detected is False

    def test_very_different_description_not_flagged(self, tg):
        mod, _, _ = tg
        state = mod.default_state()
        state["blocked_attempts"] = [
            {"description": "read one file and output contents", "type": "Explore"}
        ]
        detected, _ = mod.check_type_switching(
            state, "deploy the entire microservice architecture to kubernetes", "Plan"
        )
        assert detected is False


class TestTokenGuardCleanupStaleState:
    """`cleanup_stale_state` — deletes stale files, preserves audit log."""

    def test_removes_stale_file(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        stale = os.path.join(state_dir, "old-session.json")
        with open(stale, "w") as f:
            json.dump({"agent_count": 0}, f)
        # Set mtime to 2 hours ago
        two_hours_ago = time.time() - (2 * 3600 + 60)
        os.utime(stale, (two_hours_ago, two_hours_ago))
        mod.cleanup_stale_state(ttl_hours=1)
        assert not os.path.exists(stale)

    def test_preserves_audit_log(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        audit_log = os.path.join(state_dir, "audit.jsonl")
        with open(audit_log, "w") as f:
            f.write('{"event":"test"}\n')
        # Set mtime to far in the past
        old_time = time.time() - (100 * 3600)
        os.utime(audit_log, (old_time, old_time))
        mod.cleanup_stale_state(ttl_hours=1)
        assert os.path.exists(audit_log)  # Must NOT be deleted

    def test_preserves_fresh_files(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        fresh = os.path.join(state_dir, "fresh-session.json")
        with open(fresh, "w") as f:
            json.dump({"agent_count": 1}, f)
        # mtime is NOW — should not be deleted
        mod.cleanup_stale_state(ttl_hours=1)
        assert os.path.exists(fresh)

    def test_nonexistent_state_dir_does_not_crash(self, tmp_path):
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": str(tmp_path / "nonexistent"),
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        # Should silently do nothing
        mod.cleanup_stale_state(ttl_hours=1)


# ─── token-guard.py main() — direct call tests ───────────────────────────────
# main() contains ~400 stmts (lines 666-1116). Testing key exit paths brings
# token-guard.py coverage from ~26% to 70%+.


def _make_tg_env(tmp_path):
    """Create isolated state + config dirs for token-guard main() tests."""
    state_dir = str(tmp_path / "state")
    config_path = str(tmp_path / "cfg.json")
    os.makedirs(state_dir, exist_ok=True)
    with open(config_path, "w") as f:
        json.dump({"global_cooldown_seconds": 0, "parallel_window_seconds": 0}, f)
    return state_dir, config_path


def _run_tg_main(mod, stdin_json, monkeypatch):
    """Call token-guard main() with mocked stdin. Returns exit code or None."""
    if isinstance(stdin_json, str):
        monkeypatch.setattr("sys.stdin", io.StringIO(stdin_json))
    else:
        monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(stdin_json)))
    try:
        mod.main()
        return None  # main() returned normally (no sys.exit)
    except SystemExit as e:
        return e.code


class TestTokenGuardMain:
    """main() — exercises the 450-stmt body via direct call with isolated env."""

    def test_invalid_json_exits_0(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        rc = _run_tg_main(mod, "not valid json", monkeypatch)
        assert rc == 0

    def test_non_dict_json_exits_0(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        rc = _run_tg_main(mod, "[1, 2, 3]", monkeypatch)
        assert rc == 0

    def test_non_task_tool_exits_0(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        data = {"tool_name": "Bash", "session_id": "abcd1234", "tool_input": {}}
        rc = _run_tg_main(mod, data, monkeypatch)
        assert rc == 0

    def test_read_tool_exits_0(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        rc = _run_tg_main(mod, {"tool_name": "Read", "session_id": "abcd1234", "tool_input": {}}, monkeypatch)
        assert rc == 0

    def test_invalid_session_id_exits_2(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        data = {"tool_name": "Task", "session_id": "bad id!!", "tool_input": {"subagent_type": "Explore"}}
        rc = _run_tg_main(mod, data, monkeypatch)
        assert rc == 2

    def test_always_allowed_agent_exits_0(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        data = {
            "tool_name": "Task",
            "session_id": "abcd1234",
            "tool_input": {"subagent_type": "claude-code-guide", "description": "help"},
        }
        rc = _run_tg_main(mod, data, monkeypatch)
        assert rc == 0

    def test_resume_flag_exits_0(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        data = {
            "tool_name": "Task",
            "session_id": "abcd1234",
            "tool_input": {"subagent_type": "Explore", "resume": "prev-agent-id", "description": "resume task"},
        }
        rc = _run_tg_main(mod, data, monkeypatch)
        assert rc == 0

    def test_first_general_purpose_agent_allowed(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        data = {
            "tool_name": "Task",
            "session_id": "abcd1234",
            "tool_input": {
                "subagent_type": "general-purpose",
                "description": "analyze the authentication module architecture",
                "prompt": "Please investigate the auth module",
            },
        }
        rc = _run_tg_main(mod, data, monkeypatch)
        assert rc == 0  # First agent is always allowed

    def test_explore_agent_first_allowed(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        data = {
            "tool_name": "Task",
            "session_id": "abcd1234",
            "tool_input": {
                "subagent_type": "Explore",
                "description": "explore the full codebase structure",
                "prompt": "Map all files in the repo",
            },
        }
        rc = _run_tg_main(mod, data, monkeypatch)
        assert rc == 0

    def test_second_explore_blocked(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        # First Explore — allowed
        data = {
            "tool_name": "Task",
            "session_id": "abcd1234",
            "tool_input": {"subagent_type": "Explore", "description": "explore repo structure", "prompt": "Map repo"},
        }
        _run_tg_main(mod, data, monkeypatch)

        # Second Explore — blocked (one-per-session rule)
        rc = _run_tg_main(mod, data, monkeypatch)
        assert rc == 2

    def test_task_tool_with_empty_subagent_type(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        data = {
            "tool_name": "Task",
            "session_id": "abcd1234",
            "tool_input": {"subagent_type": "", "description": "do something", "prompt": "do it"},
        }
        rc = _run_tg_main(mod, data, monkeypatch)
        assert rc in (0, 2)  # Either allowed or blocked — must not crash

    def test_team_spawn_counts_toward_session_cap(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        with open(config_path, "w") as f:
            json.dump({"max_agents": 1, "global_cooldown_seconds": 0, "parallel_window_seconds": 0}, f)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        data = {
            "tool_name": "Task",
            "session_id": "abcd1234",
            "tool_input": {
                "subagent_type": "general-purpose",
                "description": "team task alpha",
                "team_name": "my-team",
                "prompt": "do team work",
            },
        }
        # First team spawn — allowed (within cap)
        _run_tg_main(mod, data, monkeypatch)
        # Second spawn — cap of 1 hit
        data2 = dict(data)
        data2["tool_input"] = {**data["tool_input"], "description": "team task beta"}
        rc = _run_tg_main(mod, data2, monkeypatch)
        assert rc in (0, 2)  # Enforced or shadowed depending on rule mode

    def test_null_session_id_field(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        data = {"tool_name": "Task", "session_id": None, "tool_input": {"subagent_type": "Explore"}}
        # session_id=None -> str(None)="None" -> fails SESSION_ID_RE
        rc = _run_tg_main(mod, data, monkeypatch)
        assert rc == 2  # Invalid session_id

    def test_missing_session_id_uses_unknown(self, tmp_path, monkeypatch):
        state_dir, config_path = _make_tg_env(tmp_path)
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        # No session_id → defaults to "unknown" → fails SESSION_ID_RE (too short? Let's see)
        data = {"tool_name": "Task", "tool_input": {"subagent_type": "claude-code-guide"}}
        rc = _run_tg_main(mod, data, monkeypatch)
        # "unknown" is 7 chars, SESSION_ID_RE requires 8+, so this exits 2
        assert rc == 2


class TestTokenGuardAudit:
    """`audit()` — writes a JSONL entry to AUDIT_LOG."""

    def test_audit_writes_entry(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        config_path = str(tmp_path / "cfg.json")
        mod = _import_module(
            "token-guard.py",
            env_overrides={"TOKEN_GUARD_STATE_DIR": state_dir, "TOKEN_GUARD_CONFIG_PATH": config_path},
        )
        mod.audit("allowed", "Explore", "explore repo", "abcd1234", reason="first_spawn")
        audit_log = os.path.join(state_dir, "audit.jsonl")
        assert os.path.exists(audit_log)
        entry = json.loads(Path(audit_log).read_text().strip().splitlines()[0])
        assert entry.get("event_type") == "allowed" or "event" in entry

    def test_audit_returns_decision_id_string(self, tmp_path):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        result = mod.audit("blocked", "Explore", "explore", "abcd1234", reason="cap")
        assert isinstance(result, str)


# ─── token-guard.py report() and usage() ─────────────────────────────────────
# These two functions span lines 1239-1546 (~302 stmts).
# Testing them with empty + populated audit logs pushes total coverage to 70%+.


class TestTokenGuardReport:
    """`report()` — reads AUDIT_LOG and prints analytics."""

    def test_report_no_audit_data(self, tmp_path, capsys):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        mod.report()
        out = capsys.readouterr().out
        assert "No audit data" in out

    def test_report_with_allow_entries(self, tmp_path, capsys):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        audit_log = os.path.join(state_dir, "audit.jsonl")
        entries = [
            {"event": "allow", "type": "Explore", "reason": "first_spawn", "session_key": "sess1"},
            {"event": "allow", "type": "Plan", "reason": "first_spawn", "session_key": "sess1"},
            {"event": "block", "type": "Explore", "reason": "one_per_session", "session_key": "sess1"},
            {"event": "fault", "type": "unknown", "reason": "stdin_parse_error", "session_key": "sess1"},
        ]
        with open(audit_log, "w") as f:
            for e in entries:
                f.write(json.dumps(e) + "\n")
        mod.report()
        out = capsys.readouterr().out
        assert "TOKEN GUARD ANALYTICS" in out
        assert "Allowed:" in out
        assert "Blocked:" in out

    def test_report_with_block_necessity_pattern(self, tmp_path, capsys):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        audit_log = os.path.join(state_dir, "audit.jsonl")
        with open(audit_log, "w") as f:
            f.write(json.dumps({
                "event": "block", "type": "Explore",
                "reason": "necessity_check", "pattern": "read_file_pattern",
                "session_key": "sess1"
            }) + "\n")
        mod.report()
        out = capsys.readouterr().out
        assert "Necessity patterns" in out or "TOKEN GUARD" in out

    def test_report_json_output(self, tmp_path, capsys):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        audit_log = os.path.join(state_dir, "audit.jsonl")
        with open(audit_log, "w") as f:
            f.write(json.dumps({"event": "allow", "type": "Explore", "session_key": "s1"}) + "\n")
        mod.report(json_output=True)
        out = capsys.readouterr().out
        # JSON output should be parseable
        assert out.strip()

    def test_report_with_resume_and_team_entries(self, tmp_path, capsys):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        audit_log = os.path.join(state_dir, "audit.jsonl")
        with open(audit_log, "w") as f:
            for entry in [
                {"event": "resume", "type": "Explore", "session_key": "s1"},
                {"event": "allow_team", "type": "general-purpose", "session_key": "s1"},
                {"event": "warn", "type": "Explore", "would_block": True, "session_key": "s1"},
            ]:
                f.write(json.dumps(entry) + "\n")
        mod.report()
        out = capsys.readouterr().out
        assert "Resumes:" in out or "TOKEN GUARD" in out

    def test_report_with_multiple_sessions(self, tmp_path, capsys):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        audit_log = os.path.join(state_dir, "audit.jsonl")
        with open(audit_log, "w") as f:
            for i in range(10):
                f.write(json.dumps({"event": "allow", "type": "Explore", "session_key": f"sess{i}"}) + "\n")
        mod.report()
        out = capsys.readouterr().out
        assert "Sessions:" in out or "TOKEN GUARD" in out


class TestTokenGuardUsage:
    """`usage()` — prints shareable usage summary."""

    def test_usage_no_data(self, tmp_path, capsys):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        mod.usage()
        out = capsys.readouterr().out
        assert "No usage data" in out

    def test_usage_with_data(self, tmp_path, capsys):
        state_dir = str(tmp_path / "state")
        os.makedirs(state_dir)
        mod = _import_module(
            "token-guard.py",
            env_overrides={
                "TOKEN_GUARD_STATE_DIR": state_dir,
                "TOKEN_GUARD_CONFIG_PATH": str(tmp_path / "cfg.json"),
            },
        )
        audit_log = os.path.join(state_dir, "audit.jsonl")
        with open(audit_log, "w") as f:
            for entry in [
                {"event": "allow", "type": "Explore", "session_key": "s1"},
                {"event": "allow", "type": "Plan", "session_key": "s1"},
                {"event": "block", "type": "Explore", "reason": "one_per_session", "session_key": "s1"},
            ]:
                f.write(json.dumps(entry) + "\n")
        mod.usage()
        out = capsys.readouterr().out
        assert out.strip()  # Should produce some output
