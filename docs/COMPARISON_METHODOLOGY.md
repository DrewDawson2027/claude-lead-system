# Cost Comparison Methodology

How the README cost comparison numbers were calculated.

## Pricing Used

As of February 2026 (Anthropic pricing page):

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| Claude Opus | $15.00 | $75.00 |
| Claude Sonnet | $3.00 | $15.00 |

## Assumptions

### Task scenario
- Moderately complex feature build (e.g., "add error handling to API endpoints")
- 2 parallel workers + 1 lead session
- Each worker handles a focused subtask and exits
- Lead coordinates, reviews, merges

### Agent Teams context growth
- Lead session: ~150K tokens (Opus) — maintains full context for orchestration
- Teammate A: ~300K tokens (Sonnet) — context grows with every tool call (Edit, Read, Bash)
- Teammate B: ~250K tokens (Sonnet) — context grows similarly
- Coordination overhead: ~100K tokens — messages between teammates are in-context

### Lead System context
- Lead session: ~150K tokens (Opus) — same orchestration load
- Worker 1: ~80K tokens (Sonnet) — gets task, executes, exits (no context growth from coordination)
- Worker 2: ~60K tokens (Sonnet) — same pattern
- Coordination: 0 tokens — all coordination is JSON files on disk

## Cost Calculation

### Agent Teams
```
Lead:         150K tokens × ($15 + $75) / 2M ≈ $2.25  (mix of input/output at Opus rates)
Teammate A:   300K tokens × ($3 + $15) / 2M  ≈ $2.70  (Sonnet rates)
Teammate B:   250K tokens × ($3 + $15) / 2M  ≈ $2.25
Coordination: 100K tokens × ($3 + $15) / 2M  ≈ $0.90
TOTAL: $8.10
```

### Lead System
```
Lead:         150K tokens × ($15 + $75) / 2M ≈ $2.25  (same)
Worker 1:     80K tokens × ($3 + $15) / 2M   ≈ $0.72  (smaller context)
Worker 2:     60K tokens × ($3 + $15) / 2M   ≈ $0.54  (smaller context)
Coordination: 0 tokens (filesystem)           = $0.00
TOTAL: $3.51
```

### Savings
```
$8.10 - $3.51 = $4.59 savings (57%)
```

## Why Workers Use Fewer Tokens

Agent Teams teammates maintain growing context windows:
- Every `TaskList`, `SendMessage`, `TaskUpdate` call adds to context
- Idle teammates still hold their full context window open
- Messages between teammates are delivered as context (not free)

Lead System workers are stateless:
- Worker gets a task prompt, executes it, writes `result.json`, exits
- No coordination messages in context — messages are JSON files
- No idle cost — workers don't exist between tasks

## Key Difference: Coordination Cost

| Operation | Agent Teams Cost | Lead System Cost |
|-----------|-----------------|-----------------|
| Send message | ~500-2000 tokens (in-context) | 0 tokens (JSON file) |
| Check task status | ~1000 tokens (tool call) | 0 tokens (read JSON) |
| Worker idle wait | Full context maintained | Worker doesn't exist |
| Conflict detection | Not available | 0 tokens (hook reads JSON) |

## Disclaimer

- Actual costs vary by task complexity, coding style, and tool usage patterns
- The comparison uses a representative mid-complexity task scenario
- Token counts are estimates based on typical tool call patterns observed in practice
- Pricing may change — check the [Anthropic pricing page](https://www.anthropic.com/pricing) for current rates
- The comparison assumes Claude Opus for the lead session and Claude Sonnet for workers/teammates

## References

- [Anthropic Pricing](https://www.anthropic.com/pricing)
- `README.md` — Cost comparison section
- `docs/OPERATIONAL_SLOS.md` — Performance targets
