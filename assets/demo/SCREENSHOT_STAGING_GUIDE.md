# Screenshot Staging Guide

Take real screenshots of the Lead System in action without revealing personal info.

**Time needed:** ~20 minutes
**Terminals needed:** 3 (iTerm2 split panes recommended)
**Screenshots:** 9 shots across 3 groups

---

## Pre-Flight: Privacy Prep (do this first)

### 1. Clean your shell prompt

Run this in EVERY terminal you will screenshot:

```bash
export PS1="%~ %# "
```

This removes your username from the prompt. You will see `~ %` instead of your full path.

### 2. Hide dock and menu bar for cleaner crops

- Cmd+Option+D to auto-hide the dock
- System Settings > Desktop & Dock > "Automatically hide and show the menu bar" > "Always"

### 3. Use a clean iTerm2 profile

- iTerm2 > Preferences > Profiles > + (create new)
- Name it "Demo"
- Set background to pure black (#000000) or very dark gray (#1a1a2e)
- Font: SF Mono or Menlo, 14pt
- Window size: 120 columns x 35 rows
- No transparency

---

## Phase 1: Stage the Coordinator State

The lead system reads JSON files from `~/.claude/terminals/`. We create clean fake session files so the dashboard shows realistic data with no personal info.

### Step 1: Back up existing state

```bash
cp -r ~/.claude/terminals ~/.claude/terminals.backup.$(date +%s)
```

### Step 2: Create clean session files

```bash
mkdir -p ~/.claude/terminals/inbox
mkdir -p ~/.claude/terminals/results
```

**Worker A session file:**

```bash
cat > ~/.claude/terminals/session-worker-a.json << 'EOF'
{
  "session_id": "W-a8f3",
  "worker_name": "worker-a",
  "tty": "ttys003",
  "model": "claude-sonnet-4-20250514",
  "status": "active",
  "current_task": "Implement JWT authentication middleware",
  "project": "~/demo-project",
  "files_touched": ["src/auth.ts", "tests/auth.test.ts"],
  "tools_used": { "Read": 4, "Edit": 3, "Bash": 2 },
  "started_at": "2026-03-18T10:15:00Z",
  "last_active": "2026-03-18T10:22:31Z"
}
EOF
```

**Worker B session file:**

```bash
cat > ~/.claude/terminals/session-worker-b.json << 'EOF'
{
  "session_id": "W-c2e7",
  "worker_name": "worker-b",
  "tty": "ttys005",
  "model": "claude-sonnet-4-20250514",
  "status": "active",
  "current_task": "Add error handling and input validation",
  "project": "~/demo-project",
  "files_touched": ["src/api.ts", "src/auth.ts"],
  "tools_used": { "Read": 3, "Edit": 4, "Bash": 1 },
  "started_at": "2026-03-18T10:14:00Z",
  "last_active": "2026-03-18T10:23:05Z"
}
EOF
```

**Worker C session file (optional, for 3-worker dashboard):**

```bash
cat > ~/.claude/terminals/session-worker-c.json << 'EOF'
{
  "session_id": "W-d9b1",
  "worker_name": "worker-c",
  "tty": "ttys007",
  "model": "claude-sonnet-4-20250514",
  "status": "active",
  "current_task": "Write integration tests for user flow",
  "project": "~/demo-project",
  "files_touched": ["tests/integration/user-flow.test.ts"],
  "tools_used": { "Read": 2, "Edit": 1, "Bash": 3 },
  "started_at": "2026-03-18T10:16:00Z",
  "last_active": "2026-03-18T10:21:47Z"
}
EOF
```

---

## Phase 2: Set Up the iTerm2 Layout

### Three-pane layout

1. Open iTerm2 with your "Demo" profile
2. Cmd+D to split vertically (2 panes side by side)
3. Click the RIGHT pane, then Cmd+Shift+D to split it horizontally

**Pane assignment:**
- **Left pane (wide):** Lead session
- **Top-right:** Worker A output
- **Bottom-right:** Worker B output

Run `export PS1="%~ %# "` in all 3 panes.

---

## Phase 3: Take the Screenshots

### GROUP 1: The Problem

---

#### Shot 1 — Two workers, same file

Shows two terminals both editing src/auth.ts, unaware of each other.

**Top-right pane (Worker A):**
```bash
clear && echo '
Session W-a8f3 • claude-sonnet-4-20250514 • demo-project
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

> Implement JWT authentication middleware for the API

● Reading existing auth module...

  Read src/auth.ts (67 lines)
  Read src/api.ts (42 lines)

● Adding JWT token generation to src/auth.ts

  Edit src/auth.ts
  + import jwt from "jsonwebtoken"
  + export function generateToken(userId, config) {
  +   return jwt.sign({ sub: userId }, config.secret)
  + }
'
```

**Bottom-right pane (Worker B):**
```bash
clear && echo '
Session W-c2e7 • claude-sonnet-4-20250514 • demo-project
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

> Add error handling and input validation to the API

● Reading current API structure...

  Read src/api.ts (42 lines)
  Read src/auth.ts (67 lines)

● Adding validation schemas to src/auth.ts

  Edit src/auth.ts
  + import { z } from "zod"
  + const LoginSchema = z.object({
  +   username: z.string().min(3).max(50),
  +   password: z.string().min(8)
  + })
'
```

Leave the left pane showing a clean prompt.

**>>> SCREENSHOT NOW** (Cmd+Shift+4, spacebar, click iTerm window)
Save as: `two-workers-same-file.png`

---

#### Shot 2 — Conflict detected

**Left pane (Lead):**
```bash
clear && echo '
╔═══════════════════════════════════════════════════════╗
║         CLAUDE LEAD SYSTEM — LIVE DASHBOARD          ║
╚═══════════════════════════════════════════════════════╝

📡 Active Sessions
┌──────────┬──────────────┬────────┬───────────────────────────┐
│ Session  │ Status       │ Model  │ Current Task              │
├──────────┼──────────────┼────────┼───────────────────────────┤
│ W-a8f3   │ ● active     │ sonnet │ JWT auth middleware        │
│ W-c2e7   │ ● active     │ sonnet │ Error handling + validation│
│ L-001    │ ● lead       │ sonnet │ Orchestration             │
└──────────┴──────────────┴────────┴───────────────────────────┘

📂 Files in Flight
┌──────────────────────┬───────────────────┬──────────┐
│ File                 │ Sessions          │ Status   │
├──────────────────────┼───────────────────┼──────────┤
│ src/auth.ts          │ W-a8f3, W-c2e7    │ CONFLICT │
│ src/api.ts           │ W-c2e7            │ OK       │
│ tests/auth.test.ts   │ W-a8f3            │ OK       │
└──────────────────────┴───────────────────┴──────────┘

⚠  CONFLICT DETECTED  Both workers editing src/auth.ts
'
```

**>>> SCREENSHOT NOW**
Save as: `conflict-detected.png`

---

### GROUP 2: The System Working

---

#### Shot 3 — Lead dashboard (3 workers, clean state)

**Left pane:**
```bash
clear && echo '
╔═══════════════════════════════════════════════════════╗
║         CLAUDE LEAD SYSTEM — LIVE DASHBOARD          ║
╚═══════════════════════════════════════════════════════╝

📡 Active Sessions (3 workers + lead)
┌──────────┬──────────────┬────────┬─────────────────────────────────┐
│ Session  │ Status       │ Model  │ Current Task                    │
├──────────┼──────────────┼────────┼─────────────────────────────────┤
│ W-a8f3   │ ● active     │ sonnet │ JWT auth middleware              │
│ W-c2e7   │ ● active     │ sonnet │ Error handling + validation      │
│ W-d9b1   │ ● active     │ sonnet │ Integration tests for user flow  │
│ L-001    │ ● lead       │ sonnet │ Orchestration                   │
└──────────┴──────────────┴────────┴─────────────────────────────────┘

📊 Session Metrics
  Total tools used: 23 (Read: 9, Edit: 8, Bash: 6)
  Files in flight: 5 across 3 workers
  Conflicts: 0
  Uptime: 8m 31s
'
```

**>>> SCREENSHOT NOW**
Save as: `lead-dashboard.png`

---

#### Shot 4 — Directive sent

**Left pane:**
```bash
clear && echo '
● Resolving conflict — reassigning Worker B to avoid overlap.

💬 Sending directives...

  tell W-a8f3 "Focus on JWT validation + token refresh only."
  ✓ Delivered to W-a8f3 via inbox

  tell W-c2e7 "Conflict on src/auth.ts — switch to rate limiting.
  Create src/rate-limiter.ts with sliding window algorithm."
  ✓ Delivered to W-c2e7 via inbox

  ✓ 2 directives sent. Workers will see them on next tool call.
'
```

**>>> SCREENSHOT NOW**
Save as: `directive-sent.png`

---

#### Shot 5 — Worker receives directive

**Bottom-right pane (Worker B):**
```bash
clear && echo '
Session W-c2e7 • claude-sonnet-4-20250514 • demo-project
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────┐
│  📨 MESSAGE from lead (session L-001)               │
│                                                     │
│  Conflict detected on src/auth.ts — Worker A owns   │
│  auth changes. Switch to rate limiting middleware:   │
│  Create src/rate-limiter.ts with sliding window     │
│  algorithm. Apply to /login and /register routes.   │
└─────────────────────────────────────────────────────┘

● Got it — pivoting to rate limiter. Creating new module.

  Write src/rate-limiter.ts
  + export function rateLimit(maxRequests = 10, windowMs = 60000) {
  +   return (req, res, next) => {
  +     const key = req.ip
  +     // sliding window rate limiting
  +     ...
  +   }
  + }
'
```

**>>> SCREENSHOT NOW** (capture the full window to show lead pane + worker pane together)
Save as: `directive-received.png`

---

#### Shot 6 — Conflict resolved

**Left pane:**
```bash
clear && echo '
── Dashboard Refresh ──

📂 Files in Flight  (conflicts resolved)
┌──────────────────────┬───────────────────┬──────────┐
│ File                 │ Sessions          │ Status   │
├──────────────────────┼───────────────────┼──────────┤
│ src/auth.ts          │ W-a8f3            │ OK       │
│ src/api.ts           │ W-c2e7            │ OK       │
│ src/rate-limiter.ts  │ W-c2e7            │ OK       │
│ tests/auth.test.ts   │ W-a8f3            │ OK       │
└──────────────────────┴───────────────────┴──────────┘

✓ All conflicts resolved. Workers redirected via local inbox messaging.

━━━ Session Summary ━━━
  ✓ 2 workers orchestrated
  ✓ 1 file conflict detected and resolved
  ✓ 2 directives sent via local inbox delivery
  ✓ 0 extra tokens spent on coordination
'
```

**>>> SCREENSHOT NOW**
Save as: `conflict-resolved.png`

---

### GROUP 3: Advanced Features

---

#### Shot 7 — Broadcast message

**Left pane:**
```bash
clear && echo '
> broadcast "Sync to main before merging — release cut at 3pm"

📢 Broadcasting to all active sessions...

  → W-a8f3  ✓ delivered
  → W-c2e7  ✓ delivered
  → W-d9b1  ✓ delivered

  ✓ Broadcast complete — 3/3 workers notified
'
```

**>>> SCREENSHOT NOW**
Save as: `broadcast.png`

---

#### Shot 8 — Task board

**Left pane:**
```bash
clear && echo '
📋 Task Board
┌────────────┬──────────────────────────────────┬────────────┬──────────┐
│ Task       │ Subject                          │ Assigned   │ Status   │
├────────────┼──────────────────────────────────┼────────────┼──────────┤
│ task-001   │ Fix JWT token expiry bug          │ worker-a   │ ● done   │
│ task-002   │ Add rate limiting to auth         │ worker-b   │ ● active │
│ task-003   │ Write integration test suite      │ worker-c   │ ● active │
│ task-004   │ Update API docs                   │ unassigned │ ○ pending│
└────────────┴──────────────────────────────────┴────────────┴──────────┘

  3 in progress, 1 pending, 1 completed
  Tasks persist across sessions — survives terminal restarts
'
```

**>>> SCREENSHOT NOW**
Save as: `task-board.png`

---

#### Shot 9 — Health check

**Left pane:**
```bash
clear && echo '
🏥 System Health Check

  Sessions
    W-a8f3   ● healthy  last active 12s ago
    W-c2e7   ● healthy  last active 8s ago
    W-d9b1   ● healthy  last active 23s ago
    L-001    ● healthy  lead session

  Coordination
    Inbox delivery   ✓ operational
    Conflict detect  ✓ operational
    State files      ✓ 4 sessions tracked
    Activity log     ✓ 47 events recorded

  ✓ All systems healthy — 4/4 sessions responding
'
```

**>>> SCREENSHOT NOW**
Save as: `health-check.png`

---

## Phase 4: Clean Up

```bash
# Restore original session files
rm -rf ~/.claude/terminals
mv ~/.claude/terminals.backup.* ~/.claude/terminals

# Restore your prompt
source ~/.zshrc

# Unhide dock: Cmd+Option+D
```

---

## Shot Checklist

| # | Group    | Shot                        | Filename                   | Done |
|---|----------|-----------------------------|----------------------------|------|
| 1 | Problem  | Two workers, same file      | two-workers-same-file.png  |      |
| 2 | Problem  | Conflict detected           | conflict-detected.png      |      |
| 3 | Working  | Lead dashboard (3 workers)  | lead-dashboard.png         |      |
| 4 | Working  | Directive sent              | directive-sent.png         |      |
| 5 | Working  | Worker receives directive   | directive-received.png     |      |
| 6 | Working  | Conflict resolved           | conflict-resolved.png      |      |
| 7 | Advanced | Broadcast message           | broadcast.png              |      |
| 8 | Advanced | Task board                  | task-board.png             |      |
| 9 | Advanced | Health check                | health-check.png           |      |

Save all to: `~/claude-lead-system/assets/demo/screenshots/`

---

## Tips

- **Retina captures:** Cmd+Shift+4 then spacebar = window-only capture with drop shadow at 2x resolution
- **Font size:** 14pt minimum — anything smaller is unreadable on mobile
- **Consistency:** Same iTerm profile for all shots. Switching themes looks jarring.
- **Story order:** Shoot 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 as one flow
