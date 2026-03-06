"""Functional tests for the chain automation scripts (Problem 2).

Covers the three Python chain scripts and one shell dispatcher:
  1. auto-review-dispatch.py  — PostToolUse: git commit/gh pr → enqueue action
  2. build-chain-dispatcher.py — SubagentStop: build/review agent → enqueue chain
  3. chain-advance.py          — Advances a chain state file to the next step

Each test runs the script as a subprocess with an isolated HOME/state dir,
verifying queue files, flag files, chain state files, and exit codes.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOKS_DIR = os.path.join(_REPO_ROOT, "hooks")


# ─────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ─────────────────────────────────────────────────────────────────────────────


def run_py(script_name, stdin_data, env, args=None, timeout=10):
    """Run a Python hook. Returns (exit_code, stdout, stderr)."""
    script = os.path.join(HOOKS_DIR, script_name)
    if isinstance(stdin_data, dict):
        stdin_data = json.dumps(stdin_data)
    cmd = [sys.executable, script] + (args or [])
    result = subprocess.run(
        cmd,
        input=stdin_data,
        capture_output=True,
        text=True,
        env=env,
        timeout=timeout,
    )
    return result.returncode, result.stdout, result.stderr


@pytest.fixture
def isolated_env(tmp_path):
    """Isolated HOME + state dir. Returns (env, queue_file, state_dir)."""
    state_dir = tmp_path / ".claude" / "hooks" / "session-state"
    state_dir.mkdir(parents=True)
    queue_file = state_dir / "mandatory-actions.jsonl"

    env = os.environ.copy()
    env["HOME"] = str(tmp_path)
    env["PYTHONPATH"] = HOOKS_DIR + os.pathsep + env.get("PYTHONPATH", "")
    return env, queue_file, state_dir


def read_queue(queue_file):
    """Read all actions from the mandatory-actions queue. Returns list of dicts."""
    if not queue_file.exists():
        return []
    actions = []
    for line in queue_file.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                actions.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return actions


# ─────────────────────────────────────────────────────────────────────────────
# 1. auto-review-dispatch.py
# ─────────────────────────────────────────────────────────────────────────────


class TestAutoReviewDispatch:
    """auto-review-dispatch.py: PostToolUse hook that enqueues mandatory review actions."""

    def test_non_bash_tool_does_nothing(self, isolated_env):
        """Non-Bash tools should be silently ignored (exit 0, nothing enqueued)."""
        env, queue_file, _ = isolated_env
        payload = {
            "tool_name": "Read",
            "tool_input": {"command": ""},
            "tool_output": "",
        }
        code, _, _ = run_py("auto-review-dispatch.py", payload, env)
        assert code == 0
        assert not queue_file.exists() or read_queue(queue_file) == []

    def test_bash_without_git_commit_does_nothing(self, isolated_env):
        """Bash calls that are not git commit should be ignored."""
        env, queue_file, _ = isolated_env
        payload = {
            "tool_name": "Bash",
            "tool_input": {"command": "ls -la"},
            "tool_output": "total 0",
        }
        code, _, _ = run_py("auto-review-dispatch.py", payload, env)
        assert code == 0
        assert read_queue(queue_file) == []

    def test_git_commit_with_nothing_to_commit_does_nothing(self, isolated_env):
        """'nothing to commit' in output → no review enqueued."""
        env, queue_file, _ = isolated_env
        payload = {
            "tool_name": "Bash",
            "tool_input": {"command": "git commit -m 'test'"},
            "tool_output": "On branch main\nnothing to commit, working tree clean",
        }
        code, _, _ = run_py("auto-review-dispatch.py", payload, env)
        assert code == 0
        assert read_queue(queue_file) == []

    def test_failed_git_commit_does_nothing(self, isolated_env):
        """Commit without [branch hash] pattern in output → no review enqueued."""
        env, queue_file, _ = isolated_env
        payload = {
            "tool_name": "Bash",
            "tool_input": {"command": "git commit -m 'test'"},
            "tool_output": "error: commit-msg hook rejected the commit",
        }
        code, _, _ = run_py("auto-review-dispatch.py", payload, env)
        assert code == 0
        assert read_queue(queue_file) == []

    def test_successful_git_commit_enqueues_review(self, isolated_env):
        """Successful commit with [branch abc1234] pattern → review action enqueued."""
        env, queue_file, _ = isolated_env
        payload = {
            "tool_name": "Bash",
            "tool_input": {"command": "git commit -m 'feat: add tests'"},
            "tool_output": "[main abc1234] feat: add tests\n 2 files changed, 50 insertions(+)",
        }
        code, stdout, _ = run_py("auto-review-dispatch.py", payload, env)
        assert code == 0
        actions = read_queue(queue_file)
        assert (
            len(actions) >= 1
        ), "review action must be enqueued after successful commit"
        action = actions[-1]
        assert action["type"] == "review-after-commit"
        assert "AUTO-REVIEW TRIGGERED" in action["instruction"]
        assert action["status"] == "pending"

    def test_successful_commit_writes_review_pending_flag(self, isolated_env):
        """Successful commit must also write the review-pending flag file."""
        env, queue_file, state_dir = isolated_env
        payload = {
            "tool_name": "Bash",
            "tool_input": {"command": "git commit -m 'chore: cleanup'"},
            "tool_output": "[feature/x 7f3a8b2] chore: cleanup\n 1 file changed",
        }
        run_py("auto-review-dispatch.py", payload, env)
        flag_path = state_dir / "review-pending"
        assert flag_path.exists(), "review-pending flag must be written after commit"
        data = json.loads(flag_path.read_text())
        assert "action_id" in data
        assert "created_at" in data

    def test_gh_pr_create_enqueues_review(self, isolated_env):
        """gh pr create command → review-after-pr action enqueued."""
        env, queue_file, _ = isolated_env
        payload = {
            "tool_name": "Bash",
            "tool_input": {"command": "gh pr create --title 'My PR' --body 'desc'"},
            "tool_output": "https://github.com/owner/repo/pull/42\nCreated pull request #42",
        }
        code, _, _ = run_py("auto-review-dispatch.py", payload, env)
        assert code == 0
        actions = read_queue(queue_file)
        assert len(actions) >= 1
        action = actions[-1]
        assert action["type"] == "review-after-pr"
        assert "AUTO-REVIEW TRIGGERED" in action["instruction"]

    def test_malformed_json_exits_0(self, isolated_env):
        """Malformed JSON input → graceful exit 0 (non-blocking)."""
        env, queue_file, _ = isolated_env
        code, _, _ = run_py("auto-review-dispatch.py", "not json {[", env)
        assert code == 0

    def test_enqueued_action_has_required_fields(self, isolated_env):
        """Every enqueued action must have id, type, instruction, created_at, status."""
        env, queue_file, _ = isolated_env
        payload = {
            "tool_name": "Bash",
            "tool_input": {"command": "git commit -m 'fix: bug'"},
            "tool_output": "[main deadbee] fix: bug\n 1 file changed",
        }
        run_py("auto-review-dispatch.py", payload, env)
        actions = read_queue(queue_file)
        assert actions, "expected at least one action"
        action = actions[-1]
        for field in ("id", "type", "instruction", "created_at", "status"):
            assert field in action, f"action missing required field: {field}"

    def test_stdout_prints_instruction_immediately(self, isolated_env):
        """The instruction must also print to stdout for immediate delivery."""
        env, queue_file, _ = isolated_env
        payload = {
            "tool_name": "Bash",
            "tool_input": {"command": "git commit -m 'feat: x'"},
            "tool_output": "[main abcdef1] feat: x\n 3 files changed",
        }
        _, stdout, _ = run_py("auto-review-dispatch.py", payload, env)
        assert "AUTO-REVIEW TRIGGERED" in stdout


# ─────────────────────────────────────────────────────────────────────────────
# 2. build-chain-dispatcher.py
# ─────────────────────────────────────────────────────────────────────────────


class TestBuildChainDispatcher:
    """build-chain-dispatcher.py: SubagentStop → enqueue build chain or fp-checker."""

    def test_empty_agent_text_skips(self, isolated_env):
        """Empty agent name/desc → silently skip (no action enqueued)."""
        env, queue_file, _ = isolated_env
        payload = {"agent_name": "", "description": "", "subagent_type": ""}
        code, _, _ = run_py("build-chain-dispatcher.py", payload, env)
        assert code == 0
        assert read_queue(queue_file) == []

    def test_skip_keyword_agent_skips(self, isolated_env):
        """code-simplifier, verify-app, scout etc. should be silently skipped."""
        env, queue_file, _ = isolated_env
        for skip_type in (
            "code-simplifier",
            "verify-app",
            "scout",
            "fp-checker",
            "explore",
        ):
            payload = {
                "agent_name": skip_type,
                "description": f"running {skip_type}",
                "subagent_type": skip_type,
            }
            run_py("build-chain-dispatcher.py", payload, env)
        # Nothing should be enqueued for any skip agent
        assert read_queue(queue_file) == []

    def test_review_agent_enqueues_fp_checker(self, isolated_env):
        """quick-reviewer completing → fp-checker action enqueued."""
        env, queue_file, _ = isolated_env
        payload = {
            "agent_name": "quick-reviewer",
            "description": "review the latest commit",
            "subagent_type": "quick-reviewer",
        }
        code, _, _ = run_py("build-chain-dispatcher.py", payload, env)
        assert code == 0
        actions = read_queue(queue_file)
        assert len(actions) >= 1
        action = actions[-1]
        assert action["type"] == "fp-checker-after-review"
        assert (
            "fp-checker" in action["instruction"].lower()
            or "FP-CHECKER" in action["instruction"]
        )

    def test_review_agent_clears_review_pending_flag(self, isolated_env):
        """When a review agent completes, the review-pending flag should be removed."""
        env, queue_file, state_dir = isolated_env
        flag_path = state_dir / "review-pending"
        flag_path.write_text('{"action_id": "test-123"}')
        assert flag_path.exists()

        payload = {
            "agent_name": "reviewer",
            "description": "code reviewer",
            "subagent_type": "reviewer",
        }
        run_py("build-chain-dispatcher.py", payload, env)
        assert (
            not flag_path.exists()
        ), "review-pending flag must be cleared after review agent"

    def test_build_agent_type_creates_chain_state(self, isolated_env):
        """general-purpose agent type → chain state JSON file created in chains/ dir."""
        env, queue_file, state_dir = isolated_env
        payload = {
            "agent_name": "general-purpose",
            "description": "implement the new feature",
            "subagent_type": "general-purpose",
        }
        code, _, _ = run_py("build-chain-dispatcher.py", payload, env)
        assert code == 0
        chains_dir = state_dir / "chains"
        assert chains_dir.exists(), "chains/ directory must be created"
        chain_files = list(chains_dir.glob("chain-*.json"))
        assert len(chain_files) >= 1, "chain state file must be created"
        chain = json.loads(chain_files[0].read_text())
        assert chain["type"] == "build"
        assert len(chain["steps"]) == 2
        assert chain["steps"][0]["name"] == "code-simplifier"
        assert chain["steps"][1]["name"] == "verify-app"

    def test_build_agent_enqueues_code_simplifier_step(self, isolated_env):
        """Build agent → first action enqueued is code-simplifier."""
        env, queue_file, state_dir = isolated_env
        payload = {
            "agent_name": "vibe-coder",
            "description": "build the API endpoint",
            "subagent_type": "vibe-coder",
        }
        code, stdout, _ = run_py("build-chain-dispatcher.py", payload, env)
        assert code == 0
        actions = read_queue(queue_file)
        assert len(actions) >= 1
        action = actions[-1]
        assert action["type"] == "chain-step"
        assert "code-simplifier" in action["instruction"]
        assert "BUILD CHAIN TRIGGERED" in stdout

    def test_build_agent_chain_has_chain_id(self, isolated_env):
        """Chain state and action must both reference the same chain_id."""
        env, queue_file, state_dir = isolated_env
        payload = {
            "agent_name": "master-coder",
            "description": "write the feature",
            "subagent_type": "master-coder",
        }
        run_py("build-chain-dispatcher.py", payload, env)
        chains_dir = state_dir / "chains"
        chain_files = list(chains_dir.glob("chain-*.json"))
        assert chain_files
        chain = json.loads(chain_files[0].read_text())
        chain_id = chain.get("chain_id", "")
        assert chain_id.startswith("chain-")

        actions = read_queue(queue_file)
        assert actions
        action = actions[-1]
        # The action should have the chain_id patched in
        assert action.get("chain_id") == chain_id

    def test_unknown_non_build_agent_skips(self, isolated_env):
        """An agent not in BUILD_AGENTS and not a reviewer → silently skip."""
        env, queue_file, _ = isolated_env
        payload = {
            "agent_name": "data-analyst",
            "description": "analyze the data",
            "subagent_type": "data-analyst",
        }
        code, _, _ = run_py("build-chain-dispatcher.py", payload, env)
        assert code == 0
        assert read_queue(queue_file) == []

    def test_malformed_json_exits_0(self, isolated_env):
        env, queue_file, _ = isolated_env
        code, _, _ = run_py("build-chain-dispatcher.py", "bad input {", env)
        assert code == 0


# ─────────────────────────────────────────────────────────────────────────────
# 3. chain-advance.py
# ─────────────────────────────────────────────────────────────────────────────


class TestChainAdvance:
    """chain-advance.py: CLI tool that advances a chain state file by one step."""

    def _write_chain(self, tmp_path, steps, current_step=0, chain_id=None):
        """Write a chain state JSON file and return its path."""
        chains_dir = tmp_path / "chains"
        chains_dir.mkdir(parents=True, exist_ok=True)
        cid = chain_id or "chain-abc12345"
        chain = {
            "chain_id": cid,
            "type": "build",
            "steps": [{"name": s, "status": "pending"} for s in steps],
            "current_step": current_step,
            "created_at": "2026-03-05T00:00:00Z",
            "trigger_agent": "general-purpose",
        }
        chain_path = chains_dir / f"{cid}.json"
        chain_path.write_text(json.dumps(chain, indent=2))
        return chain_path

    def test_no_args_exits_1(self):
        """Running with no arguments should exit 1."""
        script = os.path.join(HOOKS_DIR, "chain-advance.py")
        result = subprocess.run(
            [sys.executable, script],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert result.returncode == 1

    def test_nonexistent_file_exits_1(self, tmp_path):
        """Passing a nonexistent chain file path should exit 1."""
        script = os.path.join(HOOKS_DIR, "chain-advance.py")
        result = subprocess.run(
            [sys.executable, script, str(tmp_path / "nonexistent.json")],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert result.returncode == 1

    def test_malformed_chain_json_exits_1(self, tmp_path):
        """Malformed JSON in chain file should exit 1."""
        bad_file = tmp_path / "bad-chain.json"
        bad_file.write_text("this is not json {[")
        script = os.path.join(HOOKS_DIR, "chain-advance.py")
        result = subprocess.run(
            [sys.executable, script, str(bad_file)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert result.returncode == 1

    def test_advances_step_0_to_step_1(self, tmp_path):
        """With 2 steps at step 0: marks step 0 done, advances to step 1, prints next action."""
        chain_path = self._write_chain(
            tmp_path, ["code-simplifier", "verify-app"], current_step=0
        )
        script = os.path.join(HOOKS_DIR, "chain-advance.py")
        result = subprocess.run(
            [sys.executable, script, str(chain_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert result.returncode == 0
        # Stdout should be a JSON action for the next step
        output = result.stdout.strip()
        assert output, "should print next step action JSON"
        action = json.loads(output)
        assert action["type"] == "chain-step"
        assert "verify-app" in action["instruction"]
        # Chain file should be updated
        chain = json.loads(chain_path.read_text())
        assert chain["steps"][0]["status"] == "done"
        assert chain["current_step"] == 1

    def test_advances_to_final_step_marks_complete(self, tmp_path):
        """At step 1 of 2: marks done, advances pointer, chain gets completed_at, no next action."""
        chain_path = self._write_chain(
            tmp_path, ["code-simplifier", "verify-app"], current_step=1
        )
        script = os.path.join(HOOKS_DIR, "chain-advance.py")
        result = subprocess.run(
            [sys.executable, script, str(chain_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert result.returncode == 0
        # No next action — stdout should be empty or not a valid chain action
        output = result.stdout.strip()
        assert output == "" or ("verify-app" not in output)
        # Chain should show completed
        chain = json.loads(chain_path.read_text())
        assert chain["steps"][1]["status"] == "done"
        assert chain["current_step"] == 2
        assert "completed_at" in chain

    def test_step_gets_completed_at_timestamp(self, tmp_path):
        """The completed step must have a completed_at timestamp."""
        chain_path = self._write_chain(
            tmp_path, ["code-simplifier", "verify-app"], current_step=0
        )
        script = os.path.join(HOOKS_DIR, "chain-advance.py")
        subprocess.run(
            [sys.executable, script, str(chain_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        chain = json.loads(chain_path.read_text())
        assert "completed_at" in chain["steps"][0]

    def test_action_includes_chain_id(self, tmp_path):
        """The printed next-step action must include the chain_id."""
        chain_path = self._write_chain(
            tmp_path,
            ["code-simplifier", "verify-app"],
            current_step=0,
            chain_id="chain-test999",
        )
        script = os.path.join(HOOKS_DIR, "chain-advance.py")
        result = subprocess.run(
            [sys.executable, script, str(chain_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert result.returncode == 0
        action = json.loads(result.stdout.strip())
        assert action.get("chain_id") == "chain-test999"

    def test_action_has_required_fields(self, tmp_path):
        """Printed action must have id, type, chain_id, instruction, created_at, status."""
        chain_path = self._write_chain(
            tmp_path, ["code-simplifier", "verify-app"], current_step=0
        )
        script = os.path.join(HOOKS_DIR, "chain-advance.py")
        result = subprocess.run(
            [sys.executable, script, str(chain_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        action = json.loads(result.stdout.strip())
        for field in ("id", "type", "chain_id", "instruction", "created_at", "status"):
            assert field in action, f"action missing required field: {field}"

    def test_action_id_stored_in_chain_state(self, tmp_path):
        """The action_id printed should also appear in the chain state for the next step."""
        chain_path = self._write_chain(
            tmp_path, ["code-simplifier", "verify-app"], current_step=0
        )
        script = os.path.join(HOOKS_DIR, "chain-advance.py")
        result = subprocess.run(
            [sys.executable, script, str(chain_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        action = json.loads(result.stdout.strip())
        chain = json.loads(chain_path.read_text())
        assert chain["steps"][1].get("action_id") == action["id"]

    def test_single_step_chain_completes_immediately(self, tmp_path):
        """1-step chain at step 0: marks done, prints no next action, marks complete."""
        chain_path = self._write_chain(tmp_path, ["verify-app"], current_step=0)
        script = os.path.join(HOOKS_DIR, "chain-advance.py")
        result = subprocess.run(
            [sys.executable, script, str(chain_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert result.returncode == 0
        assert result.stdout.strip() == ""
        chain = json.loads(chain_path.read_text())
        assert "completed_at" in chain
