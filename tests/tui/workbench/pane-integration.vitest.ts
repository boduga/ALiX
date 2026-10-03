import { afterEach, describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import { AgentView } from '../../../src/tui/views/agent-view.js';
import { createInitialPerTabState } from '../../../src/tui/state.js';
import { createInitialWorkbenchUiState } from '../../../src/tui/workbench/model/ui-state.js';
import { layoutWorkbenchSurface } from '../../../src/tui/workbench/views/composer-view.js';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';

const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
const originalRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
function dimensions(columns: number, rows: number) {
  Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: rows, configurable: true });
}
afterEach(() => {
  if (originalColumns) Object.defineProperty(process.stdout, 'columns', originalColumns);
  else Reflect.deleteProperty(process.stdout, 'columns');
  if (originalRows) Object.defineProperty(process.stdout, 'rows', originalRows);
  else Reflect.deleteProperty(process.stdout, 'rows');
});
const strip = (value: string) => value.replace(/\x1b\[[0-9;]*m/gu, '');

describe('Workbench pane integration', () => {
  it('clips transcript into center, keeps roster left and composer full width', () => {
    const { state } = createWorkbenchRenderHarness();
    const canvas = new TerminalCanvas(200, 44);
    const perTab = createInitialPerTabState();
    perTab.inputBuffer = 'x'.repeat(150);
    const ui = { ...createInitialWorkbenchUiState({ columns: 200, rows: 44 }), composer: { text: perTab.inputBuffer, cursor: perTab.inputBuffer.length } };
    new AgentView().render({ canvas, snap: state.lastSnapshot!, dimensions: { columns: 200, rows: 44 },
      perTab, workbenchEnabled: true, workbenchUiState: ui, runtime: { agent: state.lastSnapshot!.runtime, chat: null } });
    const rows = strip(canvas.renderFrame()).split('\n');
    const { geometry, composer } = layoutWorkbenchSurface(perTab.inputBuffer, { columns: 200, rows: 44 }, 'closed');
    expect(composer.rows).toHaveLength(1);
    expect(rows[3]!.slice(0, 40)).toContain('AGENTS');
    expect(rows[3]!.slice(160)).toContain('AGENT DETAILS');
    expect(rows.slice(6, 39).some(row => row.slice(41, 159).includes('pane transcript'))).toBe(true);
    for (const row of rows.slice(6, 39)) expect(row.slice(0, 40)).not.toContain('pane transcript');
    expect(rows[geometry.regions.composerContent.y]!.slice(3, 153)).toBe('x'.repeat(150));
    expect(rows[geometry.topBorderRow]!.length).toBe(200);
  });

  it.each([[200, 44], [160, 36], [140, 24], [79, 20], [200, 8], [4, 3], [1, 1]])(
    'places hardware caret on painted composer at %ix%i', (columns, rows) => {
      dimensions(columns, rows);
      const { paint, state, output } = createWorkbenchRenderHarness();
      state.views.agent.inputBuffer = '調査🙂'.repeat(60);
      const surface = layoutWorkbenchSurface(state.views.agent.inputBuffer, { columns, rows }, 'closed', 0);
      paint();
      const cursor = output.writes.at(-1)!;
      const expectedColumn = Math.min(columns - 1, surface.geometry.composerPrefixWidth + surface.composer.cursorColumn) + 1;
      expect(cursor).toBe(`\x1b[${surface.geometry.regions.composerContent.y + surface.composer.cursorRow + 1};${expectedColumn}H`);
      expect(surface.geometry.regions.composerContent.y + surface.composer.cursorRow).toBeLessThan(rows);
    },
  );

  it.each(['agents', 'tasks', 'artifacts'] as const)('clips short open %s drawer above composer', drawer => {
    const { state } = createWorkbenchRenderHarness();
    const canvas = new TerminalCanvas(200, 8);
    const perTab = createInitialPerTabState();
    perTab.inputBuffer = 'composer remains editable';
    const ui = { ...createInitialWorkbenchUiState({ columns: 200, rows: 8 }), drawer,
      composer: { text: perTab.inputBuffer, cursor: perTab.inputBuffer.length } };
    new AgentView().render({ canvas, snap: state.lastSnapshot!, dimensions: { columns: 200, rows: 8 },
      perTab, workbenchEnabled: true, workbenchUiState: ui, runtime: { agent: state.lastSnapshot!.runtime, chat: null } });
    const rows = strip(canvas.renderFrame()).split('\n');
    const { geometry } = layoutWorkbenchSurface(perTab.inputBuffer, { columns: 200, rows: 8 }, drawer, 0);
    expect(rows[geometry.regions.composerContent.y]).toContain(perTab.inputBuffer);
    expect(rows[geometry.topBorderRow]).not.toContain('switch');
    expect(rows[geometry.bottomBorderRow]).not.toContain('All agents');
  });

  it('resizes an unpinned transcript without mutating operator selection or requested scroll', () => {
    dimensions(200, 44);
    const { app, paint, state, output } = createWorkbenchRenderHarness('wrapped words '.repeat(45));
    const cached = () => (app as unknown as { framePainter: { scrollAnchor: { lines: { itemId?: string; wrappedOffset?: number }[]; resolvedOffset: number } } }).framePainter.scrollAnchor;
    state.views.agent.pinnedBottom = false;
    state.views.agent.scrollOffset = 10;
    paint();
    const firstAnchor = cached().lines[cached().resolvedOffset]!.itemId;
    output.writes.length = 0;
    dimensions(79, 24);
    paint();
    expect(cached().lines[cached().resolvedOffset]!.itemId).toBe(firstAnchor);
    const resizedOffset = cached().resolvedOffset;
    state.views.agent.scrollOffset += 3;
    paint();
    expect(cached().resolvedOffset).toBe(resizedOffset + 3);
    expect(state.views.agent.scrollOffset).toBe(13);
    expect(state.views.agent.pinnedBottom).toBe(false);
    expect(output.writes.length).toBeGreaterThan(0);
  });
});
