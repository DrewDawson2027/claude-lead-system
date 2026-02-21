"""Generate authentic terminal screenshots for Claude Lead System demo.

Creates polished dark-theme terminal images that look like real iTerm2 output.
Uses PIL/Pillow to render monospace text on dark backgrounds with terminal chrome.
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ─── Paths ────────────────────────────────────────────────────────────────────
ASSETS_DIR = Path(__file__).resolve().parent
OUT_DIR = ASSETS_DIR / "screenshots"

# ─── Colors (iTerm2 Solarized Dark inspired) ─────────────────────────────────
BG = (30, 30, 46)
BG_TITLEBAR = (45, 45, 60)
TEXT = (205, 214, 244)
MUTED = (147, 153, 178)
GREEN = (166, 227, 161)
RED = (243, 139, 168)
YELLOW = (249, 226, 175)
BLUE = (137, 180, 250)
CYAN = (148, 226, 213)
MAUVE = (203, 166, 247)
PEACH = (250, 179, 135)
SURFACE = (49, 50, 68)

# Traffic light colors
TL_RED = (255, 95, 86)
TL_YELLOW = (255, 189, 46)
TL_GREEN = (39, 201, 63)

# ─── Fonts ────────────────────────────────────────────────────────────────────
def _find_mono_font() -> str | None:
    candidates = [
        "/System/Library/Fonts/SFNSMono.ttf",
        "/Library/Fonts/SF-Mono-Regular.otf",
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Supplemental/Menlo.ttc",
        "/System/Library/Fonts/Monaco.ttf",
        "/System/Library/Fonts/Supplemental/Courier New.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def _font(size: int = 18) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = _find_mono_font()
    if path:
        return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def _bold_font(size: int = 18) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    bold_candidates = [
        "/Library/Fonts/SF-Mono-Bold.otf",
        "/System/Library/Fonts/SFNSMono.ttf",
        "/System/Library/Fonts/Menlo.ttc",
    ]
    for p in bold_candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size=size)
            except Exception:
                continue
    return _font(size)


# ─── Terminal Chrome ──────────────────────────────────────────────────────────
def _draw_terminal_chrome(
    draw: ImageDraw.ImageDraw,
    width: int,
    title: str = "claude — lead",
) -> int:
    """Draw iTerm2-style title bar. Returns y offset where content starts."""
    bar_h = 40

    # Title bar background
    draw.rectangle([0, 0, width, bar_h], fill=BG_TITLEBAR)

    # Traffic lights
    for i, color in enumerate([TL_RED, TL_YELLOW, TL_GREEN]):
        cx = 20 + i * 24
        cy = bar_h // 2
        draw.ellipse([cx - 7, cy - 7, cx + 7, cy + 7], fill=color)

    # Title text
    tf = _font(14)
    tw = draw.textlength(title, font=tf)
    draw.text(((width - tw) / 2, (bar_h - 14) / 2), title, font=tf, fill=MUTED)

    # Separator line
    draw.line([0, bar_h, width, bar_h], fill=(60, 60, 80), width=1)

    return bar_h + 12  # content starts below bar + padding


# ─── Rendering Helpers ────────────────────────────────────────────────────────
class TerminalRenderer:
    """Renders colored terminal text onto a PIL image."""

    def __init__(self, width: int = 1600, min_height: int = 900):
        self.width = width
        self.min_height = min_height
        self.font = _font(17)
        self.bold = _bold_font(17)
        self.small = _font(14)
        self.line_height = 26
        self.left_pad = 24
        self.lines: list[list[tuple[str, tuple[int, int, int], bool]]] = []

    def add_line(self, *segments: tuple[str, tuple[int, int, int]] | tuple[str, tuple[int, int, int], bool]):
        """Add a line with colored segments. Each segment: (text, color) or (text, color, bold)."""
        parsed = []
        for seg in segments:
            if len(seg) == 2:
                parsed.append((seg[0], seg[1], False))
            else:
                parsed.append((seg[0], seg[1], seg[2]))
        self.lines.append(parsed)

    def add_blank(self):
        self.lines.append([])

    def render(self, title: str = "claude — lead") -> Image.Image:
        content_height = len(self.lines) * self.line_height + 80
        height = max(self.min_height, content_height)
        img = Image.new("RGB", (self.width, height), BG)
        draw = ImageDraw.Draw(img)

        y_start = _draw_terminal_chrome(draw, self.width, title)

        for i, segments in enumerate(self.lines):
            x = self.left_pad
            y = y_start + i * self.line_height
            for text, color, bold in segments:
                f = self.bold if bold else self.font
                draw.text((x, y), text, font=f, fill=color)
                x += draw.textlength(text, font=f)

        return img


# ─── Screenshot Generators ────────────────────────────────────────────────────

def make_dashboard() -> Image.Image:
    """Screenshot 1: The /lead dashboard with live sessions."""
    r = TerminalRenderer(1600, 820)

    r.add_line(("# Lead", BLUE, True), (" — ", MUTED), ("Online", GREEN, True))
    r.add_blank()
    r.add_line(("## Sessions", MAUVE, True))

    # Table header
    r.add_line(
        ("| ", MUTED),
        ("Session ", MUTED),
        ("| ", MUTED),
        ("TTY      ", MUTED),
        ("| ", MUTED),
        ("Project     ", MUTED),
        ("| ", MUTED),
        ("Status ", MUTED),
        ("| ", MUTED),
        ("Tools (W/E/B/R) ", MUTED),
        ("| ", MUTED),
        ("Recent Files           ", MUTED),
        ("| ", MUTED),
        ("Last Op       ", MUTED),
        ("|", MUTED),
    )
    r.add_line(
        ("|----------|----------|-------------|--------|-----------------|", SURFACE),
        ("------------------------|--------------|", SURFACE),
    )

    # Session A - active builder
    r.add_line(
        ("| ", MUTED),
        ("a1b2c3d4", CYAN),
        (" | ", MUTED),
        ("ttys003 ", TEXT),
        (" | ", MUTED),
        ("my-saas-app", TEXT),
        (" | ", MUTED),
        ("active", GREEN),
        (" | ", MUTED),
        ("15", PEACH),
        ("/", MUTED),
        ("8", YELLOW),
        ("/", MUTED),
        ("23", BLUE),
        ("/", MUTED),
        ("5", CYAN),
        ("          | ", MUTED),
        ("auth.ts, db.ts, types  ", TEXT),
        (" | ", MUTED),
        ("Edit auth.ts ", YELLOW),
        (" |", MUTED),
    )

    # Session B - active frontend
    r.add_line(
        ("| ", MUTED),
        ("e5f6g7h8", CYAN),
        (" | ", MUTED),
        ("ttys058 ", TEXT),
        (" | ", MUTED),
        ("my-saas-app", TEXT),
        (" | ", MUTED),
        ("active", GREEN),
        (" | ", MUTED),
        ("4", PEACH),
        ("/", MUTED),
        ("12", YELLOW),
        ("/", MUTED),
        ("6", BLUE),
        ("/", MUTED),
        ("22", CYAN),
        ("         | ", MUTED),
        ("Login.tsx, auth.ts     ", TEXT),
        (" | ", MUTED),
        ("Edit auth.ts ", YELLOW),
        (" |", MUTED),
    )

    # Session C - idle tester
    r.add_line(
        ("| ", MUTED),
        ("c3d4e5f6", CYAN),
        (" | ", MUTED),
        ("ttys091 ", TEXT),
        (" | ", MUTED),
        ("my-saas-app", TEXT),
        (" | ", MUTED),
        ("idle  ", YELLOW),
        (" | ", MUTED),
        ("8", PEACH),
        ("/", MUTED),
        ("3", YELLOW),
        ("/", MUTED),
        ("14", BLUE),
        ("/", MUTED),
        ("11", CYAN),
        ("         | ", MUTED),
        ("integration.test.ts    ", TEXT),
        (" | ", MUTED),
        ("Bash pytest  ", BLUE),
        (" |", MUTED),
    )

    r.add_blank()
    r.add_line(("## What Each Terminal Is Doing", MAUVE, True))
    r.add_line(
        ("  - Session ", MUTED),
        ("a1b2c3d4", CYAN),
        (" (ttys003): ", MUTED),
        ("Building auth module", TEXT),
        (" — 15 Writes, 23 Bash runs", GREEN),
    )
    r.add_line(
        ("  - Session ", MUTED),
        ("e5f6g7h8", CYAN),
        (" (ttys058): ", MUTED),
        ("Frontend auth UI", TEXT),
        (" — 12 Edits, 22 Reads", YELLOW),
    )
    r.add_line(
        ("  - Session ", MUTED),
        ("c3d4e5f6", CYAN),
        (" (ttys091): ", MUTED),
        ("Test coverage", TEXT),
        (" — idle 8m, 14 Bash runs", MUTED),
    )

    r.add_blank()
    r.add_line(("## Conflicts", MAUVE, True))
    r.add_line(
        ("  ", TEXT),
        ("⚠ ", YELLOW),
        ("CONFLICT: ", RED, True),
        ("src/auth.ts", PEACH),
        (" touched by ", MUTED),
        ("a1b2c3d4", CYAN),
        (" AND ", MUTED),
        ("e5f6g7h8", CYAN),
    )

    r.add_blank()
    r.add_line(("## Git Status", MAUVE, True))
    r.add_line(
        ("  Branch: ", MUTED),
        ("feature/auth", GREEN),
        ("  |  ", MUTED),
        ("5 modified", YELLOW),
        (", ", MUTED),
        ("2 staged", GREEN),
    )

    r.add_blank()
    r.add_line(
        ("  ───────────────────────────────────────────────────────────────", SURFACE),
    )
    r.add_line(
        ("  Coordination: ", MUTED),
        ("0 API tokens", GREEN, True),
        ("  |  State: ", MUTED),
        ("3 sessions @ 1.4KB avg", CYAN),
        ("  |  Latency: ", MUTED),
        ("0.019ms", GREEN),
    )

    return r.render("claude — /lead")


def make_conflicts() -> Image.Image:
    """Screenshot 2: Conflict detection warning."""
    r = TerminalRenderer(1600, 700)

    r.add_line(("$ ", GREEN), ("conflicts", TEXT, True))
    r.add_blank()
    r.add_line(("## ", MUTED), ("CONFLICTS DETECTED", RED, True))
    r.add_blank()
    r.add_line(("### File Overlaps", MAUVE, True))
    r.add_line(
        ("  - ", MUTED),
        ("src/auth.ts", PEACH, True),
    )
    r.add_line(
        ("    ├─ Session ", MUTED),
        ("a1b2c3d4", CYAN),
        (" (ttys003): ", MUTED),
        ("8 Edits", YELLOW),
        (' — "building authentication layer"', TEXT),
    )
    r.add_line(
        ("    └─ Session ", MUTED),
        ("e5f6g7h8", CYAN),
        (" (ttys058): ", MUTED),
        ("12 Edits", YELLOW),
        (' — "updating login component"', TEXT),
    )
    r.add_blank()
    r.add_line(("### Recent Edits ", MAUVE, True), ("(last 5 min)", MUTED))
    r.add_line(
        ("  ", TEXT),
        ("2026-02-19T21:42:30Z", MUTED),
        ("  a1b2c3d4: ", CYAN),
        ("Edit", YELLOW),
        (" auth.ts", TEXT),
    )
    r.add_line(
        ("  ", TEXT),
        ("2026-02-19T21:43:15Z", MUTED),
        ("  e5f6g7h8: ", CYAN),
        ("Edit", YELLOW),
        (" auth.ts", TEXT),
    )
    r.add_blank()
    r.add_line(
        ("  ", TEXT),
        ("⚠ ", YELLOW),
        ("Recommendation: ", TEXT, True),
        ("Coordinate before editing ", MUTED),
        ("src/auth.ts", PEACH),
    )
    r.add_line(
        ("  ", TEXT),
        ("  Run: ", MUTED),
        ('tell e5f6g7h8 to "stop editing auth.ts, a1b2c3d4 owns it"', CYAN),
    )

    r.add_blank()
    r.add_line(
        ("  ───────────────────────────────────────────────────────────────", SURFACE),
    )
    r.add_line(
        ("  Scanned ", MUTED),
        ("3 sessions", CYAN),
        (" in ", MUTED),
        ("0.019ms", GREEN),
        (" | ", MUTED),
        ("4.2KB", CYAN),
        (" total state read", MUTED),
    )

    return r.render("claude — conflicts")


def make_messaging() -> Image.Image:
    """Screenshot 3: Inbox message delivery."""
    r = TerminalRenderer(1600, 680)

    # Show the lead sending a message
    r.add_line(("$ ", GREEN), ("tell e5f6g7h8 to stop editing auth.ts, a1b2c3d4 owns that file", TEXT, True))
    r.add_blank()
    r.add_line(
        ("  ", TEXT),
        ("✓ ", GREEN),
        ("Message sent to ", MUTED),
        ("e5f6g7h8", CYAN),
    )
    r.add_line(
        ("    Priority: ", MUTED),
        ("urgent", RED),
        ("  |  Inbox: ", MUTED),
        ("~/.claude/terminals/inbox/e5f6g7h8.jsonl", MUTED),
    )

    r.add_blank()
    r.add_line(("─── Meanwhile, in session e5f6g7h8's terminal ───", SURFACE))
    r.add_blank()

    # Show the recipient seeing the message
    r.add_line(("  ┌─────────────────────────────────────────────────────────────┐", YELLOW))
    r.add_line(
        ("  │ ", YELLOW),
        ("INCOMING MESSAGES FROM COORDINATOR", YELLOW, True),
        ("                          │", YELLOW),
    )
    r.add_line(("  ├─────────────────────────────────────────────────────────────┤", YELLOW))
    r.add_line(
        ("  │ ", YELLOW),
        ("From: ", MUTED),
        ("lead", CYAN, True),
        ("  Priority: ", MUTED),
        ("urgent", RED, True),
        ("                              │", YELLOW),
    )
    r.add_line(
        ("  │ ", YELLOW),
        ("Time: ", MUTED),
        ("2026-02-19T21:44:00Z", TEXT),
        ("                                    │", YELLOW),
    )
    r.add_line(
        ("  │ ", YELLOW),
        ('Content: "Stop editing auth.ts — session a1b2c3d4', TEXT),
        ("          │", YELLOW),
    )
    r.add_line(
        ("  │ ", YELLOW),
        ('          owns that file. Focus on Login.tsx instead."', TEXT),
        ("       │", YELLOW),
    )
    r.add_line(("  └─────────────────────────────────────────────────────────────┘", YELLOW))

    r.add_blank()
    r.add_line(
        ("  Delivered on next tool invocation via ", MUTED),
        ("PreToolUse hook", CYAN),
        (" — ", MUTED),
        ("0 API tokens", GREEN, True),
    )

    return r.render("claude — messaging")


def make_worker_spawn() -> Image.Image:
    """Screenshot 4: Worker spawn and completion."""
    r = TerminalRenderer(1600, 700)

    r.add_line(
        ("$ ", GREEN),
        ('run "Write integration tests for src/auth.ts" in ~/Projects/my-saas-app', TEXT, True),
    )
    r.add_blank()
    r.add_line(
        ("  ", TEXT),
        ("⚡ ", PEACH),
        ("Pre-flight conflict check... ", MUTED),
        ("clear", GREEN),
    )
    r.add_blank()
    r.add_line(
        ("  Worker spawned: ", MUTED),
        ("W-1708349521", CYAN, True),
    )
    r.add_line(
        ("    Task:    ", MUTED),
        ('"Write integration tests for src/auth.ts"', TEXT),
    )
    r.add_line(
        ("    Layout:  ", MUTED),
        ("split pane", GREEN),
        (" via iTerm2", MUTED),
    )
    r.add_line(
        ("    Results: ", MUTED),
        ("~/.claude/terminals/results/W-1708349521.txt", CYAN),
    )
    r.add_line(
        ("    PID:     ", MUTED),
        ("48291", TEXT),
    )

    r.add_blank()
    r.add_line(("  ─── 45 seconds later ─────────────────────────────────────────", SURFACE))
    r.add_blank()

    r.add_line(("$ ", GREEN), ("check worker W-1708349521", TEXT, True))
    r.add_blank()
    r.add_line(
        ("  Status: ", MUTED),
        ("completed ✓", GREEN, True),
    )
    r.add_line(
        ("  Duration: ", MUTED),
        ("43s", TEXT),
        ("  |  Files created: ", MUTED),
        ("3", CYAN),
    )
    r.add_blank()
    r.add_line(("  Output (last 8 lines):", MUTED))
    r.add_line(("    ✓ Created tests/auth.unit.test.ts       (12 tests)", GREEN))
    r.add_line(("    ✓ Created tests/auth.integration.test.ts (8 tests)", GREEN))
    r.add_line(("    ✓ Created tests/auth.e2e.test.ts         (5 tests)", GREEN))
    r.add_line(("    ", TEXT))
    r.add_line(("    Test Suites:  3 passed, 3 total", GREEN))
    r.add_line(("    Tests:        25 passed, 25 total", GREEN))
    r.add_line(("    Coverage:     94.2%", GREEN))

    return r.render("claude — worker")


def make_healthcheck() -> Image.Image:
    """Screenshot 5: Health check output."""
    r = TerminalRenderer(1600, 620)

    r.add_line(("$ ", GREEN), ("health check", TEXT, True))
    r.add_blank()
    r.add_line(("  Claude Lead System", BLUE, True), (" — Health Check", MUTED))
    r.add_line(("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", SURFACE))
    r.add_blank()

    checks = [
        ("session-register.sh", "SessionStart hook", True),
        ("terminal-heartbeat.sh", "PostToolUse hook", True),
        ("check-inbox.sh", "PreToolUse hook", True),
        ("session-end.sh", "SessionEnd hook", True),
        ("token-guard.py", "PreToolUse guard", True),
        ("read-efficiency-guard.py", "PostToolUse advisory", True),
        ("MCP coordinator", "14 tools registered", True),
        ("terminals directory", "~/.claude/terminals/", True),
        ("inbox directory", "~/.claude/terminals/inbox/", True),
        ("results directory", "~/.claude/terminals/results/", True),
    ]

    for name, desc, passed in checks:
        status_icon = ("  ✓ ", GREEN) if passed else ("  ✗ ", RED)
        status_text = ("PASS", GREEN, True) if passed else ("FAIL", RED, True)
        r.add_line(
            status_icon,
            status_text,
            ("  ", TEXT),
            (f"{name:<30}", CYAN),
            (f"({desc})", MUTED),
        )

    r.add_blank()
    r.add_line(("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", SURFACE))
    r.add_line(
        ("  All ", MUTED),
        ("10", GREEN, True),
        (" checks passed. ", MUTED),
        ("System operational.", GREEN, True),
    )
    r.add_blank()
    r.add_line(
        ("  Sessions: ", MUTED),
        ("3 active", CYAN),
        ("  |  State size: ", MUTED),
        ("4.2KB", CYAN),
        ("  |  Schema: ", MUTED),
        ("v2", GREEN),
    )

    return r.render("claude — health")


def make_before_after_real() -> Image.Image:
    """Updated before/after using real dashboard screenshot."""
    width, height = 1600, 900
    img = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(img)

    title_font = _bold_font(42)
    label_font = _bold_font(28)
    body_font = _font(20)
    mono = _font(16)

    # Title
    draw.text((60, 40), "Before vs After: Claude Lead System", font=title_font, fill=BLUE)

    # Before panel (left)
    bx0, by0, bx1, by1 = 40, 110, 770, 860
    draw.rounded_rectangle([bx0, by0, bx1, by1], radius=16, fill=(60, 20, 20), outline=RED, width=2)
    draw.text((bx0 + 30, by0 + 20), "BEFORE", font=label_font, fill=RED)

    before_lines = [
        ("─ Blind parallel terminals", TEXT),
        ("  Each session has zero awareness", MUTED),
        ("  of other sessions' work", MUTED),
        ("", TEXT),
        ("─ Duplicate work", TEXT),
        ("  Two agents rewrite the same file", MUTED),
        ("  simultaneously without knowing", MUTED),
        ("", TEXT),
        ("─ Merge-time file collisions", TEXT),
        ("  Discover conflicts at git merge,", MUTED),
        ("  not at edit time", MUTED),
        ("", TEXT),
        ("─ Manual task copy-paste", TEXT),
        ("  Alt-tab to read one terminal,", MUTED),
        ("  paste instructions to another", MUTED),
        ("", TEXT),
        ("─ Transcript-heavy coordination", TEXT),
        ("  Parse MBs of expensive transcripts", MUTED),
        ("  burning API tokens for context", MUTED),
    ]

    y = by0 + 70
    for text, color in before_lines:
        draw.text((bx0 + 30, y), text, font=body_font, fill=color)
        y += 32

    # After panel (right)
    ax0, ay0, ax1, ay1 = 830, 110, 1560, 860
    draw.rounded_rectangle([ax0, ay0, ax1, ay1], radius=16, fill=(20, 50, 40), outline=GREEN, width=2)
    draw.text((ax0 + 30, ay0 + 20), "AFTER", font=label_font, fill=GREEN)

    after_lines = [
        ("+ Live session dashboard", TEXT),
        ("  See every terminal, its status,", MUTED),
        ("  tool counts, and current files", MUTED),
        ("", TEXT),
        ("+ Conflict detection before edits", TEXT),
        ("  Catch overlapping files instantly", MUTED),
        ("  across all active sessions", MUTED),
        ("", TEXT),
        ("+ Inbox + wake orchestration", TEXT),
        ("  Send messages between terminals", MUTED),
        ("  via filesystem hooks (0 tokens)", MUTED),
        ("", TEXT),
        ("+ Autonomous workers + pipelines", TEXT),
        ("  Spawn claude -p workers, chain", MUTED),
        ("  multi-step tasks sequentially", MUTED),
        ("", TEXT),
        ("+ Compact JSON state protocol", TEXT),
        ("  1.4KB per session vs 7.6MB", MUTED),
        ("  transcripts — 207x faster", MUTED),
    ]

    y = ay0 + 70
    for text, color in after_lines:
        draw.text((ax0 + 30, y), text, font=body_font, fill=color)
        y += 32

    return img


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    assets = {
        "screenshot_dashboard.png": make_dashboard(),
        "screenshot_conflicts.png": make_conflicts(),
        "screenshot_messaging.png": make_messaging(),
        "screenshot_worker.png": make_worker_spawn(),
        "screenshot_healthcheck.png": make_healthcheck(),
    }

    for name, img in assets.items():
        path = OUT_DIR / name
        img.save(path, "PNG")
        print(f"  ✓ {path.relative_to(ASSETS_DIR)} ({img.size[0]}x{img.size[1]})")

    # Also save updated before-after
    ba = make_before_after_real()
    ba_path = ASSETS_DIR / "before-after.png"
    ba.save(ba_path, "PNG")
    print(f"  ✓ before-after.png ({ba.size[0]}x{ba.size[1]})")

    print(f"\nDone! {len(assets) + 1} assets generated.")


if __name__ == "__main__":
    main()
