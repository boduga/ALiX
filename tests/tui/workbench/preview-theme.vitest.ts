import { describe, expect, it } from 'vitest';
import { getWorkbenchAgentPresentation, getWorkbenchPreviewTheme } from '../../../src/interfaces/tui/workbench/model/preview-theme.js';
import type { WorkbenchAgentState } from '../../../src/interfaces/tui/workbench/model/agent-roster.js';
import { displayWidth } from '../../../src/interfaces/tui/terminal-text.js';

describe('Workbench preview accessibility', () => {
  const states: readonly [WorkbenchAgentState, string][] = [
    ['queued', 'QUEUED'], ['starting', 'STARTING'], ['thinking', 'RUNNING'],
    ['tool_running', 'RUNNING'], ['waiting', 'WAITING'], ['waiting_approval', 'APPROVAL'],
    ['waiting_dependency', 'WAITING'], ['verifying', 'VERIFYING'], ['completed', 'COMPLETED'],
    ['partial', 'PARTIAL'], ['failed', 'FAILED'], ['cancelling', 'CANCELLING'], ['cancelled', 'CANCELLED'],
  ];

  it.each(states)('keeps %s explicit without color or Unicode', (state, label) => {
    const presentation = getWorkbenchAgentPresentation(state, getWorkbenchPreviewTheme('monochrome', 'ascii'));
    expect(presentation.label).toBe(label);
    expect(presentation.color).toBe('');
    expect(presentation.glyph).toMatch(/^[\x20-\x7e]$/);
  });

  it.each(['unicode', 'ascii'] as const)('reserves one cell per %s chrome glyph', (mode) => {
    const { glyphs } = getWorkbenchPreviewTheme('monochrome', mode);
    for (const glyph of Object.values(glyphs)) expect(displayWidth(glyph)).toBe(1);
  });

  it('never emits extended-color sequences in ANSI-16 mode', () => {
    const { palette } = getWorkbenchPreviewTheme('ansi16');
    for (const prefix of Object.values(palette)) {
      expect(prefix).toMatch(/^\x1b\[\d+m$/);
      expect(prefix).not.toContain(';');
    }
  });

  it('emits no styling in monochrome mode', () => {
    expect(Object.values(getWorkbenchPreviewTheme('monochrome').palette).every(prefix => prefix === '')).toBe(true);
  });

  it('keeps cancellation, failure and completion distinct in every color mode', () => {
    for (const mode of ['truecolor', 'ansi16', 'monochrome'] as const) {
      const theme = getWorkbenchPreviewTheme(mode, 'ascii');
      const presentations = (['cancelled', 'failed', 'completed'] as const).map(state => getWorkbenchAgentPresentation(state, theme));
      expect(new Set(presentations.map(value => value.label)).size).toBe(3);
      expect(new Set(presentations.map(value => value.glyph)).size).toBe(3);
    }
  });
});
