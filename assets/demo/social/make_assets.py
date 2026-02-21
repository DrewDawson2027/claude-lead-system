from __future__ import annotations

import math
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


REPO_ROOT = Path(__file__).resolve().parents[3]
ASSETS_DIR = REPO_ROOT / "assets" / "demo"
SOCIAL_DIR = ASSETS_DIR / "social"

DEMO_GIF = ASSETS_DIR / "demo.gif"
BEFORE_AFTER = ASSETS_DIR / "before-after.png"

OUT_CAROUSEL = SOCIAL_DIR / "carousel"
OUT_THUMBS = SOCIAL_DIR / "thumbnails"

OUT_VIDEO = ASSETS_DIR / "demo.mp4"


@dataclass(frozen=True)
class Brand:
    bg_top: tuple[int, int, int] = (7, 10, 18)
    bg_bottom: tuple[int, int, int] = (5, 6, 11)
    panel: tuple[int, int, int] = (11, 18, 32)
    border: tuple[int, int, int, int] = (255, 255, 255, 18)
    text: tuple[int, int, int] = (231, 236, 255)
    muted: tuple[int, int, int] = (168, 179, 214)
    accent: tuple[int, int, int] = (124, 58, 237)
    accent2: tuple[int, int, int] = (34, 211, 238)


def _find_font_path() -> str | None:
    candidates = [
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/System/Library/Fonts/SFNSRounded.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Verdana.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = _find_font_path()
    if path:
        return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def _lerp(a: int, b: int, t: float) -> int:
    return int(round(a + (b - a) * t))


def _linear_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", (w, h), top)
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        r = _lerp(top[0], bottom[0], t)
        g = _lerp(top[1], bottom[1], t)
        b = _lerp(top[2], bottom[2], t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def _radial_glow(
    base: Image.Image,
    center: tuple[int, int],
    radius: int,
    color: tuple[int, int, int],
    alpha: int,
) -> Image.Image:
    w, h = base.size
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    cx, cy = center
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=(*color, alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(radius / 3))
    out = base.convert("RGBA")
    out.alpha_composite(glow)
    return out


def _rounded_rect(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], r: int, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def _paste_cover(canvas: Image.Image, img: Image.Image, box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = box
    tw, th = x1 - x0, y1 - y0
    iw, ih = img.size
    scale = max(tw / iw, th / ih)
    nw, nh = int(math.ceil(iw * scale)), int(math.ceil(ih * scale))
    resized = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    cropped = resized.crop((left, top, left + tw, top + th))
    canvas.paste(cropped, (x0, y0))


def _text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font, fill, anchor="la"):
    draw.text(xy, text, font=font, fill=fill, anchor=anchor)


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current: list[str] = []
    for w in words:
        trial = " ".join([*current, w]).strip()
        if not trial:
            continue
        tw = draw.textlength(trial, font=font)
        if tw <= max_width or not current:
            current.append(w)
        else:
            lines.append(" ".join(current))
            current = [w]
    if current:
        lines.append(" ".join(current))
    return lines


def _slide_base(size=(1600, 900), brand: Brand = Brand()) -> Image.Image:
    img = _linear_gradient(size, brand.bg_top, brand.bg_bottom)
    img = _radial_glow(img, (int(size[0] * 0.18), int(size[1] * 0.12)), 420, brand.accent, 70)
    img = _radial_glow(img, (int(size[0] * 0.84), int(size[1] * 0.22)), 360, brand.accent2, 55)
    return img.convert("RGBA")


def _badge(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, brand: Brand) -> int:
    font = _font(22)
    pad_x, pad_y = 14, 10
    w = int(draw.textlength(text, font=font))
    h = 26
    box = (x, y, x + w + pad_x * 2, y + h + pad_y * 2)
    _rounded_rect(draw, box, r=999, fill=(13, 22, 48, 170), outline=brand.border, width=2)
    _text(draw, (x + pad_x, y + pad_y + h // 2), text, font, brand.muted, anchor="lm")
    return box[2]


def _panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], brand: Brand) -> None:
    _rounded_rect(draw, box, r=26, fill=(*brand.panel, 210), outline=brand.border, width=2)


def make_slide_1_hook(out_path: Path, brand: Brand) -> None:
    img = _slide_base(brand=brand)
    d = ImageDraw.Draw(img)

    _badge(d, 64, 54, "CLAUDE LEAD SYSTEM", brand)

    title_font = _font(74)
    subtitle_font = _font(34)
    muted_font = _font(26)

    title = "Your Claude terminals\nare blind to each other."
    _text(d, (64, 150), title, title_font, brand.text, anchor="la")

    sub = "Fix it with one command: /lead"
    _text(d, (64, 350), sub, subtitle_font, brand.muted, anchor="la")

    box = (64, 440, 1536, 806)
    _panel(d, box, brand)

    k_font = _font(30)
    b_font = _font(40)
    _text(d, (96, 490), "0 API tokens", b_font, brand.text, anchor="la")
    _text(d, (96, 548), "Hooks + filesystem state, not transcript parsing.", k_font, brand.muted, anchor="la")

    _text(d, (96, 640), "Dashboard · Messaging · Conflicts · Workers · Pipelines", k_font, brand.text, anchor="la")
    _text(d, (96, 700), "Best for X: native MP4 + links in reply.", muted_font, brand.muted, anchor="la")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PNG")


def make_slide_2_before_after(out_path: Path, brand: Brand) -> None:
    img = _slide_base(brand=brand)
    d = ImageDraw.Draw(img)
    _badge(d, 64, 54, "BEFORE → AFTER", brand)

    title_font = _font(66)
    _text(d, (64, 140), "See every session. Catch conflicts early.", title_font, brand.text, anchor="la")

    panel = (64, 250, 1536, 840)
    _panel(d, panel, brand)

    ba = Image.open(BEFORE_AFTER).convert("RGBA")
    inner = (92, 284, 1508, 810)
    _paste_cover(img, ba, inner)

    label_font = _font(28)
    _rounded_rect(d, (110, 306, 260, 350), r=999, fill=(124, 58, 237, 170), outline=None, width=0)
    _text(d, (185, 328), "BEFORE", label_font, brand.text, anchor="mm")
    _rounded_rect(d, (1338, 306, 1488, 350), r=999, fill=(34, 211, 238, 170), outline=None, width=0)
    _text(d, (1413, 328), "AFTER", label_font, brand.text, anchor="mm")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PNG")


def make_slide_3_how_it_works(out_path: Path, brand: Brand) -> None:
    img = _slide_base(brand=brand)
    d = ImageDraw.Draw(img)
    _badge(d, 64, 54, "HOW IT WORKS", brand)

    title_font = _font(66)
    _text(d, (64, 140), "Coordination outside the context window.", title_font, brand.text, anchor="la")

    panel = (64, 250, 1536, 840)
    _panel(d, panel, brand)

    mono = _font(30)
    lines = [
        "Terminal hooks (0 tokens)",
        "  → ~/.claude/terminals/session-*.json",
        "  → ~/.claude/terminals/inbox/*.jsonl",
        "",
        "/lead reads small state files (not transcripts)",
        "  → messaging, wake, conflict detection",
        "  → spawn claude -p workers",
        "  → run pipelines",
    ]
    x, y = 110, 300
    for line in lines:
        _text(d, (x, y), line, mono, brand.text if line and not line.startswith("  ") else brand.muted, anchor="la")
        y += 44

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PNG")


def make_slide_4_cta(out_path: Path, brand: Brand) -> None:
    img = _slide_base(brand=brand)
    d = ImageDraw.Draw(img)
    _badge(d, 64, 54, "TRY IT", brand)

    title_font = _font(74)
    _text(d, (64, 150), "Ship faster with\none lead terminal.", title_font, brand.text, anchor="la")

    panel = (64, 390, 1536, 840)
    _panel(d, panel, brand)

    mono = _font(30)
    steps = [
        "1) Install (link in reply):",
        "   curl -fsSL https://…/install.sh | bash",
        "",
        "2) Open 2 Claude Code terminals in the same repo",
        "3) Type: /lead",
        "4) Try: tell … / conflicts / run … in …",
        "",
        "Repo: DrewDawson2027/claude-lead-system",
    ]
    x, y = 98, 430
    for line in steps:
        fill = brand.text if line and not line.startswith("   ") else brand.muted
        _text(d, (x, y), line, mono, fill, anchor="la")
        y += 44

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PNG")


def make_lower_third(out_path: Path, size=(1920, 220), brand: Brand = Brand()) -> None:
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    grad = _linear_gradient((w, h), (11, 18, 32), (7, 10, 18)).convert("RGBA")
    grad.putalpha(190)
    img.alpha_composite(grad)

    d = ImageDraw.Draw(img)
    _rounded_rect(d, (26, 18, w - 26, h - 18), r=26, fill=(13, 22, 48, 120), outline=(255, 255, 255, 28), width=2)

    title_font = _font(44)
    sub_font = _font(28)
    _text(d, (64, 76), "Live demo", title_font, brand.text, anchor="la")
    _text(d, (64, 146), "/lead → tell → conflicts → run worker", sub_font, brand.muted, anchor="la")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PNG")


def _run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed ({proc.returncode}): {' '.join(cmd)}\n{proc.stdout}")


def ensure_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found in PATH.")


def generate_video(slides: list[Path], lower_third: Path, out_path: Path) -> None:
    ensure_ffmpeg()
    tmp_dir = SOCIAL_DIR / ".tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    try:
        seg1 = tmp_dir / "seg1.mp4"
        seg2 = tmp_dir / "seg2.mp4"
        seg4 = tmp_dir / "seg4.mp4"
        seg5 = tmp_dir / "seg5.mp4"
        seg_demo = tmp_dir / "seg3_demo.mp4"

        # 1) Hook slide
        _run(
            [
                "ffmpeg",
                "-y",
                "-loop",
                "1",
                "-t",
                "2.5",
                "-i",
                str(slides[0]),
                "-vf",
                "scale=1920:1080,format=yuv420p",
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-crf",
                "18",
                "-preset",
                "medium",
                str(seg1),
            ]
        )

        # 2) Before/after
        _run(
            [
                "ffmpeg",
                "-y",
                "-loop",
                "1",
                "-t",
                "3.5",
                "-i",
                str(slides[1]),
                "-vf",
                "scale=1920:1080,format=yuv420p",
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-crf",
                "18",
                "-preset",
                "medium",
                str(seg2),
            ]
        )

        # 3) Demo GIF + lower third overlay (~10s)
        _run(
            [
                "ffmpeg",
                "-y",
                "-stream_loop",
                "2",
                "-i",
                str(DEMO_GIF),
                "-loop",
                "1",
                "-t",
                "10",
                "-i",
                str(lower_third),
                "-t",
                "10",
                "-filter_complex",
                "[0:v]fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,"
                "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black[v0];"
                "[1:v]scale=1920:-1[lt];"
                "[v0][lt]overlay=0:H-h-34:format=auto,format=yuv420p[v]",
                "-map",
                "[v]",
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-crf",
                "18",
                "-preset",
                "medium",
                str(seg_demo),
            ]
        )

        # 4) How it works
        _run(
            [
                "ffmpeg",
                "-y",
                "-loop",
                "1",
                "-t",
                "4.0",
                "-i",
                str(slides[2]),
                "-vf",
                "scale=1920:1080,format=yuv420p",
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-crf",
                "18",
                "-preset",
                "medium",
                str(seg4),
            ]
        )

        # 5) CTA
        _run(
            [
                "ffmpeg",
                "-y",
                "-loop",
                "1",
                "-t",
                "3.5",
                "-i",
                str(slides[3]),
                "-vf",
                "scale=1920:1080,format=yuv420p",
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-crf",
                "18",
                "-preset",
                "medium",
                str(seg5),
            ]
        )

        concat_list = tmp_dir / "concat.txt"
        concat_list.write_text(
            "\n".join(
                [
                    f"file '{seg1.as_posix()}'",
                    f"file '{seg2.as_posix()}'",
                    f"file '{seg_demo.as_posix()}'",
                    f"file '{seg4.as_posix()}'",
                    f"file '{seg5.as_posix()}'",
                    "",
                ]
            )
        )

        out_path.parent.mkdir(parents=True, exist_ok=True)
        _run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_list),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-r",
                "30",
                "-crf",
                "18",
                "-preset",
                "medium",
                str(out_path),
            ]
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def make_thumbnails(slide_1: Path) -> None:
    OUT_THUMBS.mkdir(parents=True, exist_ok=True)
    img = Image.open(slide_1).convert("RGBA")

    # 16:9 (1600x900) as-is
    img.save(OUT_THUMBS / "thumb_16x9.png", "PNG")

    # 1:1 center crop
    w, h = img.size
    side = min(w, h)
    x0 = (w - side) // 2
    y0 = (h - side) // 2
    square = img.crop((x0, y0, x0 + side, y0 + side)).resize((1080, 1080), Image.LANCZOS)
    square.save(OUT_THUMBS / "thumb_1x1.png", "PNG")

    # 9:16 (1080x1920) padded
    target = Image.new("RGBA", (1080, 1920), (0, 0, 0, 255))
    scale = min(1080 / w, 1920 / h)
    nw, nh = int(w * scale), int(h * scale)
    resized = img.resize((nw, nh), Image.LANCZOS)
    ox, oy = (1080 - nw) // 2, (1920 - nh) // 2
    target.paste(resized, (ox, oy))
    target.save(OUT_THUMBS / "thumb_9x16.png", "PNG")


def main() -> None:
    if not DEMO_GIF.exists():
        raise SystemExit(f"Missing: {DEMO_GIF}")
    if not BEFORE_AFTER.exists():
        raise SystemExit(f"Missing: {BEFORE_AFTER}")

    brand = Brand()

    slide1 = OUT_CAROUSEL / "slide_01_hook.png"
    slide2 = OUT_CAROUSEL / "slide_02_before_after.png"
    slide3 = OUT_CAROUSEL / "slide_03_how_it_works.png"
    slide4 = OUT_CAROUSEL / "slide_04_cta.png"

    make_slide_1_hook(slide1, brand)
    make_slide_2_before_after(slide2, brand)
    make_slide_3_how_it_works(slide3, brand)
    make_slide_4_cta(slide4, brand)

    lower_third = SOCIAL_DIR / "lower_third_1920x220.png"
    make_lower_third(lower_third, brand=brand)

    generate_video([slide1, slide2, slide3, slide4], lower_third, OUT_VIDEO)
    make_thumbnails(slide1)

    print("Wrote:")
    print(f"- {OUT_VIDEO.relative_to(REPO_ROOT)}")
    print(f"- {slide1.relative_to(REPO_ROOT)}")
    print(f"- {slide2.relative_to(REPO_ROOT)}")
    print(f"- {slide3.relative_to(REPO_ROOT)}")
    print(f"- {slide4.relative_to(REPO_ROOT)}")
    print(f"- {lower_third.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
