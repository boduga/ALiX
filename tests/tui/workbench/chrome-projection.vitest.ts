import { describe, expect, it } from 'vitest';
import { createInitialPerTabState, SessionPhase } from '../../../src/interfaces/tui/state.js';
import { projectOperatorShell } from '../../../src/interfaces/tui/workbench/model/operator-shell.js';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';

describe('preview chrome facts', () => {
  it('keeps absent metrics unknown and explicit zero known', () => {
    const { state } = createWorkbenchRenderHarness();
    const snapshot = state.lastSnapshot!;
    const model = projectOperatorShell(snapshot, createInitialPerTabState());
    expect(model.tokensUsed).toBeUndefined();
    expect(model.filesTouched).toBe(0);
    expect(model.eventCount).toBe(8);
    const absent = projectOperatorShell({ ...snapshot, session: null, runtime: null }, createInitialPerTabState());
    expect(absent.tokensUsed).toBeUndefined();
    expect(absent.filesTouched).toBeUndefined();
    expect(absent.eventCount).toBeUndefined();
  });

  it.each([
    [SessionPhase.Idle, false, 'none'],
    [SessionPhase.Idle, true, 'close'],
    [SessionPhase.Executing, false, 'cancel'],
    [SessionPhase.Executing, true, 'close'],
  ] as const)('projects Escape for phase %s and open surface %s', (phase, closeSurface, expected) => {
    const { state } = createWorkbenchRenderHarness();
    const snapshot = { ...state.lastSnapshot!, session: { ...state.lastSnapshot!.session!, phase } };
    expect(projectOperatorShell(snapshot, createInitialPerTabState(), 'ask', 2, { closeSurface }).escapeAction).toBe(expected);
  });

  it('uses live mode and labels demo only on explicit opt-in', () => {
    const { state } = createWorkbenchRenderHarness();
    const perTab = createInitialPerTabState();
    expect(projectOperatorShell(state.lastSnapshot!, perTab, 'bypass').mode).toBe('bypass');
    expect(projectOperatorShell(state.lastSnapshot!, perTab).demo).toBeUndefined();
    expect(projectOperatorShell(state.lastSnapshot!, perTab, undefined, 0, { demo: true }).demo).toBe(true);
  });
});
