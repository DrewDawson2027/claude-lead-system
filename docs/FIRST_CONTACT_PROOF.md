# First-Contact Proof Pack

This is the canonical first-contact proof artifact for Claude Lead System.

It is intentionally narrow.

## What this proves

On the blessed public path, Lead can:

- detect overlapping file work between two active Claude Code workers
- let the operator reroute one worker live from `/lead`
- show a clean follow-up conflict check after the reroute

## Verified public lane

- **Install path** — `install.sh` with the default profile
- **Launch path** — `claudex`
- **Command path** — `/lead`
- **Runtime posture** — coordinator mode
- **Strongest verified public environment** — macOS coordinator path

## What this does not prove

This proof pack does **not** claim:

- native Agent Teams parity
- identical runtime maturity across macOS, Linux, and Windows
- broad cross-platform UX equivalence
- generic multi-agent superiority claims
- subscription-cost reduction

## Canonical proof objects

- **Hero video** — [`assets/demo/demo-final.mp4`](../assets/demo/demo-final.mp4)
- **Fast visual** — [`assets/demo/demo-hero.gif`](../assets/demo/demo-hero.gif)
- **Demo source of truth** — [`assets/demo/README.md`](../assets/demo/README.md)

Treat `demo-final.mp4`, `demo-hero.gif`, and this proof pack as the public proof set. Other files under `assets/demo/` are production or reproduction support artifacts, not separate public claims.

## Exact reproduction flow

Run from the repo root:

```bash
bash assets/demo/prepare_conflict_hero_demo.sh --force
bash assets/demo/preflight_conflict_hero_demo.sh
bash assets/demo/setup_conflict_hero_terminals.sh
```

Prepared workspace:

```text
${TMPDIR:-/tmp}/claude-lead-conflict-hero
```

Recording bundle generated at:

```text
${TMPDIR:-/tmp}/claude-lead-conflict-hero/.demo-artifacts/recording
```

That bundle contains:

- exact worker prompts
- exact lead commands
- exact operator script
- exact recording checklist
- session ID template

## Exact on-record sequence

Use the generated files under `.demo-artifacts/recording` and keep the proof arc uncut.

```text
/lead
conflicts
tell <worker-b-session-id> stop editing src/auth.ts. worker <worker-a-session-id> owns that file. continue only in tests/auth.integration.test.ts. if auth.ts needs changes, report them instead of editing the file.
conflicts
```

Recording requirements:

- both workers must already be active in the same repo
- both must have visibly inspected or touched `src/auth.ts`
- keep all three panes visible throughout the proof arc
- do not cut between the first `conflicts` command and the second `conflicts` command

## Evidence bundle

After recording, collect the evidence bundle:

```bash
bash assets/demo/collect_conflict_hero_evidence.sh \
  --project "${TMPDIR:-/tmp}/claude-lead-conflict-hero" \
  --lead <lead-session-id> \
  --worker-a <worker-a-session-id> \
  --worker-b <worker-b-session-id>
```

Evidence output:

```text
${TMPDIR:-/tmp}/claude-lead-conflict-hero/.demo-artifacts/evidence/<timestamp>
```

The evidence bundle includes:

- terminal activity receipts
- conflict receipts
- session JSON receipts
- inbox JSONL receipts for provided session IDs
- recording prompts and operator script
- latest preflight summary and command receipts
- environment and command receipts
- code pointers for the proof path

If you are generating a fresh evidence bundle, save these support artifacts alongside it:

- `uncut-proof-recording.mp4`
- `screenshot-conflict-found.png`
- `screenshot-directive-sent.png`
- `screenshot-conflict-cleared.png`
- `session-ids.txt`
- `timing-notes-template.md`

These are reproduction and evidence-bundle support artifacts, not part of the shipped public proof set unless you intentionally publish them.

## Source-of-truth files

- `assets/demo/prepare_conflict_hero_demo.sh`
- `assets/demo/preflight_conflict_hero_demo.sh`
- `assets/demo/setup_conflict_hero_terminals.sh`
- `assets/demo/collect_conflict_hero_evidence.sh`
- `assets/demo/MANUAL_DEMO_SCRIPT.md`
