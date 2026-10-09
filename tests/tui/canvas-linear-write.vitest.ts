import { describe, expect, it, vi } from 'vitest';
import * as terminalText from '../../src/interfaces/tui/terminal-text.js';
import { TerminalCanvas } from '../../src/interfaces/tui/canvas.js';

describe('canvas single-pass text writes', () => {
  it('segments each styled run once rather than every shrinking suffix', () => {
    const spy = vi.spyOn(terminalText, 'graphemes');
    try {
      const canvas = new TerminalCanvas(200, 1);
      canvas.write(0, 0, `\x1b[36m${'界x'.repeat(60)}\x1b[0m OK`);
      expect(spy.mock.calls.reduce((total, [text]) => total + text.length, 0)).toBeLessThanOrEqual(123);
      expect(canvas.renderFrame()).toContain('OK');
    } finally { spy.mockRestore(); }
  });
  it('retains ANSI styles, combined emoji and negative/right clipping', () => {
    const canvas = new TerminalCanvas(8, 1);
    canvas.write(-1, 0, 'a\x1b[31me\u0301👩‍💻\x1b[0m界Z界');
    const frame = canvas.renderFrame();
    expect(frame.replace(/\x1b\[[0-9;]*m/gu, '').trimEnd()).toBe('e\u0301👩‍💻界Z界');
    expect(frame).toContain('\x1b[31me\u0301👩‍💻\x1b[0m界Z界');
  });
  it('does not split wide glyphs at the right edge and preserves foreground reset', () => {
    const canvas = new TerminalCanvas(4, 1);
    canvas.write(0, 0, '\x1b[31ma\x1b[39mb界');
    expect(canvas.renderFrame()).toBe('\x1b[31ma\x1b[0mb界\n');
    const clipped = new TerminalCanvas(2, 1);
    clipped.write(0, 0, 'a界');
    expect(clipped.renderFrame()).toBe('a \n');
  });
});
