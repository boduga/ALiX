import { describe, expect, it } from 'vitest';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';
import type { WorkbenchUiAction } from '../../../src/tui/workbench/model/ui-action.js';
import type { WorkbenchUiState } from '../../../src/tui/workbench/model/ui-state.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import { paintWorkbenchDiagnosticOverlay } from '../../../src/tui/workbench/views/diagnostic-overlay.js';

function harness() {
  const base = createWorkbenchRenderHarness();
  const internal = base.app as unknown as { handleWorkbenchAgentInput(key: string): boolean;
    workbenchStore: { dispatch(action: WorkbenchUiAction): void; snapshot(): WorkbenchUiState } };
  const agents = Array.from({ length: 12 }, (_, index) => ({ agentId: `worker-${index + 1}`, role: 'worker',
    coordinationRunId: index < 10 ? 'run-1' : 'run-2', state: 'thinking' as const,
    ownedPaths: [], startedAt: 1, lastProgressAt: 1, usage: {} }));
  const runtime = { ...base.state.lastSnapshot!.runtime!, agents: { agents, active: 12,
    totals: { agents: 12, running: 12, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 } } };
  base.state.lastSnapshot = { ...base.state.lastSnapshot!, runtime };
  return { ...base, internal, store: internal.workbenchStore };
}

describe('roster shortcuts at app boundary', () => {
  it('selects numbered execution IDs in run scope and resets aggregate', () => {
    const { internal, store } = harness();
    store.dispatch({ type: 'run.select', runId: 'run-2' });
    internal.handleWorkbenchAgentInput('Ctrl+a');
    internal.handleWorkbenchAgentInput('2');
    expect(store.snapshot().selectedAgentId).toBe('worker-12');
    internal.handleWorkbenchAgentInput('9');
    expect(store.snapshot().selectedAgentId).toBe('worker-12');
    internal.handleWorkbenchAgentInput('/');
    expect(store.snapshot().selectedAgentId).toBeUndefined();
    expect(store.snapshot().selectedRunId).toBe('run-2');
    expect(store.snapshot().composer.text).toBe('');
  });
  it('keeps workers beyond nine reachable with navigation', () => {
    const { internal, store } = harness();
    internal.handleWorkbenchAgentInput('Ctrl+a');
    internal.handleWorkbenchAgentInput('9');
    internal.handleWorkbenchAgentInput('ArrowDown');
    expect(store.snapshot().selectedAgentId).toBe('worker-10');
  });
  it('opens coordination objective without submitting or changing composer', () => {
    const { internal, store } = harness();
    store.dispatch({ type: 'composer.replace', text: 'keep instruction' });
    internal.handleWorkbenchAgentInput('Ctrl+a');
    internal.handleWorkbenchAgentInput('c');
    expect(store.snapshot().overlayStack).toEqual(['coordination']);
    expect(store.snapshot().composer.text).toBe('keep instruction');
    internal.handleWorkbenchAgentInput('Enter');
    expect(store.snapshot().overlayStack).toEqual(['coordination']);
    internal.handleWorkbenchAgentInput('Escape');
    expect(store.snapshot().overlayStack).toEqual([]);
    expect(store.snapshot().focus).toBe('drawer');
    internal.handleWorkbenchAgentInput('2');
    expect(store.snapshot().selectedAgentId).toBe('worker-2');
  });
  it('renders objective entry with truthful missing-runtime feedback', () => {
    const canvas = new TerminalCanvas(100, 30);
    paintWorkbenchDiagnosticOverlay({ canvas, width: 100, height: 30, headerH: 3, footerH: 1 }, 'coordination', null);
    const text = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(text).toContain('COORDINATION RUN');
    expect(text).toContain('Describe the coordinated work');
    expect(text).toContain('Launch requires a connected runtime session.');
  });
});
