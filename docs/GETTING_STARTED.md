# Getting Started with Claude Lead System

## Install (2 minutes)

```bash
git clone https://github.com/DrewDawson2027/claude-lead-system.git
cd claude-lead-system && bash install.sh
```

## Launch (30 seconds)

```bash
claudex
```

Then type: `/lead`

## Your First Dashboard (1 minute)

After `/lead` boots, you'll see a live table of all running Claude terminals — what each is working on, what files it's touching, and how long it's been active.

Try: `"what's running?"` to see active sessions.

## Detect Your First Conflict (2 minutes)

Open two Claude terminals working on the same project.

In your lead terminal: `"check conflicts"`

You'll see which files overlap — before either session overwrites the other.

## Spawn Your First Worker (2 minutes)

```
"start a worker to review the README"
```

Watch it appear in your dashboard. Type `"check on reviewer"` to see its live output.

## Send Your First Message (1 minute)

```
"tell the reviewer to focus on the install section"
```

The message lands in the worker's inbox on the next check cycle.

## What's Next

- **Multi-step pipelines:** `"run lint then test then build"` — each step tracked from one place
- **Budget limits:** workers stop after N turns — set it at spawn time
- **Split-pane view:** `"open split view"` — see all workers running simultaneously
- **Plan approval:** workers pause before executing — you approve or revise before any file changes

## Full Reference

- [Architecture Comparison](ARCHITECTURE-COMPARISON.md) — how Lead System differs from native Agent Teams
- [Troubleshooting](TROUBLESHOOTING.md) — common issues and fixes
- [Security](SECURITY.md) — security model and credential handling
