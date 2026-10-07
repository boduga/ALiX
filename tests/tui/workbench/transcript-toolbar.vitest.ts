import { describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import { paintTranscriptToolbar } from '../../../src/tui/workbench/views/transcript-toolbar.js';
import { createInitialWorkbenchUiState } from '../../../src/tui/workbench/model/ui-state.js';
import { getWorkbenchPreviewTheme } from '../../../src/tui/workbench/model/preview-theme.js';

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/gu, '');
describe('transcript toolbar', () => {
  it('shows reference categories, independent scope, follow and focus guidance', () => {
    const canvas = new TerminalCanvas(120, 8);
    paintTranscriptToolbar(canvas, { x: 0, y: 3, width: 120, height: 3 }, {
      ...createInitialWorkbenchUiState(), selectedAgentId: 'frontend', transcriptFilter: 'tool',
      transcriptScope: 'all', followTail: false,
    }, 2);
    const frame = strip(canvas.renderFrame());
    for (const label of ['LIVE TRANSCRIPT', '(1 ALL)', '(2 RESPONSE)', '[3 TOOL]', '(4 ACTIVITY)', '(5 ERROR)', 'Auto-follow: OFF +2 new', 'All agents', 'Ctrl+F transcript']) expect(frame).toContain(label);
    expect(frame).not.toContain('Selected: frontend');
  });
  it('keeps selection readable without color', () => {
    const canvas = new TerminalCanvas(90, 6);
    paintTranscriptToolbar(canvas, { x: 0, y: 0, width: 90, height: 3 }, {
      ...createInitialWorkbenchUiState(), transcriptFilter: 'error', transcriptScope: 'selected', selectedAgentId: 'worker-2', focus: 'transcript',
    }, 0, getWorkbenchPreviewTheme('monochrome', 'ascii'));
    const frame = strip(canvas.renderFrame());
    expect(frame).toContain('[5 ERROR]');
    expect(frame).toContain('Selected: worker-2');
    expect(frame).toContain('1-5 filters');
  });
  it('prioritizes follow and new-item state on narrow surfaces', () => {
    const canvas = new TerminalCanvas(30, 6);
    paintTranscriptToolbar(canvas, { x: 0, y: 0, width: 30, height: 3 }, {
      ...createInitialWorkbenchUiState(), followTail: false, transcriptFilter: 'error', focus: 'transcript',
    }, 2);
    const frame = strip(canvas.renderFrame());
    expect(frame).toContain('Follow: OFF +2 new');
    expect(frame).toContain('[5E]');
    expect(frame).not.toContain('SCRIPT');
  });
  it.each([1, 4, 12, 38, 60])('clips writes to reserved region at width %i', width => {
    const canvas = new TerminalCanvas(width + 8, 6);
    paintTranscriptToolbar(canvas, { x: 3, y: 1, width, height: 2 }, createInitialWorkbenchUiState());
    const rows = strip(canvas.renderFrame()).split('\n').slice(0, 6);
    rows.forEach((row, index) => {
      expect(row.slice(0, 3).trim()).toBe('');
      expect(row.slice(3 + width).trim()).toBe('');
      if (index !== 1 && index !== 2) expect(row.trim()).toBe('');
    });
  });
});
