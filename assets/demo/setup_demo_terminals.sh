#!/usr/bin/env bash
# Sets up 3 iTerm2 panes for demo recording.
# Usage: bash assets/demo/setup_demo_terminals.sh

set -euo pipefail

DEMO_DIR="${HOME}/claude-lead-system/assets/demo/demo-project"

if ! command -v osascript &>/dev/null; then
  echo "This script requires macOS with iTerm2."
  echo "For other platforms, manually open 3 terminal panes side by side."
  exit 1
fi

osascript <<APPLESCRIPT
tell application "iTerm2"
  activate

  -- Create new window
  set newWindow to (create window with default profile)

  tell current session of current tab of newWindow
    -- Terminal A (Lead)
    write text "export PS1='\\w \$ '"
    write text "cd ${DEMO_DIR} && clear"
    write text "echo '=== Terminal A (Lead) ==='"

    -- Split vertically for Terminal B
    set termB to (split vertically with default profile)
  end tell

  tell termB
    write text "export PS1='\\w \$ '"
    write text "cd ${DEMO_DIR} && clear"
    write text "echo '=== Terminal B (Worker A) ==='"

    -- Split vertically for Terminal C
    set termC to (split vertically with default profile)
  end tell

  tell termC
    write text "export PS1='\\w \$ '"
    write text "cd ${DEMO_DIR} && clear"
    write text "echo '=== Terminal C (Worker B) ==='"
  end tell

end tell
APPLESCRIPT

echo "Demo terminals ready. Start recording."
