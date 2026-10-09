import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import type { AlixEvent } from '../../../src/runtime-state/events/types.js';
import { buildExecutionTrace } from '../../../src/interfaces/tui/runtime/execution-trace-builder.js';
import { createWorkbenchRenderHarness } from './workbench-render-harness.js';

const fixture = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/tui/workbench-preview-events.json', import.meta.url), 'utf8')) as { events: AlixEvent[] };
const { app, output, state, paint } = createWorkbenchRenderHarness();
const runtime = { ...state.lastSnapshot!.runtime!, timeline: [], trace: buildExecutionTrace(fixture.events) };
state.lastSnapshot = { ...state.lastSnapshot!, runtime };
(app as unknown as { agentRuntime: typeof runtime }).agentRuntime = runtime;

function render(): void {
  output.writes.length = 0;
  paint();
  const frame = output.writes.join('');
  if (process.stdout.columns >= 120 && process.stdout.rows >= 24) {
    assert.match(frame, /TOOL/);
    assert.match(frame, /running/);
  }
  process.stdout.write(frame);
  process.stdout.write(`\r\n__FRAME__${process.stdout.columns}x${process.stdout.rows}__\r\n`);
}
process.stdout.on('resize', render);
process.stdin.setRawMode(true);
process.stdin.on('data', () => { process.stdin.setRawMode(false); process.exit(0); });
render();
