import { describe, it, expect } from 'vitest';
import { wrapText } from '../../../src/tui/views/wrap-text.js';

describe('wrapText', () => {
  it('returns a single line for text that fits in width', () => {
    expect(wrapText('hello world', 20)).toEqual(['hello world']);
  });

  it('wraps on whitespace when text exceeds width', () => {
    expect(wrapText('the quick brown fox jumps', 10)).toEqual([
      'the quick',
      'brown fox',
      'jumps',
    ]);
  });

  it('hard-truncates a single word longer than width', () => {
    expect(wrapText('supercalifragilistic', 8)).toEqual(['supercali']);
  });

  it('returns a single empty string for empty input', () => {
    expect(wrapText('', 20)).toEqual(['']);
  });

  it('returns a single empty string when width <= 0', () => {
    expect(wrapText('hi', 0)).toEqual(['']);
    expect(wrapText('hi', -3)).toEqual(['']);
  });

  it('collapses runs of whitespace', () => {
    expect(wrapText('a   b   c', 6)).toEqual(['a b c']);
  });

  it('keeps each wrapped line <= width', () => {
    const lines = wrapText(
      'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua',
      20,
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) {
      expect(l.length).toBeLessThanOrEqual(20);
    }
  });
});
