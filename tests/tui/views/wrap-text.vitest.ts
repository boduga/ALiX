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
    // Plain-text truncation: no active formatting, so no reset is appended.
    expect(wrapText('supercalifragilistic', 8)).toEqual(['supercal']);
  });

  it('appends ANSI reset only when truncating a line with active formatting', () => {
    // Truncated text with active red foreground: reset is appended.
    const red = '\x1b[31m';
    const reset = '\x1b[0m';
    expect(wrapText(`${red}supercalifragilistic${reset}`, 8)).toEqual([
      `${red}supercal${reset}`,
    ]);
  });

  it('does not append reset when truncating a line that already reset formatting', () => {
    // Reset is already present; truncating after it doesn't add another.
    const red = '\x1b[31m';
    const reset = '\x1b[0m';
    expect(wrapText(`${red}supercalifragilistic${reset}`, 8)).toEqual([
      `${red}supercal${reset}`,
    ]);
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

  // ── Newline preservation (the primary feature) ─────────────────

  it('preserves newlines — splits text on \\n into separate output lines', () => {
    // Regression test for the original bug: multi-line content (e.g. a
    // fenced code block) was collapsing to a single line. After the
    // fix, each newline in the input becomes a separate output line.
    expect(wrapText('line1\nline2', 80)).toEqual(['line1', 'line2']);
  });

  it('preserves blank lines between content lines', () => {
    expect(wrapText('a\n\nb', 80)).toEqual(['a', '', 'b']);
  });

  it('preserves trailing newline (empty last line)', () => {
    expect(wrapText('a\n', 80)).toEqual(['a', '']);
  });

  it('wraps each newline-separated paragraph independently', () => {
    expect(wrapText('aaa bbb ccc\nddd eee fff', 5)).toEqual([
      'aaa',
      'bbb',
      'ccc',
      'ddd',
      'eee',
      'fff',
    ]);
  });

  it('normalizes CRLF to LF on read', () => {
    // CRLF input should produce the same output as LF input.
    expect(wrapText('line1\r\nline2', 80)).toEqual(['line1', 'line2']);
  });

  it('normalizes bare CR to LF', () => {
    // Old-Mac-style line endings also normalize.
    expect(wrapText('line1\rline2', 80)).toEqual(['line1', 'line2']);
  });

  it('preserves CRLF blank lines (without losing them)', () => {
    // Regression for the CRLF blank-line bug: splitting "\r\n" on \n
    // used to leave a truthy "\r" that the whitespace splitter dropped.
    expect(wrapText('a\r\n\r\nb', 80)).toEqual(['a', '', 'b']);
  });
});
