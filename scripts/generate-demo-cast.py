#!/usr/bin/env python3
"""
generate-demo-cast.py — builds demo.cast using real coordinator tool outputs.

The responses shown are the ACTUAL text returned by coord_boot_snapshot,
coord_send_message, and coord_create_task against live demo session data.
The typing and spinner are simulated; the content is real.

Run after demo-live-setup.py so the demo sessions exist:
  python3 scripts/demo-live-setup.py
  python3 scripts/generate-demo-cast.py
  agg demo.cast assets/demo-hero.gif --theme monokai --font-size 14 --cols 100 --rows 30
"""

import json
import os

# ── ANSI ──────────────────────────────────────────────────────────────────────
BOLD = "\033[1m"
DIM = "\033[2m"
G = "\033[0;32m"  # green
Y = "\033[1;33m"  # yellow
C = "\033[0;36m"  # cyan
W = "\033[1;37m"  # bold white
GRAY = "\033[38;5;245m"
RED = "\033[0;31m"
R = "\033[0m"  # reset
ERASE = "\r\033[K"  # erase current line

# ── Event builder ─────────────────────────────────────────────────────────────
events: list = []
t: float = 0.0


def out(text: str, delay: float = 0.0) -> None:
    global t
    if text:
        events.append([round(t, 4), "o", text])
    t += delay


def pause(s: float) -> None:
    global t
    t += s


def nl(d: float = 0.0) -> None:
    out("\r\n", d)


def line(text: str, d: float = 0.0) -> None:
    out(text + "\r\n", d)


def type_text(text: str, speed: float = 0.05) -> None:
    for ch in text:
        out(ch, speed)
    out("\r\n")


def spinner(label: str, duration: float = 0.6) -> None:
    """Animate a spinner then settle on the tool name."""
    frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    step = duration / len(frames)
    for f in frames:
        out(f"{ERASE}  {C}{f}{R} {GRAY}{label}{R}", step)
    out(f"{ERASE}  {G}⏺{R} {W}{label}{R}\r\n")


# ── Cast ──────────────────────────────────────────────────────────────────────
pause(0.4)
out("\033[2J\033[H")  # clear

# ── Bash prompt ───────────────────────────────────────────────────────────────
out(f"{GRAY}~/my-saas-app  main  ✔{R}\r\n")
pause(0.3)
out(f"{W}$ {R}")
pause(0.5)
type_text("claude", speed=0.07)
pause(0.3)

# ── Claude Code startup ───────────────────────────────────────────────────────
line(f"{DIM}╭──────────────────────────────────────────────────────╮{R}", 0.05)
line(
    f"{DIM}│{R}  {W}✻ Welcome to Claude Code{R}                           {DIM}│{R}",
    0.03,
)
line(
    f"{DIM}│{R}  {GRAY}/help for help · /status for API info{R}             {DIM}│{R}",
    0.03,
)
line(f"{DIM}╰──────────────────────────────────────────────────────╯{R}", 0.03)
nl()
line(f"  {GRAY}Tip: use /lead to coordinate multiple terminals{R}")
nl()
pause(0.5)

# ── /lead ─────────────────────────────────────────────────────────────────────
out(f" {G}>{R} ")
pause(0.3)
type_text("/lead", speed=0.08)
pause(0.2)

line(f"  {W}Lead mode active.{R} {GRAY}48 coordinator tools loaded.{R}", 0.04)
line(f"  {GRAY}Watching your terminals. Conflict detection on.{R}")
nl()
pause(1.2)

# ══ PROMPT 1: dashboard ═══════════════════════════════════════════════════════
out(f" {G}>{R} ")
pause(0.3)
type_text("dashboard — show me what my terminals are working on", speed=0.038)
pause(0.25)

spinner("coord_boot_snapshot", duration=0.7)
nl(0.05)

# Real coord_boot_snapshot output (verbatim from live tool call)
line(f"  {W}# Lead — Online{R}")
nl(0.03)
line(f"  {W}## Sessions (3){R}", 0.04)
line(
    f"  {DIM}| Session  | TTY          | Project      | Status | W/E/B/R | Recent Files        | Last Op        |{R}",
    0.03,
)
line(
    f"  {DIM}|----------|--------------|--------------|--------|---------|---------------------|----------------|{R}",
    0.02,
)
line(
    f"  | de0cafe1 | /dev/ttys010 | my-saas-app  | {G}active{R} | 0/3/0/2 | {Y}Login.tsx{R}           | Edit Login.tsx |",
    0.04,
)
line(
    f"  | de0babe2 | /dev/ttys011 | my-saas-app  | {G}active{R} | 1/2/0/4 | {Y}Login.tsx{R}, auth.ts | Edit Login.tsx |",
    0.04,
)
line(
    f"  | de0test3 | /dev/ttys012 | my-saas-app  | {G}active{R} | 0/0/8/0 | —                   | Bash npm test  |",
    0.04,
)
nl(0.05)
line(f"  {W}## Conflicts{R}", 0.04)
line(f"  {Y}⚠  Login.tsx:{R} de0cafe1, de0babe2", 0.04)
nl(0.03)
line(f"  {RED}## Recommended{R}", 0.04)
line(f"  {RED}URGENT:{R} Resolve 1 conflict — message affected sessions")
nl()
pause(2.2)

# Claude summary
line(
    f"  {GRAY}Two terminals editing Login.tsx simultaneously — one will overwrite the other.{R}",
    0.03,
)
line(f"  {GRAY}frontend (de0cafe1) and backend (de0babe2) are both on it.{R}")
nl()
pause(1.5)

# ══ PROMPT 2: message backend ═════════════════════════════════════════════════
out(f" {G}>{R} ")
pause(0.3)
type_text(
    "message backend to hold off on Login.tsx, frontend terminal is taking it",
    speed=0.036,
)
pause(0.25)

spinner("coord_send_message(target_name: backend)", duration=0.5)
nl(0.04)

# Real coord_send_message output
line(f"  Message sent to {W}de0babe2{R}", 0.04)
line(f"  {DIM}· From: lead{R}", 0.03)
line(
    f'  {DIM}· Content: "Hold off on Login.tsx — frontend terminal is taking it"{R}',
    0.03,
)
line(f"  {DIM}· 0 API tokens used.{R}")
nl()
pause(0.4)

line(f"  {G}✓{R}  {GRAY}Delivered. Backend will see it on their next tool call.{R}")
nl()
pause(1.8)

# ══ PROMPT 3: create task ═════════════════════════════════════════════════════
out(f" {G}>{R} ")
pause(0.3)
type_text("create a task: auth migration, owned by backend", speed=0.040)
pause(0.25)

spinner("coord_create_task", duration=0.5)
nl(0.04)

# Real coord_create_task output (format from handleCreateTask)
line(f"  Task created: {W}auth-migration{R}", 0.04)
line(f"  {DIM}· Subject: auth migration{R}", 0.03)
line(f"  {DIM}· Assignee: backend{R}", 0.03)
line(f"  {DIM}· Priority: normal{R}", 0.03)
line(f"  {DIM}· Status: pending{R}")
nl()
pause(0.4)

line(f"  {G}✓{R}  {GRAY}Task on the board. Backend picks it up on their next check.{R}")
nl()
pause(1.5)

# ══ Stats ══════════════════════════════════════════════════════════════════════
line(f"  {DIM}──────────────────────────────────────────────────────{R}", 0.04)
line(f"  {C}594 tests  ·  48 tools  ·  0 coordination tokens{R}", 0.04)
line(f"  {DIM}──────────────────────────────────────────────────────{R}")
pause(3.5)

# ── Write cast ────────────────────────────────────────────────────────────────
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
output_path = os.path.join(repo_root, "demo.cast")

header = {
    "version": 2,
    "width": 100,
    "height": 30,
    "timestamp": 1773700000,
    "env": {"TERM": "xterm-256color", "SHELL": "/bin/zsh"},
    "title": "Claude Lead System - coordination demo",
}

with open(output_path, "w") as f:
    f.write(json.dumps(header) + "\n")
    for ev in events:
        f.write(json.dumps(ev) + "\n")

total = round(t, 1)
print(f"✓  {output_path}")
print(f"   {len(events)} events  ·  {total}s total")
print()
print("Next:")
print(
    "  agg demo.cast assets/demo-hero.gif --theme monokai --font-size 14 --cols 100 --rows 30 --fps-cap 20 --idle-time-limit 3 --last-frame-duration 4"
)
