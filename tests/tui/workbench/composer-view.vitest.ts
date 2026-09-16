import { describe, expect, it } from 'vitest';
import { layoutComposer } from '../../../src/tui/workbench/views/composer-view.js';

describe('layoutComposer', () => {
  it('preserves explicit newlines and reports the terminal cursor', () => {
    expect(layoutComposer('first\nsecond', 40)).toEqual({
      rows: ['first', 'second'], cursorRow: 1, cursorColumn: 6, hiddenRows: 0,
    });
  });

  it('wraps long input and retains only the newest bounded rows', () => {
    const layout = layoutComposer('abcdefghijkl', 8, 2);
    expect(layout.rows).toEqual(['efgh', 'ijkl']);
    expect(layout.hiddenRows).toBe(1);
    expect(layout.cursorRow).toBe(1);
    expect(layout.cursorColumn).toBe(4);
  });
});
