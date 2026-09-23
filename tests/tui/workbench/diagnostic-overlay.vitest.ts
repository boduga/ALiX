import { describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import { buildWorkbenchDiagnosticLines, paintWorkbenchDiagnosticOverlay } from '../../../src/tui/workbench/views/diagnostic-overlay.js';

describe('Workbench diagnostic overlays', () => {
  it('renders projected patch activity for in-session review', () => {
    const canvas = new TerminalCanvas(100, 30);
    paintWorkbenchDiagnosticOverlay(
      { canvas, width: 100, height: 30, headerH: 3, footerH: 5 },
      'review',
      { filesChanged: 1, diffs: [{ id: 't1', toolCallId: 't1', changedFiles: ['src/app.ts'], status: 'applied', firstSequence: 1, lastSequence: 2 }] },
    );
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('REVIEW');
    expect(frame).toContain('1 files across 1 patch operations');
    expect(frame).toContain('src/app.ts');
    expect(frame).toContain('Review is read-only');
  });

  it('lists drawer slash commands in help', () => {
    const canvas = new TerminalCanvas(100, 30);
    paintWorkbenchDiagnosticOverlay(
      { canvas, width: 100, height: 30, headerH: 3, footerH: 5 },
      'help',
      null,
    );
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('Ctrl+R artifacts');
    expect(frame).toContain('/diagnostics · /diff · /review · /help');
  });

  it('correlates failures to the selected run and gives CLI-first recovery guidance', () => {
    const lines = buildWorkbenchDiagnosticLines({
      selectedRunId: 'run-1',
      agents: { agents: [
        { agentId: 'agent-1', coordinationRunId: 'run-1', role: 'worker', state: 'failed', ownedPaths: [], startedAt: 1, lastProgressAt: 2, usage: {} },
        { agentId: 'agent-2', coordinationRunId: 'run-2', role: 'worker', state: 'failed', ownedPaths: [], startedAt: 1, lastProgressAt: 2, usage: {} },
      ], active: 0, totals: { agents: 2, running: 0, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 } },
      tasks: { tasks: [
        { taskId: 'task-1', coordinationRunId: 'run-1', title: 'Merge report', state: 'blocked', blockReason: 'dependency_failed', ownedPaths: [], createdAt: 1, updatedAt: 2 },
      ], queued: 0, running: 0, blocked: 1 },
    });
    expect(lines.join('\n')).toContain('2 issues · run run-1');
    expect(lines.join('\n')).not.toContain('agent-2');
    expect(lines.join('\n')).toContain('Repair or replace the failed dependency');
    expect(lines.join('\n')).toContain('alix coordination resume run-1');
  });

  it('renders a healthy aggregate without inventing recovery work', () => {
    expect(buildWorkbenchDiagnosticLines({}).join('\n')).toContain('0 issues · all runs and agents');
  });
});
