# Token Management Compatibility Matrix

## Runtime Components
- Hook runtime: Python 3.10+
- MCP coordinator: Node.js 18+ (tested on 18, 20)
- Shell tooling: `bash`, `jq`
- Claude Code hooks: PreToolUse / SubagentStart / SubagentStop / SessionStart / PreCompact supported

## OS Matrix
- macOS: supported (primary environment)
- Linux: supported (shell + Python + Node flows)
- Windows: partial for hook Python scripts; shell hook behavior depends on Git Bash/WSL

## Data Compatibility
- Audit log: mixed v1/v2 readable
- Agent metrics: mixed untagged/v2 tagged readable
- Session state: legacy + v2 tolerated
- Cost trends: legacy `today/week/month` fields preserved + `rollingSeries` added

## Command Compatibility
- Legacy `cost_runtime.py` subcommands: supported with deprecation hints
- Legacy `coord_cost_*` MCP tools: supported with deprecation metadata payloads
- Legacy `token-guard.py --session-recap`: supported, forwards to recap module

## Failure Mode Compatibility
- Hook default mode remains `fail_open`
- Strict mode remains opt-in (`failure_mode=fail_closed`)
- Proactive alerts are non-blocking and deduped

## Known Caveats
- Large local usage corpora can slow cost aggregation; `ops today` uses cache and short timeouts to degrade gracefully.
- `ccusage` backend timeouts fall back to local parsing.
