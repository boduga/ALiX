export interface TerminalControl {
  enterRawMode(): void;
  exitRawMode(): void;
  showCursor(visible: boolean): void;
  enterAltBuffer(): void;
  exitAltBuffer(): void;
  onResize(cb: () => void): () => void;
  installEmergencyCleanup(cleanup: () => void): () => void;
}

let resizeCb: (() => void) | null = null;
const cleanupFns: Array<() => void> = [];

export function createTerminalControl(): TerminalControl {
  return {
    enterRawMode() {
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
    },
    exitRawMode() {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    },
    showCursor(visible: boolean) {
      process.stdout.write(visible ? '\x1b[?25h' : '\x1b[?25l');
    },
    enterAltBuffer() {
      // Set ALIX_TUI_ALT_BUFFER=1 to take over the terminal with the
      // private alt-buffer mode. Default OFF — runs in the regular
      // scrollback so the user can highlight and copy rendered text
      // with the terminal's normal mouse selection.
      if (process.env.ALIX_TUI_ALT_BUFFER === '1') {
        process.stdout.write('\x1b[?1049h');
      }
    },
    exitAltBuffer() {
      if (process.env.ALIX_TUI_ALT_BUFFER === '1') {
        process.stdout.write('\x1b[?1049l');
      }
    },
    onResize(cb: () => void) {
      resizeCb = cb;
      process.stdout.on('resize', cb);
      return () => {
        if (resizeCb) process.stdout.off('resize', cb);
        resizeCb = null;
      };
    },
    installEmergencyCleanup(cleanup: () => void) {
      // 'exit' handler only does cleanup — never calls process.exit() since
      // the process is already winding down (calling exit again re-fires the
      // event and creates an infinite loop, which Node warns about).
      const exitHandler = () => { try { cleanup(); } catch { /* ignore */ } };
      // Signal handlers run cleanup, then exit unconditionally so the process
      // terminates immediately (default SIGINT/SIGTERM behaviour would also
      // fire 'exit' normally, but our handler traps it first).
      const signalHandler = () => {
        try { cleanup(); } catch { /* ignore */ }
        process.exit(130);
      };
      process.on('exit', exitHandler);
      process.on('SIGINT', signalHandler);
      process.on('SIGTERM', signalHandler);
      cleanupFns.push(() => process.off('exit', exitHandler));
      return () => {
        process.off('SIGINT', signalHandler);
        process.off('SIGTERM', signalHandler);
      };
    },
  };
}
