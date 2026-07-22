import { describe, it, expect, vi } from 'vitest';
import { createTerminalControl } from '../../src/tui/terminal-control.js';

describe('TerminalControl', () => {
  it('write sends data to stdout', () => {
    const tc = createTerminalControl();
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    tc.write('hello');
    expect(spy).toHaveBeenCalledWith('hello');
    spy.mockRestore();
  });

  it('setCursor writes ANSI cursor position', () => {
    const tc = createTerminalControl();
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    tc.setCursor(5, 10);
    expect(spy).toHaveBeenCalledWith('\x1b[5;10H');
    spy.mockRestore();
  });
});
