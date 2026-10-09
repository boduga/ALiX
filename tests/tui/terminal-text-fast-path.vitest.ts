import { expect, it } from 'vitest';
import { graphemes, displayWidth, wrapDisplayText } from '../../src/interfaces/tui/terminal-text.js';

it('avoids Unicode segmentation for printable ASCII while preserving complex clusters', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
  const Original = Intl.Segmenter;
  let calls = 0;
  Object.defineProperty(Intl, 'Segmenter', { ...descriptor, value: class extends Original {
    constructor() { super(undefined, { granularity: 'grapheme' }); calls++; }
  } });
  try {
    expect(graphemes('code path 123')).toEqual(Array.from('code path 123'));
    expect(displayWidth('code path 123')).toBe(13);
    expect(wrapDisplayText('abcd', 2)).toEqual(['ab', 'cd']);
    expect(calls).toBe(0);
    expect(graphemes('e\u0301👩‍💻\r\n界')).toEqual(['e\u0301', '👩‍💻', '\r\n', '界']);
    expect(calls).toBe(1);
  } finally { Object.defineProperty(Intl, 'Segmenter', descriptor); }
});
