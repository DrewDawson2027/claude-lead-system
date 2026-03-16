# Getting Started with Claude Lead System

Your first 10 minutes. Step by step.

---

## Step 1: Install (2 minutes)

Open your terminal and run these two commands:

```bash
git clone https://github.com/DrewDawson2027/claude-lead-system.git
cd claude-lead-system && bash install.sh
```

The first command downloads the project to your computer. The second runs the installer — it copies the right files to where Claude Code looks for them.

When you see `Install complete`, you're done.

---

## Step 2: Launch (30 seconds)

In the same terminal window, run:

```bash
claudex
```

This starts Claude Code with the Lead System active. You'll see Claude's normal interface — but now it has the coordinator running in the background.

Once Claude is ready, type:

```
/lead
```

Press Enter. The Lead System boots up and you'll see your dashboard.

---

## Step 3: Your First Dashboard (1 minute)

The dashboard shows all your Claude terminals — what project each one is working on, which files it's touching, and how long it's been running.

If you only have one terminal open right now, you'll see just yours.

Try typing:

```
what's running?
```

The Lead will respond with a list of active sessions. Each session is one Claude terminal window on your machine.

---

## Step 4: Detect Your First Conflict (2 minutes)

This is the main reason to use Lead. Here's how to see it in action:

1. Keep your Lead terminal open
2. Open a **second** terminal window
3. In the second terminal, `cd` into the same project folder and start working on any file

Now go back to your Lead terminal and type:

```
check conflicts
```

If both terminals have touched the same file, you'll see something like:

```
CONFLICT: src/auth.ts — session-a (editing) ↔ session-b (editing)
```

That's a collision that would have silently overwritten work. Lead caught it before it happened.

---

## Step 5: Spawn Your First Worker (2 minutes)

Workers are Claude sessions that run a specific task and stop when they're done. You don't need to babysit them.

In your Lead terminal, type:

```
start a worker to review the README
```

Watch your dashboard — a new row appears for the reviewer worker. It's now reading the README and writing its analysis.

To check on it while it runs:

```
check on reviewer
```

You'll see live output: what the worker is reading, what it's finding, where it is in the task.

---

## Step 6: Send Your First Message (1 minute)

You can redirect a worker mid-task without stopping it.

```
tell the reviewer to focus on the install section
```

The message lands in the worker's inbox. On its next check cycle (usually within a few seconds), it reads it and adjusts what it's doing.

This is how you steer multiple workers from one place — no switching windows, no re-prompting.

---

## What's Next

Once you're comfortable with the basics, here's what else Lead can do:

**Multi-step pipelines**
Run a sequence of tasks in order, each tracked from one place:

```
run lint then test then build
```

**Budget limits**
Cap how many turns a worker can take before it stops:

```
start a worker with a 10-turn budget to refactor auth.ts
```

**Split-pane view**
See all workers running at the same time:

```
open split view
```

**Plan approval**
Workers pause before touching any file — you approve or revise their plan first:

```
start a worker in plan mode to redesign the database schema
```

---

## Full Reference

- [MCP Tool Reference](MCP_TOOL_REFERENCE.md) — all 81 coordinator tools
- [Architecture Comparison](ARCHITECTURE-COMPARISON.md) — how Lead differs from native Agent Teams
- [Compatibility Matrix](COMPATIBILITY_MATRIX.md) — platform support evidence
- [Known Limitations](KNOWN_LIMITATIONS.md) — what doesn't work yet and why
