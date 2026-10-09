import { createWorkbenchRenderHarness } from './workbench-render-harness.js';
import type { TerminalControl } from '../../../src/interfaces/tui/terminal-control.js';
import type { AgentTurnResult, CoordinationRunRequest } from '../../../src/agents/agent/session/types.js';

const { app, output, paint } = createWorkbenchRenderHarness();
const internal = app as unknown as {
  handleRaw(bytes: Buffer): void; cleanupSync(): Promise<void>; terminal: TerminalControl;
  opts: { agentSession?: { runCoordination(input: CoordinationRunRequest): Promise<AgentTurnResult>; cancelActiveTurn(reason: string): boolean } };
};
const launches: CoordinationRunRequest[] = [];
let cancellationCount = 0;
let finish: (() => void) | undefined;
internal.opts.agentSession = {
  runCoordination: input => {
    launches.push(input);
    return new Promise(resolve => { finish = () => {
      resolve({ summary: 'Scripted coordination settled', sessionId: 'test', toolCalls: [] }); finish = undefined;
    }; });
  },
  cancelActiveTurn: () => {
    if (!finish) return false;
    cancellationCount++; finish(); return true;
  },
};
function report(): void {
  process.stdout.write(output.writes.join('')); output.writes.length = 0;
  process.stdout.write(`\r\n__STATE__${JSON.stringify({ ...app.getWorkbenchStateForTest(), launches, cancellationCount,
    columns: process.stdout.columns, rows: process.stdout.rows, raw: process.stdin.isRaw })}__\r\n`);
}
internal.terminal.enableTerminalModes();
process.stdout.on('resize', () => { paint(); report(); });
process.stdin.on('data', async (bytes: Buffer) => {
  if (bytes.equals(Buffer.from([4]))) {
    await internal.cleanupSync();
    process.stdout.write(`\r\n__CLEANUP__${JSON.stringify({ raw: process.stdin.isRaw })}__\r\n`); process.exit(0);
  }
  internal.handleRaw(bytes);
  await new Promise<void>(resolve => setImmediate(resolve));
  paint(); report();
});
paint(); report();
