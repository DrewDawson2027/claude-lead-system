#!/usr/bin/env python3
"""
demo-live-teardown.py — restore real sessions after recording.
"""

import json
import os
import glob
import shutil
import signal

TERMINALS = os.path.expanduser("~/.claude/terminals")
BACKUP = "/tmp/claude-demo-session-backup"
PID_FILE = "/tmp/claude-demo-refresher.pid"

# Kill refresher
try:
    with open(PID_FILE) as f:
        pid = int(f.read().strip())
    os.kill(pid, signal.SIGTERM)
    print(f"✓  Killed refresher (PID {pid})")
    os.remove(PID_FILE)
except Exception as e:
    print(f"   No refresher found ({e})")

# Remove demo sessions
removed = 0
for pattern in [
    "session-de0cafe1.json",
    "session-de0babe2.json",
    "session-de0test3.json",
]:
    path = f"{TERMINALS}/{pattern}"
    if os.path.exists(path):
        os.remove(path)
        removed += 1
print(f"✓  Removed {removed} demo session files")

# Restore backups
restored = 0
for f in glob.glob(f"{BACKUP}/session-*.json"):
    dest = f"{TERMINALS}/{os.path.basename(f)}"
    shutil.copy2(f, dest)
    restored += 1
print(f"✓  Restored {restored} session files from backup")

print()
print("✅  Teardown complete — real sessions restored")
