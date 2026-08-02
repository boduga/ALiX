import { describe, it, expect } from 'vitest';
import { RuntimeView } from '../../../src/tui/views/runtime-view.js';
import { createInitialPerTabState, type PerTabState } from '../../../src/tui/state.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import type { ExecutionTraceEntry } from '../../../src/tui/runtime/execution-trace.js';

function makeTrace(): ExecutionTraceEntry[] {
  return [
    { id: 'tr-1', kind: 'tool', status: 'completed', title: 'tool.search', startedAt: 1, durationMs: 5, sourceEvents: { firstSequence: 1 } },
    { id: 'tr-2', kind: 'capability', status: 'completed', title: 'core.session.list', startedAt: 2, sourceEvents: { firstSequence: 2 } },
    { id: 'tr-3', kind: 'policy', status: 'completed', title: 'Policy decision', startedAt: 3, sourceEvents: { firstSequence: 3 } },
  ];
}

function render(perTab: PerTabState, trace: ExecutionTraceEntry[]): string {
  const canvas = new TerminalCanvas(80, 24);
  const snap = {
    generatedAt: 1,
    session: null,
    daemon: null,
    approvals: null,
    runtime: { trace, timeline: [], workflow: null, totalEventCount: trace.length, lastEventAt: 3, sessionId: 'chat-1', capabilities: null, metrics: null },
    sops: null,
    policy: null,
    cwd: '/workspace/test',
  };
  new RuntimeView().render({ snap, dimensions: { columns: 80, rows: 24 }, perTab, canvas });
  return canvas.renderFrame();
}

describe('RuntimeView', () => {
  it('renders the full execution trace by default (filter all)', () => {
    const frame = render(createInitialPerTabState(), makeTrace());
    expect(frame).toContain('tool.search');
    expect(frame).toContain('core.session.list');
    expect(frame).toContain('Policy decision');
  });

  it('renders only tool entries when the filter is tool', () => {
    const perTab: PerTabState = { ...createInitialPerTabState(), runtimeTraceFilter: 'tool' };
    const frame = render(perTab, makeTrace());
    expect(frame).toContain('tool.search');
    expect(frame).not.toContain('core.session.list');
    expect(frame).not.toContain('Policy decision');
  });

  it('renders only capability entries when the filter is capability', () => {
    const perTab: PerTabState = { ...createInitialPerTabState(), runtimeTraceFilter: 'capability' };
    const frame = render(perTab, makeTrace());
    expect(frame).not.toContain('tool.search');
    expect(frame).toContain('core.session.list');
    expect(frame).not.toContain('Policy decision');
  });

  it('keeps the summary header (events count) intact', () => {
    const frame = render(createInitialPerTabState(), makeTrace());
    expect(frame).toContain('events: 3');
  });

  it('renders current workflow state when available', () => {
    const view = new RuntimeView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, approvals: null, sops: null, policy: null,
      runtime: {
        trace: [],
        timeline: [],
        workflow: { name: 'research-and-implement', currentStep: 7, totalSteps: 12, startedAt: 1 },
        totalEventCount: 42,
        lastEventAt: 1,
        sessionId: 'chat-1',
        capabilities: null,
        metrics: null,
      },
      cwd: '/workspace/test',
    };
    const out = view.render({ snap, dimensions: { columns: 100, rows: 30 }, perTab: createInitialPerTabState() });
    expect(out.rows.some((r) => /research-and-implement/.test(r))).toBe(true);
    expect(out.rows.some((r) => /7\s*\/\s*12/.test(r))).toBe(true);
  });

  it('handleKey scrolls via ArrowDown/Up; search opens on /', () => {
    const view = new RuntimeView();
    const ctx = (perTabOverrides: Partial<PerTabState> = {}) => ({
      snap: {
        generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null,
        cwd: '/workspace/test',
      },
      dimensions: { columns: 80, rows: 24 },
      perTab: { ...createInitialPerTabState(), ...perTabOverrides },
    });
    expect(view.handleKey?.('ArrowDown', ctx({ cursor: 0 }))).toEqual({ type: 'moveCursor', cursor: 1, pinnedBottom: false });
    expect(view.handleKey?.('PageDown', ctx({ cursor: 0 }))).toEqual({ type: 'moveCursor', cursor: 10, pinnedBottom: false });
    expect(view.handleKey?.('Home', ctx({ cursor: 5 }))).toEqual({ type: 'moveCursor', cursor: 0, pinnedBottom: false });
    expect(view.handleKey?.('End', ctx({ cursor: 0 }))).toEqual({ type: 'moveCursor', cursor: 1000, pinnedBottom: false });
    expect(view.handleKey?.('Escape', ctx())).toEqual({ type: 'switchTab', tab: 'chat' });
    expect(view.handleKey?.('/', ctx())).toEqual({ type: 'scheduleRefresh' });
  });
});
