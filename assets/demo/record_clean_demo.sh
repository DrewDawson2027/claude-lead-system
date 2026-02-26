#!/usr/bin/env bash
# Clean full-screen demo recording — no desktop, no personal info
# Outputs: demo-final.mp4 + demo-final.gif
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$DEMO_DIR"
TERMINALS_DIR="$HOME/.claude/terminals"
INBOX_DIR="$TERMINALS_DIR/inbox"
RESULTS_DIR="$TERMINALS_DIR/results"

SID_A="a7f3b2c1"
SID_B="e9d4f8a6"

# ── Setup fake sessions ──────────────────────────────────────────────────────
setup_sessions() {
  mkdir -p "$TERMINALS_DIR" "$INBOX_DIR" "$RESULTS_DIR"
  local now; now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  cat > "$TERMINALS_DIR/session-${SID_A}.json" << EOF
{
  "session": "$SID_A", "status": "active", "project": "lead-demo",
  "branch": "feat/auth", "cwd": "/Users/dev/lead-demo", "tty": "/dev/ttys005",
  "started": "2026-02-26T19:42:00Z", "last_active": "$now", "schema_version": 2,
  "tool_counts": { "Write": 4, "Edit": 7, "Bash": 12, "Read": 18 },
  "files_touched": ["src/auth.ts", "src/db.ts", "tests/auth.test.ts", "src/middleware.ts"],
  "recent_ops": [
    { "tool": "Edit", "file": "src/auth.ts", "t": "2026-02-26T19:51:12Z" },
    { "tool": "Write", "file": "tests/auth.test.ts", "t": "2026-02-26T19:51:08Z" }
  ],
  "current_task": "Implementing JWT auth with bcrypt password hashing"
}
EOF

  cat > "$TERMINALS_DIR/session-${SID_B}.json" << EOF
{
  "session": "$SID_B", "status": "active", "project": "lead-demo",
  "branch": "feat/api-errors", "cwd": "/Users/dev/lead-demo", "tty": "/dev/ttys006",
  "started": "2026-02-26T19:44:00Z", "last_active": "$now", "schema_version": 2,
  "tool_counts": { "Write": 2, "Edit": 5, "Bash": 8, "Read": 11 },
  "files_touched": ["src/api.ts", "src/auth.ts", "tests/api.test.ts", "src/errors.ts"],
  "recent_ops": [
    { "tool": "Edit", "file": "src/api.ts", "t": "2026-02-26T19:51:02Z" },
    { "tool": "Edit", "file": "src/errors.ts", "t": "2026-02-26T19:50:48Z" }
  ],
  "current_task": "Adding structured error handling to API routes"
}
EOF
}

cleanup_sessions() {
  rm -f "$TERMINALS_DIR/session-${SID_A}.json" "$TERMINALS_DIR/session-${SID_B}.json"
  rm -f "$INBOX_DIR/${SID_A}.jsonl" "$INBOX_DIR/${SID_B}.jsonl"
}

# ── Worker A simulation ──────────────────────────────────────────────────────
create_scripts() {
cat > /tmp/demo_wa.sh << 'WA'
#!/bin/bash
clear; sleep 0.3
printf '\n\033[1;36m  Worker A  ━━━  feat/auth  ━━━  JWT + bcrypt\033[0m\n\n'
sleep 0.8

printf '  \033[2m● Reading src/auth.ts...\033[0m\n'
sleep 0.6
printf '  \033[0;32m✓\033[0m Read src/auth.ts \033[2m(62 lines)\033[0m\n'
sleep 0.4

printf '  \033[2m● Reading tests/auth.test.ts...\033[0m\n'
sleep 0.5
printf '  \033[0;32m✓\033[0m Read tests/auth.test.ts \033[2m(15 lines)\033[0m\n'
sleep 0.6

printf '\n  \033[1mAnalyzing auth module:\033[0m\n'
printf '    → login(): needs bcrypt.compare\n'
printf '    → register(): needs duplicate check + hash\n'
printf '    → generateToken(): needs JWT signing\n'
sleep 1.2

printf '\n  \033[2m● Editing src/auth.ts...\033[0m\n'
sleep 0.8
printf '  \033[0;32m✓\033[0m Edit src/auth.ts — bcrypt import + verifyPassword\n'
sleep 0.5

printf '  \033[2m● Editing src/auth.ts...\033[0m\n'
sleep 0.7
printf '  \033[0;32m✓\033[0m Edit src/auth.ts — JWT token generation\n'
sleep 0.4

printf '  \033[2m● Writing tests/auth.test.ts...\033[0m\n'
sleep 1
printf '  \033[0;32m✓\033[0m Write tests/auth.test.ts — 6 test cases\n'
sleep 0.5

printf '\n  \033[2m● Running tests...\033[0m\n'
sleep 1.2
printf '  \033[0;32m✓ 6 tests passed\033[0m \033[2m(0.847s)\033[0m\n'

printf '  \033[2m● Editing src/middleware.ts...\033[0m\n'
sleep 0.8
printf '  \033[0;32m✓\033[0m Edit src/middleware.ts — auth middleware\n'

# Pause — wait for lead message
sleep 4

printf '\n  \033[1;33m┌─ Inbox ──────────────────────────────────────┐\033[0m\n'
printf '  \033[1;33m│\033[0m From: Lead                                   \033[1;33m│\033[0m\n'
printf '  \033[1;33m│\033[0m Add integration tests for the login flow —   \033[1;33m│\033[0m\n'
printf '  \033[1;33m│\033[0m test full request→auth→response pipeline     \033[1;33m│\033[0m\n'
printf '  \033[1;33m│\033[0m with mock DB. Not just unit tests.           \033[1;33m│\033[0m\n'
printf '  \033[1;33m└──────────────────────────────────────────────┘\033[0m\n\n'
sleep 1

printf '  \033[1mPivoting to integration tests...\033[0m\n'
sleep 0.6
printf '  \033[2m● Reading src/api.ts...\033[0m\n'
sleep 0.5
printf '  \033[0;32m✓\033[0m Read src/api.ts \033[2m(42 lines)\033[0m\n'
sleep 0.4

printf '  \033[2m● Writing tests/auth.integration.test.ts...\033[0m\n'
sleep 1.2
printf '  \033[0;32m✓\033[0m Write tests/auth.integration.test.ts — 4 tests\n'
sleep 0.6

printf '\n  \033[2m● Running full suite...\033[0m\n'
sleep 1.5
printf '  \033[0;32m✓ 10 tests passed\033[0m \033[2m(1.234s)\033[0m\n\n'
printf '  \033[1;32m✓ Complete:\033[0m JWT auth + bcrypt + 10 tests\n'
sleep 999
WA

# ── Worker B simulation ──────────────────────────────────────────────────────
cat > /tmp/demo_wb.sh << 'WB'
#!/bin/bash
clear; sleep 0.3
printf '\n\033[1;35m  Worker B  ━━━  feat/api-errors  ━━━  Error Handling\033[0m\n\n'
sleep 1.2

printf '  \033[2m● Reading src/api.ts...\033[0m\n'
sleep 0.5
printf '  \033[0;32m✓\033[0m Read src/api.ts \033[2m(42 lines)\033[0m\n'
sleep 0.4

printf '  \033[2m● Reading src/auth.ts...\033[0m\n'
sleep 0.5
printf '  \033[0;32m✓\033[0m Read src/auth.ts \033[2m(62 lines)\033[0m\n'
sleep 0.7

printf '\n  \033[1mPlanning error strategy:\033[0m\n'
printf '    → AppError class with status codes\n'
printf '    → try/catch on all routes\n'
printf '    → Error middleware for JSON responses\n'
printf '    → Zod request validation\n'
sleep 1.5

printf '\n  \033[2m● Writing src/errors.ts...\033[0m\n'
sleep 0.9
printf '  \033[0;32m✓\033[0m Write src/errors.ts — AppError, NotFoundError, ValidationError\n'
sleep 0.5

printf '  \033[2m● Editing src/api.ts...\033[0m\n'
sleep 1
printf '  \033[0;32m✓\033[0m Edit src/api.ts — wrapped handlers in try/catch\n'
sleep 0.5

printf '  \033[2m● Editing src/api.ts...\033[0m\n'
sleep 0.8
printf '  \033[0;32m✓\033[0m Edit src/api.ts — error middleware\n'
sleep 0.4

printf '  \033[2m● Writing tests/api.test.ts...\033[0m\n'
sleep 1.1
printf '  \033[0;32m✓\033[0m Write tests/api.test.ts — 8 tests\n'
sleep 0.5

printf '\n  \033[2m● Running tests...\033[0m\n'
sleep 1.2
printf '  \033[0;32m✓ 8 tests passed\033[0m \033[2m(0.623s)\033[0m\n'

# Pause — wait for lead message
sleep 6

printf '\n  \033[1;33m┌─ Inbox ──────────────────────────────────────┐\033[0m\n'
printf '  \033[1;33m│\033[0m From: Lead                                   \033[1;33m│\033[0m\n'
printf '  \033[1;33m│\033[0m Add rate limiting to POST /login —           \033[1;33m│\033[0m\n'
printf '  \033[1;33m│\033[0m 5 attempts/min/IP. In-memory store,          \033[1;33m│\033[0m\n'
printf '  \033[1;33m│\033[0m no Redis needed.                             \033[1;33m│\033[0m\n'
printf '  \033[1;33m└──────────────────────────────────────────────┘\033[0m\n\n'
sleep 1

printf '  \033[1mAdding rate limiting...\033[0m\n'
sleep 0.5
printf '  \033[2m● Writing src/rate-limit.ts...\033[0m\n'
sleep 1
printf '  \033[0;32m✓\033[0m Write src/rate-limit.ts — 5/min/IP limiter\n'
sleep 0.5

printf '  \033[2m● Editing src/api.ts...\033[0m\n'
sleep 0.7
printf '  \033[0;32m✓\033[0m Edit src/api.ts — applied rate limiter\n'
sleep 0.4

printf '  \033[2m● Editing tests/api.test.ts...\033[0m\n'
sleep 0.8
printf '  \033[0;32m✓\033[0m Edit tests/api.test.ts — rate limit tests\n'
sleep 0.5

printf '\n  \033[2m● Running full suite...\033[0m\n'
sleep 1.2
printf '  \033[0;32m✓ 10 tests passed\033[0m \033[2m(0.891s)\033[0m\n\n'
printf '  \033[1;32m✓ Complete:\033[0m Error handling + rate limiting + 10 tests\n'
sleep 999
WB

# ── Lead simulation ──────────────────────────────────────────────────────────
cat > /tmp/demo_lead.sh << 'LEAD'
#!/bin/bash
clear; sleep 0.3
printf '\n'

# Wait for workers to start showing output
sleep 7

printf '  \033[1;33m╔════════════════════════════════════════════════════════╗\033[0m\n'
printf '  \033[1;33m║           CLAUDE LEAD SYSTEM  ·  /lead                ║\033[0m\n'
printf '  \033[1;33m║       Zero-Token Multi-Agent Orchestration            ║\033[0m\n'
printf '  \033[1;33m╚════════════════════════════════════════════════════════╝\033[0m\n\n'
sleep 0.5

printf '  \033[2mScanning ~/.claude/terminals/...\033[0m\n'
sleep 0.6
printf '  \033[0;32m✓\033[0m 2 active sessions found\n\n'
sleep 0.4

# Dashboard table
printf '  \033[1m┌──────────┬───────────────┬────────┬─────────┬─────────────────────────────────┐\033[0m\n'
printf '  \033[1m│ Session  │ Branch        │ Status │ W/E/B/R │ Current Task                    │\033[0m\n'
printf '  \033[1m├──────────┼───────────────┼────────┼─────────┼─────────────────────────────────┤\033[0m\n'
printf '  │ a7f3b2c1 │ feat/auth     │ \033[0;32mactive\033[0m │ 4/7/12/18│ JWT auth + bcrypt hashing      │\n'
printf '  │ e9d4f8a6 │ feat/api-err  │ \033[0;32mactive\033[0m │ 2/5/8/11 │ Structured error handling      │\n'
printf '  \033[1m└──────────┴───────────────┴────────┴─────────┴─────────────────────────────────┘\033[0m\n\n'
sleep 1.5

# Conflict check
printf '  \033[1;36m▸ conflicts\033[0m\n'
sleep 0.6
printf '  \033[1;31m⚠ CONFLICT:\033[0m src/auth.ts\n'
printf '    a7f3b2c1: Edit at 19:51  ·  e9d4f8a6: Read at 19:50\n'
printf '    \033[2mRisk: LOW — B only reads, A owns edits\033[0m\n\n'
sleep 1.5

# Send instructions to Worker A
printf '  \033[1;36m▸ tell a7f3b2c1\033[0m add integration tests for login flow\n'
sleep 0.4
printf '  \033[0;32m✓\033[0m Message → inbox/a7f3b2c1.jsonl\n\n'
sleep 1

# Send instructions to Worker B
printf '  \033[1;36m▸ tell e9d4f8a6\033[0m add rate limiting to POST /login\n'
sleep 0.4
printf '  \033[0;32m✓\033[0m Message → inbox/e9d4f8a6.jsonl\n\n'
sleep 1

printf '  \033[2mWorkers will receive on next tool call...\033[0m\n'
sleep 5

# Refreshed dashboard
printf '\n  \033[1;36m▸ refresh\033[0m\n'
sleep 0.6
printf '\n  \033[1m┌──────────┬───────────────┬────────┬──────────┬──────────────────────────────────┐\033[0m\n'
printf '  \033[1m│ Session  │ Branch        │ Status │ W/E/B/R  │ Latest                           │\033[0m\n'
printf '  \033[1m├──────────┼───────────────┼────────┼──────────┼──────────────────────────────────┤\033[0m\n'
printf '  │ a7f3b2c1 │ feat/auth     │ \033[0;32mactive\033[0m │ 6/9/14/20│ \033[0;32m✓\033[0m 10 tests (6 unit + 4 integ)  │\n'
printf '  │ e9d4f8a6 │ feat/api-err  │ \033[0;32mactive\033[0m │ 4/8/10/12│ \033[0;32m✓\033[0m rate-limit.ts + 10 tests     │\n'
printf '  \033[1m└──────────┴───────────────┴────────┴──────────┴──────────────────────────────────┘\033[0m\n\n'

printf '  \033[1;32m✓ Both workers pivoted from lead instructions\033[0m\n'
printf '    A: +4 integration tests (login pipeline)\n'
printf '    B: +rate limiting (5/min/IP) + 2 tests\n\n'
sleep 1

# Cost
printf '  \033[1;36m▸ cost\033[0m\n'
sleep 0.4
printf '  Lead System: \033[1m$3.51\033[0m  (coordination: $0.00)\n'
printf '  Agent Teams: \033[2m$8.10  (coordination: $0.90)\033[0m\n'
printf '  \033[1;32mSaved 57%%\033[0m — $4.59 less per task\n\n'

printf '  \033[1;33m── Zero tokens. Full autonomy. ──\033[0m\n'
sleep 999
LEAD

chmod +x /tmp/demo_wa.sh /tmp/demo_wb.sh /tmp/demo_lead.sh
}

# ══════════════════════════════════════════════════════════════════════════════
echo "=== Clean Demo Recording ==="

setup_sessions
create_scripts

# Step 1: Open a NEW full-screen iTerm2 window with 3 vertical panes
echo "Opening full-screen iTerm2..."
osascript <<'APPLE'
tell application "iTerm2"
  activate
  delay 0.3

  -- Create new maximized window
  set newWindow to (create window with default profile)
  delay 0.5

  -- Enter native full screen so no desktop is visible
  tell newWindow
    set bounds to {0, 0, 5120, 1440}
  end tell
  delay 0.3

  tell current session of current tab of newWindow
    -- Pane 1 (Worker A - left)
    write text "export PS1='' && clear"

    -- Split for Pane 2 (Lead - center)
    set pane2 to (split vertically with default profile)
  end tell

  tell pane2
    write text "export PS1='' && clear"

    -- Split for Pane 3 (Worker B - right)
    set pane3 to (split vertically with default profile)
  end tell

  tell pane3
    write text "export PS1='' && clear"
  end tell

  delay 0.5
end tell
APPLE

sleep 2

# Step 2: Start screen recording (capture screen 1 = the external ultrawide)
# Try to determine which screen iTerm is on
echo "Starting recording..."
RECORDING_FILE="$OUTPUT_DIR/demo-raw.mp4"

# Record screen - we'll use screen 4 (Capture screen 0) at 30fps
ffmpeg -y -f avfoundation -framerate 30 -capture_cursor 0 -i "2:" \
  -c:v libx264 -preset ultrafast -crf 16 -pix_fmt yuv420p \
  "$RECORDING_FILE" </dev/null 2>/dev/null &
FFMPEG_PID=$!
sleep 2

# Step 3: Launch scripts — Worker A (pane 1), Lead (pane 2), Worker B (pane 3)
echo "Launching demo scripts..."
osascript <<'LAUNCH'
tell application "iTerm2"
  tell window 1
    tell tab 1
      tell session 1
        write text "bash /tmp/demo_wa.sh"
      end tell
      tell session 2
        write text "bash /tmp/demo_lead.sh"
      end tell
      tell session 3
        write text "bash /tmp/demo_wb.sh"
      end tell
    end tell
  end tell
end tell
LAUNCH

# Step 4: Wait for demo (~42 seconds of scripted content)
echo "Recording... (42 seconds)"
sleep 44

# Step 5: Stop
echo "Stopping..."
kill $FFMPEG_PID 2>/dev/null; wait $FFMPEG_PID 2>/dev/null

# Step 6: Process — crop to just the iTerm2 window and produce final assets
echo "Processing..."

# Get window position from iTerm2
BOUNDS=$(osascript -e 'tell application "iTerm2" to get bounds of window 1' 2>/dev/null || echo "0, 25, 2560, 1440")
X=$(echo "$BOUNDS" | awk -F', ' '{print $1}')
Y=$(echo "$BOUNDS" | awk -F', ' '{print $2}')
W=$(echo "$BOUNDS" | awk -F', ' '{printf "%d", $3 - $1}')
H=$(echo "$BOUNDS" | awk -F', ' '{printf "%d", $4 - $2}')

echo "  Window bounds: ${X},${Y} ${W}x${H}"

FINAL_MP4="$OUTPUT_DIR/demo-final.mp4"
FINAL_GIF="$OUTPUT_DIR/demo-final.gif"

# Crop to window, re-encode high quality
ffmpeg -y -i "$RECORDING_FILE" \
  -vf "crop=${W}:${H}:${X}:${Y}" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart \
  "$FINAL_MP4" 2>/dev/null

# GIF: first 25 seconds, 15fps, 1400px wide
ffmpeg -y -i "$RECORDING_FILE" -t 25 \
  -vf "crop=${W}:${H}:${X}:${Y},fps=15,scale=1400:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" \
  "$FINAL_GIF" 2>/dev/null

rm -f "$RECORDING_FILE"

# Step 7: Screenshots at key moments
echo "Extracting screenshots..."
for t in 10 18 25 35; do
  ffmpeg -y -i "$FINAL_MP4" -ss "$t" -frames:v 1 \
    "$OUTPUT_DIR/screenshots/demo_t${t}s.png" 2>/dev/null
done

# Cleanup
cleanup_sessions
rm -f /tmp/demo_wa.sh /tmp/demo_wb.sh /tmp/demo_lead.sh
osascript -e 'tell application "iTerm2" to close window 1' 2>/dev/null || true

echo ""
echo "=== Done ==="
ls -lh "$FINAL_MP4" "$FINAL_GIF" 2>/dev/null
echo ""
echo "Screenshots: $OUTPUT_DIR/screenshots/demo_t*"
