import { describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../../src/interfaces/tui/canvas.js';
import { paintOperatorShell } from '../../../src/interfaces/tui/workbench/views/operator-shell.js';
import { diffFrameRows } from '../../../src/interfaces/tui/workbench/render/frame-differ.js';
import type { OperatorShellSnapshot } from '../../../src/interfaces/tui/workbench/model/operator-shell.js';

const model: OperatorShellSnapshot = {
  workspace: '/workspace/ALiX', mode: 'ask', transcriptMode: 'compact', running: true,
  tokensUsed: 7352, filesTouched: 2, eventCount: 80, queuedMessages: 0,
  agents: { total: 4, active: 3, running: 3, waitingApproval: 0, stalled: 0, costCoverage: 0 },
};
function render(snapshot: OperatorShellSnapshot): string {
  const canvas = new TerminalCanvas(200, 44);
  paintOperatorShell({ canvas, width: 200, height: 44, model: snapshot });
  return canvas.renderFrame();
}

describe('preview chrome updates', () => {
  it('stable facts on clock repaint produce no changed rows', () => {
    expect(diffFrameRows(render(model), render({ ...model }))).toEqual([]);
  });
  it('counter updates repaint only footer', () => {
    expect(diffFrameRows(render(model), render({ ...model, eventCount: 81 })).map(p => p.row)).toEqual([43]);
  });
  it('lifecycle totals repaint header without clearing body', () => {
    const completed = { ...model, agents: { ...model.agents!, running: 2, active: 2 } };
    expect(diffFrameRows(render(model), render(completed)).map(p => p.row)).toEqual([0]);
  });
});
