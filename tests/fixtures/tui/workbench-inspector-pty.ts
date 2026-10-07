import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import type { AlixEvent } from '../../../src/events/types.js';
import { AgentRosterProjection } from '../../../src/tui/workbench/projections/agent-roster-projection.js';
import { TaskProjection } from '../../../src/tui/workbench/projections/task-projection.js';
import { ArtifactProjection } from '../../../src/tui/workbench/projections/artifact-projection.js';
import type { WorkbenchStore } from '../../../src/tui/workbench/app/workbench-store.js';
import { createWorkbenchRenderHarness } from './workbench-render-harness.js';

const fixture = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/tui/workbench-preview-events.json', import.meta.url), 'utf8')) as {
  events: AlixEvent[]; now: string; selectedAgentId: string;
};
const { app, output, state, paint } = createWorkbenchRenderHarness();
const agents = new AgentRosterProjection(); agents.update(fixture.events);
const tasks = new TaskProjection(); tasks.update(fixture.events);
const artifacts = new ArtifactProjection(); artifacts.update(fixture.events);
const runtime = { ...state.lastSnapshot!.runtime!, agents: agents.snapshot(Date.parse(fixture.now)),
  tasks: tasks.snapshot(), artifacts: artifacts.snapshot() };
state.lastSnapshot = { ...state.lastSnapshot!, generatedAt: Date.parse(fixture.now), runtime };
(app as unknown as { agentRuntime: typeof runtime }).agentRuntime = runtime;
(app as unknown as { workbenchStore: WorkbenchStore }).workbenchStore.dispatch({ type: 'agent.select', agentId: fixture.selectedAgentId, scrollOffset: 0 });

function render(): void {
  output.writes.length = 0;
  paint();
  const frame = output.writes.join('');
  if (process.stdout.columns >= 160 && process.stdout.rows >= 36) {
    for (const label of ['AGENT DETAILS', 'LIVE ACTIVITY', 'APPROVALS', 'ARTIFACTS', 'USAGE', 'frontend-agent']) assert.ok(frame.includes(label), `Missing ${label}`);
  }
  assert.equal(app.getWorkbenchStateForTest().selectedAgentId, fixture.selectedAgentId);
  process.stdout.write(frame);
  process.stdout.write(`\r\n__FRAME__${process.stdout.columns}x${process.stdout.rows}__\r\n`);
}
process.stdout.on('resize', render);
process.stdin.setRawMode(true);
process.stdin.on('data', () => { process.stdin.setRawMode(false); process.exit(0); });
render();
