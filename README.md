<div align="center">

# Claude Lead System

### Local coordination layer for Claude Code

**One local control room for heavier Claude Code workflows.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/DrewDawson2027/claude-lead-system/actions/workflows/ci.yml/badge.svg)](https://github.com/DrewDawson2027/claude-lead-system/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)

</div>

## What this is

Lead gives Claude Code one local control room for heavier workflows: active terminals, worker control, messaging, conflict detection, and tracked pipelines.

Use it when you want more local control, visibility, and conflict prevention around heavier Claude Code workflows. Do not read it as an Agent Teams replacement, a native-team parity layer, or a subscription-cost reducer.

## Quick Start

```bash
# 1. Install (one command — signed default path)
VERSION=v1.0.0
bash <(curl -fsSL "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/install.sh")

# 2. Launch Claude
claudex

# 3. Enter coordinator mode
/lead
```

That's it. You'll see a live dashboard of your active Claude terminals.

## When to use Lead vs Native Agent Teams

| Situation                                               | Use Lead | Use Native Agent Teams |
| ------------------------------------------------------- | -------- | ---------------------- |
| 4+ active workers you want to control from one terminal | ✓        |                        |
| Pre-edit conflict detection before sessions collide     | ✓        |                        |
| Operator-grade dashboard, audit trail, and governance   | ✓        |                        |
| Budget/spawn caps and approval workflows                | ✓        |                        |
| 1-2 collaborators with in-context coordination          |          | ✓                      |
| Tightest first-party UX consistency                     |          | ✓                      |
| Minimum-setup, no external coordinator                  |          | ✓                      |

## Lead-exclusive capabilities

These are delivered by the coordinator, not available in native Agent Teams:

| Capability                             | What it does                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Pre-edit conflict detection            | Flags when two sessions are about to edit the same file — before the collision   |
| Conflict lifecycle visibility          | Track, resolve, and recheck conflicts across active sessions                     |
| Operator dashboard                     | Live table of all sessions: status, branch, files touched, last active           |
| Worker spawn + kill + resume           | Start, stop, and re-enter workers from one control point                         |
| Session resumption with prior context  | `coord_resume_worker` re-enters the prior Claude conversation, not a fresh start |
| P2P worker messaging                   | Workers send messages directly to named peers via inbox files                    |
| Broadcast                              | Send one message to all active workers simultaneously                            |
| Plan approval protocol                 | Workers in plan mode pause; lead approves or revises before execution            |
| Quality gates with actionable feedback | Gate failures return a checklist of what the worker must fix                     |
| Exit-code-2 hook feedback              | Hook exits return feedback to the worker inbox without interrupting flow         |
| Budget gating                          | Cap tokens or turns per worker before spawning                                   |
| Permission mode control                | Set `plan`, `auto`, or `bypassPermissions` per worker at spawn time              |
| Pipeline orchestration                 | Run multi-step flows (lint → test → build) tracked from one place                |
| Team and task management               | Create teams, assign tasks, claim and complete with full audit trail             |
| Worktree isolation                     | Each worker can run in its own git worktree — no branch conflicts                |
| Graceful shutdown protocol             | Coordinate clean shutdowns across all active workers                             |
| Checkpoint / restore                   | Save and restore worker state mid-task                                           |
| Activity log (audit trail)             | Append-only log of every coordination event                                      |
| Worker metadata and role presets       | Assign roles, track teams, store custom metadata per worker                      |
| Peer discovery via session files       | Workers find each other by name without coordinator polling                      |
| Zero API-token filesystem coordination | Filesystem path carries coordination overhead with no API token cost             |
| Live worker status watch               | `scripts/lead-status-watch.sh` — continuously-refreshing terminal table          |
| Context store                          | Shared key/value store accessible to all workers in a session                    |
| GC for results and sessions            | Auto-clean old result files, session state, and pipeline artifacts               |
| Rate limiting and input validation     | Bounded, hardened local control surface                                          |
| Secure state directory hardening       | 0700/0600 permissions, symlink checks, ownership validation                      |
| Windows ACL hardening                  | `icacls` verification with broad-principal stripping                             |
| Cross-platform terminal launch         | macOS (tmux/iTerm2/Terminal), Linux (gnome-terminal/kitty/xterm)                 |
| Operator runbook and cheat sheet       | `docs/OPERATOR_RUNBOOK.md`, `docs/OPERATOR_CHEATSHEET.md`                        |

<details><summary>Canonical claim posture (for contributors and reviewers)</summary>

<!-- CLAIM_POSTURE:START -->

- Canonical taxonomy: `verified`, `partial`, `experimental`
- Parity posture (canonical): Do not claim exact UX parity or exact feature parity with native Agent Teams. Do not publish single-number parity percentages. Use only evidence-labeled capability claims using the canonical taxonomy. Hybrid/native execution paths remain experimental until current end-to-end evidence exists.
- Native advantages (canonical): In-process teammate lifecycle semantics in a single runtime. Tighter first-party cross-platform UX consistency. Integrated native UI and runtime linkage without external coordinator polling.
- Lead advantages (canonical): Pre-edit conflict detection and conflict lifecycle visibility across active sessions. Operator-grade dashboard and API orchestration for multi-terminal workflows. Filesystem coordination path with zero API-token coordination overhead. Policy and governance controls around worker execution (budget/spawn/approval/checkpoint).
- Economics posture (canonical): Do not claim universal savings or blanket cheaper-than-native outcomes. Filesystem coordination can claim zero API-token coordination overhead on that path. Throughput and economics claims beyond that path must stay evidence-scoped to the workflow under discussion.
- Economics verdicts (canonical): Filesystem coordination overhead claim = verified; Workflow-scoped token-pressure delta claim = partial; Universal cheaper-than-native or universal savings claim = experimental.
- Release blocker posture (canonical): Release blockers are failing release-quality gates, not unresolved parity/economics ambitions. Parity and economics gaps remain posture limits until promoted by fresh evidence.
- Canonical source: `docs/CLAIM_POSTURE_SOURCE.json`
- Canonical parity/economics document: `docs/PARITY_ECONOMICS_POSTURE.md`
<!-- CLAIM_POSTURE:END -->

</details>

## Mainstream support today

- **Blessed launch path** — `install.sh` → `claudex` → `/lead`
- **Strongest verified mainstream lane** — macOS coordinator path

<details><summary>Advanced support posture</summary>

- **Linux / Windows** — claim status comes only from proof artifacts in `reports/compatibility/proofs/latest/`
- **Advanced mode variants (`--mode hybrid|lite`)** — power-user/debug lanes; mainstream remains default `full`
- **Native bridge flags (`--native` / `--no-native`)** — advanced integration toggles, separate from mode selection

</details>

## First-contact proof

- **Hero demo** — [assets/demo/demo-final.mp4](assets/demo/demo-final.mp4)
- **Fast visual** — [assets/demo/demo-hero.gif](assets/demo/demo-hero.gif)
- **Canonical proof pack** — [docs/FIRST_CONTACT_PROOF.md](docs/FIRST_CONTACT_PROOF.md)

Treat `demo-final.mp4`, `demo-hero.gif`, and `docs/FIRST_CONTACT_PROOF.md` as the public proof set. Other files under `assets/demo/` are production or reproduction support assets, not separate public claims.

The proof is intentionally narrow: two active workers converge on the same file, Lead detects the conflict, the operator reroutes one worker, and the follow-up conflict check is clean on the blessed path.

![Lead orchestrating 2 workers — conflict detection, messaging, and worker control](assets/demo/demo-hero.gif)

> **Demo:** Workers A and B run in the same repo → Lead boots `/lead` → Detects a file conflict on `src/auth.ts` → Sends new instructions → Workers pivot. The demo shows the standard Lead flow on today's verified path, not native-team parity. [[Download video]](assets/demo/demo-final.mp4)

## Why people use it

- **Several active Claude terminals** that need one control point
- **Conflict prevention** before two sessions collide on the same files
- **Worker control** when you want to redirect, wake, or replace work in flight
- **Local visibility** into what each terminal is doing
- **Tracked multi-step flows** instead of ad hoc handoffs

## Mainstream mental model

Normal users only need these concepts:

- **Lead** — the command you enter with `/lead`
- **Dashboard** — the live view of your active Claude terminals
- **Workers** — extra Claude terminals Lead can spawn or redirect
- **Messages** — instructions Lead can send to a session
- **Conflicts** — warnings when two sessions touch the same files
- **Pipelines** — tracked multi-step work run from one place

<details><summary>Safety defaults</summary>

Lead ships hardened local defaults:

- **Local-only dashboard** — binds to `127.0.0.1`, not `0.0.0.0`
- **Browser protections** — same-origin enforcement and CSRF protection on mutations
- **Strict local permissions** — private state dirs and token files
- **Rate limiting and input validation** — bounded local control surface
- **Blocking safeguards** — risky coordination actions can be denied by default

Full details: [docs/SECURITY.md](docs/SECURITY.md)
Threat model: [docs/THREAT_MODEL_LOCAL_BROWSER.md](docs/THREAT_MODEL_LOCAL_BROWSER.md)
Release channels: [docs/RELEASE_CHANNELS.md](docs/RELEASE_CHANNELS.md)

</details>

<details><summary>Economics and native-team posture</summary>

If you use Claude Code on a flat-rate Max plan, the honest public question is not "does Lead lower my bill?" It is "does this local coordination layer help preserve more useful work inside a usage window?"

What Lead can legitimately claim:

- **No API-token coordination load for the filesystem coordination path itself**
- **Some extra hook latency and context overhead** from the governance layer itself
- **Net wins only when the avoided waste is bigger than that overhead**

Public launch copy should stop there. Exact throughput bands are workflow-dependent, and any dollar framing should be treated as token-equivalent pressure, not a Max bill reduction.

Use Lead when:

- You routinely run **4+ active workers** or reassign work mid-flight
- You care about **conflict detection, observability, and governance**
- You want to preserve more useful work inside a flat-rate Claude usage window
- You need **terminal-native workers, pipelines, or an external control plane**

Use native Agent Teams when:

- You only need **1-2 collaborators**
- First-party **in-context collaboration UX** matters more than governance
- You want the **lowest-maintenance** setup and do not need the extra operator layer

If you need the detailed methodology or scenario bands, use [docs/COMPARISON_METHODOLOGY.md](docs/COMPARISON_METHODOLOGY.md) and keep the wording conditional.

</details>

<details><summary>Advanced concepts intentionally kept out of the mainstream path</summary>

- install/runtime mode values (`full`, `hybrid`, `lite`) selected via `install.sh --mode` or `claudex --mode`
- native bridge toggles (`claudex --native` / `--no-native`, plus bridge autostart flags), which are not mode values
- background service internals and dashboard plumbing
- hook wiring, local state files, and fallback scripts
- MCP tool names, bridge internals, and implementation-specific runtime details

</details>

---

## What it looks like

After `/lead` boots, you operate with natural language from the coordinator:

```
# Send instructions to another terminal
tell e5f6g7h8 to write integration tests for src/auth.ts

# Check for file conflicts
conflicts
→ ⚠ src/auth.ts touched by sessions a1b2c3d4 AND e5f6g7h8

# Spawn an autonomous worker
run "add error handling to src/api.ts" in ~/my-app

# Run a tracked pipeline
pipeline: lint, test, build in ~/my-app

# Live worker status (separate terminal)
bash scripts/lead-status-watch.sh
```

<details><summary>Full signed install (verified release path)</summary>

```bash
VERSION=v1.0.0 # replace with latest release tag
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/install.sh"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/checksums.txt"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/checksums.txt.sig"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/checksums.txt.pem"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/release.json"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/release.json.sig"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/release.json.pem"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/claude-lead-system.tar.gz"
shasum -a 256 -c checksums.txt --ignore-missing
bash install.sh --version "${VERSION}" \
  --checksum-file checksums.txt \
  --checksum-signature checksums.txt.sig \
  --checksum-cert checksums.txt.pem \
  --release-manifest release.json \
  --release-manifest-signature release.json.sig \
  --release-manifest-cert release.json.pem \
  --source-tarball claude-lead-system.tar.gz
```

</details>

## How It Works

Think of Lead as a control room for Claude Code:

1. **You type `/lead`** in one Claude Code session.
2. **Lead boots a live view** of your active Claude terminals and what they are touching.
3. **You direct work from there** — send instructions, wake a session, spawn a worker, run a pipeline, or inspect results.
4. **Coordination state stays local** so Lead can reason from fresh local state instead of re-reading long transcripts.

## What `/lead` Can Do

| Command                         | What Happens                                           |
| ------------------------------- | ------------------------------------------------------ |
| _(boot)_                        | Opens the dashboard and shows recommended next actions |
| `tell [session] to [task]`      | Sends instructions to an active terminal               |
| `wake [session] with [message]` | Brings an idle terminal back into the loop             |
| `run [task] in [dir]`           | Starts a worker in a new terminal                      |
| `pipeline: A, B, C in [dir]`    | Runs a tracked multi-step flow                         |
| `conflicts`                     | Shows overlapping file work across active sessions     |
| `spawn terminal in [dir]`       | Opens another interactive Claude Code terminal         |
| `kill worker [id]`              | Stops a running worker                                 |
| `health check`                  | Runs advanced diagnostics if something looks broken    |

<details><summary>Advanced platform notes</summary>

- **macOS** — strongest verified launch surface today
- **Linux** — no maturity claim without a committed proof artifact
- **Windows** — no maturity claim without a committed proof artifact
- **Advanced runtime variants** — available for power users, not part of the mainstream path

Treat the published proof set above as proof for the blessed macOS lane, not as proof of identical cross-platform behavior.

Full compatibility details (generated from proof artifacts): [docs/COMPATIBILITY_MATRIX.md](docs/COMPATIBILITY_MATRIX.md)

</details>

---

## Installation

### Blessed install (default)

Use the default installer. Do not pass `--mode` unless you intentionally want an advanced profile.

```bash
VERSION=v1.0.0 # replace with latest release tag
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/install.sh"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/checksums.txt"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/checksums.txt.sig"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/checksums.txt.pem"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/release.json"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/release.json.sig"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/release.json.pem"
curl -fsSLO "https://github.com/DrewDawson2027/claude-lead-system/releases/download/${VERSION}/claude-lead-system.tar.gz"
shasum -a 256 -c checksums.txt --ignore-missing
bash install.sh --version "${VERSION}" \
  --checksum-file checksums.txt \
  --checksum-signature checksums.txt.sig \
  --checksum-cert checksums.txt.pem \
  --release-manifest release.json \
  --release-manifest-signature release.json.sig \
  --release-manifest-cert release.json.pem \
  --source-tarball claude-lead-system.tar.gz
```

After install, run `claudex`, then type `/lead`.

<details><summary>Dev / nightly install (advanced, unpinned)</summary>

```bash
curl -fsSL https://raw.githubusercontent.com/DrewDawson2027/claude-lead-system/main/install.sh | bash -- --ref main --allow-unsigned-release
```

</details>

<details><summary>Advanced install/runtime modes</summary>

`install.sh --mode` and `claudex --mode` accept exactly these values:

- `full` — blessed default Lead profile
- `hybrid` — advanced alternate profile for debugging and integration work
- `lite` — advanced minimal profile for power users

</details>

<details><summary>Native bridge integration flags (advanced, not mode names)</summary>

Use these with `claudex` when you intentionally want native bridge integration behavior:

- `--native` or `--no-native`
- `--bridge-autostart` or `--no-bridge-autostart`

`native` is not a valid `--mode` value.

</details>

<details><summary>Manual install (advanced)</summary>

```bash
git clone https://github.com/DrewDawson2027/claude-lead-system.git
cd claude-lead-system

# Copy hooks, commands, and MCP coordinator
cp -r hooks/ ~/.claude/hooks/
cp -r commands/ ~/.claude/commands/
cp -r mcp-coordinator/ ~/.claude/mcp-coordinator/
chmod +x ~/.claude/hooks/*.sh

# Install MCP coordinator dependencies
cd ~/.claude/mcp-coordinator && npm install

# Wire up settings (auto-expands __HOME__)
cd - && bash install.sh --ref main --allow-unsigned-release

# Verify
bash ~/.claude/hooks/health-check.sh
```

</details>

### Requirements

- [Claude Code](https://claude.ai/code) installed and authenticated
- `jq` (`brew install jq` / `apt install jq`)
- Node.js >= 18
- `bash`, `python3`

---

## More Help

- [Troubleshooting](docs/TROUBLESHOOTING.md) — common issues and fixes
- [Workflow Examples](docs/WORKFLOW_EXAMPLES.md) — realistic end-to-end flows
- [Security](docs/SECURITY.md) — threat model and mitigations

<details><summary>Power-user and implementation docs</summary>

- [Architecture](docs/ARCHITECTURE.md) — system design and data flow
- [API Contract](docs/API_CONTRACT.md) — coordinator tool schemas
- [MCP Tool Reference](docs/MCP_TOOL_REFERENCE.md) — full tool surface
- [Operator Runbook](docs/OPERATOR_RUNBOOK.md) — ops procedures
- [Agent Teams Integration](docs/AGENT_TEAMS_INTEGRATION.md) — advanced hybrid-mode and native-bridge integration work
- [Claim Provenance](docs/CLAIM_PROVENANCE.md) — README claims mapped to proof artifacts
- [Parity & Economics Posture](docs/PARITY_ECONOMICS_POSTURE.md) — canonical posture generated from one source
- [Comparison Methodology](docs/COMPARISON_METHODOLOGY.md) — cost methodology and caveats
- [Operational SLOs](docs/OPERATIONAL_SLOS.md) — performance targets and measurement

</details>

---

### Verification

Security, release-integrity, and core regression claims are CI-backed. Comparison and economics sections are evidence-backed documentation, not universal product guarantees. To verify a signed release locally:

Release discipline (public truth standard):

- Canonical public-cert branch: `main`
- Canonical cert flow: `npm run cert:a-plus:fresh`
- Canonical cert artifact: `reports/a-plus-cert.json`
- `A+` is valid only when that exact cert flow passes on the exact `main` source branch with a clean worktree
- `npm run docs:audit` is the CI-aligned docs/claim-drift truth gate

Run the canonical cert flow locally:

```bash
npm run cert:a-plus:fresh
cat reports/a-plus-cert.json
```

```bash
cosign verify-blob \
  --signature checksums.txt.sig \
  --certificate checksums.txt.pem \
  --certificate-identity-regexp "^https://github.com/DrewDawson2027/claude-lead-system/.github/workflows/(release-bundle|supply-chain)\\.yml@refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+([-.][A-Za-z0-9._-]+)?$" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  checksums.txt
```

Benchmark results are published in `bench/latest-results.json` (SHA256-stamped in CI).

---

## Contributing

PRs welcome — especially for `tmux`/`zellij` split pane support and additional tests. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Author

**Drew Dawson** — [@DrewDawson2027](https://github.com/DrewDawson2027)

## License

MIT — see [LICENSE](LICENSE).
