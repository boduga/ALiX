/** IPC barriers only delay production methods; they never replace authorization.
 * No sockets, providers, or model calls. Each invocation is a separate OS host. */
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { OwnershipRegistry } from '../../src/coordination/ownership/ownership-registry.js';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import type { NewEvent } from '../../src/runtime-state/events/types.js';
import { ToolExecutor } from '../../src/capabilities/tools/executor.js';
import { FileToolRouter } from '../../src/capabilities/tools/tool-router.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { DaemonToolContinuationResumer } from '../../src/operations/daemon/tool-continuation-resumer.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';
import { isCancellationError } from '../../src/runtime-state/runtime/cancellation-token.js';

const [cwd, approvalId, mode] = process.argv.slice(2);
if (!cwd || !approvalId || !mode || !process.send) throw new Error('Expected IPC race host');
function send(event: string, data: object = {}) { process.send!({ event, pid: process.pid, ...data }); }
async function barrier(event: string) {
  // Register before notification; parent messages cannot outrun the listener.
  await new Promise<void>(resolve => {
    process.once('message', () => resolve()); send(event);
  });
}
const resume = ToolExecutor.prototype.resumeApprovedContinuation;
ToolExecutor.prototype.resumeApprovedContinuation = async function (id, signal) {
  signal.addEventListener('abort', () => send('aborted'), { once: true });
  return resume.call(this, id, signal);
};
const append = EventLog.prototype.append;
EventLog.prototype.append = async function <TType extends string, TPayload>(event: NewEvent<TType, TPayload>) {
  const result = await append.bind(this)<TType, TPayload>(event);
  if (event.type === mode) await barrier('paused');
  return result;
};
const execute = FileToolRouter.prototype.execute;
FileToolRouter.prototype.execute = async function (...args) {
  await appendFile(join(cwd, 'router-entries.jsonl'), JSON.stringify({ pid: process.pid }) + '\n');
  const result = await execute.apply(this, args);
  if (mode === 'ambiguous-effect') {
    if (result.kind !== 'success') throw new Error('Real effect failed');
    // An intentionally nontransactional external-effect SURROGATE. This append
    // is test instrumentation, not proof about a remote service or shell API.
    await appendFile(join(cwd, 'external-surrogate.jsonl'), JSON.stringify({ pid: process.pid }) + '\n');
    await barrier('paused');
  }
  return result;
};
const approvals = new ApprovalStore(cwd); await approvals.load();
await barrier('ready');
try {
  if (mode === 'consume') {
    const record = approvals.get(approvalId)!;
    const result = await approvals.consumeApproved(approvalId, record.bindingKey!,
      { workerId: 'race-consumer', workerAttempt: 1 }, record.invocation);
    send('result', { consumed: result.consumed });
  } else {
    const config = structuredClone(DEFAULT_CONFIG);
    config.permissions.sessionMode = 'ask'; config.permissions.tools = { 'file.create': 'ask' };
    const resumer = new DaemonToolContinuationResumer(cwd, config, new CoordinationStore(cwd), approvals,
      new OwnershipRegistry(cwd), async sessionId => {
        const log = new EventLog(join(cwd, '.alix/sessions', sessionId)); await log.init(); return log;
      });
    try {
      try { await resumer.resumeApproved(approvalId); send('result', { cancelled: false }); }
      catch (error) { if (!isCancellationError(error)) throw error; send('result', { cancelled: true }); }
    } finally { await resumer.shutdown(); }
  }
} finally { closeAllSharedLedgers(); process.disconnect!(); }
