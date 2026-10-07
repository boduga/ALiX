#!/usr/bin/env python3
"""Render Phase-10 cell/ANSI golden frames to fixed-font PNG evidence.

Reads a golden `.txt` written by `tests/tui/workbench/golden-helper.ts` (the
Workbench painter's frame string: display rows separated by ``\\n``, ANSI SGR
runs inline, final row terminated by ``\\n``) and writes a PNG to
``tests/tui/workbench/__goldens__/png/<name>.png``. After rendering it
(re)writes ``tests/tui/workbench/__goldens__/capture-settings.md`` with the
font/cell/Pillow provenance for every capture it produced.

HONORED SGR SUBSET (minimal, deterministic; every other CSI/SGR parameter is
ignored and the previous attribute is kept):
  0          reset (fg/bg/bold back to documented defaults)
  1 / 22     bold on / bold off (bold selects the bold face of the fixed font)
  39 / 49    default fg / default bg
  30-37, 90-97    basic + bright foreground (xterm palette)
  40-47, 100-107  basic + bright background (xterm palette)
  38;2;r;g;b / 48;2;r;g;b  24-bit foreground / background
  38;5;N / 48;5;N          256-color: NOT rendered (attribute kept unchanged)
Not emulated: underline, reverse video, italic, dim, strikethrough.
Unstyled cells use DEFAULT_FG / DEFAULT_BG (the documented terminal defaults
for the near-black blue preview surface).

Fixed font: DejaVuSansMono at a fixed point size (see FONT_SIZE). If the font
file is absent the script prints a clear error and falls back to Pillow's
``load_default`` face with a loud warning — output is then font-dependent and
the capture-settings.md record says so.

Usage:
    python3 tests/manual/render-golden-png.py               # the 3 Phase-10 captures
    python3 tests/manual/render-golden-png.py matrix-180x40 # additional golden(s)
Accepts bare scenario names, ``<name>.txt`` or explicit paths.

These PNGs are evidence artifacts (plan:213/:360), not CI-gated: only
existence/non-empty is asserted in parity-goldens.vitest.ts. Rendering is
manual and idempotent — same golden + same font => byte-identical PNG.
"""

from __future__ import annotations

import hashlib
import re
import sys
import unicodedata
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
    import PIL
except ImportError:  # pragma: no cover - environment guard
    print(
        "FATAL: Pillow is required (expected 10.2.0). Install with: python3 -m pip install Pillow==10.2.0",
        file=sys.stderr,
    )
    raise SystemExit(1)

PILLOW_VERSION = PIL.__version__

FONT_PATH = Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")
BOLD_FONT_PATH = Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf")
FONT_SIZE = 16

# Documented terminal defaults for unstyled cells (preview surface colors).
DEFAULT_FG = (230, 237, 243)   # #e6edf3 bright primary text
DEFAULT_BG = (8, 21, 27)       # #08151b near-black blue background

BASIC16 = [
    (0, 0, 0), (205, 0, 0), (0, 205, 0), (205, 205, 0),
    (0, 0, 238), (205, 0, 205), (0, 205, 205), (229, 229, 229),
    (127, 127, 127), (255, 0, 0), (0, 255, 0), (255, 255, 0),
    (92, 92, 255), (255, 0, 255), (0, 255, 255), (255, 255, 255),
]

REPO_ROOT = Path(__file__).resolve().parents[2]
GOLDEN_DIR = REPO_ROOT / "tests" / "tui" / "workbench" / "__goldens__"
PNG_DIR = GOLDEN_DIR / "png"
SETTINGS_MD = GOLDEN_DIR / "capture-settings.md"

# Phase-10 fixed-font captures (plan:360 + plan:213): canonical reference
# size plus the 160x36 three-pane reference and its ASCII substitute.
DEFAULT_CAPTURES = ("canonical-200x44", "three-pane-160x36", "ascii-preview-160x36")

SIZE_RE = re.compile(r"-(\d+)x(\d+)$")
SGI_RE = re.compile(r"\x1b\[([0-9;:]*)m")


def load_fonts() -> tuple[object, object, bool]:
    """Return (regular, bold, used_fixed_font)."""
    if not FONT_PATH.is_file():
        print(
            f"ERROR: fixed font not found at {FONT_PATH}.\n"
            "       Install the DejaVu monospace face (e.g. `apt install fonts-dejavu-core`)\n"
            "       for deterministic captures. Falling back to Pillow's load_default face\n"
            "       with a LOUD warning: this output is font- and Pillow-version-dependent.",
            file=sys.stderr,
        )
        fallback = ImageFont.load_default()
        return fallback, fallback, False
    regular = ImageFont.truetype(str(FONT_PATH), FONT_SIZE)
    if BOLD_FONT_PATH.is_file():
        bold = ImageFont.truetype(str(BOLD_FONT_PATH), FONT_SIZE)
    else:
        print(f"WARNING: bold face {BOLD_FONT_PATH} missing; bold runs use the regular face.", file=sys.stderr)
        bold = regular
    return regular, bold, True


def char_width(ch: str) -> int:
    if unicodedata.combining(ch) or ch in ("​", "‍", "﻿"):
        return 0
    if unicodedata.east_asian_width(ch) in ("W", "F"):
        return 2
    return 1


def apply_sgr(params: str, attrs: dict) -> None:
    parts = [int(p) if p.isdigit() else 0 for p in params.split(";")] if params else [0]
    i = 0
    while i < len(parts):
        p = parts[i]
        if p == 0:
            attrs["fg"], attrs["bg"], attrs["bold"] = DEFAULT_FG, DEFAULT_BG, False
        elif p == 1:
            attrs["bold"] = True
        elif p == 22:
            attrs["bold"] = False
        elif p == 39:
            attrs["fg"] = DEFAULT_FG
        elif p == 49:
            attrs["bg"] = DEFAULT_BG
        elif 30 <= p <= 37:
            attrs["fg"] = BASIC16[p - 30]
        elif 90 <= p <= 97:
            attrs["fg"] = BASIC16[p - 90 + 8]
        elif 40 <= p <= 47:
            attrs["bg"] = BASIC16[p - 40]
        elif 100 <= p <= 107:
            attrs["bg"] = BASIC16[p - 100 + 8]
        elif p in (38, 48) and i + 2 < len(parts) and parts[i + 1] == 2:
            color = (parts[i + 2], parts[i + 3], parts[i + 4]) if i + 4 < len(parts) else None
            if color is not None:
                attrs["fg" if p == 38 else "bg"] = color
            i += 4
        elif p in (38, 48) and i + 1 < len(parts) and parts[i + 1] == 5:
            i += 2  # 256-color unsupported: keep previous attribute
        # all other SGR parameters (underline, italic, ...) intentionally ignored
        i += 1


def row_cells(line: str) -> tuple[list, int]:
    """Return (cells, display_width). Cell = (col, text, fg, bg, bold, width)."""
    attrs = {"fg": DEFAULT_FG, "bg": DEFAULT_BG, "bold": False}
    cells: list = []
    col = 0
    i = 0
    while i < len(line):
        if line[i] == "\x1b" and i + 1 < len(line) and line[i + 1] == "[":
            m = SGI_RE.match(line, i)
            if m:
                apply_sgr(m.group(1), attrs)
                i = m.end()
                continue
            end = line.find("m", i)
            i = (end + 1) if end != -1 else len(line)  # non-SGR CSI: skip
            continue
        ch = line[i]
        w = char_width(ch)
        if w == 0 and cells:
            prev = cells[-1]
            cells[-1] = (prev[0], prev[1] + ch, prev[2], prev[3], prev[4], prev[5])
            i += 1
            continue
        cells.append((col, ch, attrs["fg"], attrs["bg"], attrs["bold"], w or 1))
        col += w or 1
        i += 1
    return cells, col


def resolve_golden(argument: str) -> Path:
    candidate = Path(argument)
    if candidate.is_file():
        return candidate
    name = argument.removesuffix(".txt")
    path = GOLDEN_DIR / f"{name}.txt"
    if not path.is_file():
        raise SystemExit(f"ERROR: golden not found: {path}")
    return path


def capture_name(path: Path) -> str:
    return path.stem


def expected_size(name: str, rows: list) -> tuple[int, int]:
    m = SIZE_RE.search(name)
    observed_cols = max((width for _, width in rows), default=0)
    if m:
        cols, height = int(m.group(1)), int(m.group(2))
        if observed_cols != cols or len(rows) != height:
            print(
                f"WARNING: {name} filename says {cols}x{height} but frame is "
                f"{observed_cols}x{len(rows)}; using observed bounds.",
                file=sys.stderr,
            )
            cols = max(cols, observed_cols)
            height = max(height, len(rows))
        return cols, height
    return observed_cols, len(rows)


def render(golden: Path, font, bold_font, fixed: bool) -> dict:
    name = capture_name(golden)
    text = golden.read_text(encoding="utf-8")
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()  # trailing row terminator
    parsed = [row_cells(line) for line in lines]
    cols, height = expected_size(name, parsed)

    if hasattr(font, "getlength"):
        advance = float(font.getlength("M"))
    elif hasattr(font, "getsize"):  # bitmap fallback font
        advance = float(font.getsize("M")[0])
    else:  # pragma: no cover - defensive
        advance = 8.0
    ascent, descent = font.getmetrics() if hasattr(font, "getmetrics") else (FONT_SIZE, 0)
    cell_w = max(1, int(round(advance)))
    cell_h = max(1, int(ascent) + int(descent))

    image = Image.new("RGB", (cols * cell_w, height * cell_h), DEFAULT_BG)
    draw = ImageDraw.Draw(image)
    for r, (cells, _) in enumerate(parsed):
        y = r * cell_h
        for col, text_cell, fg, bg, bold, width in cells:
            x = col * cell_w
            if bg != DEFAULT_BG:
                draw.rectangle([x, y, x + width * cell_w - 1, y + cell_h - 1], fill=bg)
            if text_cell:
                draw.text((x, y), text_cell, font=bold_font if bold else font, fill=fg)

    PNG_DIR.mkdir(parents=True, exist_ok=True)
    out = PNG_DIR / f"{name}.png"
    image.save(out, format="PNG")
    return {
        "name": name,
        "golden": golden,
        "png": out,
        "cols": cols,
        "height": height,
        "pixels": f"{image.width}x{image.height}",
        "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
        "fixed": fixed,
        "cell": f"{cell_w}x{cell_h}",
        "advance": advance,
    }


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_settings(records: list, font, fixed: bool) -> None:
    font_desc = str(FONT_PATH) if fixed else "Pillow ImageFont.load_default() (FALLBACK — not deterministic)"
    font_sha = file_sha256(FONT_PATH) if fixed else "n/a"
    bold_desc = str(BOLD_FONT_PATH) if fixed and BOLD_FONT_PATH.is_file() else "n/a"
    bold_sha = file_sha256(BOLD_FONT_PATH) if fixed and BOLD_FONT_PATH.is_file() else "n/a"
    lines = [
        "# Fixed-font PNG capture settings (Phase-10 evidence)",
        "",
        "Plan: `docs/superpowers/plans/2026-10-03-tui-workbench-preview-parity.md`",
        "(item at line 213 — record font and capture settings; line 360 — fixed-font",
        "screenshots for the responsive matrix).",
        "",
        "These PNGs are **evidence artifacts, not CI-gated**: `parity-goldens.vitest.ts`",
        "asserts only that this file and the three PNGs exist and are non-empty.",
        "No pixel comparison runs anywhere; regeneration is manual.",
        "",
        "- Pillow version: " + PILLOW_VERSION,
        "- Font (fixed): " + font_desc,
        "- Font sha256: `" + font_sha + "`",
        "- Bold face: " + bold_desc,
        "- Bold face sha256: `" + bold_sha + "`",
        f"- Point size: {FONT_SIZE}",
    ]
    if isinstance(font, ImageFont.FreeTypeFont):
        ascent, descent = font.getmetrics()
        cell_w = int(round(font.getlength("M")))
        cell_h = int(ascent) + int(descent)
        lines += [
            f"- Cell dimensions: {cell_w}x{cell_h} px "
            f"(advance of `M` = {font.getlength('M'):.5f} px rounded; ascent {ascent} + descent {descent})",
        ]
    lines += [
        f"- Unstyled cells: fg {DEFAULT_FG}, bg {DEFAULT_BG} (#e6edf3 on #08151b)",
        "- Honored SGR: reset(0), bold(1)/off(22), default fg(39)/bg(49), basic+bright",
        "  fg/bg 30-37/40-47/90-97/100-107, 24-bit `38;2`/`48;2`. 256-color and",
        "  underline/reverse/italic/dim are NOT rendered (attribute kept or ignored).",
        "- Wide (East Asian W/F) glyphs occupy two cells; combining marks attach to the",
        "  preceding cell. DejaVu Sans Mono lacks CJK/emoji glyphs — such characters",
        "  fall back to the font's .notdef box (no current capture contains them).",
        "",
        "## Captures",
        "",
        "| Capture | Golden source | Cells | Cell px | Pixels | PNG sha256 |",
        "|---|---|---|---|---|---|",
    ]
    for rec in records:
        rel = rec["golden"].relative_to(REPO_ROOT)
        lines.append(
            f"| {rec['name']} | `{rel}` | {rec['cols']}x{rec['height']} | "
            f"{rec['cell']} | {rec['pixels']} | `{rec['sha256']}` |"
        )
    lines += [
        "",
        "## Regenerate",
        "",
        "```bash",
        "python3 tests/manual/render-golden-png.py            # the three captures above",
        "python3 tests/manual/render-golden-png.py <name>     # any __goldens__/<name>.txt",
        "```",
        "",
        "Rendering is deterministic: the same golden + the same font file produce a",
        "byte-identical PNG. This file is rewritten by the same command so its hashes",
        "never drift from the PNGs on disk.",
        "",
    ]
    SETTINGS_MD.write_text("\n".join(lines), encoding="utf-8")


def main(argv: list[str]) -> int:
    args = argv[1:]
    names = args if args else list(DEFAULT_CAPTURES)
    font, bold_font, fixed = load_fonts()
    if not fixed:
        print(
            f"WARNING: rendering {len(names)} capture(s) with Pillow's default font "
            f"(Pillow {PILLOW_VERSION}); PNGs are NOT comparable to fixed-font baselines.",
            file=sys.stderr,
        )
    records = []
    for argument in names:
        golden = resolve_golden(argument)
        records.append(render(golden, font, bold_font, fixed))
        rec = records[-1]
        print(
            f"[render-golden-png] {rec['name']}: {rec['cols']}x{rec['height']} cells "
            f"-> {rec['pixels']} px, sha256 {rec['sha256'][:16]}…"
        )
    write_settings(records, font, fixed)
    print(f"[render-golden-png] wrote {SETTINGS_MD.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
