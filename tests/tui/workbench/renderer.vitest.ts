import { describe, expect, it } from 'vitest';
import { layoutComposer } from '../../../src/tui/workbench/views/composer-view.js';
import { diffFrameRows, renderFramePatches } from '../../../src/tui/workbench/render/frame-differ.js';
import { displayWidth, graphemes } from '../../../src/tui/workbench/render/terminal-text.js';

describe('Workbench renderer primitives', () => {
  it('emits only changed rows after the first frame', () => {
    expect(diffFrameRows('one\ntwo\n', 'one\nTWO\n')).toEqual([{ row: 1, text: 'TWO' }]);
    expect(renderFramePatches([{ row: 1, text: 'TWO' }])).toBe('\x1b[2;1H\x1b[2KTWO');
    expect(diffFrameRows('same\n', 'same\n')).toEqual([]);
  });

  it('uses grapheme display width for composer wrapping and cursor placement', () => {
    expect(graphemes('A👩‍💻e\u0301')).toEqual(['A', '👩‍💻', 'e\u0301']);
    expect(displayWidth('A👩‍💻e\u0301')).toBe(4);
    const layout = layoutComposer('123456👩‍💻', 10);
    expect(layout.rows).toEqual(['123456', '👩‍💻']);
    expect(layout.cursorColumn).toBe(2);
  });
});
