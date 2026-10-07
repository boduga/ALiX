import { createWorkbenchRenderHarness } from './workbench-render-harness.js';
import type { WorkbenchUiState } from '../../../src/tui/workbench/model/ui-state.js';

const { app, output, paint } = createWorkbenchRenderHarness();
const internal = app as unknown as { handleRaw(bytes: Buffer): void; getWorkbenchStateForTest(): WorkbenchUiState };
function report(): void {
  process.stdout.write(output.writes.join(''));
  output.writes.length = 0;
  const state = internal.getWorkbenchStateForTest();
  process.stdout.write(`\r\n__STATE__${JSON.stringify({ focus: state.focus, filter: state.transcriptFilter, scope: state.transcriptScope, follow: state.followTail, text: state.composer.text, drawer: state.drawer })}__\r\n`);
}
process.stdin.setRawMode(true);
process.stdin.on('data', (bytes: Buffer) => {
  if (bytes.equals(Buffer.from([4]))) { process.stdin.setRawMode(false); process.exit(0); }
  internal.handleRaw(bytes);
  report();
});
paint();
report();
