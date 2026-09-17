import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTerminalControl, captureStderr, releaseStderr } from '../../src/tui/terminal-control.js';

describe('TerminalControl — mode management', () => {
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('enableTerminalModes enters alt buffer, enables bracketed paste, hides cursor, stops blink', () => {
    const tc = createTerminalControl();
    tc.enableTerminalModes();
    const calls = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Order from the spec: alt buffer → show cursor → raw mode → bracketed paste → stop blink
    // showCursor(true) -> '\x1b[?25h', enterAltBuffer -> '\x1b[?1049h', enterRawMode doesn't write
    // bracketed paste on -> '\x1b[?2004h', stop blink -> '\x1b[?12l'
    expect(calls[0]).toBe('\x1b[?1049h');   // enterAltBuffer
    expect(calls[1]).toBe('\x1b[?25h');      // showCursor(true)
    expect(calls[2]).toBe('\x1b[?2004h');    // bracketed paste mode
    expect(calls[3]).toBe('\x1b[?12l');      // stop cursor blink
    expect(calls.length).toBe(4);
  });

  it('disableTerminalModes runs even when enableTerminalModes was not called', () => {
    const tc = createTerminalControl();
    expect(() => tc.disableTerminalModes()).not.toThrow();
  });

  it('disableTerminalModes disables bracketed paste, shows cursor, exits raw and alt buffer', () => {
    const tc = createTerminalControl();
    tc.disableTerminalModes();
    const calls = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Order: disable bracketed paste → show cursor → exit raw mode → exit alt buffer
    expect(calls[0]).toBe('\x1b[?2004l');   // disable bracketed paste
    expect(calls[1]).toBe('\x1b[?25h');      // showCursor(true)
    expect(calls[2]).toBe('\x1b[?1049l');    // exitAltBuffer
    expect(calls.length).toBe(3);
  });
});

describe('TerminalControl — stderr capture', () => {
  let origWrite: typeof process.stderr.write;
  let origIsTTY: unknown;

  beforeEach(() => {
    origWrite = process.stderr.write;
    origIsTTY = (process.stderr as unknown as { isTTY?: unknown }).isTTY;
  });

  afterEach(() => {
    releaseStderr();
    process.stderr.write = origWrite;
    (process.stderr as unknown as { isTTY?: unknown }).isTTY = origIsTTY;
  });

  it('buffers stderr while captured and replays it on release', () => {
    (process.stderr as unknown as { isTTY?: unknown }).isTTY = true;
    const seen: string[] = [];
    process.stderr.write = ((chunk: unknown) => {
      seen.push(String(chunk));
      return true;
    }) as unknown as typeof process.stderr.write;
    captureStderr();
    process.stderr.write('[Config WARN] something\n');
    expect(seen).toEqual([]);
    releaseStderr();
    expect(seen.join('')).toBe('[Config WARN] something\n');
  });

  it('bounds captured stderr, retains the newest diagnostics, and reports omitted characters', () => {
    (process.stderr as unknown as { isTTY?: unknown }).isTTY = true;
    const seen: string[] = [];
    process.stderr.write = ((chunk: unknown) => {
      seen.push(String(chunk));
      return true;
    }) as unknown as typeof process.stderr.write;

    captureStderr();
    process.stderr.write('a'.repeat(40 * 1024));
    process.stderr.write('latest diagnostic\n');
    releaseStderr();

    const replayed = seen.join('');
    expect(replayed).toMatch(/^\[alix-tui\] stderr truncated: \d+ characters omitted;/);
    expect(replayed).toContain('showing the most recent 32768.');
    expect(replayed.endsWith('latest diagnostic\n')).toBe(true);
    expect(replayed.length).toBeLessThan(34 * 1024);
  });

  it('is a no-op when stderr is not a TTY', () => {
    (process.stderr as unknown as { isTTY?: unknown }).isTTY = false;
    const seen: string[] = [];
    process.stderr.write = ((chunk: unknown) => {
      seen.push(String(chunk));
      return true;
    }) as unknown as typeof process.stderr.write;
    captureStderr();
    process.stderr.write('direct\n');
    expect(seen).toEqual(['direct\n']);
    releaseStderr();
  });

  it('release without capture does not throw', () => {
    expect(() => releaseStderr()).not.toThrow();
  });

  it('a second capture while captured is idempotent', () => {
    (process.stderr as unknown as { isTTY?: unknown }).isTTY = true;
    captureStderr();
    captureStderr();
    process.stderr.write('x\n');
    releaseStderr();
    releaseStderr();
  });

  it('invokes write callbacks', async () => {
    (process.stderr as unknown as { isTTY?: unknown }).isTTY = true;
    captureStderr();
    let called = false;
    process.stderr.write('x', () => {
      called = true;
    });
    await Promise.resolve();
    expect(called).toBe(true);
    releaseStderr();
  });
});
