#!/usr/bin/env python3
"""
demo-live-setup.py — wire the real lead system for a live screen recording.

What this does:
  1. Backs up all existing session files
  2. Marks them "closed" so only demo sessions appear in coord_boot_snapshot
  3. Creates 3 fake active sessions: frontend, backend, tests
     - frontend + backend both have Login.tsx in files_touched → conflict fires
     - backend has worker_name so coord_send_message can target it by name
  4. Starts a background process to keep last_active timestamps fresh (active)
  5. Creates ~/my-saas-app/src/components/Login.tsx so path resolution works

Run teardown when done: python3 scripts/demo-live-teardown.py
"""

import json
import os
import glob
import shutil
import subprocess
import sys
from datetime import datetime, timezone

TERMINALS = os.path.expanduser("~/.claude/terminals")
BACKUP = "/tmp/claude-demo-session-backup"
PID_FILE = "/tmp/claude-demo-refresher.pid"
PROJECT_DIR = os.path.expanduser("~/my-saas-app")
LOGIN_PATH = f"{PROJECT_DIR}/src/components/Login.tsx"
AUTH_PATH = f"{PROJECT_DIR}/src/api/auth.ts"


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── 1. Backup existing sessions ───────────────────────────────────────────────
os.makedirs(BACKUP, exist_ok=True)
existing = glob.glob(f"{TERMINALS}/session-*.json")
for f in existing:
    shutil.copy2(f, BACKUP)
print(f"✓  Backed up {len(existing)} session files → {BACKUP}")

# ── 2. Mark all existing sessions as closed ───────────────────────────────────
closed_count = 0
for f in existing:
    try:
        with open(f) as fh:
            d = json.load(fh)
        d["status"] = "closed"
        with open(f, "w") as fh:
            json.dump(d, fh, indent=2)
        closed_count += 1
    except Exception:
        pass
print(f"✓  Closed {closed_count} existing sessions (hidden from dashboard)")

# ── 3. Create demo project files ──────────────────────────────────────────────
os.makedirs(os.path.dirname(LOGIN_PATH), exist_ok=True)
os.makedirs(os.path.dirname(AUTH_PATH), exist_ok=True)
if not os.path.exists(LOGIN_PATH):
    with open(LOGIN_PATH, "w") as f:
        f.write("// Login component — auth migration in progress\n")
if not os.path.exists(AUTH_PATH):
    with open(AUTH_PATH, "w") as f:
        f.write("// Auth API\n")
print(f"✓  Demo project at {PROJECT_DIR}")

# ── 4. Create demo sessions ───────────────────────────────────────────────────
now = now_iso()

demo_sessions = [
    {
        "session": "de0cafe1",
        "worker_name": "frontend",
        "status": "active",
        "project": "my-saas-app",
        "cwd": PROJECT_DIR,
        "tty": "/dev/ttys010",
        "started": now,
        "last_active": now,
        "last_tool": "Edit",
        "last_file": "Login.tsx",
        "schema_version": 2,
        "tool_counts": {"Edit": 3, "Read": 2},
        "turn_count": 4,
        "files_touched": [LOGIN_PATH],
        "current_files": [LOGIN_PATH],
        "recent_ops": [
            {"t": now, "tool": "Edit", "file": LOGIN_PATH},
            {"t": now, "tool": "Read", "file": LOGIN_PATH},
        ],
    },
    {
        "session": "de0babe2",
        "worker_name": "backend",
        "status": "active",
        "project": "my-saas-app",
        "cwd": PROJECT_DIR,
        "tty": "/dev/ttys011",
        "started": now,
        "last_active": now,
        "last_tool": "Edit",
        "last_file": "Login.tsx",
        "schema_version": 2,
        "tool_counts": {"Edit": 2, "Write": 1, "Read": 4},
        "turn_count": 6,
        "files_touched": [LOGIN_PATH, AUTH_PATH],
        "current_files": [LOGIN_PATH],
        "recent_ops": [
            {"t": now, "tool": "Edit", "file": LOGIN_PATH},
        ],
    },
    {
        "session": "de0test3",
        "worker_name": "tests",
        "status": "active",
        "project": "my-saas-app",
        "cwd": PROJECT_DIR,
        "tty": "/dev/ttys012",
        "started": now,
        "last_active": now,
        "last_tool": "Bash",
        "last_file": "npm test",
        "schema_version": 2,
        "tool_counts": {"Bash": 8},
        "turn_count": 3,
        "files_touched": [],
        "current_files": [],
        "recent_ops": [
            {"t": now, "tool": "Bash", "file": "npm test --watch"},
        ],
    },
]

demo_paths = []
for s in demo_sessions:
    path = f"{TERMINALS}/session-{s['session']}.json"
    with open(path, "w") as f:
        json.dump(s, f, indent=2)
    demo_paths.append(path)
    print(f"✓  Created session: {s['worker_name']}  ({s['session']})")

# ── 5. Start background refresher (keeps last_active < 30s) ──────────────────
refresher_code = f"""
import json, time
from datetime import datetime, timezone

files = {json.dumps(demo_paths)}

def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

while True:
    for f in files:
        try:
            with open(f) as fh:
                d = json.load(fh)
            d["last_active"] = now()
            with open(f, "w") as fh:
                json.dump(d, fh, indent=2)
        except Exception:
            pass
    time.sleep(8)
"""

proc = subprocess.Popen(
    [sys.executable, "-c", refresher_code],
    start_new_session=True,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
with open(PID_FILE, "w") as f:
    f.write(str(proc.pid))
print(f"✓  Refresher running (PID {proc.pid}) — sessions stay active")

# ── Done ──────────────────────────────────────────────────────────────────────
print()
print("━" * 56)
print("  DEMO ENVIRONMENT READY")
print("━" * 56)
print()
print("📹  TO RECORD:")
print("    1. Open a FRESH iTerm2 window (not this one)")
print("    2. Start Loom / QuickTime screen recording")
print("    3. Type in the new window:")
print("         cd ~/my-saas-app && claude")
print("    4. In Claude Code, type: /lead")
print()
print("🗣  DEMO SCRIPT (say these exactly, ~25 seconds):")
print()
print('   Step 1: "dashboard — show me what my terminals are working on"')
print("           → shows 3 sessions + ⚠ conflict on Login.tsx")
print()
print('   Step 2: "message backend to hold off on Login.tsx,')
print('            the frontend terminal is taking it"')
print("           → coord_send_message delivered to backend")
print()
print('   Step 3: "create a task: auth migration, owned by backend"')
print("           → coord_create_task fires")
print()
print("   End caption: 594 tests · 48 tools · 0 coordination tokens")
print()
print(f"🧹  TEARDOWN: python3 scripts/demo-live-teardown.py")
print()
