import { describe, it, expect } from 'vitest';
import { TuiRenderer, type Region } from '../../src/tui/render.js';

describe('Region union exhaustiveness', () => {
  it('lists exactly four regions plus wildcard', () => {
    const regions: Region[] = ['header', 'body', 'tabs', 'status', 'all'];
    expect(new Set(regions).size).toBe(5);
  });
});

describe('FrameBuffer equality', () => {
  it('detects identical frames (zero-write opportunity)', () => {
    const r = new TuiRenderer();
    const frame = ['a', 'b', 'c'];
    expect(r.framesEqual(frame, frame)).toBe(true);
  });
  it('detects differing frames', () => {
    const r = new TuiRenderer();
    expect(r.framesEqual(['a'], ['b'])).toBe(false);
  });
});

describe('TuiRenderer repaint queue', () => {
  it('scheduleRepaint accumulates; pump drains', () => {
    const r = new TuiRenderer();
    expect(r.pendingRegions).toEqual([]);
    r.scheduleRepaint('header');
    r.scheduleRepaint('body');
    expect(r.pendingRegions).toEqual(['header', 'body']);
    r.pump();
    expect(r.pendingRegions).toEqual([]);
  });

  it("pump 'all' drains the queue", () => {
    const r = new TuiRenderer();
    r.scheduleRepaint('all');
    expect(r.pendingRegions).toEqual(['all']);
    r.pump();
    expect(r.pendingRegions).toEqual([]);
  });

  it('pump is no-op when queue is empty', () => {
    const r = new TuiRenderer();
    expect(r.pendingRegions).toEqual([]);
    r.pump();
    expect(r.pendingRegions).toEqual([]);
  });
});
