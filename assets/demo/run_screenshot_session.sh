#!/bin/bash
# Screenshot session — sets up iTerm2 panes and cycles through all 9 shots.
# Run this, then press Enter in the LEFT pane between shots.
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$DEMO_DIR/.screenshot-tmp"
rm -rf "$TMP" && mkdir -p "$TMP"

# ─── Worker A pane script ───
cat > "$TMP/worker-a.sh" << 'WA_EOF'
#!/bin/bash
export PS1="~ % "
printf '\033]0;Worker A\007'
sleep 1
clear
cat << 'S'

Session W-a8f3 • claude-sonnet-4-20250514 • demo-project
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

> Implement JWT authentication middleware for the API

● Reading existing auth module...

  Read src/auth.ts (67 lines)
  Read src/api.ts (42 lines)

● Adding JWT token generation to src/auth.ts

  Edit src/auth.ts
  + import jwt from 'jsonwebtoken'
  + export function generateToken(userId, config) {
  +   return jwt.sign({ sub: userId }, config.secret)
  + }

● Adding auth middleware that protects routes.

  Edit src/auth.ts
  + export function authMiddleware(req, res, next) {
  +   const header = req.headers.authorization
  +   if (!header?.startsWith('Bearer ')) {
  +     return res.status(401).json({ error: 'Missing token' })
  +   }
  +   const payload = verifyToken(header.slice(7), req.app.config)
  +   req.user = payload
  +   next()
  + }
S
while true; do sleep 60; done
WA_EOF
chmod +x "$TMP/worker-a.sh"

# ─── Worker B pane script (watches for signal to swap content) ───
cat > "$TMP/worker-b.sh" << 'WB_EOF'
#!/bin/bash
export PS1="~ % "
SIGNAL_DIR="$1"
printf '\033]0;Worker B\007'
sleep 1
clear
cat << 'S'

Session W-c2e7 • claude-sonnet-4-20250514 • demo-project
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

> Add error handling and input validation to the API

● Reading current API structure...

  Read src/api.ts (42 lines)
  Read src/auth.ts (67 lines)

● Adding validation schemas to src/auth.ts

  Edit src/auth.ts
  + import { z } from 'zod'
  + const LoginSchema = z.object({
  +   username: z.string().min(3).max(50),
  +   password: z.string().min(8)
  + })

● Adding global error handler...

  Edit src/api.ts
  + export class ApiError extends Error {
  +   constructor(public status, message, public code) {
  +     super(message)
  +   }
  + }
  + export function errorHandler(err, req, res) {
  +   if (err instanceof ApiError) {
  +     return res.status(err.status).json({ error: err.message })
  +   }
  +   res.status(500).json({ error: 'Internal server error' })
  + }
S

# Wait for signal to show directive
while [ ! -f "$SIGNAL_DIR/show-directive" ]; do sleep 0.3; done

clear
cat << 'S'

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
  +     const key = req.ip || 'unknown'
  +     const now = Date.now()
  +     if (window.count > maxRequests) {
  +       return res.status(429).json({ error: 'Too many requests' })
  +     }
  +     next()
  +   }
  + }

● Running tests...

  Bash npm test
  PASS tests/api.test.ts
    ✓ rate limiter blocks after threshold (18ms)
    ✓ rate limiter resets after window (9ms)
    ✓ error handler formats ApiError (3ms)

  Tests:  3 passed, 3 total
S
while true; do sleep 60; done
WB_EOF
chmod +x "$TMP/worker-b.sh"

# ─── Lead pane script (cycles through shots on Enter) ───
cat > "$TMP/lead.sh" << 'LEAD_EOF'
#!/bin/bash
export PS1="~ % "
SIGNAL_DIR="$1"
printf '\033]0;Lead\007'
sleep 1

wait_key() {
  echo ""
  echo "───────────────────────────────────────────"
  echo "  📸 SCREENSHOT NOW  (Cmd+Shift+4 → spacebar → click)"
  echo "  Press Enter for next shot..."
  echo "───────────────────────────────────────────"
  read -r
}

# SHOT 1
clear
echo ""
echo "  Session L-001 • claude-sonnet-4-20250514 • demo-project"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  > /lead"
echo ""
echo "  Booting lead session... scanning terminals..."
echo ""
echo "  [Shot 1/9: Two workers same file — look at right panes]"
wait_key

# SHOT 2
clear
cat << 'S'

╔═══════════════════════════════════════════════════════╗
║         CLAUDE LEAD SYSTEM — LIVE DASHBOARD          ║
╚═══════════════════════════════════════════════════════╝

📡 Active Sessions
┌──────────┬──────────────┬────────┬────────────────────────────┐
│ Session  │ Status       │ Model  │ Current Task               │
├──────────┼──────────────┼────────┼────────────────────────────┤
│ W-a8f3   │ ● active     │ sonnet │ JWT auth middleware         │
│ W-c2e7   │ ● active     │ sonnet │ Error handling + validation │
│ L-001    │ ● lead       │ sonnet │ Orchestration              │
└──────────┴──────────────┴────────┴────────────────────────────┘

📂 Files in Flight
┌──────────────────────┬───────────────────┬──────────┐
│ File                 │ Sessions          │ Status   │
├──────────────────────┼───────────────────┼──────────┤
│ src/auth.ts          │ W-a8f3, W-c2e7    │ CONFLICT │
│ src/api.ts           │ W-c2e7            │ OK       │
│ tests/auth.test.ts   │ W-a8f3            │ OK       │
└──────────────────────┴───────────────────┴──────────┘

⚠  CONFLICT DETECTED  Both workers editing src/auth.ts
   W-a8f3: JWT generateToken, verifyToken, authMiddleware
   W-c2e7: error handler refactor touching auth imports

  [Shot 2/9: Conflict detected]
S
wait_key

# SHOT 3
clear
cat << 'S'

╔═══════════════════════════════════════════════════════╗
║         CLAUDE LEAD SYSTEM — LIVE DASHBOARD          ║
╚═══════════════════════════════════════════════════════╝

📡 Active Sessions (3 workers + lead)
┌──────────┬──────────────┬────────┬──────────────────────────────────┐
│ Session  │ Status       │ Model  │ Current Task                     │
├──────────┼──────────────┼────────┼──────────────────────────────────┤
│ W-a8f3   │ ● active     │ sonnet │ JWT auth middleware               │
│ W-c2e7   │ ● active     │ sonnet │ Error handling + validation       │
│ W-d9b1   │ ● active     │ sonnet │ Integration tests for user flow   │
│ L-001    │ ● lead       │ sonnet │ Orchestration                    │
└──────────┴──────────────┴────────┴──────────────────────────────────┘

📊 Session Metrics
  Total tools used: 23 (Read: 9, Edit: 8, Bash: 6)
  Files in flight: 5 across 3 workers
  Conflicts: 0
  Uptime: 8m 31s

  [Shot 3/9: Clean dashboard with 3 workers]
S
wait_key

# SHOT 4
clear
cat << 'S'

● Resolving conflict — reassigning Worker B to avoid overlap.

💬 Sending directives...

  tell W-a8f3 "Focus on JWT validation + token refresh only.
  Worker B is handling error responses — skip the error handler
  refactor to avoid conflicts."
  ✓ Delivered to W-a8f3 via inbox

  tell W-c2e7 "Conflict detected on src/auth.ts — Worker A owns
  auth changes. Switch to rate limiting middleware: create
  src/rate-limiter.ts with sliding window algorithm.
  Apply to /login and /register routes."
  ✓ Delivered to W-c2e7 via inbox

  reassign W-c2e7
  ✓ Reassigned: error handling → rate limiting middleware

  ✓ 2 directives sent. Workers will see them on next tool call.

  [Shot 4/9: Directive sent]
S
wait_key

# SHOT 5 — signal worker-b to swap content
touch "$SIGNAL_DIR/show-directive"
sleep 0.8
clear
cat << 'S'

● Monitoring directive delivery...

  W-a8f3  ✓ acknowledged — continuing JWT work
  W-c2e7  ✓ acknowledged — pivoting to rate limiter

● Both workers confirmed. No further overlap on src/auth.ts.

  [Shot 5/9: Worker received directive — look at bottom-right pane]
S
wait_key

# SHOT 6
clear
cat << 'S'

── Dashboard Refresh ──

📡 Active Sessions  (updated 2s ago)
┌──────────┬──────────────┬────────┬────────────────────────────┐
│ Session  │ Status       │ Model  │ Current Task               │
├──────────┼──────────────┼────────┼────────────────────────────┤
│ W-a8f3   │ ● active     │ sonnet │ JWT + token refresh         │
│ W-c2e7   │ ● active     │ sonnet │ Rate limiting middleware    │
│ L-001    │ ● lead       │ sonnet │ Orchestration              │
└──────────┴──────────────┴────────┴────────────────────────────┘

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

  [Shot 6/9: Conflict resolved]
S
wait_key

# SHOT 7
clear
cat << 'S'

> broadcast "Sync to main before merging — release cut at 3pm"

📢 Broadcasting to all active sessions...

  → W-a8f3  ✓ delivered
  → W-c2e7  ✓ delivered
  → W-d9b1  ✓ delivered

  ✓ Broadcast complete — 3/3 workers notified

  [Shot 7/9: Broadcast]
S
wait_key

# SHOT 8
clear
cat << 'S'

📋 Task Board
┌────────────┬────────────────────────────────────┬────────────┬──────────┐
│ Task       │ Subject                            │ Assigned   │ Status   │
├────────────┼────────────────────────────────────┼────────────┼──────────┤
│ task-001   │ Fix JWT token expiry bug            │ worker-a   │ ● done   │
│ task-002   │ Add rate limiting to auth endpoints │ worker-b   │ ● active │
│ task-003   │ Write integration test suite        │ worker-c   │ ● active │
│ task-004   │ Update API documentation            │ unassigned │ ○ pending│
└────────────┴────────────────────────────────────┴────────────┴──────────┘

  1 completed, 2 in progress, 1 pending
  Tasks persist across sessions — survives terminal restarts

  [Shot 8/9: Task board]
S
wait_key

# SHOT 9
clear
cat << 'S'

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

  [Shot 9/9: Health check]
S

echo ""
echo "═══════════════════════════════════════"
echo "  ✅ ALL 9 SHOTS DONE"
echo "═══════════════════════════════════════"
echo "  Press Enter to close everything."
read -r
LEAD_EOF
chmod +x "$TMP/lead.sh"

# ─── Launch iTerm2 with 3 panes ───
osascript << APPLESCRIPT
tell application "iTerm2"
  activate
  delay 0.3

  -- Create a brand new window
  set newWindow to (create window with default profile)
  delay 0.5

  tell newWindow
    set bounds to {0, 0, 2560, 1440}
    delay 0.3

    -- Tab 1 is the only tab, session 1 is the lead (left pane)
    tell current tab
      tell item 1 of sessions
        -- This is the left pane — Lead
        write text "clear && bash '$TMP/lead.sh' '$TMP'"

        -- Split this session vertically to create the right pane
        set workerA to (split vertically with default profile)
      end tell

      -- workerA is the right pane — split it horizontally
      tell workerA
        write text "clear && bash '$TMP/worker-a.sh'"
        set workerB to (split horizontally with default profile)
      end tell

      -- workerB is the bottom-right pane
      tell workerB
        write text "clear && bash '$TMP/worker-b.sh' '$TMP'"
      end tell
    end tell
  end tell
end tell
APPLESCRIPT

echo "iTerm2 is set up — go to that window."
echo "Press Enter in the LEFT pane to cycle through shots."
