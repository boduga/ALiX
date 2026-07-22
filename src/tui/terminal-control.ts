export interface TerminalControl {
  enterRawMode(): void;
  exitRawMode(): void;
  showCursor(visible: boolean): void;
  enterAltBuffer(): void;
  exitAltBuffer(): void;
  /** Write data to stdout. Single owner of terminal output. */
  write(data: string): void;
  /** Position cursor at (row, column) — 1-indexed. */
  setCursor(row: number, column: number): void;
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
      // Set ALIX_TUI_ALT_BUFFER=0 to run in the regular scrollback
      // (useful when you need to highlight and copy rendered text).
      // Default ON — alt-buffer mode keeps the terminal clean.
      if (process.env.ALIX_TUI_ALT_BUFFER !== '0') {
        process.stdout.write('\x1b[?1049h');
      }
    },
    exitAltBuffer() {
      if (process.env.ALIX_TUI_ALT_BUFFER !== '0') {
        process.stdout.write('\x1b[?1049l');
      }
    },
    write(data: string) {
      process.stdout.write(data);
    },
    setCursor(row: number, column: number) {
      process.stdout.write(`\x1b[${row};${column}H`);
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
