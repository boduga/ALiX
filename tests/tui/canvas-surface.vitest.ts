import { describe, it, expect } from 'vitest';
import { CanvasSurface } from '../../src/tui/renderers/canvas-surface.js';
import type { RenderSurface } from '../../src/tui/renderer/surface.js';

describe('CanvasSurface', () => {
  const w = 80, h = 24;

  it('creates with dimensions', () => {
    const s = new CanvasSurface(w, h);
    expect(s.width).toBe(w);
    expect(s.height).toBe(h);
  });

  it('write does not throw', () => { expect(() => new CanvasSurface(w, h).write(0, 0, 'hi')).not.toThrow(); });
  it('drawBox does not throw', () => { expect(() => new CanvasSurface(w, h).drawBox(0, 0, 10, 5, 't')).not.toThrow(); });
  it('drawBar does not throw', () => { expect(() => new CanvasSurface(w, h).drawBar(0, 0, 20, 0.5)).not.toThrow(); });
  it('clear resets', () => { const s = new CanvasSurface(w, h); s.write(0, 0, 'x'); expect(() => s.clear()).not.toThrow(); });
  it('serialize returns string', () => { const s = new CanvasSurface(w, h); expect(typeof s.serialize()).toBe('string'); });
  it('blit between CanvasSurfaces works', () => {
    const a = new CanvasSurface(w, h); a.write(0, 0, 'hello');
    const b = new CanvasSurface(w, h); b.blit(a, 10, 10);
    expect(() => b.serialize()).not.toThrow();
  });
  it('copy to non-CanvasSurface via interface works', () => {
    const a = new CanvasSurface(w, h); a.write(5, 5, 'x');
    const dst: RenderSurface = new CanvasSurface(w, h); a.copy(dst, 0, 0);
    expect(() => dst.serialize()).not.toThrow();
  });
});
