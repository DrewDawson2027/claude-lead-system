# Manual Demo Recording Script

Record this with screen recording software. The target runtime is a **35-55 second** hero clip plus **one uncut proof take**.

## Core thesis

The clip proves one sentence:

> When two active workers are converging on the same file, Claude Lead System detects the collision risk, lets the operator intervene immediately, and visibly clears the conflict before merge pain happens.

## Pre-record setup

Run from the repo root:

```bash
bash assets/demo/prepare_conflict_hero_demo.sh --force
bash assets/demo/preflight_conflict_hero_demo.sh
bash assets/demo/setup_conflict_hero_terminals.sh
```

Use the prepared workspace:

```text
${TMPDIR:-/tmp}/claude-lead-conflict-hero
```

Use the generated bundle:

```text
${TMPDIR:-/tmp}/claude-lead-conflict-hero/.demo-artifacts/recording
```

Before you hit record:

1. Paste `worker-a-prompt.txt` into the worker-a pane.
2. Paste `worker-b-prompt.txt` into the worker-b pane.
3. Wait until both workers have visibly inspected or touched `src/auth.ts`.
4. Keep all three panes visible.
5. Turn off notifications and hide personal information.
6. Do not start recording until the overlap is already in motion.

## Exact operator inputs

Replace the session IDs with the real ones shown on screen.

```text
/lead
conflicts
tell <worker-b-session-id> stop editing src/auth.ts. worker <worker-a-session-id> owns that file. continue only in tests/auth.integration.test.ts. if auth.ts needs changes, report them instead of editing the file.
conflicts
```

## What must be visible on screen

- Three live panes in the same repo.
- `src/auth.ts` visible as the overlapping file.
- The first `conflicts` output showing both sessions.
- The directive being sent to Worker B.
- Worker B receiving the directive and pivoting.
- The second `conflicts` output showing the cleared state.

## Timing and hold points

- Hold 1-2 seconds on the first conflict output.
- Do not cut between the first `conflicts` command and the second `conflicts` command.
- Hold 2-3 seconds on the cleared conflict result.

## Narration script

### Opening

> The hard part of multi-agent coding is not spawning more agents. It is stopping them from colliding on the same file.

### While `/lead` renders

> Here I have two live workers in the same repo.

### While the first `conflicts` output appears

> Both are converging on `src/auth.ts`. Lead catches that before I end up in merge cleanup.

### While sending the directive

> I can re-route one worker live: one worker owns the auth file, the other stays in tests.

### While Worker B pivots

> The point is not more agent theater. The point is operator control at the moment coordination actually matters.

### While the cleared output appears

> Now the overlap is gone. That is the wedge: prevent the collision before the merge conflict.

## Post-recording

If you are generating a fresh evidence bundle, save these support artifacts:

- `uncut-proof-recording.mp4`
- `screenshot-conflict-found.png`
- `screenshot-directive-sent.png`
- `screenshot-conflict-cleared.png`

These are reproduction and evidence-bundle support artifacts, not part of the shipped public proof set unless you intentionally publish them.

Then collect the evidence pack:

```bash
bash assets/demo/collect_conflict_hero_evidence.sh \
  --project "${TMPDIR:-/tmp}/claude-lead-conflict-hero" \
  --lead <lead-session-id> \
  --worker-a <worker-a-session-id> \
  --worker-b <worker-b-session-id> \
  --recording uncut-proof-recording.mp4 \
  --conflict-shot screenshot-conflict-found.png \
  --directive-shot screenshot-directive-sent.png \
  --cleared-shot screenshot-conflict-cleared.png
```
