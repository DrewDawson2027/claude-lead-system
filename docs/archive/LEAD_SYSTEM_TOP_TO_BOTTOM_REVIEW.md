# Lead System Top-to-Bottom Review (Corrected and Expanded Addendum)

This addendum fully replaces the prior strategic review and corrects the scope to include both trees:

1. `~/claude-lead-system/` (sidecar/coordinator/runtime)
2. `~/.claude/` (operational control plane: hooks, agents, CLAUDE.md, settings)

---

## 1) Category 1 — Worklog "open" bugs: resolution status + exact remediation

## 1.1 Symlink path traversal in `isPathWithin`

### Status

Resolved in current tree.

### Exact hardening implemented

`isPathWithin` now canonicalizes both base and candidate paths through `realpathSync` before containment checks, including ENOENT-aware parent probing.

References:

- `@/Users/drewdawson/claude-lead-system/sidecar/server/routes/shared.ts#1-67`

Equivalent patch shape (if backport needed):

```diff
--- a/sidecar/server/routes/shared.ts
+++ b/sidecar/server/routes/shared.ts
@@
+import { realpathSync } from 'fs';
@@
+function resolvePathForContainment(...) {
+  const resolved = pathResolve(inputPath);
+  try { return pathRealpath(resolved); } catch (err) {
+    if (err?.code !== 'ENOENT') throw err;
+    // Walk up to nearest existing ancestor, realpath that parent,
+    // then reconstruct candidate path under canonical parent.
+  }
+}
@@
-const baseResolved = pathResolve(basePath);
-const candidateResolved = pathResolve(candidatePath);
-const rel = relative(baseResolved, candidateResolved);
+const baseReal = pathRealpath(pathResolve(basePath));
+const candidateReal = resolvePathForContainment(candidatePath, pathResolve, pathRealpath);
+const rel = relative(baseReal, candidateReal);
```

### All callsites of `isPathWithin`

- `@/Users/drewdawson/claude-lead-system/sidecar/server/routes/maintenance.ts#47-49` (`/checkpoints/restore`)
- `@/Users/drewdawson/claude-lead-system/sidecar/server/routes/maintenance.ts#104-106` (`/repair/fix`)
- `@/Users/drewdawson/claude-lead-system/sidecar/server/routes/maintenance.ts#183-185` (`/backups/restore`)
- `@/Users/drewdawson/claude-lead-system/sidecar/server/routes/system.ts#116-119` (`/reports/comparison` baseline file)

### Test coverage assessment

Covered with both unit and integration tests:

- Unit symlink-escape test: `@/Users/drewdawson/claude-lead-system/sidecar/test/path-containment.test.mjs#50-78`
- HTTP containment bypass + symlink bypass checks across diagnostics/repair/checkpoints/backups:
  `@/Users/drewdawson/claude-lead-system/sidecar/test/server-http.test.mjs#420-510`

Conclusion: this item is no longer open in current code.

---

## 1.2 Action retry split lineage

### Status

Resolved with **Option (a): reuse original record and increment attempt count**.

### Current behavior (no lineage split)

1. Retry/fallback transitions same `action_id` back to pending with incremented `retry_count`:
   - `@/Users/drewdawson/claude-lead-system/sidecar/native/action-queue.js#109-120`
2. Retry/fallback routes pass `trackedActionId` into tracked runner:
   - `@/Users/drewdawson/claude-lead-system/sidecar/server/routes/actions.ts#43-52`
   - `@/Users/drewdawson/claude-lead-system/sidecar/server/routes/actions.ts#68-76`
3. Tracked runner reuses existing record when `trackedActionId` is provided (no `create()` path):
   - `@/Users/drewdawson/claude-lead-system/sidecar/server/runtime/actions.ts#3-10`

Equivalent patch shape (if backport needed):

```diff
--- a/sidecar/server/runtime/actions.ts
+++ b/sidecar/server/runtime/actions.ts
@@
-const record = actionQueue.create(...)
+const record = trackedActionId
+  ? { ...(actionQueue.get(trackedActionId) || {}), action_id: trackedActionId, ... }
+  : actionQueue.create(...)
```

### Test coverage assessment

Explicit integration test verifies no duplicate record creation on retry/fallback:

- `@/Users/drewdawson/claude-lead-system/sidecar/test/server-http.test.mjs#258-308`

Conclusion: this item is no longer open in current code.

---

## 1.3 Reassign/gate-check integration tests

### Status

Implemented.

### Integration coverage now present

- End-to-end route behavior test (not just schema validation), including coordinator execution effects:
  - `@/Users/drewdawson/claude-lead-system/sidecar/test/server-http.test.mjs#112-190`
- Schema allowlist tests also present:
  - `@/Users/drewdawson/claude-lead-system/sidecar/test/route-validation.test.mjs#112-131`

### Optional additional tests still worth adding

1. Reassign failure path returns `ACTION_FAILED` when coordinator throws.
2. Gate-check failure path returns `ACTION_FAILED` on coordinator error.
3. Reassign rejects empty `new_assignee` (400) at HTTP integration level (not only route unit/schema).

Conclusion: baseline integration gap is closed; only negative-path expansion remains.

---

## 2) Category 2 — Corrected scope review (`~/.claude` operational layer)

## 2.1 Hooks layer redo (`~/.claude/hooks`)

Wiring in settings is confirmed for all six requested hooks:

- `token-guard.py`, `model-router.py` on `PreToolUse: Task`:
  `@/Users/drewdawson/.claude/settings.json#179-191`
- `credential-guard.py` on `PreToolUse: Write|Edit|MultiEdit|Bash`:
  `@/Users/drewdawson/.claude/settings.json#239-246`
- `risky-command-guard.py` on `PreToolUse: Bash`:
  `@/Users/drewdawson/.claude/settings.json#249-256`
- `auto-review-dispatch.py` on `PostToolUse: Bash`:
  `@/Users/drewdawson/.claude/settings.json#142-149`
- `build-chain-dispatcher.py` on `SubagentStop`:
  `@/Users/drewdawson/.claude/settings.json#270-288`

### Hook-by-hook assessment

1. **`model-router.py`**
   - Correctness: 3-tier recommendation works; hard-blocks prompt >15 lines (`exit 2`) at `@/Users/drewdawson/.claude/hooks/model-router.py#183-193`.
   - Gap: "heavy agents must be background" is warning-only, not enforced (`@/Users/drewdawson/.claude/hooks/model-router.py#194-203`).
   - Fail posture: mostly fail-open on parser/runtime faults (`@/Users/drewdawson/.claude/hooks/model-router.py#218-225`).

2. **`token-guard.py`**
   - Correctness: strong Task-spawn gating (session caps, cooldowns, necessity/type-switch checks) at `@/Users/drewdawson/.claude/hooks/token-guard.py#892-1107`.
   - Gap vs stated purpose: does **not** enforce turn-level token budget directly; `agent_budgets.max_turns` is advisory print-only (`@/Users/drewdawson/.claude/hooks/token-guard.py#1127-1138`).
   - Opus handling: warning-only (`@/Users/drewdawson/.claude/hooks/token-guard.py#1117-1125`).
   - Fail posture: mixed; config sets `fail_closed` (`@/Users/drewdawson/.claude/hooks/token-guard-config.json#9`), but some parse paths still fail-open.

3. **`auto-review-dispatch.py`**
   - Correctness: commit/PR trigger to mandatory action queue is implemented (`@/Users/drewdawson/.claude/hooks/auto-review-dispatch.py#61-94`).
   - Completeness gap: relies on output substring checks (not explicit exit code), so command wrappers/edge outputs may bypass.
   - Fail posture: fail-open (always exits 0 except normal flow).

4. **`build-chain-dispatcher.py`**
   - Correctness: implements deterministic review→fp-checker and build→simplifier→verify chain enqueue (`@/Users/drewdawson/.claude/hooks/build-chain-dispatcher.py#106-141`).
   - Completeness gap: keyword heuristics can miss non-keyword implementation agents or trigger false positives.
   - Fail posture: fail-open.

5. **`credential-guard.py`**
   - Correctness: blocks common hardcoded secret patterns on write/edit and `.env` commit mentions (`@/Users/drewdawson/.claude/hooks/credential-guard.py#9-24`, `#71-78`, `#86-90`).
   - Completeness gaps:
     - only scans new edit content, not full file context;
     - Bash commit guard checks command string, not actual staged diff.
   - Fail posture: fail-open on parser errors; fail-closed on positive match.

6. **`risky-command-guard.py`**
   - Correctness: two-tier block/warn logic is implemented (`@/Users/drewdawson/.claude/hooks/risky-command-guard.py#19-43`, `#57-95`).
   - Completeness gaps:
     - pattern coverage is regex-based and bypassable via aliases/scripts/obfuscation;
     - force-push block is branch-name heuristic.
   - Fail posture: fail-open on parse/no-match; fail-closed on blocked-pattern match.

### Comparison to native Claude Agent Teams

Native Agent Teams provides no equivalent local hook enforcement layer (no PreToolUse/PostToolUse policy chain by default). This `~/.claude/hooks` stack is a meaningful governance advantage, but only where rules are truly blocking (not advisory).

---

## 2.2 Agent definitions redo (`~/.claude/agents`)

Reviewed active set:

- `reviewer.md`, `quick-reviewer.md`, `fp-checker.md`, `code-simplifier.md`, `verify-app.md`, `code-architect.md`, `scout.md`, `practice-creator.md`

References:

- `@/Users/drewdawson/.claude/agents/reviewer.md#1-81`
- `@/Users/drewdawson/.claude/agents/quick-reviewer.md#1-46`
- `@/Users/drewdawson/.claude/agents/fp-checker.md#1-54`
- `@/Users/drewdawson/.claude/agents/code-simplifier.md#1-66`
- `@/Users/drewdawson/.claude/agents/verify-app.md#1-96`
- `@/Users/drewdawson/.claude/agents/code-architect.md#1-80`
- `@/Users/drewdawson/.claude/agents/scout.md#1-39`
- `@/Users/drewdawson/.claude/agents/practice-creator.md#1-48`

### Conventions/model quality findings

1. **Model assignment quality: mostly correct**
   - Haiku for fast/cheap (`quick-reviewer`, `fp-checker`, `scout`, `practice-creator`) is sensible.
   - Sonnet for implementation verification/architecture (`code-simplifier`, `verify-app`, `code-architect`) is sensible.
   - Opus for deep review (`reviewer`) is appropriate.

2. **Prompt-quality and operational issues**
   - `reviewer.md` lacks explicit `tools:` frontmatter, so tool scope is less controlled.
   - Four agents reference a non-existent pre-flight path `~/.claude/agents/elite-engineer-reference.md`; actual file is `~/.claude/elite-engineer-reference.md`:
     - `reviewer`, `code-simplifier`, `verify-app`, `code-architect`.
   - `verify-app` includes `git stash && ... && git stash pop`; if middle command fails, stash may remain unapplied (state risk).
   - `practice-creator` is notably underspecified vs the rest (minimal constraints/output rigor).

3. **Compared to native Agent Teams frontmatter model**
   - Current custom agents specify a subset (name/description/model/tools).
   - They do **not** encode richer execution controls you cited for native team agents (`permissionMode`, `maxTurns`, hooks, memory, isolation) at agent definition level.
   - Net: behavior is partly enforced elsewhere (hooks/CLAUDE.md), not self-contained per-agent.

---

## 2.3 CLAUDE.md redo (`~/.claude/CLAUDE.md`)

Reference:

- `@/Users/drewdawson/.claude/CLAUDE.md#1-191`

### Internal consistency review

Key strengths:

- Clear routing matrix and explicit default model policy.
- Explicit hard-rule language for prompt length, backgrounding, and verification.

Detected contradictions/tension points:

1. "Never dispatch two agents for same analysis" vs "multiple approaches compared → 3 parallel agents" (`@/Users/drewdawson/.claude/CLAUDE.md#51-53`, `#93-95`).
2. "HARD RULE background=true" is not mechanically enforced by hooks (router warns only) (`@/Users/drewdawson/.claude/CLAUDE.md#69-76` vs `@/Users/drewdawson/.claude/hooks/model-router.py#194-203`).
3. Several "HARD RULE" items are advisory-only in practice (no-double-reads, parallel dispatch-by-default).

### Completeness gaps

1. No explicit precedence model when two hard rules conflict.
2. No defined fallback behavior when hook subsystem is unavailable/degraded.
3. No machine-readable mapping from policy text to enforcement points (traceability gap).

### Effectiveness: enforceable vs advisory

**Mechanically enforced** (good):

- prompt length cap for Task prompts
- task spawn gating/cooldowns
- credential and risky-command block patterns
- mandatory queue-based auto-dispatch chains

**Advisory-only** (gap):

- background requirement for heavy agents
- no-double-reads
- some model routing guidance
- multiple autonomous command heuristics

### Comparison to native Agent Teams configuration style

- This system centralizes behavior in one `CLAUDE.md` plus hooks.
- Native Agent Teams frontmatter distributes behavior into per-agent metadata (as you noted: model/tools/permissionMode/maxTurns/hooks/memory/isolation, etc.).
- Tradeoff:
  - central file = faster global policy edits;
  - per-agent metadata = stronger local correctness/isolation and easier linting/validation per role.

### Bloat assessment and extraction plan

Current file is ~191 lines (not 351), but still dense and mixed (routing + chains + verification + tool routing + learning policy).

Recommended split:

1. Keep `CLAUDE.md` as short policy index (core non-negotiables only).
2. Extract to machine-checkable modules:
   - `rules/model-routing.md`
   - `rules/dispatch.md`
   - `rules/verification.md`
   - `rules/chains.md`
3. Add a "policy-to-hook enforcement map" table so each hard rule cites enforcing hook/script or is marked advisory.

---

## 3) Priority remediation list (post-correction)

1. **Enforce background dispatch in `model-router.py`** (change warning to block for high-complexity foreground tasks).
2. **Make token budget claims accurate**: either implement true turn-level/model-level token gating in `token-guard.py` or revise docs to advisory language.
3. **Fix bad pre-flight path** in 4 agent files (`~/.claude/elite-engineer-reference.md` actual location).
4. **Harden `verify-app` regression step** to avoid stash-loss edge cases.
5. **Add staged-diff credential scanning** for `git commit` path in `credential-guard.py`.
6. **Add rule-enforcement map** to CLAUDE policy docs to separate hard-enforced vs advisory.

---

## 4) Final corrected recommendation

Recommendation remains **HYBRIDIZE**, but with a stricter framing:

- Keep `claude-lead-system` for runtime governance, sidecar APIs, and coordinator policy controls.
- Keep `~/.claude` hooks as the operational safety layer.
- Tighten the advisory gaps above so "hard rules" are consistently mechanical.

This corrected review closes the prior scope error and directly audits the active operational control plane.
