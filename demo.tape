Output demo.gif
Set Width 1200
Set Height 600
Set FontSize 14
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 20

# ── Scene 1: Title ──
Type "printf '\\033[1;36m═══════════════════════════════════════\\033[0m\\n'"
Enter
Type "echo '  Claude Lead System  |  One control room for all your Claude Code terminals'"
Enter
Type "printf '\\033[1;36m═══════════════════════════════════════\\033[0m\\n'"
Enter
Sleep 2s

# ── Scene 2: Real tests ──
Type "echo '── Test Suite ──'"
Enter
Type "cd ~/claude-lead-system && npm run test:coordinator 2>&1 | tail -6"
Enter
Sleep 35s

# ── Scene 3: Tool count ──
Type "echo '── MCP Tool Registry ──'"
Enter
Type "bash scripts/demo-count-tools.sh"
Enter
Sleep 2s

# ── Scene 4: Conflict detection (real past data) ──
Type "echo '── Conflict Detection (from live log) ──'"
Enter
Type "bash scripts/demo-last-conflict.sh"
Enter
Sleep 3s

# ── Scene 5: Health check ──
Type "echo '── System Health ──'"
Enter
Type "bash hooks/health-check.sh 2>&1 | tail -4"
Enter
Sleep 5s

# ── Final banner ──
Type "echo ''"
Enter
Type "printf '\\033[1;32m═══════════════════════════════════════════════════════\\033[0m\\n'"
Enter
Type "echo '  428 tests  |  81 tools  |  All CI green'"
Enter
Type "echo '  Zero API tokens for coordination'"
Enter
Type "echo '  github.com/DrewDawson2027/claude-lead-system'"
Enter
Type "printf '\\033[1;32m═══════════════════════════════════════════════════════\\033[0m\\n'"
Enter
Sleep 5s
