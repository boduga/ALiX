export interface FramePatch {
  readonly row: number;
  readonly text: string;
}

export function diffFrameRows(previous: string | null, next: string): readonly FramePatch[] {
  const nextRows = next.endsWith('\n') ? next.slice(0, -1).split('\n') : next.split('\n');
  if (previous === null) return nextRows.map((text, row) => ({ row, text }));
  const previousRows = previous.endsWith('\n') ? previous.slice(0, -1).split('\n') : previous.split('\n');
  const count = Math.max(previousRows.length, nextRows.length);
  const patches: FramePatch[] = [];
  for (let row = 0; row < count; row++) {
    const text = nextRows[row] ?? '';
    if (previousRows[row] !== text) patches.push({ row, text });
  }
  return patches;
}

export function renderFramePatches(patches: readonly FramePatch[]): string {
  return patches.map((patch) => `\x1b[${patch.row + 1};1H\x1b[2K${patch.text}`).join('');
}
