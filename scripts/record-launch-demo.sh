#!/usr/bin/env bash
# =============================================================================
# record-launch-demo.sh
# 60-second terminal demo of claude-lead-system key capabilities
#
# USAGE:
#   ./scripts/record-launch-demo.sh
#
# This script records a scripted demo using asciinema (preferred) or the
# built-in `script` command. Drew types the commands manually for authenticity.
# The recording captures the tmux pane where Drew is running.
#
# OUTPUT: ~/Desktop/demo-recording/launch-demo.cast
# =============================================================================

set -euo pipefail

OUTPUT_DIR="$HOME/Desktop/demo-recording"
OUTPUT_FILE="$OUTPUT_DIR/launch-demo.cast"
SCRIPT_LOG="$OUTPUT_DIR/launch-demo.log"

mkdir -p "$OUTPUT_DIR"

# ─── Color helpers ───────────────────────────────────────────────────────────
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

print_step() {
  echo -e "\n${CYAN}${BOLD}▶ $1${RESET}"
}

print_info() {
  echo -e "  ${YELLOW}$1${RESET}"
}

print_ok() {
  echo -e "  ${GREEN}✓ $1${RESET}"
}

# ─── Pre-flight check ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  claude-lead-system  —  Launch Demo Recorder${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

if command -v asciinema &>/dev/null; then
  RECORDER="asciinema"
  print_ok "asciinema found — will produce a .cast file for sharing on asciinema.org"
else
  RECORDER="script"
  print_info "asciinema not found — falling back to 'script' command"
  print_info "Install asciinema for shareable .cast files:  brew install asciinema"
fi

echo ""
print_step "Output will be saved to: $OUTPUT_FILE"
echo ""

# ─── Demo sequence briefing ──────────────────────────────────────────────────
echo -e "${BOLD}DEMO SEQUENCE (you type these — don't rush):${RESET}"
echo ""
echo "  [0:00]  1. /lead          — starts the coordinator (2s pause after)"
echo "  [0:02]  2. coord_spawn_workers  — spawn alpha + beta in parallel (5s)"
echo "  [0:07]  3. coord_watch_output  — live progress both workers (10s)"
echo "  [0:17]  4. coord_detect_conflicts  — show file overlap catch (10s)"
echo "  [0:27]  5. coord_send_message  — instruct alpha to adjust (5s)"
echo "  [0:32]  6. coord_watch_output worker_name=alpha  — focused view (5s)"
echo "  [0:37]  7. coord_get_result  — show completed output (5s)"
echo "  [0:42]  8. coord_list_workers  — final status summary (5s)"
echo "  [0:47]  END — pause for effect, then stop recording"
echo ""

read -rp "Ready to start recording? Press ENTER to begin (Ctrl+C to abort)..."

echo ""
echo -e "${BOLD}Recording starting in 3...${RESET}"
sleep 1
echo -e "${BOLD}2...${RESET}"
sleep 1
echo -e "${BOLD}1...${RESET}"
sleep 1
echo ""

# ─── Start recording ─────────────────────────────────────────────────────────
if [[ "$RECORDER" == "asciinema" ]]; then
  # asciinema rec: --overwrite allows re-recording, --idle-time-limit 2 caps
  # long pauses to keep the demo tight on playback.
  print_info "Recording with asciinema. Type your commands naturally."
  print_info "Press Ctrl+D or type 'exit' to stop recording."
  echo ""
  asciinema rec \
    --overwrite \
    --idle-time-limit 2 \
    --title "claude-lead-system demo — parallel agent coordination" \
    "$OUTPUT_FILE"
else
  # `script` captures raw terminal output to a typescript file.
  # -q = quiet (no start/stop messages in the recording itself)
  print_info "Recording with 'script'. Type your commands naturally."
  print_info "Type 'exit' to stop recording."
  echo ""
  script -q "$SCRIPT_LOG"
  print_info "Raw log saved to: $SCRIPT_LOG"
  print_info "Convert to .cast with: asciinema convert $SCRIPT_LOG $OUTPUT_FILE"
fi

# ─── Post-recording ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  Recording complete!${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

if [[ -f "$OUTPUT_FILE" ]]; then
  SIZE=$(du -sh "$OUTPUT_FILE" | cut -f1)
  print_ok "Saved: $OUTPUT_FILE  ($SIZE)"
  echo ""
  echo -e "  ${BOLD}Next steps:${RESET}"
  echo "    Play back:   asciinema play $OUTPUT_FILE"
  echo "    Upload:      asciinema upload $OUTPUT_FILE"
  echo "    Convert GIF: agg $OUTPUT_FILE ~/Desktop/demo-recording/demo.gif"
else
  print_info "No .cast file found. If you used 'script', convert the log manually:"
  print_info "  asciinema convert $SCRIPT_LOG $OUTPUT_FILE"
fi

echo ""
