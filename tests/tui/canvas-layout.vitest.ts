import { describe, it, expect } from 'vitest';
import { CanvasLayoutEngine } from '../../src/tui/layout/canvas-layout.js';

describe('CanvasLayoutEngine', () => {
  const engine = new CanvasLayoutEngine();

  it('returns default perPanelH=14 when terminal is large enough for 4 panels', () => {
    const geom = engine.compute({ columns: 200, rows: 80 }, 4);
    expect(geom.perPanelH).toBe(14);
    expect(geom.panelCount).toBe(4);
    expect(geom.headerH).toBe(3);
    expect(geom.footerH).toBe(3);
    expect(geom.bodyH).toBe(74);
    expect(geom.leftW).toBe(150);
    expect(geom.rightW).toBe(49);
    expect(geom.dividerX).toBe(150);
  });

  it('defaults panelCount to 4 when omitted', () => {
    const geom = engine.compute({ columns: 200, rows: 80 });
    expect(geom.panelCount).toBe(4);
    expect(geom.perPanelH).toBe(14);
  });

  it('honors custom panelCount of 2', () => {
    const geom = engine.compute({ columns: 200, rows: 80 }, 2);
    expect(geom.panelCount).toBe(2);
    expect(geom.perPanelH).toBe(14);
  });

  it('clamps perPanelH to >= 5 when terminal is too short', () => {
    const geom = engine.compute({ columns: 200, rows: 30 }, 4);
    // bodyH = 30 - 3 - 3 = 24
    // target = 14 * 4 = 56 > 24
    // perPanelH = max(5, floor(24 / 4)) = max(5, 6) = 6
    expect(geom.perPanelH).toBe(6);
    expect(geom.bodyH).toBe(24);
  });

  it('enforces floor of 5 on perPanelH in extreme cramped terminals', () => {
    const geom = engine.compute({ columns: 80, rows: 15 }, 4);
    // bodyH = max(1, 15 - 3 - 3) = 9
    // available = 9
    // target = 56 > 9
    // perPanelH = max(5, floor(9 / 4)) = max(5, 2) = 5
    expect(geom.perPanelH).toBe(5);
  });

  it('respects minimum leftW of 40 even on narrow terminals', () => {
    const geom = engine.compute({ columns: 60, rows: 40 });
    // SPLIT_RATIO * 60 = 45; max(40, 45) = 45
    expect(geom.leftW).toBe(45);
    // columns - leftW - 1 = 60 - 45 - 1 = 14 -> max(20, 14) = 20
    expect(geom.rightW).toBe(20);
  });

  it('clamps leftW to 40 when terminal is very narrow', () => {
    const geom = engine.compute({ columns: 30, rows: 40 });
    // SPLIT_RATIO * 30 = 22.5 -> floor -> 22; max(40, 22) = 40
    expect(geom.leftW).toBe(40);
    // columns - leftW - 1 = 30 - 40 - 1 = -11 -> max(20, -11) = 20
    expect(geom.rightW).toBe(20);
  });

  it('keeps bodyH >= 1 in tiny terminals', () => {
    const geom = engine.compute({ columns: 200, rows: 5 });
    // bodyH = max(1, 5 - 3 - 3) = 1
    expect(geom.bodyH).toBe(1);
  });

  it('dividerX equals leftW', () => {
    const geom = engine.compute({ columns: 120, rows: 40 });
    expect(geom.dividerX).toBe(geom.leftW);
  });

  it('preserves the requested panelCount in the returned geometry', () => {
    expect(engine.compute({ columns: 200, rows: 80 }, 7).panelCount).toBe(7);
    expect(engine.compute({ columns: 200, rows: 80 }, 1).panelCount).toBe(1);
  });
});
