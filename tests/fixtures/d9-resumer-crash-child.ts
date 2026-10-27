/** Test-only host: real watcher/resumer/executor/stores; checkpoints park after
 * completed production calls. The parent must observe IPC before SIGKILL. */
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { ContinuationStore } from '../../src/runtime-state/runtime/continuation-store.js';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { OwnershipRegistry } from '../../src/coordination/ownership/ownership-registry.js';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { FileToolRouter } from '../../src/capabilities/tools/tool-router.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { DaemonToolContinuationResumer } from '../../src/operations/daemon/tool-continuation-resumer.js';
import { ApprovalWatcher } from '../../src/operations/daemon/approval-watcher.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

const [cwd, approvalId, point] = process.argv.slice(2);
if (!cwd || !approvalId || !point || !process.send) throw new Error('Expected isolated IPC crash host');
async function checkpoint(name: string): Promise<void> {
  if (point !== name) return;
  process.send!({ checkpoint: name, pid: process.pid });
  setInterval(() => {}, 1000);
  await new Promise<never>(() => {});
}

const remove = ContinuationStore.prototype.remove;
ContinuationStore.prototype.remove = async function (...args) {
  await remove.apply(this, args);
  await checkpoint('after-tombstone');
};
const consume = ApprovalStore.prototype.consumeApproved;
ApprovalStore.prototype.consumeApproved = async function (...args) {
  const result = await consume.apply(this, args);
  if (result.consumed) await checkpoint('after-consume');
  return result;
};
const execute = FileToolRouter.prototype.execute;
FileToolRouter.prototype.execute = async function (...args) {
  // Non-idempotent observation independent of file.create's content idempotency.
  // This is test instrumentation, not a replacement router or authorization.
  await appendFile(join(cwd, 'router-entries.jsonl'), JSON.stringify({ pid: process.pid, id: args[0].toolCallId }) + '\n');
  const result = await execute.apply(this, args);
  if (result.kind !== 'success') throw new Error(`Real file router failed: ${JSON.stringify(result)}`);
  await checkpoint('after-effect');
  return result;
};
const outcome = ApprovalStore.prototype.recordExecutionOutcome;
ApprovalStore.prototype.recordExecutionOutcome = async function (...args) {
  const result = await outcome.apply(this, args);
  if (result && args[1] === 'succeeded') await checkpoint('after-receipt');
  return result;
};

const config = structuredClone(DEFAULT_CONFIG);
config.permissions.sessionMode = 'ask';
config.permissions.tools = { 'file.create': 'ask' };
const approvals = new ApprovalStore(cwd); await approvals.load();
const resumer = new DaemonToolContinuationResumer(cwd, config, new CoordinationStore(cwd), approvals,
  new OwnershipRegistry(cwd), async sessionId => {
    const log = new EventLog(join(cwd, '.alix/sessions', sessionId)); await log.init(); return log;
  });
const watcher = new ApprovalWatcher(cwd, undefined, { resumeApproved: id => resumer.resumeApproved(id) });
try {
  await checkpoint('before-resume');
  // Both polling and explicit resume must reject a spent/stranded invocation.
  // The watcher intentionally skips consumed approvals with pending outcomes.
  for (let i = 0; i < 2; i++) {
    await watcher.scan();
    await resumer.resumeApproved(approvalId);
  }
  process.send!({ checkpoint: 'recovered', pid: process.pid });
} finally {
  await resumer.shutdown();
  closeAllSharedLedgers();
  process.disconnect!();
}
