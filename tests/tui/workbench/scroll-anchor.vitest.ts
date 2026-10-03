import { describe, expect, it } from 'vitest';
import type { ScrollbackLine } from '../../../src/tui/views/bottom-anchored-viewport.js';
import { reconcileWorkbenchScrollAnchor } from '../../../src/tui/workbench/layout/scroll-anchor.js';

function rows(itemId: string, count: number): ScrollbackLine[] {
  return Array.from({ length: count }, (_, wrappedOffset) => ({
    kind: 'agent', text: `${itemId}:${wrappedOffset}`, isFirst: wrappedOffset === 0, itemId, wrappedOffset,
  }));
}

describe('semantic Workbench resize anchors', () => {
  it('retains item and wrapped row when preceding content grows on narrowing', () => {
    const previous = [...rows('first', 2), ...rows('selected', 3)];
    const next = [...rows('first', 5), ...rows('selected', 6)];
    expect(reconcileWorkbenchScrollAnchor(previous, 3, next)).toBe(6);
  });

  it('clamps wrapped row within the same item on widening', () => {
    const previous = [...rows('first', 5), ...rows('selected', 6)];
    const next = [...rows('first', 2), ...rows('selected', 2), ...rows('last', 1)];
    expect(reconcileWorkbenchScrollAnchor(previous, 9, next)).toBe(3);
  });

  it('clamps missing-item fallback to remaining rows', () => {
    const previous = [...rows('first', 2), ...rows('removed', 3)];
    expect(reconcileWorkbenchScrollAnchor(previous, 4, rows('first', 2))).toBe(1);
    expect(reconcileWorkbenchScrollAnchor(previous, 4, [])).toBe(0);
  });

  it('keeps existing anchors when more content appends', () => {
    const previous = [...rows('first', 2), ...rows('selected', 2)];
    expect(reconcileWorkbenchScrollAnchor(previous, 3, [...previous, ...rows('appended', 8)])).toBe(3);
  });

  it('falls back safely for legacy untagged or out-of-range positions', () => {
    const untagged: ScrollbackLine[] = [{ kind: 'user', text: 'legacy', isFirst: true }];
    expect(reconcileWorkbenchScrollAnchor(untagged, 0, rows('new', 2))).toBe(0);
    expect(reconcileWorkbenchScrollAnchor(untagged, -1, rows('new', 2))).toBe(0);
    expect(reconcileWorkbenchScrollAnchor(untagged, Infinity, rows('new', 2))).toBe(0);
  });
});
