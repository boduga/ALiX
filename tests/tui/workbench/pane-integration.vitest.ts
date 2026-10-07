import { afterEach, describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import { AgentView } from '../../../src/tui/views/agent-view.js';
import { computeBottomAnchor } from '../../../src/tui/views/scroll-math.js';
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
  it.each([[200,44],[134,33],[80,24],[12,9]])('paints full cyan composer box and bounded exact placeholder at %ix%i', (columns, rows) => {
    const { state } = createWorkbenchRenderHarness();
    const canvas = new TerminalCanvas(columns, rows);
    const ui = createInitialWorkbenchUiState({ columns, rows });
    new AgentView().render({ canvas, snap: state.lastSnapshot!, dimensions: { columns, rows }, perTab: createInitialPerTabState(), workbenchEnabled: true, workbenchUiState: ui, runtime: { agent: null, chat: null } });
    const frame = strip(canvas.renderFrame()).split('\n');
    const { geometry } = layoutWorkbenchSurface('', { columns, rows }, 'closed');
    const line = frame[geometry.regions.composerContent.y]!;
    expect(line.startsWith('│> ')).toBe(true);
    expect(line.endsWith('│')).toBe(true);
    expect(line.slice(3, -1).trimEnd()).toBe('Add your next instruction...'.slice(0, columns - 4));
    expect(frame[geometry.topBorderRow]).toBe('╭' + '─'.repeat(columns - 2) + '╮');
  });

  it.each(['x'.repeat(76), '界'.repeat(38)])('keeps exact-full-row caret inside composer border: %s', text => {
    dimensions(80,24);
    const { app, state, paint, output } = createWorkbenchRenderHarness();
    const ui = (app as any).workbenchStore;
    ui.dispatch({ type: 'composer.replace', text });
    state.views.agent.inputBuffer = text;
    paint();
    const { geometry, composer } = layoutWorkbenchSurface(text, { columns:80, rows:24 }, 'closed');
    expect(composer.cursorColumn).toBe(0);
    expect(output.writes.at(-1)).toBe(`\x1b[${geometry.regions.composerContent.y + composer.cursorRow + 1};4H`);
  });

  it.each(['help', 'inspector', 'diagnostics'])('keeps overlay and approval out of composer on a short terminal: %s', overlay => {
    dimensions(80,12);
    const { app, state, paint } = createWorkbenchRenderHarness();
    const ui = (app as any).workbenchStore;
    ui.dispatch({ type: 'composer.replace', text: 'editable draft' });
    ui.dispatch({ type: 'overlay.toggle', overlay });
    state.views.agent.inputBuffer = 'editable draft';
    state.views.agent.pendingApprovals = [{ id: 'pending', toolName: 'shell.run', target: 'approval target', requestedAt: 1 }];
    paint();
    const frame = strip((app as any).framePainter.previousWorkbenchFrame).split('\n');
    const { geometry } = layoutWorkbenchSurface('editable draft', { columns:80,rows:12 }, 'closed');
    expect(frame[geometry.regions.composerContent.y]).toContain('editable draft');
    expect(frame[geometry.topBorderRow]).toBe('╭' + '─'.repeat(78) + '╮');
  });

  it('uses full transcript width for the same bottom anchor as the painted surface', () => {
    const { state } = createWorkbenchRenderHarness();
    const perTab = createInitialPerTabState();
    perTab.streamingText = 'x'.repeat(200);
    const ctx = { snap: state.lastSnapshot!, dimensions: { columns: 80, rows: 12 }, perTab,
      workbenchEnabled: true, workbenchUiState: createInitialWorkbenchUiState(), runtime: { agent: null, chat: null } };
    // 78 columns minus the 41-column actor/time prefix: six streaming rows,
    // plus scope and separator, with one visible body row.
    expect(computeBottomAnchor(ctx, 'agent')).toBe(7);
    const canvas = new TerminalCanvas(80, 12);
    new AgentView().render({ ...ctx, canvas });
    const rows = strip(canvas.renderFrame()).split('\n');
    const { geometry } = layoutWorkbenchSurface('', ctx.dimensions, 'closed');
    expect(rows[geometry.regions.transcriptBody.y]!.slice(1, -1).trim()).toBe('x'.repeat(15));
  });
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
    expect(rows[3]!.slice(41, 159)).toContain('LIVE TRANSCRIPT');
    expect(rows[6]![41]).toBe('│');
    expect(rows[6]![158]).toBe('│');
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
    (app as unknown as { workbenchStore: { dispatch(action: { type: 'transcript.follow'; followTail: boolean }): void } })
      .workbenchStore.dispatch({ type: 'transcript.follow', followTail: false });
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
