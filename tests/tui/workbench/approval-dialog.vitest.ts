import { describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import {
  buildWorkbenchApprovalCardLines,
  paintWorkbenchApprovalDialog,
} from '../../../src/tui/workbench/views/approval-dialog.js';

describe('Workbench approval dialog', () => {
  it('renders an exact pending operation and authoritative-resolution hint', () => {
    const canvas = new TerminalCanvas(80, 24);
    paintWorkbenchApprovalDialog(
      { canvas, width: 80, height: 24, headerH: 3, footerH: 5 },
      { id: 'approval-1', toolName: 'write_file', target: 'src/tui/app.ts', args: {}, requestedAt: 1, requestedBy: 'system' },
      2,
      60_001,
    );
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('APPROVAL REQUIRED · write_file · 1 OF 2');
    expect(frame).toContain('src/tui/app.ts');
    expect(frame).toContain('pending · id approval-1');
    expect(frame).toContain('a approve · d deny');
    expect(frame).toContain('Ctrl+O details');
    expect(frame).toContain('remains pending until runtime confirms');
  });

  it('bounds a long command target inside the dialog', () => {
    const canvas = new TerminalCanvas(64, 24);
    const target = `for b in llama-cli llama-server main; do command -v "$b"; done ${'x'.repeat(100)}`;
    paintWorkbenchApprovalDialog(
      { canvas, width: 64, height: 24, headerH: 3, footerH: 5 },
      { id: 'approval-2', toolName: 'shell.run', target, args: {}, requestedAt: 1, requestedBy: 'system' },
      1,
    );
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('APPROVAL REQUIRED · shell.run');
    expect(frame).toContain('for b in llama-cli');
    expect(frame).toContain('…');
    expect(frame).not.toContain(target);
  });

  it('bounds the title on a narrow terminal', () => {
    const canvas = new TerminalCanvas(30, 18);
    paintWorkbenchApprovalDialog(
      { canvas, width: 30, height: 18, headerH: 3, footerH: 5 },
      { id: 'approval-3', toolName: 'very.long.tool.name', target: 'target', args: {}, requestedAt: 1, requestedBy: 'system' },
      4,
    );
    const rows = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '').split('\n');
    expect(rows.every((row) => row.length <= 30)).toBe(true);
    expect(rows.join('\n')).toContain('APPROVAL REQUIRED');
  });

  it('does not render without an authoritative pending record', () => {
    const canvas = new TerminalCanvas(80, 24);
    paintWorkbenchApprovalDialog({ canvas, width: 80, height: 24, headerH: 3, footerH: 5 }, undefined, 0);
    expect(canvas.renderFrame()).not.toContain('APPROVAL REQUIRED');
  });

  it('shares the exact bounded card rows with inline transcript rendering', () => {
    const approval = {
      id: 'approval-shared', toolName: 'shell.run', target: 'pnpm vitest run tests/tui',
      args: {}, requestedAt: 1, requestedBy: 'system',
    };
    const canvas = new TerminalCanvas(80, 24);
    paintWorkbenchApprovalDialog(
      { canvas, width: 80, height: 24, headerH: 3, footerH: 5 },
      approval,
      1,
      5_001,
    );
    const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
    const lines = buildWorkbenchApprovalCardLines(approval, 1, 76, 5_001);

    expect(lines).toHaveLength(6);
    for (const line of lines) expect(frame).toContain(line);
  });
});
