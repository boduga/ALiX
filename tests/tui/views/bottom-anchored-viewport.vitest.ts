import { describe, it, expect } from 'vitest';
import { renderBottomAnchoredSlice, type ScrollbackLine } from '../../../src/tui/views/bottom-anchored-viewport.js';
import { MockCanvas } from './helpers/mock-canvas.js';
import type { TerminalCanvas } from '../../../src/tui/canvas.js';

function line(text: string, kind = 'plain'): ScrollbackLine {
  return { kind, text, isFirst: false };
}

// MockCanvas is an intentionally minimal test double — cast at the boundary
// since it doesn't carry TerminalCanvas's full structural surface (private
// buffer, width/height aliases, drawBox/renderFrame, etc.).
function canvas(columns: number, rows: number): TerminalCanvas {
  return new MockCanvas(columns, rows) as unknown as TerminalCanvas;
}

describe('renderBottomAnchoredSlice', () => {
  it('returns empty bounds when allLines is empty', () => {
    const c = canvas(80, 24);
    const result = renderBottomAnchoredSlice({ canvas: c, allLines: [], top: 5, bottomRow: 20, offset: 0, columns: 80, kindStyles: { plain: () => {} } });
    expect(result.firstRow).toBe(0);
    expect(result.lastRow).toBe(-1);
  });

  it('returns empty bounds when scrollbackRows <= 0', () => {
    const c = canvas(80, 24);
    const result = renderBottomAnchoredSlice({ canvas: c, allLines: [line('a')], top: 20, bottomRow: 19, offset: 0, columns: 80, kindStyles: { plain: () => {} } });
    expect(result.firstRow).toBe(0);
    expect(result.lastRow).toBe(-1);
  });

  it('renders lines at top..top+visibleCount-1 with offset=0 when content fits', () => {
    const c = canvas(80, 24);
    const captured: Array<{ text: string; rowY: number }> = [];
    const lines = [line('a'), line('b'), line('c')];
    const result = renderBottomAnchoredSlice({
      canvas: c, allLines: lines, top: 5, bottomRow: 20, offset: 0, columns: 80,
      kindStyles: { plain: (l, rowY) => { captured.push({ text: l.text, rowY }); } },
    });
    expect(captured.map(c => c.text)).toEqual(['a', 'b', 'c']);
    expect(captured.map(c => c.rowY)).toEqual([5, 6, 7]);
    expect(result.firstRow).toBe(5);
    expect(result.lastRow).toBe(7);
  });

  it('clamps windowEnd to allLines.length when offset+scrollbackRows overflows', () => {
    const c = canvas(80, 24);
    const captured: Array<{ text: string; rowY: number }> = [];
    const lines = [line('a'), line('b'), line('c')];
    // top=5, bottomRow=20 → scrollbackRows=16. offset=10 → window=[10,26] clamped [10,3]=[10,3] → empty.
    const result = renderBottomAnchoredSlice({
      canvas: c, allLines: lines, top: 5, bottomRow: 20, offset: 10, columns: 80,
      kindStyles: { plain: (l, rowY) => { captured.push({ text: l.text, rowY }); } },
    });
    expect(captured).toEqual([]);
    expect(result.firstRow).toBe(5);
    expect(result.lastRow).toBe(4);
  });

  it('renders window [offset, offset+scrollbackRows] clamped when offset is mid-scrollback', () => {
    const c = canvas(80, 24);
    const captured: Array<{ text: string; rowY: number }> = [];
    const lines = Array.from({ length: 100 }, (_, i) => line(`L${i}`));
    // top=5, bottomRow=20 → scrollbackRows=16. offset=50 → window=[50,66].
    const result = renderBottomAnchoredSlice({
      canvas: c, allLines: lines, top: 5, bottomRow: 20, offset: 50, columns: 80,
      kindStyles: { plain: (l, rowY) => { captured.push({ text: l.text, rowY }); } },
    });
    expect(captured.length).toBe(16);
    expect(captured.map(c => c.text)).toEqual(
      Array.from({ length: 16 }, (_, i) => `L${50 + i}`),
    );
    expect(captured[0]!.rowY).toBe(5);
    expect(captured[15]!.rowY).toBe(20);
    expect(captured[0]!.text).toBe('L50');
    expect(captured[15]!.text).toBe('L65');
    expect(result.firstRow).toBe(5);
    expect(result.lastRow).toBe(20);
  });

  it('fills full scrollback area when content is longer than scrollbackRows with offset=0', () => {
    const c = canvas(80, 24);
    const captured: Array<{ text: string; rowY: number }> = [];
    const lines = Array.from({ length: 100 }, (_, i) => line(`L${i}`));
    const result = renderBottomAnchoredSlice({
      canvas: c, allLines: lines, top: 5, bottomRow: 20, offset: 0, columns: 80,
      kindStyles: { plain: (l, rowY) => { captured.push({ text: l.text, rowY }); } },
    });
    expect(captured.length).toBe(16);
    expect(captured.map(c => c.text)).toEqual(
      Array.from({ length: 16 }, (_, i) => `L${i}`),
    );
    expect(captured[0]!.rowY).toBe(5);
    expect(captured[15]!.rowY).toBe(20);
    expect(result.firstRow).toBe(5);
    expect(result.lastRow).toBe(20);
  });

  it('invokes kindStyles[line.kind] exactly once per visible line', () => {
    const c = canvas(80, 24);
    const captured: ScrollbackLine[] = [];
    const lines = [line('a'), line('b'), line('c'), line('d'), line('e')];
    renderBottomAnchoredSlice({
      canvas: c, allLines: lines, top: 5, bottomRow: 20, offset: 0, columns: 80,
      kindStyles: { plain: (l) => { captured.push(l); } },
    });
    expect(captured.length).toBe(5);
    expect(captured.map(l => l.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
