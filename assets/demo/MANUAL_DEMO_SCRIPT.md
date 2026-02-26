# Manual Demo Recording Script

Record this with OBS or screen recording software. Total runtime: ~3 minutes.

## Pre-recording Setup

1. **Clean terminal prompt** — use a minimal PS1:
   ```bash
   export PS1="\w $ "
   ```

2. **Run the terminal layout script**:
   ```bash
   bash assets/demo/setup_demo_terminals.sh
   ```
   This opens 3 iTerm2 panes side by side.

3. **Clear all terminals** — `clear` in each pane

4. **Set working directory** in all panes:
   ```bash
   cd ~/claude-lead-system/assets/demo/demo-project
   ```

5. **Remove personal info**: no browser tabs, no notifications, no dock items with personal data

## Recording Flow

### Terminal Layout
```
┌─────────────────┬─────────────────┬─────────────────┐
│   Terminal A     │   Terminal B     │   Terminal C     │
│   (Lead)         │   (Worker A)     │   (Worker B)     │
└─────────────────┴─────────────────┴─────────────────┘
```

### Step 1: Boot Lead Dashboard (Terminal A) — 20 seconds

```
/lead
```

**What to show:** Dashboard with session table, W/E/B/R counters, status column.
**Pause:** Let the viewer see the full dashboard render.

### Step 2: Show Both Active Sessions (Terminal A) — 10 seconds

Point out that Terminal B and Terminal C appear in the dashboard as active sessions.

### Step 3: Spawn a Worker (Terminal A) — 30 seconds

```
run "write unit tests for src/auth.ts — cover login, register, and token generation" in ~/claude-lead-system/assets/demo/demo-project
```

**What to show:** Worker spawning in a new tab/split. Meta file creation. Worker prompt.
**Switch to Worker tab:** Show it running autonomously.

### Step 4: Send a Message (Terminal A) — 20 seconds

```
tell [session-id-of-terminal-B] to also add integration tests for the API routes in src/api.ts
```

**What to show:** Message sent confirmation. Switch to Terminal B — message appears on next tool call.

### Step 5: Show Conflict Detection (Terminal A) — 20 seconds

```
conflicts
```

**What to show:** Conflict warning when both sessions touch `src/auth.ts`.

### Step 6: Run a Pipeline (Terminal A) — 30 seconds

```
pipeline: lint, test, build in ~/claude-lead-system/assets/demo/demo-project
```

**What to show:** Pipeline script creation, sequential execution, per-step status.

### Step 7: Check Worker Result (Terminal A) — 20 seconds

```
check worker [worker-id] result
```

**What to show:** Worker output with files modified and test results.

### Step 8: Final Dashboard (Terminal A) — 10 seconds

```
/lead
```

**What to show:** Updated dashboard with all sessions, tool counts updated, conflict flags.

## Post-recording

1. Take screenshots at key moments (dashboard, conflict warning, worker spawn)
2. Trim video to ~2-3 minutes
3. Create GIF from the first 30 seconds (dashboard boot + worker spawn)
