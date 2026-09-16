import { describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import { paintWorkbenchApprovalDialog } from '../../../src/tui/workbench/views/approval-dialog.js';

describe('Workbench approval dialog', () => {
  it('renders an exact pending operation and authoritative-resolution hint', () => {
    const canvas = new TerminalCanvas(80, 24);
    paintWorkbenchApprovalDialog(
      { canvas, width: 80, height: 24, headerH: 3, footerH: 5 },
      { id: 'approval-1', toolName: 'write_file', target: 'src/tui/app.ts', args: {}, requestedAt: 1, requestedBy: 'system' },
      2,
    );
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('APPROVAL REQUIRED · 1 OF 2');
    expect(frame).toContain('write_file · src/tui/app.ts');
    expect(frame).toContain('id approval-1');
    expect(frame).toContain('remains pending until runtime confirms');
  });

  it('does not render without an authoritative pending record', () => {
    const canvas = new TerminalCanvas(80, 24);
    paintWorkbenchApprovalDialog({ canvas, width: 80, height: 24, headerH: 3, footerH: 5 }, undefined, 0);
    expect(canvas.renderFrame()).not.toContain('APPROVAL REQUIRED');
  });
});
