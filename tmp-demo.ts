/**
 * Quick demo: render the AgentView with realistic sample data
 * to demonstrate all formatting kinds in a single frame.
 */
import { TerminalCanvas } from '../../src/tui/canvas.js';
import { AgentView } from '../../src/tui/views/agent-view.js';
import type { ViewRenderContext } from '../../src/tui/views/types.js';
import type { DashboardSnapshot, PerTabState } from '../../src/tui/state.js';

const snap: DashboardSnapshot = {
  version: 1, timestamp: Date.now(),
  session: { mode: 'auto', phase: 'Planning', version: '1.0.0' },
  runtime: { totalEventCount: 12, workflow: { currentStep: 2, totalSteps: 5 }, sessionId: 'demo', state: 'idle' },
  daemon: null,
  approvals: { pending: [{ id: 'ap_demo001', toolName: 'write_file', targetPath: 'src/server.ts', requestedAt: Date.now() }], recentlyResolved: [] },
  sops: null, policy: { rules: [] }, agents: {},
};

const perTab: PerTabState = {
  cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
  pinnedBottom: true, inputBuffer: '', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null,
  submittedPrompts: ['add error handling to the server'],
  agentResponses: ['Created src/server.ts with Express error middleware. Added try/catch around route handlers and a global error handler.'],
  planContent: '# Implementation Plan\n\n## Changes\n1. Add error middleware\n2. Wrap routes\n3. Add tests',
  planTasks: [
    { id: 's:t:1', index: 1, title: 'Add error middleware to server.ts', status: 'completed' },
    { id: 's:t:2', index: 2, title: 'Wrap route handlers in try/catch', status: 'in_progress' },
    { id: 's:t:3', index: 3, title: 'Add error handling tests', status: 'pending' },
  ],
  pendingApprovals: [
    { id: 'ap_demo001', toolName: 'write_file', target: 'src/server.ts', requestedAt: Date.now() },
  ],
  resolvedApprovals: [],
};

const W = 72, H = 22;
const canvas = new TerminalCanvas(W, H);

const view = new AgentView();
view.render({ snap, dimensions: { columns: W, rows: H }, perTab, canvas });

console.log('\n═══ Agent Tab — Demo Frame (72×22) ═══\n');
process.stdout.write(canvas.renderFrame());
console.log('═══ End Frame ═══\n');
