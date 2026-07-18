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
    enterAltBuffer() { process.stdout.write('\x1b[?1049h'); },
    exitAltBuffer() { process.stdout.write('\x1b[?1049l'); },
    onResize(cb: () => void) {
      resizeCb = cb;
      process.stdout.on('resize', cb);
      return () => {
        if (resizeCb) process.stdout.off('resize', cb);
        resizeCb = null;
      };
    },
    installEmergencyCleanup(cleanup: () => void) {
      const handler = () => {
        try { cleanup(); } catch { /* ignore */ }
        finally { process.exit(130); }
      };
      process.on('exit', handler);
      process.on('SIGINT', handler);
      process.on('SIGTERM', handler);
      cleanupFns.push(() => process.off('exit', handler));
      return () => {
        process.off('SIGINT', handler);
        process.off('SIGTERM', handler);
      };
    },
  };
}
