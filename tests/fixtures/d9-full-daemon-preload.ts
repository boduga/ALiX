/** Explicit Node --import test instrumentation. Never imported by production.
 * Calls original methods; only timing and observation cross the IPC channel. */
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { ContinuationStore } from '../../src/runtime-state/runtime/continuation-store.js';
import { FileToolRouter } from '../../src/capabilities/tools/tool-router.js';
import { ToolExecutor } from '../../src/capabilities/tools/executor.js';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import type { NewEvent } from '../../src/runtime-state/events/types.js';
import { DaemonToolContinuationResumer } from '../../src/operations/daemon/tool-continuation-resumer.js';
import { ApprovalWatcher } from '../../src/operations/daemon/approval-watcher.js';
import { CoordinationSchedulerService } from '../../src/operations/daemon/coordination-scheduler-service.js';
import { CoordinationScheduler } from '../../src/coordination/kernel/coordination-scheduler.js';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { DaemonRuntimeExecutor } from '../../src/operations/daemon/daemon-runtime-executor.js';
import { isCancellationError } from '../../src/runtime-state/runtime/cancellation-token.js';

if (!process.send || !process.env.D9_WORKSPACE) throw new Error('D9 preload requires isolated IPC host');
// A killed test runner must not orphan a socket-owning daemon on the host.
process.once('disconnect', () => process.exit(1));
const cwd = process.env.D9_WORKSPACE;
const target = process.env.D9_APPROVAL;
const point = process.env.D9_POINT;
const effectMode = process.env.D9_EFFECT_MODE;
const send = (event: string, data: object = {}) => process.send!({ event, pid: process.pid, ...data });
let release: (() => void) | undefined;
let parked = false;
async function checkpoint(name: string) {
  if (point !== name || parked) return;
  parked = true;
  await new Promise<void>(resolve => { release = resolve; send('checkpoint', { name }); });
}
let watcher: ApprovalWatcher | undefined;
let service: CoordinationSchedulerService | undefined;
const watcherStart = ApprovalWatcher.prototype.start;
ApprovalWatcher.prototype.start = function () {
  watcherStart.call(this); watcher = this; send('watcher-started');
};
const serviceStart = CoordinationSchedulerService.prototype.start;
CoordinationSchedulerService.prototype.start = function () {
  serviceStart.call(this); service = this; send('scheduler-started');
};
const tick = CoordinationScheduler.prototype.tick;
CoordinationScheduler.prototype.tick = async function (id) {
  const result = await tick.call(this, id); send('tick-done', { id, result }); return result;
};
const updateRun = CoordinationStore.prototype.updateRun;
CoordinationStore.prototype.updateRun = async function (...args) {
  const result = await updateRun.apply(this, args);
  if (result) send('run-committed', { id: result.id, workers: result.workers });
  return result;
};
process.on('message', message => {
  const command = message as { command: string; id?: string };
  if (command.command === 'release') { release?.(); release = undefined; }
  if (command.command === 'tick') service?.requestTick(command.id!);
  if (command.command === 'scan') {
    void (async () => {
      if (!watcher) throw new Error('No production watcher');
      let cancelled = false;
      try { await watcher.scan(); }
      catch (error) { if (!isCancellationError(error)) throw error; cancelled = true; }
      const store = new ApprovalStore(cwd); await store.load();
      send('scan-done', { cancelled, records: store.list().map(a => ({ id: a.id, status: a.status, outcome: a.executionOutcome })) });
    })().catch(error => { send('instrumentation-error', { error: String(error) }); process.exitCode = 1; });
  }
});
const scan = ApprovalWatcher.prototype.scan;
ApprovalWatcher.prototype.scan = async function () {
  send('scan-entered'); return scan.call(this);
};
const expireDue = ApprovalStore.prototype.expireDue;
ApprovalStore.prototype.expireDue = async function (...args) {
  const result = await expireDue.apply(this, args);
  if (target && this.get(target)) await checkpoint('during-reconciliation');
  return result;
};
const resume = DaemonToolContinuationResumer.prototype.resumeApproved;
DaemonToolContinuationResumer.prototype.resumeApproved = async function (id) {
  send('resume-entered', { id });
  if (id === target) await checkpoint('before-resume');
  const result = await resume.call(this, id); send('resume-done', { id }); return result;
};
const remove = ContinuationStore.prototype.remove;
ContinuationStore.prototype.remove = async function (...args) {
  await remove.apply(this, args); await checkpoint('after-tombstone');
};
const consume = ApprovalStore.prototype.consumeApproved;
ApprovalStore.prototype.consumeApproved = async function (...args) {
  const result = await consume.apply(this, args);
  if (result.consumed && args[0] === target) await checkpoint('after-consume');
  return result;
};
const append = EventLog.prototype.append;
EventLog.prototype.append = async function <T extends string, P>(event: NewEvent<T, P>) {
  const result = await append.bind(this)<T, P>(event);
  if (event.type === 'tool.requested' || event.type === 'tool.started') await checkpoint(event.type);
  return result;
};
const resumeTool = ToolExecutor.prototype.resumeApprovedContinuation;
ToolExecutor.prototype.resumeApprovedContinuation = async function (id, signal) {
  signal.addEventListener('abort', () => send('abort-observed', { id }), { once: true });
  return resumeTool.call(this, id, signal);
};
const execute = FileToolRouter.prototype.execute;
FileToolRouter.prototype.execute = async function (...args) {
  await checkpoint('before-effect');
  await appendFile(join(cwd, 'router-entries.jsonl'), JSON.stringify({ pid: process.pid, call: args[0].toolCallId }) + '\n');
  if (effectMode === 'fail-before') return { kind: 'error', message: 'controlled effect failed before execution' };
  const result = await execute.apply(this, args);
  if (result.kind === 'success' && effectMode) {
    // Controlled external-effect SURROGATE, outside the approval transaction.
    // Duplicate sends model adapter behavior; they are not daemon re-dispatches.
    for (let sendIndex = 0; sendIndex < (effectMode.startsWith('duplicate') ? 2 : 1); sendIndex++) {
      if (effectMode === 'duplicate-keyed') {
        try { await writeFile(join(cwd, 'effect-idempotency-key'), 'fixed-request-key', { flag: 'wx' }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
      }
      await appendFile(join(cwd, 'controlled-effects.jsonl'), JSON.stringify({ pid: process.pid, sendIndex }) + '\n');
    }
    if (effectMode === 'receipt-lost') await checkpoint('after-effect');
    if (effectMode === 'unknown' || effectMode === 'timeout-applied') return {
      kind: 'error', message: effectMode === 'timeout-applied' ? 'controlled timeout after applying effect' : 'controlled unknown outcome', outcomeUnknown: true,
    };
  }
  if (result.kind === 'success') await checkpoint('after-effect');
  return result;
};
const executeTaskTool = DaemonRuntimeExecutor.prototype.executeTool;
DaemonRuntimeExecutor.prototype.executeTool = async function (...args) {
  const opts = (this as unknown as { opts: { signal?: AbortSignal; taskId: string } }).opts;
  opts.signal?.addEventListener('abort', () => send('task-abort-observed', { id: opts.taskId }), { once: true });
  await checkpoint('task-active');
  return executeTaskTool.apply(this, args);
};
const outcome = ApprovalStore.prototype.recordExecutionOutcome;
ApprovalStore.prototype.recordExecutionOutcome = async function (...args) {
  const result = await outcome.apply(this, args);
  if (result && args[0] === target && args[1] === 'succeeded') await checkpoint('after-receipt');
  return result;
};
