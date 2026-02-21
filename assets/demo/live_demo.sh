#!/bin/bash
# ─── Claude Lead System — Live Demo Orchestrator ─────────────────────────────
# This script:
# 1. Opens iTerm2 with 3 panes simulating multiple Claude Code sessions
# 2. Runs the lead demo in the main pane
# 3. Takes real screencapture screenshots at each step
# 4. Records the screen with ffmpeg
#
# Output goes to ~/Desktop/Claude-Lead-System-Launch/

set -e

OUTDIR="$HOME/Desktop/Claude-Lead-System-Launch"
mkdir -p "$OUTDIR"

RESET="\033[0m"
BOLD="\033[1m"
DIM="\033[2m"
RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
BLUE="\033[34m"
MAGENTA="\033[35m"
CYAN="\033[36m"

# ─── Pane scripts (simulate Claude Code sessions) ────────────────────────────

# Session A: Backend builder
cat > /tmp/cls_pane_a.sh << 'PANE_A'
#!/bin/bash
clear
printf "\033[36m\033[1mclaude-a1b2c3d4\033[0m \033[2m(my-saas-app) feature/auth\033[0m\n"
printf "\033[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n\n"
printf "\033[32m$\033[0m \033[1mBuilding authentication module...\033[0m\n\n"
printf "  \033[33mEdit\033[0m src/auth.ts\n"
sleep 0.3
printf "  \033[33mEdit\033[0m src/middleware.ts\n"
sleep 0.3
printf "  \033[34mBash\033[0m npm test\n"
sleep 0.3
printf "  \033[32m✓\033[0m 12 tests passed\n"
sleep 0.3
printf "  \033[35mWrite\033[0m src/types.ts\n"
sleep 0.3
printf "  \033[33mEdit\033[0m src/auth.ts\n"
sleep 0.3
printf "  \033[33mEdit\033[0m src/auth.ts\n"
sleep 0.3
printf "  \033[34mBash\033[0m npm test\n"
sleep 0.3
printf "  \033[32m✓\033[0m 15 tests passed\n\n"
printf "\033[2mTools: W:15 E:8 B:23 R:5\033[0m\n"
printf "\033[2mFiles: auth.ts, db.ts, middleware.ts, types.ts\033[0m\n\n"
printf "\033[33m⚡ Active — editing src/auth.ts\033[0m\n"
# Keep alive
sleep 300
PANE_A
chmod +x /tmp/cls_pane_a.sh

# Session B: Frontend developer
cat > /tmp/cls_pane_b.sh << 'PANE_B'
#!/bin/bash
clear
printf "\033[36m\033[1mclaude-e5f6g7h8\033[0m \033[2m(my-saas-app) feature/auth\033[0m\n"
printf "\033[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n\n"
printf "\033[32m$\033[0m \033[1mBuilding frontend auth UI...\033[0m\n\n"
printf "  \033[36mRead\033[0m src/components/Login.tsx\n"
sleep 0.3
printf "  \033[33mEdit\033[0m src/components/Login.tsx\n"
sleep 0.3
printf "  \033[36mRead\033[0m src/hooks/useAuth.ts\n"
sleep 0.3
printf "  \033[33mEdit\033[0m src/hooks/useAuth.ts\n"
sleep 0.3
printf "  \033[33mEdit\033[0m src/auth.ts\n"
sleep 0.3
printf "  \033[34mBash\033[0m npm run build\n"
sleep 0.3
printf "  \033[33mEdit\033[0m src/styles.css\n"
sleep 0.3
printf "  \033[33mEdit\033[0m src/auth.ts\n\n"
printf "\033[2mTools: W:4 E:12 B:6 R:22\033[0m\n"
printf "\033[2mFiles: Login.tsx, auth.ts, styles.css, useAuth.ts\033[0m\n\n"
printf "\033[33m⚡ Active — editing src/auth.ts\033[0m\n"
sleep 300
PANE_B
chmod +x /tmp/cls_pane_b.sh

# Session C: Test writer (idle)
cat > /tmp/cls_pane_c.sh << 'PANE_C'
#!/bin/bash
clear
printf "\033[36m\033[1mclaude-c3d4e5f6\033[0m \033[2m(my-saas-app) feature/auth\033[0m\n"
printf "\033[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n\n"
printf "\033[32m$\033[0m \033[1mWriting test coverage...\033[0m\n\n"
printf "  \033[35mWrite\033[0m tests/integration.test.ts\n"
printf "  \033[34mBash\033[0m npm test -- --coverage\n"
printf "  \033[32m✓\033[0m Coverage: 87.3%%\n"
printf "  \033[35mWrite\033[0m tests/e2e.test.ts\n"
printf "  \033[34mBash\033[0m npm test -- --coverage\n"
printf "  \033[32m✓\033[0m Coverage: 91.1%%\n\n"
printf "\033[2mTools: W:8 E:3 B:14 R:11\033[0m\n"
printf "\033[2mFiles: integration.test.ts, e2e.test.ts\033[0m\n\n"
printf "\033[2m💤 Idle — waiting for new tasks (8m)\033[0m\n"
sleep 300
PANE_C
chmod +x /tmp/cls_pane_c.sh

echo "Pane scripts created."
echo ""
echo "Now opening iTerm2 with the demo layout..."

# ─── Open iTerm2 with 4-pane layout ──────────────────────────────────────────
osascript << 'APPLESCRIPT'
tell application "iTerm2"
    activate

    -- Create new window
    set newWindow to (create window with default profile)

    tell current session of current tab of newWindow
        -- Set title for the main pane (Lead)
        write text "printf '\\033]0;LEAD — Claude Lead System\\007'"
        write text "clear"
    end tell

    tell current tab of newWindow
        -- Split horizontally: left = sessions, right = lead
        set sessionB to (split vertically with default profile)

        tell sessionB
            write text "printf '\\033]0;Session e5f6g7h8\\007'"
            write text "bash /tmp/cls_pane_b.sh"
        end tell

        -- Split the right pane vertically
        set sessionC to (split horizontally with default profile)

        tell sessionC
            write text "printf '\\033]0;Session c3d4e5f6\\007'"
            write text "bash /tmp/cls_pane_c.sh"
        end tell
    end tell

    -- Go back to the first pane and run session A content first, then the lead demo
    tell first session of current tab of newWindow
        write text "printf '\\033]0;LEAD — Claude Lead System\\007'"
        write text "bash /tmp/cls_pane_a.sh &"
    end tell

end tell
APPLESCRIPT

echo ""
echo "iTerm2 window opened with 3 session panes."
echo ""
echo "Waiting 4 seconds for panes to render..."
sleep 4

# ─── Take Screenshot 1: Multi-pane overview ──────────────────────────────────
echo "Taking screenshot 1: multi-pane overview..."
screencapture -x "$OUTDIR/live_01_multipane_overview.png"
echo "  ✓ live_01_multipane_overview.png"
sleep 1

echo ""
echo "Demo layout is ready."
echo "The 3 session panes are showing simulated Claude Code output."
echo ""
echo "Screenshots saved to: $OUTDIR"
