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

  it('follows a cursor positioned inside wrapped Unicode input', () => {
    const emoji = `\u{1f469}\u200d\u{1f4bb}`;
    const text = `abcd${emoji}efghijkl`;
    const cursor = `abcd${emoji}`.length;
    const layout = layoutComposer(text, 8, 2, cursor);

    expect(layout.rows).toEqual(['abcd', `${emoji}ef`]);
    expect(layout.hiddenRows).toBe(0);
    expect(layout.cursorRow).toBe(1);
    expect(layout.cursorColumn).toBe(2);
  });

  it('reveals an earlier cursor row instead of forcing the newest rows', () => {
    const layout = layoutComposer('abcdefghijkl', 8, 2, 2);
    expect(layout.rows).toEqual(['abcd', 'efgh']);
    expect(layout.hiddenRows).toBe(0);
    expect(layout.cursorRow).toBe(0);
    expect(layout.cursorColumn).toBe(2);
  });
});
