import type { ScrollbackLine } from '../../views/bottom-anchored-viewport.js';

/** Preserve the visible semantic item when width changes its wrapped row count. */
export function reconcileWorkbenchScrollAnchor(
  previousLines: readonly ScrollbackLine[],
  previousIndex: number,
  nextLines: readonly ScrollbackLine[],
): number {
  const fallback = Math.max(0, Math.min(Number.isFinite(previousIndex) ? Math.floor(previousIndex) : 0, Math.max(0, nextLines.length - 1)));
  const previous = previousLines[previousIndex];
  if (!previous?.itemId) return fallback;
  const wantedOffset = previous.wrappedOffset ?? 0;
  let nearest = -1;
  let nearestDistance = Infinity;
  for (let index = 0; index < nextLines.length; index++) {
    const line = nextLines[index]!;
    if (line.itemId !== previous.itemId) continue;
    const distance = Math.abs((line.wrappedOffset ?? 0) - wantedOffset);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest < 0 ? fallback : nearest;
}
