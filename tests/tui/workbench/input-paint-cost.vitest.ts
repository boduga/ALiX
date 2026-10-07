import { expect, it, vi } from 'vitest';
import * as terminalText from '../../../src/tui/terminal-text.js';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';

it('paints a raw keystroke without quadratic grapheme work', () => {
  const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  const rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  const spy = vi.spyOn(terminalText, 'graphemes');
  try {
    Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 44, configurable: true });
    const { app, output } = createWorkbenchRenderHarness();
    (app as unknown as { handleRaw(bytes: Buffer): void }).handleRaw(Buffer.from('x'));
    expect(app.getWorkbenchStateForTest().composer.text).toBe('x');
    expect(output.writes.join('')).toContain('x');
    // Count actual work rather than machine-dependent milliseconds. This
    // covers production raw input, renderer composition and canvas writes.
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.reduce((total, [text]) => total + text.length, 0)).toBeLessThan(150000);
  } finally {
    spy.mockRestore();
    if (columns) Object.defineProperty(process.stdout, 'columns', columns);
    else Reflect.deleteProperty(process.stdout, 'columns');
    if (rows) Object.defineProperty(process.stdout, 'rows', rows);
    else Reflect.deleteProperty(process.stdout, 'rows');
  }
});
