import { createWorkbenchRenderHarness } from './workbench-render-harness.js';

const { output, state, paint } = createWorkbenchRenderHarness('resize transcript '.repeat(20));
state.views.agent.inputBuffer = 'full-width composer '.repeat(12);
function render(): void {
  output.writes.length = 0;
  paint();
  process.stdout.write(output.writes.join(''));
  process.stdout.write(`\r\n__FRAME__${process.stdout.columns}x${process.stdout.rows}__\r\n`);
}
process.stdout.on('resize', render);
process.stdin.setRawMode(true);
process.stdin.on('data', () => { process.stdin.setRawMode(false); process.exit(0); });
render();
