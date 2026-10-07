import { createWorkbenchRenderHarness } from './workbench-render-harness.js';
import type { TerminalControl } from '../../../src/tui/terminal-control.js';

const { app, output, paint } = createWorkbenchRenderHarness();
const internal = app as unknown as {
  handleRaw(bytes: Buffer): void;
  cleanupSync(): Promise<void>;
  terminal: TerminalControl;
  sessionDispatchActive: boolean;
  workbenchCancelArmed: boolean;
  opts: { agentSession?: { cancelActiveTurn(reason: string): boolean } };
};
let cancellationCount = 0;
internal.opts.agentSession = { cancelActiveTurn: () => {
  if (!internal.sessionDispatchActive) return false;
  cancellationCount += 1;
  internal.sessionDispatchActive = false;
  return true;
} };

function report(): void {
  process.stdout.write(output.writes.join(''));
  output.writes.length = 0;
  const state = app.getWorkbenchStateForTest();
  process.stdout.write(`\r\n__STATE__${JSON.stringify({ ...state,
    columns: process.stdout.columns, rows: process.stdout.rows,
    cancellationCount, raw: process.stdin.isRaw,
  })}__\r\n`);
}

internal.terminal.enableTerminalModes();
process.stdout.on('resize', () => { paint(); report(); });
process.stdin.on('data', async (bytes: Buffer) => {
  if (bytes.equals(Buffer.from([4]))) {
    await internal.cleanupSync();
    process.stdout.write(`\r\n__CLEANUP__${JSON.stringify({ raw: process.stdin.isRaw })}__\r\n`);
    process.exit(0);
  }
  // Dedicated fixture command arms a fake runtime port without a provider call.
  if (bytes.equals(Buffer.from([7]))) {
    internal.sessionDispatchActive = true;
    internal.workbenchCancelArmed = false;
  }
  else internal.handleRaw(bytes);
  paint();
  report();
});
paint();
report();
