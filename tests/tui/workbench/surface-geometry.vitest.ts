import { describe, expect, it } from 'vitest';
import { resolveWorkbenchSurfaceGeometry, type WorkbenchRegion } from '../../../src/interfaces/tui/workbench/layout/responsive-layout.js';

function overlaps(a: WorkbenchRegion, b: WorkbenchRegion): boolean {
  return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
    && a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('Workbench surface geometry', () => {
  it('defines the canonical three-pane grid and full-width composer', () => {
    const geometry = resolveWorkbenchSurfaceGeometry(200, 44, 'closed');
    expect(geometry.regions.roster).toEqual({ x: 0, y: 3, width: 40, height: 37 });
    expect(geometry.regions.transcript).toEqual({ x: 41, y: 3, width: 118, height: 37 });
    expect(geometry.regions.inspector).toEqual({ x: 160, y: 3, width: 40, height: 37 });
    expect(geometry.regions.transcriptBody).toEqual({ x: 41, y: 6, width: 118, height: 33 });
    expect(geometry.regions.composer).toEqual({ x: 0, y: 40, width: 200, height: 3 });
    expect(geometry.regions.composerContent).toEqual({ x: 0, y: 41, width: 200, height: 1 });
    expect(geometry.dimensions).toEqual({ columns: 118, rows: 44 });
  });

  it.each([
    [200, 44, true], [180, 40, true], [160, 36, true],
    [160, 35, false], [159, 36, false], [140, 32, false],
    [120, 30, false], [119, 30, false], [100, 28, false],
    [80, 24, false], [79, 24, false], [60, 20, false],
  ])('requires both width and height for inspector at %ix%i', (columns, rows, inspectorVisible) => {
    const geometry = resolveWorkbenchSurfaceGeometry(columns, rows, 'agents');
    expect(geometry.regions.inspector !== null).toBe(inspectorVisible);
    expect(geometry.regions.composer.width).toBe(columns);
    expect(geometry.regions.roster !== null).toBe(columns >= 120);
    expect(geometry.regions.overlay !== null).toBe(columns < 120);
  });

  it('preserves existing side-drawer availability without forcing one at medium width', () => {
    expect(resolveWorkbenchSurfaceGeometry(140, 32, 'closed').regions.transcript.x).toBe(0);
    const side = resolveWorkbenchSurfaceGeometry(140, 32, 'tasks');
    expect(side.regions.roster).toEqual({ x: 0, y: 3, width: 36, height: 25 });
    expect(side.regions.transcript.x).toBe(37);
    expect(side.dimensions.columns).toBe(103);
  });

  it('keeps short windows unobstructed unless the operator explicitly opens a drawer', () => {
    const closed = resolveWorkbenchSurfaceGeometry(200, 8, 'closed');
    expect(closed.layout.drawer).toBe('closed');
    expect(closed.regions.overlay).toBeNull();
    expect(closed.regions.transcript.width).toBe(200);
    const opened = resolveWorkbenchSurfaceGeometry(200, 8, 'agents');
    expect(opened.layout.drawerMode).toBe('overlay');
    expect(opened.regions.overlay).not.toBeNull();
  });

  it('bottom-aligns tiny composer text with its terminal cursor row', () => {
    const geometry = resolveWorkbenchSurfaceGeometry(20, 3, 'closed');
    expect(geometry.regions.composerContent).toEqual({ x: 0, y: 1, width: 20, height: 1 });
    expect(geometry.panelRow).toBe(1);
    expect(geometry.regions.composer.height).toBe(2);
  });

  it('grows composer upwards without changing pane widths or the final text row', () => {
    const single = resolveWorkbenchSurfaceGeometry(200, 44, 'closed');
    const multi = resolveWorkbenchSurfaceGeometry(200, 44, 'closed', 5);
    expect(multi.regions.composer).toEqual({ x: 0, y: 36, width: 200, height: 7 });
    expect(multi.regions.composerContent).toEqual({ x: 0, y: 37, width: 200, height: 5 });
    expect(multi.panelRow).toBe(single.panelRow);
    expect(multi.regions.transcript.width).toBe(single.regions.transcript.width);
    expect(multi.regions.transcript.height).toBe(single.regions.transcript.height - 4);
  });

  it.each([1, 2, 3, 4, 6, 8, 11, 12, 20, 36, 44])('bounds every region and prioritizes editable content at height %i', (rows) => {
    for (const columns of [1, 2, 3, 20, 79, 120, 160, 200]) {
      const geometry = resolveWorkbenchSurfaceGeometry(columns, rows, 'agents', 500);
      for (const rect of Object.values(geometry.regions)) {
        if (!rect) continue;
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.width).toBeGreaterThanOrEqual(0);
        expect(rect.height).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(columns);
        expect(rect.y + rect.height).toBeLessThanOrEqual(rows);
      }
      expect(geometry.regions.composerContent.height).toBeGreaterThanOrEqual(1);
      expect(geometry.panelRow).toBeGreaterThanOrEqual(0);
      expect(geometry.panelRow).toBeLessThan(rows);
      expect(geometry.composerPrefixWidth).toBeLessThan(columns);
      const disjoint = [geometry.regions.header, geometry.regions.tabs, geometry.regions.roster,
        geometry.regions.transcript, geometry.regions.inspector, geometry.regions.composer, geometry.regions.footer]
        .filter((rect): rect is WorkbenchRegion => rect !== null);
      for (let index = 0; index < disjoint.length; index++) {
        for (let other = index + 1; other < disjoint.length; other++) {
          expect(overlaps(disjoint[index]!, disjoint[other]!)).toBe(false);
        }
      }
    }
  });

  it('normalizes invalid/fractional sizes and composer row counts', () => {
    expect(resolveWorkbenchSurfaceGeometry(Number.NaN, Number.POSITIVE_INFINITY, 'agents', Number.NaN).dimensions)
      .toEqual({ columns: 1, rows: 1 });
    const geometry = resolveWorkbenchSurfaceGeometry(200.9, 44.9, 'closed', -1);
    expect(geometry.regions.composer.width).toBe(200);
    expect(geometry.regions.composerContent.height).toBe(1);
    expect(geometry.dimensions.rows).toBe(44);
  });
});
