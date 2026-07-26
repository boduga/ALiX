import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTerminalControl } from '../../src/tui/terminal-control.js';

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
