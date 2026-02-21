"""Generate animated demo GIF from PIL frames.

Creates a smooth animated GIF showing the Claude Lead System demo flow
by rendering terminal text frame-by-frame with typing effects.
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ASSETS_DIR = Path(__file__).resolve().parent
OUT_GIF = ASSETS_DIR / "demo.gif"

# Colors
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
TL_RED = (255, 95, 86)
TL_YELLOW = (255, 189, 46)
TL_GREEN = (39, 201, 63)

WIDTH, HEIGHT = 1200, 700
LINE_H = 22
LEFT_PAD = 20
TOP_PAD = 56  # below title bar


def _find_mono_font() -> str | None:
    for p in [
        "/System/Library/Fonts/SFNSMono.ttf",
        "/Library/Fonts/SF-Mono-Regular.otf",
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Supplemental/Menlo.ttc",
        "/System/Library/Fonts/Monaco.ttf",
    ]:
        if os.path.exists(p):
            return p
    return None


FONT_PATH = _find_mono_font()
FONT = ImageFont.truetype(FONT_PATH, 15) if FONT_PATH else ImageFont.load_default()
FONT_BOLD = FONT  # same for now


def new_frame(title: str = "claude — /lead") -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    # Title bar
    d.rectangle([0, 0, WIDTH, 38], fill=BG_TITLEBAR)
    for i, c in enumerate([TL_RED, TL_YELLOW, TL_GREEN]):
        cx = 18 + i * 22
        d.ellipse([cx - 6, 13, cx + 6, 25], fill=c)
    tw = d.textlength(title, font=FONT)
    d.text(((WIDTH - tw) / 2, 12), title, font=FONT, fill=MUTED)
    d.line([0, 38, WIDTH, 38], fill=(60, 60, 80))
    return img


def draw_text(img: Image.Image, x: int, y: int, text: str, color=TEXT):
    d = ImageDraw.Draw(img)
    d.text((x, y), text, font=FONT, fill=color)


def draw_line(img: Image.Image, line_num: int, segments: list[tuple[str, tuple]]):
    d = ImageDraw.Draw(img)
    x = LEFT_PAD
    y = TOP_PAD + line_num * LINE_H
    for text, color in segments:
        d.text((x, y), text, font=FONT, fill=color)
        x += d.textlength(text, font=FONT)


def make_frames() -> list[tuple[Image.Image, int]]:
    """Returns list of (frame, duration_ms) tuples."""
    frames = []

    # ═══ Scene 1: Boot ═══
    f = new_frame()
    draw_line(f, 0, [("$ ", GREEN), ("/lead", TEXT)])
    frames.append((f.copy(), 1500))

    draw_line(f, 2, [("Scanning ~/.claude/terminals/...", MUTED)])
    frames.append((f.copy(), 800))

    draw_line(f, 3, [("Found ", MUTED), ("3 sessions", CYAN), (" | ", MUTED), ("1 project", CYAN), (" | Checking conflicts...", MUTED)])
    frames.append((f.copy(), 1000))

    # ═══ Scene 2: Dashboard ═══
    f = new_frame()
    draw_line(f, 0, [("# Lead", BLUE), (" — ", MUTED), ("Online", GREEN)])
    draw_line(f, 2, [("## Sessions", MAUVE)])

    # Header
    draw_line(f, 3, [("| Session  | TTY      | Project     | Status | W/E/B/R  | Recent Files          | Last Op      |", MUTED)])
    draw_line(f, 4, [("|----------|----------|-------------|--------|----------|----------------------|--------------|", SURFACE)])
    frames.append((f.copy(), 600))

    # Row 1
    draw_line(f, 5, [
        ("| ", MUTED), ("a1b2c3d4", CYAN), (" | ttys003  | my-saas-app | ", TEXT),
        ("active", GREEN), (" | ", MUTED), ("15/8/23/5", YELLOW),
        (" | auth.ts, db.ts       | ", TEXT), ("Edit auth.ts", YELLOW), (" |", MUTED),
    ])
    frames.append((f.copy(), 400))

    # Row 2
    draw_line(f, 6, [
        ("| ", MUTED), ("e5f6g7h8", CYAN), (" | ttys058  | my-saas-app | ", TEXT),
        ("active", GREEN), (" | ", MUTED), ("4/12/6/22", YELLOW),
        (" | Login.tsx, auth.ts   | ", TEXT), ("Edit auth.ts", YELLOW), (" |", MUTED),
    ])
    frames.append((f.copy(), 400))

    # Row 3
    draw_line(f, 7, [
        ("| ", MUTED), ("c3d4e5f6", CYAN), (" | ttys091  | my-saas-app | ", TEXT),
        ("idle  ", YELLOW), (" | ", MUTED), ("8/3/14/11", YELLOW),
        (" | integration.test.ts  | ", TEXT), ("Bash pytest ", BLUE), (" |", MUTED),
    ])
    frames.append((f.copy(), 800))

    # Conflict warning
    draw_line(f, 9, [("## Conflicts", MAUVE)])
    draw_line(f, 10, [("  ", TEXT), ("⚠ ", YELLOW), ("CONFLICT: ", RED), ("src/auth.ts", PEACH), (" touched by ", MUTED), ("a1b2c3d4", CYAN), (" AND ", MUTED), ("e5f6g7h8", CYAN)])
    frames.append((f.copy(), 2500))

    # ═══ Scene 3: Conflicts deep dive ═══
    f = new_frame("claude — conflicts")
    draw_line(f, 0, [("$ ", GREEN), ("conflicts", TEXT)])
    draw_line(f, 2, [("## ", MUTED), ("CONFLICTS DETECTED", RED)])
    frames.append((f.copy(), 800))

    draw_line(f, 4, [("### File Overlaps", MAUVE)])
    draw_line(f, 5, [("  - ", MUTED), ("src/auth.ts", PEACH)])
    draw_line(f, 6, [("    ├─ Session ", MUTED), ("a1b2c3d4", CYAN), (": 8 Edits — ", MUTED), ('"building auth layer"', TEXT)])
    draw_line(f, 7, [("    └─ Session ", MUTED), ("e5f6g7h8", CYAN), (": 12 Edits — ", MUTED), ('"updating login UI"', TEXT)])
    frames.append((f.copy(), 2000))

    draw_line(f, 9, [("  ", TEXT), ("⚠ ", YELLOW), ("Recommendation: ", TEXT), ("Coordinate before editing ", MUTED), ("src/auth.ts", PEACH)])
    frames.append((f.copy(), 2000))

    # ═══ Scene 4: Send message ═══
    f = new_frame("claude — messaging")
    draw_line(f, 0, [("$ ", GREEN), ("tell e5f6g7h8 to stop editing auth.ts, a1b2c3d4 owns it", TEXT)])
    frames.append((f.copy(), 1200))

    draw_line(f, 2, [("  ", TEXT), ("✓ ", GREEN), ("Message sent to ", MUTED), ("e5f6g7h8", CYAN)])
    draw_line(f, 3, [("    Priority: ", MUTED), ("urgent", RED), ("  |  Cost: ", MUTED), ("0 API tokens", GREEN)])
    frames.append((f.copy(), 2000))

    # ═══ Scene 5: Spawn worker ═══
    f = new_frame("claude — worker")
    draw_line(f, 0, [("$ ", GREEN), ('run "Write tests for auth.ts" in ~/Projects/my-saas-app', TEXT)])
    frames.append((f.copy(), 1000))

    draw_line(f, 2, [("  ", TEXT), ("⚡ ", PEACH), ("Pre-flight conflict check... ", MUTED), ("clear", GREEN)])
    draw_line(f, 4, [("  Worker spawned: ", MUTED), ("W-1708349521", CYAN)])
    draw_line(f, 5, [('    Task:   "Write tests for auth.ts"', TEXT)])
    draw_line(f, 6, [("    Layout: ", MUTED), ("split pane", GREEN), (" via iTerm2", MUTED)])
    frames.append((f.copy(), 2000))

    # Worker complete
    draw_line(f, 8, [("  ─── 45 seconds later ───", SURFACE)])
    draw_line(f, 10, [("  Status: ", MUTED), ("completed ✓", GREEN)])
    draw_line(f, 11, [("  ", TEXT), ("✓ 25 tests passed  |  Coverage: 94.2%", GREEN)])
    frames.append((f.copy(), 2500))

    # ═══ Scene 6: Punchline ═══
    f = new_frame("claude — lead")
    draw_line(f, 1, [("──────────────────────────────────────────────────────", SURFACE)])
    draw_line(f, 3, [("Total coordination cost: ", TEXT), ("0 API tokens", GREEN)])
    draw_line(f, 5, [("All orchestration via shell hooks + filesystem state.", MUTED)])
    draw_line(f, 6, [("State: 1.4KB avg  |  Latency: 0.019ms  |  207x faster", MUTED)])
    draw_line(f, 8, [("github.com/DrewDawson2027/claude-lead-system", CYAN)])
    frames.append((f.copy(), 3000))

    return frames


def main():
    frames = make_frames()
    images = [f for f, _ in frames]
    durations = [d for _, d in frames]

    images[0].save(
        OUT_GIF,
        save_all=True,
        append_images=images[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )

    total_s = sum(durations) / 1000
    print(f"✓ demo.gif: {len(frames)} frames, {total_s:.1f}s total, {OUT_GIF.stat().st_size / 1024:.0f}KB")


if __name__ == "__main__":
    main()
