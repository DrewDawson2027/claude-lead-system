#!/usr/bin/env bash
# Full automated demo recording: Lead System orchestrating 2 workers
# Outputs: demo-full.mp4 (video) + demo-full.gif (hero GIF)
#
# Requirements: iTerm2, ffmpeg, agg, asciinema
# Usage: bash assets/demo/record_full_demo.sh

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$DEMO_DIR/../.." && pwd)"
OUTPUT_DIR="$DEMO_DIR"
TERMINALS_DIR="$HOME/.claude/terminals"
INBOX_DIR="$TERMINALS_DIR/inbox"
RESULTS_DIR="$TERMINALS_DIR/results"

# Clean colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ── Fake session data for 2 workers ──────────────────────────────────────────
SID_A="a7f3b2c1"
SID_B="e9d4f8a6"
ACTIVITY_FILE="$TERMINALS_DIR/activity.jsonl"

setup_fake_sessions() {
  mkdir -p "$TERMINALS_DIR" "$INBOX_DIR" "$RESULTS_DIR"

  cat > "$TERMINALS_DIR/session-${SID_A}.json" << 'SESS'
{
  "session": "a7f3b2c1",
  "status": "active",
  "project": "lead-demo",
  "branch": "feat/auth",
  "cwd": "/Users/dev/lead-demo",
  "tty": "/dev/ttys005",
  "started": "2026-02-26T19:42:00Z",
  "last_active": "PLACEHOLDER_TIME",
  "schema_version": 2,
  "tool_counts": { "Write": 4, "Edit": 7, "Bash": 12, "Read": 18 },
  "files_touched": ["src/auth.ts", "src/db.ts", "tests/auth.test.ts", "src/middleware.ts"],
  "recent_ops": [
    { "tool": "Edit", "file": "src/auth.ts", "t": "2026-02-26T19:51:12Z" },
    { "tool": "Write", "file": "tests/auth.test.ts", "t": "2026-02-26T19:51:08Z" },
    { "tool": "Bash", "file": "", "t": "2026-02-26T19:50:55Z" },
    { "tool": "Read", "file": "src/db.ts", "t": "2026-02-26T19:50:42Z" }
  ],
  "current_task": "Implementing JWT auth with bcrypt password hashing"
}
SESS

  cat > "$TERMINALS_DIR/session-${SID_B}.json" << 'SESS'
{
  "session": "e9d4f8a6",
  "status": "active",
  "project": "lead-demo",
  "branch": "feat/api-errors",
  "cwd": "/Users/dev/lead-demo",
  "tty": "/dev/ttys006",
  "started": "2026-02-26T19:44:00Z",
  "last_active": "PLACEHOLDER_TIME",
  "schema_version": 2,
  "tool_counts": { "Write": 2, "Edit": 5, "Bash": 8, "Read": 11 },
  "files_touched": ["src/api.ts", "src/auth.ts", "tests/api.test.ts", "src/errors.ts"],
  "recent_ops": [
    { "tool": "Edit", "file": "src/api.ts", "t": "2026-02-26T19:51:02Z" },
    { "tool": "Edit", "file": "src/errors.ts", "t": "2026-02-26T19:50:48Z" },
    { "tool": "Read", "file": "src/auth.ts", "t": "2026-02-26T19:50:35Z" }
  ],
  "current_task": "Adding structured error handling to API routes"
}
SESS

  # Fix timestamps to be "now"
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  sed -i '' "s/PLACEHOLDER_TIME/$now/g" "$TERMINALS_DIR/session-${SID_A}.json"
  sed -i '' "s/PLACEHOLDER_TIME/$now/g" "$TERMINALS_DIR/session-${SID_B}.json"
}

cleanup_fake_sessions() {
  rm -f "$TERMINALS_DIR/session-${SID_A}.json" "$TERMINALS_DIR/session-${SID_B}.json"
  rm -f "$INBOX_DIR/${SID_A}.jsonl" "$INBOX_DIR/${SID_B}.jsonl"
}

# ── iTerm2 helpers ───────────────────────────────────────────────────────────
type_in_pane() {
  local pane_idx="$1"
  local text="$2"
  osascript <<EOF
tell application "iTerm2"
  tell window 1
    tell tab 1
      tell session $pane_idx
        write text "$text"
      end tell
    end tell
  end tell
end tell
EOF
}

slow_type() {
  # Types text character by character with delay for dramatic effect
  local pane_idx="$1"
  local text="$2"
  local delay="${3:-0.03}"

  osascript <<EOF
tell application "iTerm2"
  tell window 1
    tell tab 1
      tell session $pane_idx
        write text "$text"
      end tell
    end tell
  end tell
end tell
EOF
}

clear_pane() {
  type_in_pane "$1" "clear"
}

# ── Worker simulation scripts ────────────────────────────────────────────────
create_worker_scripts() {
  # Worker A: simulates Claude working on auth tests
  cat > /tmp/demo_worker_a.sh << 'WORKER_A'
#!/bin/bash
export PS1="$ "
clear
printf '\033[1;36m╭─ Claude Code Worker A ─── feat/auth ───────────────────╮\033[0m\n'
printf '\033[1;36m│\033[0m Task: Implementing JWT auth with bcrypt password hashing\033[1;36m │\033[0m\n'
printf '\033[1;36m╰────────────────────────────────────────────────────────╯\033[0m\n\n'
sleep 1

printf '\033[2m● Reading src/auth.ts...\033[0m\n'
sleep 0.8
printf '\033[0;32m✓\033[0m Read src/auth.ts (62 lines)\n'
sleep 0.5

printf '\033[2m● Reading tests/auth.test.ts...\033[0m\n'
sleep 0.6
printf '\033[0;32m✓\033[0m Read tests/auth.test.ts (15 lines)\n'
sleep 0.4

printf '\n\033[1mAnalyzing auth module...\033[0m\n'
printf '  → login() needs bcrypt.compare for password verification\n'
printf '  → register() needs bcrypt.hash + duplicate email check\n'
printf '  → generateToken() needs JWT signing with secret\n'
sleep 1.5

printf '\n\033[2m● Editing src/auth.ts...\033[0m\n'
sleep 1
printf '\033[0;32m✓\033[0m Edit src/auth.ts — added bcrypt import and verifyPassword implementation\n'
sleep 0.7

printf '\033[2m● Editing src/auth.ts...\033[0m\n'
sleep 0.8
printf '\033[0;32m✓\033[0m Edit src/auth.ts — added JWT token generation with jsonwebtoken\n'
sleep 0.6

printf '\033[2m● Writing tests/auth.test.ts...\033[0m\n'
sleep 1.2
printf '\033[0;32m✓\033[0m Write tests/auth.test.ts — 6 test cases: login success/fail, register success/duplicate, token verify/expire\n'
sleep 0.8

printf '\n\033[2m● Running tests...\033[0m\n'
sleep 1.5
printf '\033[0;32m✓\033[0m 6 tests passed (0.847s)\n'
sleep 0.5

printf '\033[2m● Editing src/middleware.ts...\033[0m\n'
sleep 1
printf '\033[0;32m✓\033[0m Edit src/middleware.ts — added auth middleware with token extraction\n'

# Now pause and wait for inbox message
sleep 3
printf '\n\033[1;33m━━━ Inbox Message from Lead ━━━\033[0m\n'
printf '\033[1;33m│\033[0m Also add integration tests for the login flow —\n'
printf '\033[1;33m│\033[0m test the full request→auth→response pipeline with\n'
printf '\033[1;33m│\033[0m mock database, not just unit tests.\n'
printf '\033[1;33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n\n'
sleep 1.5

printf '\033[1mPivoting to integration tests...\033[0m\n'
sleep 0.8
printf '\033[2m● Reading src/api.ts...\033[0m\n'
sleep 0.6
printf '\033[0;32m✓\033[0m Read src/api.ts (42 lines)\n'
sleep 0.4

printf '\033[2m● Writing tests/auth.integration.test.ts...\033[0m\n'
sleep 1.5
printf '\033[0;32m✓\033[0m Write tests/auth.integration.test.ts — 4 integration tests: POST /login, POST /register, auth middleware, token refresh\n'
sleep 0.8

printf '\033[2m● Running full test suite...\033[0m\n'
sleep 2
printf '\033[0;32m✓\033[0m 10 tests passed (1.234s)\n\n'
printf '\033[1;32m✓ Task complete:\033[0m JWT auth + bcrypt + 10 tests (6 unit + 4 integration)\n'
sleep 999
WORKER_A

  # Worker B: simulates Claude working on API error handling
  cat > /tmp/demo_worker_b.sh << 'WORKER_B'
#!/bin/bash
export PS1="$ "
clear
printf '\033[1;35m╭─ Claude Code Worker B ─── feat/api-errors ────────────╮\033[0m\n'
printf '\033[1;35m│\033[0m Task: Adding structured error handling to API routes  \033[1;35m│\033[0m\n'
printf '\033[1;35m╰───────────────────────────────────────────────────────╯\033[0m\n\n'
sleep 1.5

printf '\033[2m● Reading src/api.ts...\033[0m\n'
sleep 0.7
printf '\033[0;32m✓\033[0m Read src/api.ts (42 lines)\n'
sleep 0.5

printf '\033[2m● Reading src/auth.ts...\033[0m\n'
sleep 0.6
printf '\033[0;32m✓\033[0m Read src/auth.ts (62 lines)\n'
sleep 0.3

printf '\n\033[1mPlanning error handling strategy...\033[0m\n'
printf '  → Create AppError class with status codes\n'
printf '  → Add try/catch to all route handlers\n'
printf '  → Add error middleware for consistent JSON responses\n'
printf '  → Add request validation with Zod schemas\n'
sleep 2

printf '\n\033[2m● Writing src/errors.ts...\033[0m\n'
sleep 1
printf '\033[0;32m✓\033[0m Write src/errors.ts — AppError class, NotFoundError, ValidationError, AuthError\n'
sleep 0.8

printf '\033[2m● Editing src/api.ts...\033[0m\n'
sleep 1.2
printf '\033[0;32m✓\033[0m Edit src/api.ts — wrapped handlers in try/catch, added validation\n'
sleep 0.7

printf '\033[2m● Editing src/api.ts...\033[0m\n'
sleep 0.9
printf '\033[0;32m✓\033[0m Edit src/api.ts — added error middleware at bottom of chain\n'
sleep 0.5

printf '\033[2m● Writing tests/api.test.ts...\033[0m\n'
sleep 1.3
printf '\033[0;32m✓\033[0m Write tests/api.test.ts — 8 tests: 404, validation, auth errors, health check\n'
sleep 0.8

printf '\n\033[2m● Running tests...\033[0m\n'
sleep 1.5
printf '\033[0;32m✓\033[0m 8 tests passed (0.623s)\n'

# Wait for lead message
sleep 5
printf '\n\033[1;33m━━━ Inbox Message from Lead ━━━\033[0m\n'
printf '\033[1;33m│\033[0m Add rate limiting to the login endpoint —\n'
printf '\033[1;33m│\033[0m 5 attempts per minute per IP. Use a simple\n'
printf '\033[1;33m│\033[0m in-memory store, no Redis needed.\n'
printf '\033[1;33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n\n'
sleep 1.5

printf '\033[1mAdding rate limiting...\033[0m\n'
sleep 0.6
printf '\033[2m● Writing src/rate-limit.ts...\033[0m\n'
sleep 1.2
printf '\033[0;32m✓\033[0m Write src/rate-limit.ts — in-memory rate limiter (5/min/IP, auto-cleanup)\n'
sleep 0.7

printf '\033[2m● Editing src/api.ts...\033[0m\n'
sleep 0.8
printf '\033[0;32m✓\033[0m Edit src/api.ts — applied rate limiter to POST /login\n'
sleep 0.5

printf '\033[2m● Editing tests/api.test.ts...\033[0m\n'
sleep 1
printf '\033[0;32m✓\033[0m Edit tests/api.test.ts — added rate limit tests (block on 6th attempt, reset after window)\n'
sleep 0.8

printf '\n\033[2m● Running full test suite...\033[0m\n'
sleep 1.5
printf '\033[0;32m✓\033[0m 10 tests passed (0.891s)\n\n'
printf '\033[1;32m✓ Task complete:\033[0m Error handling + rate limiting + 10 tests\n'
sleep 999
WORKER_B

  chmod +x /tmp/demo_worker_a.sh /tmp/demo_worker_b.sh

  # Lead script: the real show
  cat > /tmp/demo_lead.sh << 'LEAD'
#!/bin/bash
export PS1="$ "
clear

# Simulate boot delay
sleep 8

printf '\033[1;33m╭─────────────────────────────────────────────────────────────────────────╮\033[0m\n'
printf '\033[1;33m│                        CLAUDE LEAD SYSTEM                                │\033[0m\n'
printf '\033[1;33m│                     Zero-Token Orchestration                              │\033[0m\n'
printf '\033[1;33m╰─────────────────────────────────────────────────────────────────────────╯\033[0m\n\n'
sleep 0.5

printf '\033[2mScanning sessions...\033[0m\n'
sleep 0.8
printf '\033[0;32m✓\033[0m Found 2 active sessions\n\n'
sleep 0.5

# Dashboard
printf '\033[1m┌──────────┬───────────┬────────────┬────────┬───────────┬──────────────────────────────────────────┐\033[0m\n'
printf '\033[1m│ Session  │ Branch    │ Status     │ W/E/B/R│ Last Op   │ Files                                    │\033[0m\n'
printf '\033[1m├──────────┼───────────┼────────────┼────────┼───────────┼──────────────────────────────────────────┤\033[0m\n'
printf '│ a7f3b2c1 │ feat/auth │ \033[0;32mactive\033[0m     │ 4/7/12/18│ Edit auth │ auth.ts, db.ts, auth.test.ts, middleware  │\n'
printf '│ e9d4f8a6 │ feat/api  │ \033[0;32mactive\033[0m     │ 2/5/8/11 │ Edit api  │ api.ts, auth.ts, api.test.ts, errors.ts   │\n'
printf '\033[1m└──────────┴───────────┴────────────┴────────┴───────────┴──────────────────────────────────────────┘\033[0m\n\n'
sleep 2

# Conflict detection
printf '\033[1;36m▸ Checking for file conflicts...\033[0m\n'
sleep 0.8
printf '\n\033[1;31m⚠ CONFLICT DETECTED\033[0m\n'
printf '  \033[1msrc/auth.ts\033[0m — touched by both sessions:\n'
printf '    a7f3b2c1 (feat/auth): Edit at 19:51:12 — bcrypt + JWT implementation\n'
printf '    e9d4f8a6 (feat/api):  Read at 19:50:35 — imported for type checking\n'
printf '  \033[2mRisk: LOW — session B only reads, session A owns edits\033[0m\n\n'
sleep 2.5

# Send message to Worker A
printf '\033[1;36m▸ Sending instructions to Worker A (a7f3b2c1)...\033[0m\n'
sleep 0.5
printf '\033[0;32m✓\033[0m Message delivered to inbox/a7f3b2c1.jsonl\n'
printf '  \033[2m"Also add integration tests for the login flow"\033[0m\n\n'
sleep 1.5

# Send message to Worker B
printf '\033[1;36m▸ Sending instructions to Worker B (e9d4f8a6)...\033[0m\n'
sleep 0.5
printf '\033[0;32m✓\033[0m Message delivered to inbox/e9d4f8a6.jsonl\n'
printf '  \033[2m"Add rate limiting to the login endpoint"\033[0m\n\n'
sleep 2

# Wait for workers to process
printf '\033[2mWaiting for workers to acknowledge...\033[0m\n'
sleep 6

# Refresh dashboard
printf '\n\033[1;36m▸ Refreshing dashboard...\033[0m\n'
sleep 0.8

printf '\n\033[1m┌──────────┬───────────┬────────────┬────────┬────────────────┬──────────────────────────────────────────────────┐\033[0m\n'
printf '\033[1m│ Session  │ Branch    │ Status     │ W/E/B/R│ Last Op        │ Files                                            │\033[0m\n'
printf '\033[1m├──────────┼───────────┼────────────┼────────┼────────────────┼──────────────────────────────────────────────────┤\033[0m\n'
printf '│ a7f3b2c1 │ feat/auth │ \033[0;32mactive\033[0m     │ 6/9/14/20│ Write integ.ts │ auth.ts, auth.test.ts, auth.integration.test.ts  │\n'
printf '│ e9d4f8a6 │ feat/api  │ \033[0;32mactive\033[0m     │ 4/8/10/12│ Edit api.ts    │ api.ts, errors.ts, rate-limit.ts, api.test.ts     │\n'
printf '\033[1m└──────────┴───────────┴────────────┴────────┴────────────────┴──────────────────────────────────────────────────┘\033[0m\n\n'

printf '\033[1;32m✓ Both workers pivoted to new tasks from lead instructions\033[0m\n'
printf '  Worker A: +4 integration tests (login flow pipeline)\n'
printf '  Worker B: +rate limiting (5/min/IP) + 2 new tests\n\n'
sleep 2

# Cost comparison
printf '\033[1;36m▸ Cost comparison...\033[0m\n\n'
sleep 0.5
printf '  \033[1mLead System (actual):\033[0m\n'
printf '    Lead session (Opus):      ~150K tokens  = $2.25\n'
printf '    Worker A (Sonnet):         ~80K tokens  = $0.72\n'
printf '    Worker B (Sonnet):         ~60K tokens  = $0.54\n'
printf '    Coordination (filesystem):  0 tokens    = $0.00\n'
printf '    \033[1mTotal: $3.51\033[0m\n\n'
printf '  \033[2mAgent Teams (projected):\033[0m\n'
printf '    \033[2mLead + 2 teammates + messaging:  ~$8.10\033[0m\n'
printf '    \033[2mSavings: $4.59 (57%%)\033[0m\n\n'

printf '\033[1;33m─── Session complete. All work tracked. Zero coordination tokens. ───\033[0m\n'
sleep 999
LEAD

  chmod +x /tmp/demo_lead.sh
}

# ── Main recording flow ─────────────────────────────────────────────────────

echo "=== Claude Lead System — Demo Recording ==="
echo ""

# Step 1: Set up fake sessions
echo "Setting up demo session data..."
setup_fake_sessions

# Step 2: Create worker + lead scripts
echo "Creating simulation scripts..."
create_worker_scripts

# Step 3: Open iTerm2 with 3 panes
echo "Opening iTerm2 with 3 panes..."
osascript <<'SETUP_PANES'
tell application "iTerm2"
  activate
  delay 0.5

  -- Create a new window
  set newWindow to (create window with default profile)
  delay 0.5

  tell current session of current tab of newWindow
    -- This is pane 1 (Worker A)
    write text "export PS1='$ ' && clear"

    -- Split vertically for pane 2 (Worker B)
    set pane2 to (split vertically with default profile)
  end tell

  tell pane2
    write text "export PS1='$ ' && clear"

    -- Split vertically for pane 3 (Lead)
    set pane3 to (split vertically with default profile)
  end tell

  tell pane3
    write text "export PS1='$ ' && clear"
  end tell

  delay 1
end tell
SETUP_PANES

sleep 2

# Step 4: Start screen recording (ffmpeg captures display)
echo "Starting screen recording..."
RECORDING_FILE="$OUTPUT_DIR/demo-full-raw.mp4"

# Get iTerm2 window bounds for cropping
WINDOW_BOUNDS=$(osascript -e 'tell application "iTerm2" to get bounds of window 1' 2>/dev/null || echo "0, 0, 2560, 1440")

# Record screen 0 (main display) at 30fps, high quality
ffmpeg -y -f avfoundation -framerate 30 -capture_cursor 0 -i "4:" \
  -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p \
  "$RECORDING_FILE" &
FFMPEG_PID=$!
sleep 2

# Step 5: Launch worker scripts in panes
echo "Starting workers..."
osascript <<'LAUNCH'
tell application "iTerm2"
  tell window 1
    tell tab 1
      -- Pane 1: Worker A
      tell session 1
        write text "bash /tmp/demo_worker_a.sh"
      end tell

      -- Pane 2: Worker B
      tell session 2
        write text "bash /tmp/demo_worker_b.sh"
      end tell

      -- Pane 3: Lead (starts after delay built into script)
      tell session 3
        write text "bash /tmp/demo_lead.sh"
      end tell
    end tell
  end tell
end tell
LAUNCH

# Step 6: Wait for the demo to play out (~45 seconds)
echo "Recording demo... (45 seconds)"
sleep 48

# Step 7: Stop recording
echo "Stopping recording..."
kill $FFMPEG_PID 2>/dev/null || true
wait $FFMPEG_PID 2>/dev/null || true
sleep 1

# Step 8: Crop to iTerm2 window and produce final output
echo "Processing video..."
FINAL_VIDEO="$OUTPUT_DIR/demo-full.mp4"
FINAL_GIF="$OUTPUT_DIR/demo-hero.gif"

# Re-encode with better compression
if [ -f "$RECORDING_FILE" ]; then
  ffmpeg -y -i "$RECORDING_FILE" \
    -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p \
    -movflags +faststart \
    "$FINAL_VIDEO" 2>/dev/null

  # Create GIF (first 20 seconds, 15fps, 1200px wide)
  ffmpeg -y -i "$RECORDING_FILE" -t 20 \
    -vf "fps=15,scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" \
    "$FINAL_GIF" 2>/dev/null

  rm -f "$RECORDING_FILE"
  echo ""
  echo "=== Recording complete ==="
  echo "  Video: $FINAL_VIDEO"
  echo "  GIF:   $FINAL_GIF"
  echo ""
  ls -lh "$FINAL_VIDEO" "$FINAL_GIF" 2>/dev/null
else
  echo "ERROR: Recording failed — no output file"
fi

# Step 9: Clean up
cleanup_fake_sessions
rm -f /tmp/demo_worker_a.sh /tmp/demo_worker_b.sh /tmp/demo_lead.sh

# Close the demo window
osascript -e 'tell application "iTerm2" to close window 1' 2>/dev/null || true

echo ""
echo "Done. Review the video and GIF before posting."
