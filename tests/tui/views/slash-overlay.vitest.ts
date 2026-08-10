import { describe, it, expect } from 'vitest';
import { MockCanvas } from './helpers/mock-canvas.js';
import { renderSlashOverlay } from '../../../src/tui/views/slash-overlay.js';
import type { SlashStrip } from '../../../src/tui/views/types.js';
import type { TerminalCanvas } from '../../../src/tui/canvas.js';

const strip = (entries: Array<{ label: string; description: string }>, selected = 0, hint: string | null = null): SlashStrip => ({
  entries: entries.map((e) => ({ name: e.label, label: e.label, description: e.description })),
  selected,
  hint,
});

// MockCanvas is an intentionally minimal test double — cast to TerminalCanvas
// at each call site since it doesn't carry TerminalCanvas's full structural
// surface (private buffer, width/height aliases, drawBox/renderFrame, etc.)
// and we need the MockCanvas reference for `writes` access.

/**
 * Decode a MockCanvas write's text into a structured entry mirroring what
 * renderSlashOverlay emits: leading ` `, then `>` or ` ` (marker), then ` `,
 * then a `\x1b[36m...\x1b[0m` label, then ` `, then a description.
 */
function decodeWrite(text: string): { marker: '>' | ' '; label: string; description: string } {
  const m = text.match(/^ (>| ) \x1b\[36m([^\x1b]+)\x1b\[0m (.*)$/);
  if (!m) throw new Error(`unrecognized slash write: ${JSON.stringify(text)}`);
  return { marker: m[1] as '>' | ' ', label: m[2]!, description: m[3]! };
}

describe('renderSlashOverlay', () => {
  it('returns rowsRendered=0 when slash is undefined (no-op)', () => {
    const m = new MockCanvas(80, 24);
    const result = renderSlashOverlay({ canvas: m as unknown as TerminalCanvas, slash: undefined as unknown as SlashStrip, panelRow: 19, columns: 80 });
    expect(result.rowsRendered).toBe(0);
    expect(result.lastRow).toBe(19);
    expect(result.selectionVisible).toBe(true);
    expect(m.writes).toEqual([]);
  });

  it('renders a single hint row when hint is set and entries are empty', () => {
    const m = new MockCanvas(80, 24);
    const result = renderSlashOverlay({ canvas: m as unknown as TerminalCanvas, slash: strip([], 0, 'Unknown skill "/x"'), panelRow: 19, columns: 80 });
    expect(result.rowsRendered).toBe(1);
    expect(result.lastRow).toBe(20);
    expect(result.selectionVisible).toBe(false);
    expect(m.writes).toEqual([{ x: 0, y: 20, text: ' \x1b[33mUnknown skill "/x"\x1b[0m' }]);
  });

  it('renders all entries when count <= maxRows and marks the selected one', () => {
    const m = new MockCanvas(80, 24);
    const s = strip(
      [{ label: '/foo', description: 'foo skill' }, { label: '/bar', description: 'bar skill' }],
      1,
    );
    const result = renderSlashOverlay({ canvas: m as unknown as TerminalCanvas, slash: s, panelRow: 19, columns: 80 });
    expect(result.rowsRendered).toBe(2);
    expect(result.lastRow).toBe(21);
    expect(result.selectionVisible).toBe(true);

    // Capture both rowY AND the rendered entry (label + marker + description)
    // per Task-1 review's fix pattern: row numbers alone don't prove which
    // entry was selected. Strip rows grow downward from panelRow+1.
    const rendered = m.writes
      .filter((w) => w.y >= 20 && w.y <= 21)
      .sort((a, b) => a.y - b.y)
      .map((w) => ({ rowY: w.y, ...decodeWrite(w.text) }));

    expect(rendered).toEqual([
      { rowY: 20, marker: ' ', label: '/foo', description: 'foo skill' },
      { rowY: 21, marker: '>', label: '/bar', description: 'bar skill' },
    ]);
    // Exactly one row carries the selected marker, and it carries the right label.
    expect(rendered.filter((r) => r.marker === '>')).toEqual([
      { rowY: 21, marker: '>', label: '/bar', description: 'bar skill' },
    ]);
  });

  it('windows entries around the selected index when count > maxRows', () => {
    const m = new MockCanvas(80, 24);
    const s = strip(
      Array.from({ length: 12 }, (_, i) => ({ label: `/skill${i}`, description: `d${i}` })),
      8,    // selected=8 of 12, maxRows=6
    );
    // panelRow=17 → rows 18..23 are available (6 rows); maxRows=6 fits exactly.
    const result = renderSlashOverlay({ canvas: m as unknown as TerminalCanvas, slash: s, panelRow: 17, columns: 80, maxRows: 6 });
    expect(result.rowsRendered).toBe(6);
    expect(result.selectionVisible).toBe(true);

    const rendered = m.writes
      .filter((w) => w.y >= 18 && w.y <= 23)
      .sort((a, b) => a.y - b.y)
      .map((w) => ({ rowY: w.y, ...decodeWrite(w.text) }));

    // The selected marker (>) must appear in exactly one of the rendered rows,
    // and it must be on the row carrying /skill8 (selected=8).
    const rowsWithSelected = rendered.filter((r) => r.marker === '>');
    expect(rowsWithSelected.length).toBe(1);
    expect(rowsWithSelected[0]!.label).toBe('/skill8');
  });

  it('clamps rows when panelRow + 1 + maxRows would exceed canvas.height', () => {
    const m = new MockCanvas(80, 24);
    const s = strip(
      Array.from({ length: 6 }, (_, i) => ({ label: `/skill${i}`, description: `d${i}` })),
      0,
    );
    // panelRow=22 means rows 23..28 would be needed; canvas.height=24 → only 1 row fits.
    const result = renderSlashOverlay({ canvas: m as unknown as TerminalCanvas, slash: s, panelRow: 22, columns: 80, maxRows: 6 });
    expect(result.rowsRendered).toBe(1);
    expect(result.selectionVisible).toBe(true);
    // Selection sits on the only rendered row (selected=0 → window starts at 0).
    const rendered = m.writes.map((w) => ({ rowY: w.y, ...decodeWrite(w.text) }));
    expect(rendered).toEqual([
      { rowY: 23, marker: '>', label: '/skill0', description: 'd0' },
    ]);
  });

  it('returns rowsRendered=0 when no rows can fit', () => {
    const m = new MockCanvas(80, 24);
    const s = strip([{ label: '/foo', description: 'foo' }], 0);
    const result = renderSlashOverlay({ canvas: m as unknown as TerminalCanvas, slash: s, panelRow: 23, columns: 80, maxRows: 6 });
    expect(result.rowsRendered).toBe(0);
    expect(result.selectionVisible).toBe(false);
    expect(m.writes).toEqual([]);
  });
});
