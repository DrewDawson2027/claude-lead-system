# Claude Lead System — Manifest

Registry of all agents, hooks, coordinator modules, and native integration. Source of truth for the lead system architecture.

---

## Agents

| Agent            | File                                   | Model  | Memory    | Skills                                 | Role                                        |
| ---------------- | -------------------------------------- | ------ | --------- | -------------------------------------- | ------------------------------------------- |
| code-architect   | `~/.claude/agents/code-architect.md`   | Sonnet | `project` | `codebase-overview`, `security-review` | Architecture decisions, ADRs, system design |
| code-simplifier  | `~/.claude/agents/code-simplifier.md`  | Sonnet | `local`   | —                                      | Post-build code simplification              |
| fp-checker       | `~/.claude/agents/fp-checker.md`       | Haiku  | —         | —                                      | False positive check after reviews          |
| practice-creator | `~/.claude/agents/practice-creator.md` | Sonnet | `user`    | `learn`                                | Learning exercises and quizzes              |
| quick-reviewer   | `~/.claude/agents/quick-reviewer.md`   | Haiku  | `local`   | —                                      | Post-commit auto-review                     |
| reviewer         | `~/.claude/agents/reviewer.md`         | Sonnet | `user`    | `security-review`                      | Security-aware deep code review             |
| scout            | `~/.claude/agents/scout.md`            | Haiku  | —         | —                                      | File lookup and codebase search             |
| verify-app       | `~/.claude/agents/verify-app.md`       | Sonnet | `local`   | `test-and-fix`                         | Post-build verification and testing         |

### Worker Role Presets (coordinator)

| Role        | Agent          | Model  | Permission Mode | Isolate |
| ----------- | -------------- | ------ | --------------- | ------- |
| researcher  | scout          | Haiku  | readOnly        | false   |
| implementer | _(general)_    | Sonnet | acceptEdits     | true    |
| reviewer    | reviewer       | Sonnet | readOnly        | false   |
| planner     | code-architect | Sonnet | planOnly        | false   |

---

## Lifecycle Hooks

| Hook Event        | Script                     | Purpose                                                   |
| ----------------- | -------------------------- | --------------------------------------------------------- |
| SubagentStart     | `agent-lifecycle.sh`       | Logs agent spawn timestamp for duration tracking          |
| SubagentStop      | `agent-lifecycle.sh`       | Logs agent completion with duration calculation           |
| PreCompact        | `pre-compact-save.sh`      | Saves session state before context compaction             |
| PreToolUse (Task) | `token-guard.py`           | Enforces agent caps, necessity scoring, cooldowns         |
| PreToolUse (Read) | `read-efficiency-guard.py` | Blocks duplicate/sequential reads                         |
| SessionStart      | `session-register.sh`      | Registers session, bootstraps cache                       |
| SessionStart      | `self-heal.py`             | Validates 60+ checks, auto-repairs config                 |
| TeammateIdle      | `teammate-lifecycle.sh`    | Logs teammate idle events to activity/session telemetry   |
| TaskCompleted     | `teammate-lifecycle.sh`    | Logs task completion events to activity/session telemetry |

Metrics log: `~/.claude/hooks/session-state/agent-metrics.jsonl`
Compaction log: `~/.claude/session-cache/compaction-log.jsonl`

---

## Prompt Caching Architecture

The lead system uses lightweight agent files (`~/.claude/agents/*.md`) with YAML frontmatter. Agents with `memory:` enabled persist learning across sessions. Agents with `skills:` get specialized capabilities injected automatically.

---

## Execution Paths

The lead system supports two execution paths for teams:

| Execution Path | Evidence Label | How Workers Run                   | Messaging          | P2P | Resume                 |
| -------------- | -------------- | --------------------------------- | ------------------ | --- | ---------------------- |
| `coordinator`  | `verified`     | MCP-spawned `claude -p` processes | Inbox files (poll) | No  | Summary re-injection   |
| `hybrid`       | `experimental` | MCP-spawned with extended events  | Push + inbox       | Yes | agentId when available |

### Hook Event Schemas

Hooks accept two event payload schemas from Claude Code:

| Hook                | Coordinator Fields                                                      | Extended Fields                                                |
| ------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `teammate-idle.py`  | `teammate_id`, `task`, `output`, `files_changed`                        | `teammate_name`, `task_in_progress`, `idle_reason`             |
| `task-completed.py` | `task`, `task_id`, `completion_message`, `files_changed`, `teammate_id` | `task_title`, `task_id`, `assignee`, `completion_time_seconds` |

### Push-Based Message Delivery

On `hybrid` path, `handleSendMessage` queues a native action at `~/.claude/lead-sidecar/runtime/actions/pending/` in addition to writing the inbox file. The lead session picks up queued actions and translates them to `SendMessage` calls.

### Agent Resume via agentId

Team members store an `agentId` field. When re-dispatching to a member with an existing `agentId` on a `hybrid` team, the system passes `resume_agent_id` to preserve full context instead of re-injecting summaries.

---

## Quality Gates

| Test Suite       | File                             | Tests  | Coverage                                                                                              |
| ---------------- | -------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| Functional hooks | `tests/test_functional_hooks.py` | 59     | teammate-idle, task-completed, trust_audit, agent-metrics, result-compressor, hook-audit, hook-health |
| Coordinator E2E  | `mcp-coordinator/test/`          | varies | workers, tasks, teams, messaging, pipelines                                                           |

---

## How to Extend

### Adding a new agent

1. Create `~/.claude/agents/{agent-name}.md` with YAML frontmatter (`name`, `description`, `tools`, `model`, optionally `memory` and `skills`)
2. Update this MANIFEST.md agent table
3. If the agent maps to a worker role, update `ROLE_PRESETS` in `mcp-coordinator/lib/workers.js`

### Adding a new hook

1. Create hook script in `hooks/` directory
2. Wire into `settings.json` or `settings.local.json` hooks config
3. Add tests to `tests/test_functional_hooks.py`
4. Update this MANIFEST.md hook table

---

## Development Hooks

Git hooks that enforce code quality locally before commits reach CI.

| Hook         | File                    | Trigger      | Purpose                                                                                                                                                        |
| ------------ | ----------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | `.git/hooks/pre-commit` | `git commit` | Runs `node --check` on all staged `.js` and `.mjs` files. Blocks the commit if any file has a syntax error and prints the offending file path + Node.js error. |

**Note:** Git hooks are not tracked by version control (`.git/` is excluded from commits). To install the pre-commit hook on a fresh clone, copy `.git/hooks/pre-commit` from an existing clone or add a `scripts/install-hooks.sh` script.
