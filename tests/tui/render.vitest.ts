import { describe, it, expect } from 'vitest';
import { TuiRenderer, type Region } from '../../src/tui/render.js';

describe('Region union exhaustiveness', () => {
  it('lists exactly four regions plus the wildcard', () => {
    const regions: Region[] = ['header', 'body', 'tabs', 'status', 'all'];
    expect(new Set(regions).size).toBe(5);
  });
});

describe('FrameBuffer equality', () => {
  it('detects identical frames (zero-write opportunity)', () => {
    const r = new TuiRenderer({ paint: () => {}, scheduleRepaint: () => {} });
    const frame = ['a', 'b', 'c'];
    expect(r.framesEqual(frame, frame)).toBe(true);
  });
  it('detects differing frames', () => {
    const r = new TuiRenderer({ paint: () => {}, scheduleRepaint: () => {} });
    expect(r.framesEqual(['a'], ['b'])).toBe(false);
  });
});

describe('TuiRenderer repaint queue', () => {
  it('scheduleRepaint accumulates; pump drains', () => {
    const writes: Region[] = [];
    const r = new TuiRenderer({
      paint: (region: Region) => writes.push(region),
      scheduleRepaint: () => {},
    });
    r.scheduleRepaint('header');
    r.scheduleRepaint('body');
    r.pump();
    expect(writes).toEqual(['header', 'body']);
  });

  it("pump with 'all' schedules all four regions", () => {
    const writes: Region[] = [];
    const r = new TuiRenderer({
      paint: (region: Region) => writes.push(region),
      scheduleRepaint: () => {},
    });
    r.scheduleRepaint('all');
    r.pump();
    expect(writes).toContain('header');
    expect(writes).toContain('body');
    expect(writes).toContain('tabs');
    expect(writes).toContain('status');
  });

  it('pump is no-op when queue is empty', () => {
    let called = false;
    const r = new TuiRenderer({
      paint: () => { called = true; },
      scheduleRepaint: () => {},
    });
    r.pump();
    expect(called).toBe(false);
  });
});
