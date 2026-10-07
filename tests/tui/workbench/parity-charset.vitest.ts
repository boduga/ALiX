import { describe, expect, it, vi } from 'vitest';
import { stripAnsi } from '../../../src/tui/box.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import { displayWidth, graphemes, graphemeWidth } from '../../../src/tui/terminal-text.js';
import { createInitialPerTabState, SessionPhase } from '../../../src/tui/state.js';
import type { DashboardSnapshot, RuntimeSnapshot } from '../../../src/tui/snapshot.js';
import type { TimelineEntry } from '../../../src/tui/runtime/timeline-builder.js';
import type { ViewRenderContext } from '../../../src/tui/views/types.js';
import { AgentView } from '../../../src/tui/views/agent-view.js';
import type { ToolItem } from '../../../src/tui/workbench/model/transcript-item.js';
import { getWorkbenchPreviewTheme, type WorkbenchPreviewTheme } from '../../../src/tui/workbench/model/preview-theme.js';
import { createInitialWorkbenchUiState } from '../../../src/tui/workbench/model/ui-state.js';
import { projectOperatorShell } from '../../../src/tui/workbench/model/operator-shell.js';
import { buildAgentInspectorModel } from '../../../src/tui/workbench/model/agent-inspector.js';
import { WorkbenchStore } from '../../../src/tui/workbench/app/workbench-store.js';
import { routeWorkbenchInput } from '../../../src/tui/workbench/input/input-router.js';
import { paintRosterDrawer } from '../../../src/tui/workbench/views/roster-drawer.js';
import { paintAgentInspector } from '../../../src/tui/workbench/views/agent-inspector.js';
import { paintOperatorShell } from '../../../src/tui/workbench/views/operator-shell.js';
import { paintTranscriptToolbar } from '../../../src/tui/workbench/views/transcript-toolbar.js';
import { buildWorkbenchScrollbackLines } from '../../../src/tui/workbench/views/workbench-scrollback.js';
import { buildWorkbenchToolCardLines } from '../../../src/tui/workbench/views/tool-card.js';
import { layoutComposer } from '../../../src/tui/workbench/views/composer-view.js';
import { createTerminalControl } from '../../../src/tui/terminal-control.js';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';
import { agent, inspectorSnapshot, paintThemedInspectorFrame as paintInspector, roster } from './parity-helpers.js';

const MIXED = '調査 👩‍💻 café é界';
const UNICODE_ONLY = /[╭╮╰╯│─●○✗✓•›↑↓…·–]/u;
const TRUECOLOR = /\x1b\[[34]8;2;/u;
const SGR_COLOR = /\x1b\[(?:3[0-7]|4[0-7]|9[0-7]|10[0-7])m/u;

const strip = (value: string): string => stripAnsi(value);
const rowsOf = (frame: string): string[] => strip(frame).split('\n');

/** Grapheme suffix painted past `columns` display columns (wide cells count 2). */
function spillBeyond(row: string, columns: number): string {
  let used = 0;
  let suffix = '';
  for (const cell of graphemes(row)) {
    if (used >= columns) suffix += cell;
    used += graphemeWidth(cell);
  }
  return suffix;
}

// Shared `agent()` factory, roster + totals literal, `inspectorSnapshot()`
// and the themed inspector paint live in parity-helpers.ts (shared with
// parity-scenarios.vitest.ts).

function paintRoster(overrides: Partial<Parameters<typeof paintRosterDrawer>[0]> = {}, theme?: WorkbenchPreviewTheme): string {
  const canvas = overrides.canvas ?? new TerminalCanvas(200, 44);
  paintRosterDrawer({
    canvas, terminalColumns: 200, left: 0, top: 3, bottom: 38,
    layout: { breakpoint: 'ultrawide', contentColumns: 118, drawer: 'agents', drawerMode: 'side', drawerWidth: 40 },
    agents: roster([]), tasks: null, ...overrides,
    ...(theme ? { theme } : {}),
  });
  return canvas.renderFrame();
}

function shellSnapshot(): DashboardSnapshot {
  return {
    generatedAt: 1,
    session: { mode: 'auto', phase: SessionPhase.Idle, version: 'test', startedAt: 1, turns: 2 },
    daemon: null, approvals: null,
    runtime: {
      trace: [], timeline: [], workflow: null, totalEventCount: 1204,
      lastEventAt: null, sessionId: 'charset', capabilities: null, metrics: null, context: null,
    },
    sops: null, policy: null,
    // Deliberately non-ASCII: the shell header paints this workspace path, so
    // the shell region carries a real CJK row (see the ASCII-substitution test).
    cwd: '/workspace/projects/調査',
  };
}
function paintShell(theme?: WorkbenchPreviewTheme): string {
  const canvas = new TerminalCanvas(200, 44);
  paintOperatorShell({
    canvas, width: 200, height: 44,
    model: projectOperatorShell(shellSnapshot(), createInitialPerTabState()),
    ...(theme ? { theme } : {}),
  });
  return canvas.renderFrame();
}

function paintToolbar(theme: WorkbenchPreviewTheme): string {
  const canvas = new TerminalCanvas(90, 4);
  paintTranscriptToolbar(canvas, { x: 0, y: 0, width: 90, height: 3 }, createInitialWorkbenchUiState(), 0, theme);
  return canvas.renderFrame();
}

const scrollbackTimeline: TimelineEntry[] = [
  { id: 'u1', kind: 'agent.message', actor: 'user', sessionId: 's', startedAt: Date.parse('2026-10-03T10:14:21.000Z'), text: `Implement responsive sidebar ${MIXED}`, sourceEvents: { firstSequence: 1, lastSequence: 1 } },
  { id: 'p1', kind: 'agent.progress', actor: 'agent', agentId: 'worker-1', sessionId: 's', startedAt: Date.parse('2026-10-03T10:14:25.000Z'), userSafe: true, text: `Reading current sidebar component for context. ${MIXED}`, sourceEvents: { firstSequence: 2, lastSequence: 2 } },
  { id: 'r1', kind: 'agent.response', actor: 'agent', sessionId: 's', startedAt: Date.parse('2026-10-03T10:14:31.000Z'), text: `Finished. ${MIXED}`, sourceEvents: { firstSequence: 3, lastSequence: 3 } },
];

function scrollbackContext(): ViewRenderContext {
  const runtime: RuntimeSnapshot = {
    trace: [], timeline: [], workflow: null, totalEventCount: 3,
    lastEventAt: null, sessionId: 'charset', capabilities: null, metrics: null, context: null,
  };
  const snap: DashboardSnapshot = {
    generatedAt: 1,
    session: { mode: 'auto', phase: SessionPhase.Idle, version: 'test', startedAt: 1, turns: 1 },
    daemon: null, approvals: null, runtime, sops: null, policy: null, cwd: '/workspace',
  };
  return {
    snap, dimensions: { columns: 90, rows: 36 }, perTab: createInitialPerTabState(), workbenchEnabled: true,
    runtime: { chat: null, agent: { ...runtime, sessionId: 'charset-agent', timeline: scrollbackTimeline } },
  };
}

describe('Phase 10 charset parity — output', () => {
  it('[V02, V03, T09] keeps every full-surface row inside terminal width under CJK/emoji/combining content', () => {
    const { state } = createWorkbenchRenderHarness(MIXED);
    const canvas = new TerminalCanvas(200, 44);
    const perTab = createInitialPerTabState();
    perTab.inputBuffer = `draft ${MIXED}`;
    const ui = {
      ...createInitialWorkbenchUiState({ columns: 200, rows: 44 }),
      composer: { text: `draft ${MIXED}`, cursor: `draft ${MIXED}`.length },
    };
    new AgentView().render({
      canvas, snap: state.lastSnapshot!, dimensions: { columns: 200, rows: 44 },
      perTab, workbenchEnabled: true, workbenchUiState: ui,
      runtime: { agent: state.lastSnapshot!.runtime, chat: null },
    });
    const rows = rowsOf(canvas.renderFrame());
    for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(200);
    const text = rows.join('\n');
    expect(text).toContain('調査');
    expect(text).toContain('👩‍💻');
  });

  it('[V03, T05, T15] wraps mixed-width transcript prose inside requested columns with aligned continuations', () => {
    for (const columns of [30, 48, 72, 90]) {
      const lines = buildWorkbenchScrollbackLines(scrollbackContext(), columns);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(displayWidth(strip(line.text))).toBeLessThanOrEqual(columns);
    }
    const all72 = buildWorkbenchScrollbackLines(scrollbackContext(), 72);
    const activity = all72
      .filter((line) => line.kind === 'activity');
    expect(activity.length).toBeGreaterThan(1);
    const first = strip(activity[0]!.text);
    const continuation = strip(activity[1]!.text);
    const offset = displayWidth(first.slice(0, first.indexOf('Reading')));
    expect(continuation.startsWith(' '.repeat(offset))).toBe(true);
    const joined = buildWorkbenchScrollbackLines(scrollbackContext(), 90).map((line) => strip(line.text)).join('\n');
    expect(joined).toContain('調査');
    expect(joined).toContain('👩‍💻');
  });

  it('[V03, L05, L11] keeps CJK roster identities inside the drawer and leaves the neighbor pane untouched', () => {
    const canvas = new TerminalCanvas(200, 44);
    for (let y = 0; y < 44; y++) canvas.write(0, y, '.'.repeat(200));
    const frame = strip(paintRoster({
      canvas,
      agents: roster([
        agent('調査-agent', { state: 'thinking', taskLabel: '响应式侧边栏を実装' }),
        agent('test-agent', { state: 'waiting_dependency', taskLabel: '調査テスト' }),
        agent('review-agent', { state: 'completed' }),
      ]),
      selectedAgentId: '調査-agent',
    }));
    const rows = frame.split('\n');
    expect(frame).toContain('調査-agent');
    expect(frame).toContain('响应式侧边栏を実装');
    for (let y = 3; y <= 38; y++) expect(spillBeyond(rows[y] ?? '', 40)).toBe('.'.repeat(160));
    for (const y of [0, 1, 2, 39, 40, 41, 42, 43]) expect(rows[y]).toBe('.'.repeat(200));
  });

  it('[V03, R02, R05] keeps CJK/emoji inspector values inside its region and preserves surrounding cells', () => {
    const model = buildAgentInspectorModel(
      inspectorSnapshot({ role: '調査担当 👩‍💻', currentOperation: '編集中 é' }),
      { selectedAgentId: 'frontend-agent' },
    );
    const canvas = new TerminalCanvas(44, 40);
    for (let y = 0; y < 40; y++) canvas.write(0, y, '.'.repeat(44));
    paintAgentInspector(canvas, { x: 2, y: 2, width: 40, height: 36 }, model, getWorkbenchPreviewTheme('truecolor', 'unicode'));
    const rows = strip(canvas.renderFrame()).split('\n');
    expect(canvas.renderFrame()).toContain('調査');
    expect(canvas.renderFrame()).toContain('响应式侧边栏');
    for (let y = 2; y <= 37; y++) expect(spillBeyond(rows[y] ?? '', 42)).toBe('..');
    for (const y of [0, 1, 38, 39]) expect(rows[y]).toBe('.'.repeat(44));
  });

  it('[V03, C01] keeps composer rows and cursor inside the box for CJK/emoji/combining drafts', () => {
    const draft = `調査👩‍💻é界${'x'.repeat(20)}`;
    const layout = layoutComposer(draft, 16, 6, draft.length);
    expect(layout.rows.length).toBeGreaterThan(1);
    for (const row of layout.rows) expect(displayWidth(row)).toBeLessThanOrEqual(16);
    expect(layout.cursorRow).toBeLessThan(layout.rows.length);
    expect(layout.cursorColumn).toBeLessThanOrEqual(16);
    expect(displayWidth(layout.rows[layout.cursorRow]!.slice(0, layout.cursorColumn) || '')).toBeLessThanOrEqual(16);
  });

  it('[V03, T12] holds tool card rows at exact column width with CJK/emoji paths in unicode mode', () => {
    const item: ToolItem = {
      id: 'call-charset', name: 'file.read', status: 'completed', startedAt: 1,
      sourceEvents: { firstSequence: 1, lastSequence: 3 },
      metadata: { toolCallId: 'call-charset', path: 'src/調査/👩‍💻-sidebar.tsx', requestedRange: { startLine: 1, endLine: 200 }, observedLineCount: 142 },
    };
    const rows = buildWorkbenchToolCardLines(item, { width: 72, indent: 41, theme: getWorkbenchPreviewTheme('truecolor', 'unicode') });
    const plainWidths = rows.map((row) => displayWidth(strip(row.text)));
    expect(plainWidths.every((width) => width <= 72)).toBe(true);
    expect(plainWidths[0]).toBe(72);
    expect(plainWidths.at(-1)).toBe(72);
    expect(rows.map((row) => strip(row.text)).join('\n')).toContain('調査');
  });
});

describe('Phase 10 charset parity — input', () => {
  const inputContext = () => ({
    turnActive: false, composerText: '', slashActive: false, approvalPending: false,
    overlayOpen: false, transcriptMode: 'compact' as const, drawer: 'closed' as const, focus: 'composer' as const,
  });

  it('[C03] routes printable CJK graphemes to composer insert', () => {
    for (const grapheme of ['界', '調', '査']) {
      expect(routeWorkbenchInput(grapheme, inputContext())).toEqual({ type: 'composer.insert', text: grapheme });
    }
  });

  it('[C03] moves, backspaces and deletes CJK wide characters as single graphemes', () => {
    const store = new WorkbenchStore();
    store.dispatch({ type: 'composer.insert', text: '界A調' });
    expect(store.snapshot().composer).toEqual({ text: '界A調', cursor: 3 });
    store.dispatch({ type: 'composer.move', direction: 'left' });
    expect(store.snapshot().composer.cursor).toBe(2);
    store.dispatch({ type: 'composer.backspace' });
    expect(store.snapshot().composer).toEqual({ text: '界調', cursor: 1 });
    store.dispatch({ type: 'composer.move', direction: 'left' });
    expect(store.snapshot().composer.cursor).toBe(0);
    store.dispatch({ type: 'composer.delete' });
    expect(store.snapshot().composer).toEqual({ text: '調', cursor: 0 });
    store.dispatch({ type: 'composer.insert', text: '👩‍💻' });
    expect(store.snapshot().composer).toEqual({ text: '👩‍💻調', cursor: 5 });
    store.dispatch({ type: 'composer.backspace' });
    expect(store.snapshot().composer).toEqual({ text: '調', cursor: 0 });
  });

  it('[C03] raw keystrokes insert and erase complete CJK graphemes', () => {
    const { app } = createWorkbenchRenderHarness();
    const internal = app as unknown as {
      handleRaw(buffer: Buffer): void;
      getWorkbenchStateForTest(): { composer: { text: string; cursor: number } };
    };
    internal.handleRaw(Buffer.from('界'));
    internal.handleRaw(Buffer.from('調'));
    expect(internal.getWorkbenchStateForTest().composer).toEqual({ text: '界調', cursor: 2 });
    internal.handleRaw(Buffer.from('\x7f'));
    expect(internal.getWorkbenchStateForTest().composer).toEqual({ text: '界', cursor: 1 });
  });
});

describe('Phase 10 capability parity — ascii and low-color modes', () => {
  const asciiAgents = () => roster([
    agent('backend-agent', { state: 'thinking', taskLabel: 'Build API endpoints' }),
    agent('test-agent', { state: 'waiting_dependency', taskLabel: 'Depends on frontend-agent' }),
    agent('review-agent', { state: 'completed', taskLabel: 'Review changes' }),
  ]);

  it('[V02, V04, L01] substitutes ASCII roster chrome for unicode box glyphs in the same scenario', () => {
    const unicode = strip(paintRoster({ agents: asciiAgents(), selectedAgentId: 'backend-agent' }));
    const ascii = strip(paintRoster(
      { agents: asciiAgents(), selectedAgentId: 'backend-agent' },
      getWorkbenchPreviewTheme('truecolor', 'ascii'),
    ));
    expect(unicode).toMatch(UNICODE_ONLY);
    expect(ascii).not.toMatch(UNICODE_ONLY);
    expect(ascii).toContain('backend-agent RUNNING');
    expect(ascii).toContain('Up/Down select');
    expect(ascii).toMatch(/\+[-]+\+/u);
    expect(ascii).toContain('>* backend-agent');
  });

  it('[V01, V04, H01, F05] renders the CJK workspace path in the shell header and substitutes ASCII footer separators', () => {
    const unicode = strip(paintShell());
    const ascii = strip(paintShell(getWorkbenchPreviewTheme('truecolor', 'ascii')));
    expect(unicode).toContain('/workspace/projects/調査');
    expect(ascii).toContain('/workspace/projects/調査');
    expect(unicode).toContain('Tab views • Ctrl+O details');
    expect(ascii).toContain('Tab views . Ctrl+O details');
    expect(ascii).not.toMatch(UNICODE_ONLY);
    expect(ascii).toContain('ALiX WORKBENCH');
  });

  it('[V02, V03, T01] renders transcript toolbar separators per glyph capability', () => {
    const unicode = strip(paintToolbar(getWorkbenchPreviewTheme('truecolor', 'unicode')));
    const ascii = strip(paintToolbar(getWorkbenchPreviewTheme('truecolor', 'ascii')));
    expect(unicode).toContain('LIVE TRANSCRIPT');
    expect(unicode).toContain('•');
    expect(ascii).toContain('LIVE TRANSCRIPT');
    expect(ascii).not.toMatch(UNICODE_ONLY);
    expect(ascii).toContain(' . ');
  });

  it('[V02, V04, R01] follows glyph capability for the inspector outline', () => {
    const unicode = strip(paintInspector(getWorkbenchPreviewTheme('truecolor', 'unicode')));
    const ascii = strip(paintInspector(getWorkbenchPreviewTheme('truecolor', 'ascii')));
    expect(unicode).toMatch(UNICODE_ONLY);
    expect(ascii).not.toMatch(UNICODE_ONLY);
    expect(ascii).toContain('AGENT DETAILS');
    expect(ascii).toMatch(/\+[-]+\+/u);
  });

  it('[V01, V04] ansi16 and monochrome emit no truecolor sequences across painters', () => {
    for (const mode of ['ansi16', 'monochrome'] as const) {
      const theme = getWorkbenchPreviewTheme(mode, 'ascii');
      const frames = [
        paintRoster({ agents: asciiAgents(), selectedAgentId: 'backend-agent' }, theme),
        paintInspector(theme),
        paintToolbar(theme),
        paintShell(theme),
      ];
      for (const frame of frames) expect(frame, mode).not.toMatch(TRUECOLOR);
    }
    const ansi16 = paintRoster({ agents: asciiAgents() }, getWorkbenchPreviewTheme('ansi16', 'ascii'));
    expect(ansi16).toMatch(SGR_COLOR);
    const truecolor = paintRoster({ agents: asciiAgents() });
    expect(truecolor).toMatch(TRUECOLOR);
  });

  it('[V01, V04] monochrome theme-controlled painters emit no color sequences at all', () => {
    const theme = getWorkbenchPreviewTheme('monochrome', 'ascii');
    for (const frame of [
      paintRoster({ agents: asciiAgents(), selectedAgentId: 'backend-agent' }, theme),
      paintInspector(theme),
      paintToolbar(theme),
    ]) {
      expect(frame).not.toMatch(SGR_COLOR);
      expect(frame).not.toMatch(TRUECOLOR);
    }
  });
});

describe('Phase 10 non-TTY and terminal restoration', () => {
  it('[V03, Phase10.3] full-surface render is identical with stdout non-TTY', () => {
    const { state } = createWorkbenchRenderHarness(MIXED);
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-03T10:14:46.000Z'));
    const original = (process.stdout as { isTTY?: boolean }).isTTY;
    const render = (): string => {
      const canvas = new TerminalCanvas(200, 44);
      const perTab = createInitialPerTabState();
      new AgentView().render({
        canvas, snap: state.lastSnapshot!, dimensions: { columns: 200, rows: 44 },
        perTab, workbenchEnabled: true, workbenchUiState: createInitialWorkbenchUiState({ columns: 200, rows: 44 }),
        runtime: { agent: state.lastSnapshot!.runtime, chat: null },
      });
      return canvas.renderFrame();
    };
    try {
      (process.stdout as { isTTY?: boolean }).isTTY = true;
      const ttyFrame = render();
      (process.stdout as { isTTY?: boolean }).isTTY = false;
      const pipedFrame = render();
      expect(pipedFrame).toBe(ttyFrame);
      for (const row of rowsOf(pipedFrame)) expect(displayWidth(row)).toBeLessThanOrEqual(200);
      expect(rowsOf(pipedFrame).join('\n')).toContain('調査');
    } finally {
      (process.stdout as { isTTY?: boolean }).isTTY = original;
      now.mockRestore();
    }
  });

  it('[Phase10.3] round-trips alt-buffer, bracketed paste and cursor without touching raw mode when stdin is not a TTY', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const rawModeDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode');
    let rawModeCalls = 0;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdin, 'setRawMode', {
      value: () => { rawModeCalls += 1; return true; }, configurable: true, writable: true,
    });
    try {
      const control = createTerminalControl();
      control.enableTerminalModes();
      control.disableTerminalModes();
      const calls = writeSpy.mock.calls.map((call) => String(call[0]));
      const altOn = calls.indexOf('\x1b[?1049h');
      const altOff = calls.indexOf('\x1b[?1049l');
      const pasteOn = calls.indexOf('\x1b[?2004h');
      const pasteOff = calls.indexOf('\x1b[?2004l');
      expect(altOn).toBeGreaterThanOrEqual(0);
      expect(altOff).toBeGreaterThan(altOn);
      expect(pasteOn).toBeGreaterThanOrEqual(0);
      expect(pasteOff).toBeGreaterThan(pasteOn);
      expect(calls.slice(pasteOff)).toContain('\x1b[?25h');
      expect(rawModeCalls).toBe(0);
    } finally {
      writeSpy.mockRestore();
      if (isTTYDescriptor) Object.defineProperty(process.stdin, 'isTTY', isTTYDescriptor);
      else Reflect.deleteProperty(process.stdin, 'isTTY');
      if (rawModeDescriptor) Object.defineProperty(process.stdin, 'setRawMode', rawModeDescriptor);
      else Reflect.deleteProperty(process.stdin, 'setRawMode');
    }
  });
});
