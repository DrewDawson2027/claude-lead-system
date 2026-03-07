# Coverage Ratchet Plan (Coordinator)

Current state (as of 2026-02-22):

- Measured line coverage: ~80.7%
- CI enforcement: 80% (ratchet restored)

Ratchet policy (completed for 80%, keep for future increases):

1. Add targeted tests for lowest-coverage modules (`messaging`, `shutdown`, `context-store`, `approval`, `workers`, `platform/common`, `tasks`, `team-tasking`)
2. Raise CI gate only after CI is green at the new threshold
3. Keep README coverage claims aligned with measured output (do not estimate manually)

Recommended verification:

```bash
cd /Users/drewdawson/claude-lead-system/mcp-coordinator
npx c8 --check-coverage --lines 80 node --test test/*.test.mjs
```
