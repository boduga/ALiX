import { describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import { paintWorkbenchDiagnosticOverlay } from '../../../src/tui/workbench/views/diagnostic-overlay.js';

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
    expect(frame).toContain('/agents · /tasks · /artifacts · /diff · /review · /help');
  });
});
