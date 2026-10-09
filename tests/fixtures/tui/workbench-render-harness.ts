import { TuiApp, type TuiAppOptions } from '../../../src/interfaces/tui/app.js';
import { MockInput, MockOutput } from '../../../src/interfaces/tui/io.js';
import type { DashboardSnapshot } from '../../../src/interfaces/tui/snapshot.js';
import { SessionPhase } from '../../../src/interfaces/tui/state.js';
import type { TimelineEntry } from '../../../src/interfaces/tui/runtime/timeline-builder.js';

export function createWorkbenchRenderHarness(text = 'pane transcript') {
  const timeline: TimelineEntry[] = Array.from({ length: 8 }, (_, index) => ({
    id: `message-${index}`, kind: 'agent.message', actor: 'assistant', sessionId: 'test',
    text: `${index}: ${text}`, startedAt: index * 1000,
    sourceEvents: { firstSequence: index + 1, lastSequence: index + 1 },
  }));
  const runtime = { trace: [], timeline, workflow: null, totalEventCount: 8,
    lastEventAt: null, sessionId: 'test', capabilities: null, metrics: null, context: null };
  const snapshot = { generatedAt: 1,
    session: { mode: 'auto', phase: SessionPhase.Idle, version: 'test', startedAt: 1, turns: 0, filesTouched: 0 },
    daemon: null, approvals: null, runtime, sops: null, policy: null, cwd: '/workspace',
  } as DashboardSnapshot;
  const output = new MockOutput();
  const app = new TuiApp({ builder: { build: async () => snapshot, buildSync: () => snapshot },
    daemonMetrics: { start: () => {}, stop: async () => {} }, input: new MockInput(), output, workbenchEnabled: true,
  } as unknown as TuiAppOptions);
  const state = app.getStateForTest();
  state.lastSnapshot = snapshot;
  state.activeTab = 'agent';
  // FramePainter reads the agent collector independently of the outer snapshot.
  const internal = app as unknown as { agentRuntime: typeof runtime; paintFullFrame(): void };
  internal.agentRuntime = runtime;
  return { app, output, state, paint: () => internal.paintFullFrame() };
}
