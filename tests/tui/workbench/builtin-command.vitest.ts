import { describe, expect, it } from 'vitest';
import { parseWorkbenchBuiltinCommand } from '../../../src/tui/workbench/input/builtin-command.js';

describe('Workbench built-in commands', () => {
  it.each([
    ['/agents', { type: 'drawer.open', drawer: 'agents' }],
    ['/tasks', { type: 'drawer.open', drawer: 'tasks' }],
    ['/diff', { type: 'overlay.open', overlay: 'diff' }],
    ['/review', { type: 'overlay.open', overlay: 'review' }],
    ['/help', { type: 'overlay.open', overlay: 'help' }],
    ['/?', { type: 'overlay.open', overlay: 'help' }],
  ] as const)('parses %s', (input, expected) => {
    expect(parseWorkbenchBuiltinCommand(input)).toEqual(expected);
  });

  it('normalizes surrounding whitespace and case', () => {
    expect(parseWorkbenchBuiltinCommand('  /AGENTS  ')).toEqual({ type: 'drawer.open', drawer: 'agents' });
  });

  it.each(['/agents now', '/tasks/active', '/unknown', 'agents'])('rejects non-exact command %s', (input) => {
    expect(parseWorkbenchBuiltinCommand(input)).toBeNull();
  });
});
