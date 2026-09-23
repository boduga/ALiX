import { describe, expect, it } from 'vitest';
import { TerminalCanvas } from '../../src/tui/canvas.js';
import { displayWidth } from '../../src/tui/terminal-text.js';

describe('TerminalCanvas display-width alignment', () => {
  it('reserves terminal columns for wide graphemes', () => {
    const canvas = new TerminalCanvas(8, 1);
    canvas.write(0, 0, '調査');
    canvas.write(4, 0, 'OK');

    const row = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '').trimEnd();
    expect(row).toBe('調査OK');
    expect(displayWidth(row)).toBe(6);
  });

  it('keeps emoji sequences in one canvas cell span', () => {
    const canvas = new TerminalCanvas(6, 1);
    const emoji = '\u{1f469}\u200d\u{1f4bb}';
    canvas.write(0, 0, emoji);
    canvas.write(2, 0, 'X');

    const row = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '').trimEnd();
    expect(row).toBe(`${emoji}X`);
    expect(displayWidth(row)).toBe(3);
  });
});
