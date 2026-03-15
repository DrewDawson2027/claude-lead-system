Output demo.gif
Set Width 1200
Set Height 600
Set FontSize 14
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms
Set Padding 20

# Title frame
Type "# Claude Lead System — One control room for all your Claude Code terminals"
Enter
Sleep 2s

# Show the quick install
Type "git clone https://github.com/DrewDawson2027/claude-lead-system.git"
Sleep 1s
Enter
Sleep 1s
Type "cd claude-lead-system && bash install.sh"
Enter
Sleep 3s

# Show test suite
Type "npm test 2>&1 | tail -15"
Enter
Sleep 4s

# Show tool count
Type "echo '81 MCP coordination tools'"
Enter
Sleep 2s

# Show the key feature — conflict detection
Type "# Key Feature: Pre-edit conflict detection"
Enter
Sleep 1s
Type "# Two sessions editing the same file? Lead catches it BEFORE the collision."
Enter
Sleep 2s

# Show focus/cycle
Type "# In-process UX: auto-stream worker output"
Enter
Type "# /focus researcher — see their output live"
Enter
Type "# /cycle — rotate through active workers"
Enter
Type "# /unfocus — stop streaming"
Enter
Sleep 3s

# End frame
Type "# 996 tests | 81 tools | All CI green | Zero API tokens for coordination"
Enter
Sleep 3s
