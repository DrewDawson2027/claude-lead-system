#!/usr/bin/env python3
"""
Generate demo.cast for claude-lead-system launch demo.
Produces a ~25s scripted terminal recording — no live session needed.

Usage:
    python3 scripts/generate-demo-cast.py
    agg demo.cast assets/demo-hero.gif --theme monokai --font-size 14

Output: demo.cast (asciinema v3 format)
"""

import json
import os
import sys

# ── ANSI color codes ──────────────────────────────────────────────────────────
G = "\033[0;32m"  # green
Y = "\033[1;33m"  # yellow / warning
C = "\033[0;36m"  # cyan
W = "\033[1;37m"  # bold white
DIM = "\033[2m"  # dim
R = "\033[0m"  # reset

# ── Event builder ─────────────────────────────────────────────────────────────
events: list = []
t: float = 0.0


def out(text: str, delay: float = 0.0) -> None:
    global t
    events.append([round(t, 4), "o", text])
    t += delay


def pause(seconds: float) -> None:
    global t
    t += seconds


def nl(extra_delay: float = 0.0) -> None:
    out("\r\n", extra_delay)


def line(text: str, delay_after: float = 0.0) -> None:
    out(text + "\r\n", delay_after)


def type_text(text: str, char_delay: float = 0.040) -> None:
    """Simulate keypresses one char at a time."""
    for ch in text:
        out(ch, char_delay)
    out("\r\n")


# ── Demo ──────────────────────────────────────────────────────────────────────

# Clear + tiny pause before anything appears
pause(0.5)
out("\033[2J\033[H")  # clear screen

# Shell prompt
pause(0.2)
out(f"{DIM}~/my-saas-app  (main){R}\r\n")
pause(0.3)
out(f"{W}$ {R}")
pause(0.5)

# User types /lead
type_text("/lead", char_delay=0.07)
pause(0.25)

# ── Dashboard ─────────────────────────────────────────────────────────────────
nl()
line(f"{W}  Claude Lead System  ·  3 terminals active{R}", 0.04)
nl()
line(f"  {G}●{R}  frontend   my-saas-app   {Y}src/components/Login.tsx{R}", 0.06)
line(f"  {G}●{R}  backend    my-saas-app   {Y}src/components/Login.tsx{R}", 0.06)
line(f"  {G}●{R}  tests      my-saas-app   running 594 tests")
nl()
pause(2.2)

# ── Conflict check ────────────────────────────────────────────────────────────
out(f"{DIM}>{R} ")
type_text('"any conflicts?"', char_delay=0.048)
pause(0.35)

nl()
line(f"  {Y}⚠  CONFLICT — src/components/Login.tsx{R}", 0.06)
line(f"     frontend  is editing this file", 0.05)
line(f"     backend   is editing this file", 0.05)
line(f"     {DIM}one will overwrite the other{R}")
nl()
pause(2.2)

# ── Message backend ───────────────────────────────────────────────────────────
out(f"{DIM}>{R} ")
type_text(
    '"message backend — hold off on Login.tsx, frontend has it"', char_delay=0.038
)
pause(0.35)

nl()
line(f"  {G}✓{R}  Sent to backend", 0.05)
pause(0.5)
line(f"     {DIM}backend: ack — switching to src/api/auth.ts{R}")
nl()
pause(1.8)

# ── Create task ───────────────────────────────────────────────────────────────
out(f"{DIM}>{R} ")
type_text('"create a task: auth migration, owned by backend"', char_delay=0.040)
pause(0.35)

nl()
line(f"  {G}✓{R}  Task created — auth migration", 0.06)
line(f"     {DIM}owner: backend{R}")
nl()
pause(1.8)

# ── Stats ─────────────────────────────────────────────────────────────────────
line(f"  {DIM}──────────────────────────────────────────{R}", 0.04)
line(f"  {C}594 tests  ·  48 tools  ·  0 coordination tokens{R}", 0.04)
line(f"  {DIM}──────────────────────────────────────────{R}")
pause(3.5)

# ── Write cast file ───────────────────────────────────────────────────────────
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
output_path = os.path.join(repo_root, "demo.cast")

header = {
    "version": 2,
    "width": 80,
    "height": 24,
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
print(f"\nNext: agg demo.cast assets/demo-hero.gif --theme monokai --font-size 14")
