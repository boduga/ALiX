# Fixed-font PNG capture settings (Phase-10 evidence)

Plan: `docs/superpowers/plans/2026-10-03-tui-workbench-preview-parity.md`
(item at line 213 — record font and capture settings; line 360 — fixed-font
screenshots for the responsive matrix).

These PNGs are **evidence artifacts, not CI-gated**: `parity-goldens.vitest.ts`
asserts only that this file and the three PNGs exist and are non-empty.
No pixel comparison runs anywhere; regeneration is manual.

- Pillow version: 10.2.0
- Font (fixed): /usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
- Font sha256: `c805f9436dbc268644c1d9584f01a601a653e028e08fd74b9b949f6cf8304d88`
- Bold face: /usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf
- Bold face sha256: `3a3c502eeff669a231549e80df9f7c49de109bafe303170409e905d0b31a38fe`
- Point size: 16
- Cell dimensions: 10x19 px (advance of `M` = 9.64062 px rounded; ascent 15 + descent 4)
- Unstyled cells: fg (230, 237, 243), bg (8, 21, 27) (#e6edf3 on #08151b)
- Honored SGR: reset(0), bold(1)/off(22), default fg(39)/bg(49), basic+bright
  fg/bg 30-37/40-47/90-97/100-107, 24-bit `38;2`/`48;2`. 256-color and
  underline/reverse/italic/dim are NOT rendered (attribute kept or ignored).
- Wide (East Asian W/F) glyphs occupy two cells; combining marks attach to the
  preceding cell. DejaVu Sans Mono lacks CJK/emoji glyphs — such characters
  fall back to the font's .notdef box (no current capture contains them).

## Captures

| Capture | Golden source | Cells | Cell px | Pixels | PNG sha256 |
|---|---|---|---|---|---|
| canonical-200x44 | `tests/tui/workbench/__goldens__/canonical-200x44.txt` | 200x44 | 10x19 | 2000x836 | `f83f53b42e423d78df286ae891e193f32f202bf176afc70882da1cf1c9d1722a` |
| three-pane-160x36 | `tests/tui/workbench/__goldens__/three-pane-160x36.txt` | 160x36 | 10x19 | 1600x684 | `96236ff17ba921f14663c5bf9f1c25bd18f506a024c0af46fa127597224921d2` |
| ascii-preview-160x36 | `tests/tui/workbench/__goldens__/ascii-preview-160x36.txt` | 160x36 | 10x19 | 1600x684 | `480f96459807819f9dff80f076e0518e831a4cbcfbdbe0e5076205661b67d68d` |

## Regenerate

```bash
python3 tests/manual/render-golden-png.py            # the three captures above
python3 tests/manual/render-golden-png.py <name>     # any __goldens__/<name>.txt
```

Rendering is deterministic: the same golden + the same font file produce a
byte-identical PNG. This file is rewritten by the same command so its hashes
never drift from the PNGs on disk.
