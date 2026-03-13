# Demo Asset Pack

The launch-ready path in this directory is the **conflict-prevention hero demo**.

Treat these as the public proof set:

- `demo-final.mp4`
- `demo-hero.gif`
- `../docs/FIRST_CONTACT_PROOF.md`

Other files in this directory are production or reproduction support artifacts, not separate public claims.

Keep the proof narrow:

- Two active workers are in the same repo.
- Both converge on `src/auth.ts`.
- The lead detects the overlap.
- The operator reroutes one worker live.
- The follow-up conflict check is clean.

## 1) Prepare the reproducible demo workspace

Run from the repo root:

```bash
bash assets/demo/prepare_conflict_hero_demo.sh --force
bash assets/demo/preflight_conflict_hero_demo.sh
bash assets/demo/setup_conflict_hero_terminals.sh
```

The prepared workspace is created at:

```text
${TMPDIR:-/tmp}/claude-lead-conflict-hero
```

It includes a recording bundle with:

- exact worker prompts
- exact lead commands
- exact operator script
- exact recording checklist

## 2) Exact on-record sequence

Use the generated files under:

```text
${TMPDIR:-/tmp}/claude-lead-conflict-hero/.demo-artifacts/recording
```

The hero clip should show this exact operator flow:

```text
/lead
conflicts
tell <worker-b-session-id> stop editing src/auth.ts. worker <worker-a-session-id> owns that file. continue only in tests/auth.integration.test.ts. if auth.ts needs changes, report them instead of editing the file.
conflicts
```

Record only after both workers are already active and have visibly inspected or touched `src/auth.ts`.

## 3) Proof requirements

The uncut take must keep all three panes visible throughout the proof arc:

- conflict visible
- directive visible
- worker pivot visible
- cleared conflict visible

Do not cut between the first `conflicts` command and the second `conflicts` command.

If you are generating a fresh evidence bundle, save these support artifacts:

- `uncut-proof-recording.mp4`
- `screenshot-conflict-found.png`
- `screenshot-directive-sent.png`
- `screenshot-conflict-cleared.png`

These are reproduction and evidence-bundle support artifacts, not part of the shipped public proof set unless you intentionally publish them.

## 4) Evidence pack

After recording, collect the evidence bundle:

```bash
bash assets/demo/collect_conflict_hero_evidence.sh \
  --project "${TMPDIR:-/tmp}/claude-lead-conflict-hero" \
  --lead <lead-session-id> \
  --worker-a <worker-a-session-id> \
  --worker-b <worker-b-session-id>
```

The evidence bundle includes:

- terminal activity receipts
- conflict receipts
- session JSON receipts
- recording prompts and operator script
- environment and command receipts
- code pointers for the proof path

## 5) Source of truth

For the launch artifact, use these files as the source of truth:

- `prepare_conflict_hero_demo.sh`
- `preflight_conflict_hero_demo.sh`
- `setup_conflict_hero_terminals.sh`
- `collect_conflict_hero_evidence.sh`
- `MANUAL_DEMO_SCRIPT.md`
