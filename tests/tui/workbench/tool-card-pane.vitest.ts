import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { AlixEvent } from '../../../src/runtime-state/events/types.js';
import { TerminalCanvas } from '../../../src/interfaces/tui/canvas.js';
import { stripAnsi } from '../../../src/interfaces/tui/box.js';
import { AgentView } from '../../../src/interfaces/tui/views/agent-view.js';
import { buildExecutionTrace } from '../../../src/interfaces/tui/runtime/execution-trace-builder.js';
import { createInitialPerTabState } from '../../../src/interfaces/tui/state.js';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';

it.each(['compact', 'detailed'] as const)('paints event-backed %s cards inside the wide transcript pane', mode => {
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/tui/workbench-preview-events.json', import.meta.url), 'utf8')) as { events: AlixEvent[] };
  const { state } = createWorkbenchRenderHarness();
  const runtime = { ...state.lastSnapshot!.runtime!, timeline: [],
    trace: buildExecutionTrace(fixture.events).filter(row => row.kind === 'tool' && row.status === 'completed') };
  const canvas = new TerminalCanvas(200, 44);
  const perTab = { ...createInitialPerTabState(), transcriptMode: mode };
  new AgentView().render({ canvas, snap: { ...state.lastSnapshot!, runtime }, dimensions: { columns: 200, rows: 44 },
    perTab, workbenchEnabled: true, workbenchUiState: createInitialWorkbenchUiState({ columns: 200, rows: 44 }),
    runtime: { agent: runtime, chat: null } });
  const rows = stripAnsi(canvas.renderFrame()).split('\n');
  const center = rows.map(row => row.slice(41, 159)).join('\n');
  expect(center).toContain('TOOL alix_file_read');
  expect(center).toContain('TOOL alix_patch_apply');
  expect(center).toContain('(142 lines)');
  expect(center).toContain('(287 lines)');
  expect(center).toContain('requested lines:');
  for (const row of rows) {
    expect(row.slice(0, 41)).not.toContain('TOOL');
    expect(row.slice(159)).not.toContain('TOOL');
  }
});
