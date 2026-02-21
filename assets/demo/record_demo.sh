#!/bin/bash
# ─── Claude Lead System — Scripted Demo ──────────────────────────────────────
# This script simulates the demo flow with realistic terminal output.
# Run with: asciinema rec --command "bash record_demo.sh" --cols 120 --rows 35 recording.cast
# Convert: agg recording.cast demo.gif --theme monokai --font-size 16 --cols 120 --rows 35

set -e

# ─── ANSI Colors ──────────────────────────────────────────────────────────────
RESET="\033[0m"
BOLD="\033[1m"
DIM="\033[2m"
RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
BLUE="\033[34m"
MAGENTA="\033[35m"
CYAN="\033[36m"
WHITE="\033[37m"
BG_DARK="\033[48;2;30;30;46m"

# Typing effect
type_text() {
    local text="$1"
    local delay="${2:-0.04}"
    for ((i=0; i<${#text}; i++)); do
        printf "%s" "${text:$i:1}"
        sleep "$delay"
    done
}

slow_print() {
    echo -e "$1"
    sleep "${2:-0.8}"
}

clear
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Scene 1: Show the problem
# ═══════════════════════════════════════════════════════════════════════════════
slow_print "${BOLD}${WHITE}Claude Lead System${RESET} — Demo" 1.5
echo ""
slow_print "${DIM}The problem: multiple Claude Code terminals in one repo.${RESET}" 1
slow_print "${DIM}They can't see each other. They step on the same files.${RESET}" 1
slow_print "${DIM}You burn API tokens just babysitting them.${RESET}" 1.5
echo ""
slow_print "${BOLD}${CYAN}The fix: one command.${RESET}" 1

echo ""
echo -ne "${GREEN}\$ ${RESET}"
type_text "/lead" 0.08
echo ""
sleep 1.5

# ═══════════════════════════════════════════════════════════════════════════════
# Scene 2: Dashboard boot
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
slow_print "${DIM}Scanning ~/.claude/terminals/...${RESET}" 0.6
slow_print "${DIM}Found 3 sessions | 1 project | Checking conflicts...${RESET}" 0.8
echo ""

slow_print "${BOLD}${BLUE}# Lead${RESET}${DIM} — ${RESET}${BOLD}${GREEN}Online${RESET}" 0.5
echo ""
slow_print "${BOLD}${MAGENTA}## Sessions${RESET}" 0.3

# Table
echo -e "${DIM}| Session  | TTY      | Project     | Status | Tools (W/E/B/R) | Recent Files          | Last Op      |${RESET}"
echo -e "${DIM}|----------|----------|-------------|--------|-----------------|----------------------|--------------|${RESET}"
sleep 0.3
echo -e "| ${CYAN}a1b2c3d4${RESET} | ttys003  | my-saas-app | ${GREEN}active${RESET} | ${YELLOW}15${RESET}/${YELLOW}8${RESET}/${BLUE}23${RESET}/${CYAN}5${RESET}          | auth.ts, db.ts       | ${YELLOW}Edit auth.ts${RESET} |"
sleep 0.2
echo -e "| ${CYAN}e5f6g7h8${RESET} | ttys058  | my-saas-app | ${GREEN}active${RESET} | ${YELLOW}4${RESET}/${YELLOW}12${RESET}/${BLUE}6${RESET}/${CYAN}22${RESET}         | Login.tsx, auth.ts   | ${YELLOW}Edit auth.ts${RESET} |"
sleep 0.2
echo -e "| ${CYAN}c3d4e5f6${RESET} | ttys091  | my-saas-app | ${YELLOW}idle${RESET}   | ${YELLOW}8${RESET}/${YELLOW}3${RESET}/${BLUE}14${RESET}/${CYAN}11${RESET}        | integration.test.ts  | ${BLUE}Bash pytest${RESET}  |"
sleep 1

echo ""
slow_print "${BOLD}${MAGENTA}## Conflicts${RESET}" 0.3
echo -e "  ${YELLOW}⚠${RESET} ${BOLD}${RED}CONFLICT:${RESET} ${YELLOW}src/auth.ts${RESET} touched by ${CYAN}a1b2c3d4${RESET} AND ${CYAN}e5f6g7h8${RESET}"
sleep 2

# ═══════════════════════════════════════════════════════════════════════════════
# Scene 3: Conflict detection deep dive
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -ne "${GREEN}\$ ${RESET}"
type_text "conflicts" 0.06
echo ""
sleep 1

echo ""
slow_print "${BOLD}${RED}## CONFLICTS DETECTED${RESET}" 0.5
echo ""
slow_print "${BOLD}${MAGENTA}### File Overlaps${RESET}" 0.3
echo -e "  - ${BOLD}${YELLOW}src/auth.ts${RESET}"
sleep 0.2
echo -e "    ├─ Session ${CYAN}a1b2c3d4${RESET} (ttys003): ${YELLOW}8 Edits${RESET} — \"building authentication layer\""
sleep 0.2
echo -e "    └─ Session ${CYAN}e5f6g7h8${RESET} (ttys058): ${YELLOW}12 Edits${RESET} — \"updating login component\""
sleep 0.5
echo ""
echo -e "  ${YELLOW}⚠${RESET} ${BOLD}Recommendation:${RESET} Coordinate before editing ${YELLOW}src/auth.ts${RESET}"
echo -e "    Run: ${CYAN}tell e5f6g7h8 to \"stop editing auth.ts, a1b2c3d4 owns it\"${RESET}"
sleep 2

# ═══════════════════════════════════════════════════════════════════════════════
# Scene 4: Send a message
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -ne "${GREEN}\$ ${RESET}"
type_text 'tell e5f6g7h8 to stop editing auth.ts, a1b2c3d4 owns that file' 0.03
echo ""
sleep 1

echo ""
echo -e "  ${GREEN}✓${RESET} Message sent to ${CYAN}e5f6g7h8${RESET}"
echo -e "    Priority: ${RED}urgent${RESET}  |  Delivery: next tool invocation"
echo -e "    ${DIM}Cost: 0 API tokens (filesystem hook, not context window)${RESET}"
sleep 2

# ═══════════════════════════════════════════════════════════════════════════════
# Scene 5: Spawn autonomous worker
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -ne "${GREEN}\$ ${RESET}"
type_text 'run "Write integration tests for src/auth.ts" in ~/Projects/my-saas-app' 0.03
echo ""
sleep 1

echo ""
echo -e "  ${YELLOW}⚡${RESET} Pre-flight conflict check... ${GREEN}clear${RESET}"
echo ""
echo -e "  Worker spawned: ${BOLD}${CYAN}W-1708349521${RESET}"
echo -e "    Task:    \"Write integration tests for src/auth.ts\""
echo -e "    Layout:  ${GREEN}split pane${RESET} via iTerm2"
echo -e "    PID:     48291"
sleep 2

# ═══════════════════════════════════════════════════════════════════════════════
# Scene 6: Check worker result
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -ne "${GREEN}\$ ${RESET}"
type_text "check worker W-1708349521" 0.05
echo ""
sleep 1

echo ""
echo -e "  Status: ${BOLD}${GREEN}completed ✓${RESET}"
echo -e "  Duration: 43s  |  Files created: 3"
echo ""
echo -e "  ${GREEN}✓ Created tests/auth.unit.test.ts        (12 tests)${RESET}"
echo -e "  ${GREEN}✓ Created tests/auth.integration.test.ts  (8 tests)${RESET}"
echo -e "  ${GREEN}✓ Created tests/auth.e2e.test.ts           (5 tests)${RESET}"
echo -e "  ${GREEN}Tests: 25 passed | Coverage: 94.2%${RESET}"
sleep 2

# ═══════════════════════════════════════════════════════════════════════════════
# Scene 7: The punchline
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${DIM}──────────────────────────────────────────────────────────────────${RESET}"
echo ""
slow_print "${BOLD}${WHITE}Total coordination cost:${RESET} ${BOLD}${GREEN}0 API tokens${RESET}" 0.8
slow_print "${DIM}All orchestration via shell hooks + filesystem state.${RESET}" 0.5
slow_print "${DIM}State files: 1.4KB avg  |  Latency: 0.019ms  |  207x faster than transcripts${RESET}" 1
echo ""
slow_print "${BOLD}${CYAN}github.com/DrewDawson2027/claude-lead-system${RESET}" 1
slow_print "${DIM}curl -fsSL https://raw.githubusercontent.com/DrewDawson2027/claude-lead-system/main/install.sh | bash${RESET}" 2
echo ""
