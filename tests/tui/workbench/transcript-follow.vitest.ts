import { afterEach, expect, it } from 'vitest';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';
import type { WorkbenchUiAction } from '../../../src/tui/workbench/model/ui-action.js';
import type { TimelineEntry } from '../../../src/tui/runtime/timeline-builder.js';

const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
const rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
afterEach(() => {
  if (columns) Object.defineProperty(process.stdout, 'columns', columns); else Reflect.deleteProperty(process.stdout, 'columns');
  if (rows) Object.defineProperty(process.stdout, 'rows', rows); else Reflect.deleteProperty(process.stdout, 'rows');
});
it('counts new semantic items once while paused and clears count on follow', () => {
  Object.defineProperty(process.stdout, 'columns', { value: 120, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true });
  const { app, state, paint } = createWorkbenchRenderHarness('long content '.repeat(8));
  const internal = app as unknown as {
    workbenchStore: { dispatch(action: WorkbenchUiAction): void };
    agentRuntime: { timeline: TimelineEntry[] };
    framePainter: { pausedTranscript: { appended: Set<string> } | null; scrollAnchor: { resolvedOffset: number; lines: { itemId?: string }[] } };
  };
  internal.workbenchStore.dispatch({ type: 'transcript.follow', followTail: false });
  state.views.agent.scrollOffset = 4;
  paint();
  const anchor = internal.framePainter.scrollAnchor.lines[internal.framePainter.scrollAnchor.resolvedOffset]!.itemId;
  const previous = internal.agentRuntime.timeline.at(-1)!;
  internal.agentRuntime.timeline.push({ ...previous, id: 'new-message', text: 'new response '.repeat(12), sourceEvents: { firstSequence: 9, lastSequence: 9 } });
  paint(); paint();
  expect(internal.framePainter.pausedTranscript!.appended.size).toBe(1);
  expect(internal.framePainter.scrollAnchor.lines[internal.framePainter.scrollAnchor.resolvedOffset]!.itemId).toBe(anchor);
  expect(state.views.agent.scrollOffset).toBe(4);
  internal.workbenchStore.dispatch({ type: 'agent.select', agentId: 'worker-inspection', scrollOffset: 0 });
  paint();
  expect(internal.framePainter.pausedTranscript!.appended.size).toBe(1);
  internal.workbenchStore.dispatch({ type: 'transcript.filter', filter: 'response' });
  paint();
  expect(internal.framePainter.scrollAnchor.lines[internal.framePainter.scrollAnchor.resolvedOffset]!.itemId).toBe(anchor);
  internal.workbenchStore.dispatch({ type: 'transcript.follow', followTail: true });
  paint();
  expect(internal.framePainter.pausedTranscript).toBeNull();
});
