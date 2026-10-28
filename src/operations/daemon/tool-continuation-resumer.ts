import { resolve } from 'node:path';
import type { AlixConfig } from '../config/schema.js';
import type { ApprovalStore } from '../../governance/approvals/approval-store.js';
import type { ApprovalRecord } from '../../governance/approvals/approval-types.js';
import { createWorkerApprovalPort } from '../../governance/approvals/worker-approval-port.js';
import { invocationMatches, computeOwnershipClaimsHash } from '../../governance/approvals/approval-binding.js';
import type { PendingContinuation } from '../../runtime-state/runtime/continuation-store.js';
import type { EventLog } from '../../runtime-state/events/event-log.js';
import { WorkspacePathResolver } from '../../runtime-state/runtime/workspace-path.js';
import { createToolExecutor } from '../../capabilities/tools/tool-executor-factory.js';
import type { CoordinationStore } from '../../coordination/kernel/coordination-store.js';
import type { CoordinationRun, WorkerAssignment } from '../../coordination/kernel/coordination-types.js';
import { acquireWorkerOwnership } from '../../coordination/kernel/coordination-ownership.js';
import { CoordinationRunLock } from '../../coordination/kernel/coordination-run-lock.js';
import { isWriteWorker, ownedPathsForWorker } from '../../coordination/kernel/worker-role.js';
import type { OwnershipRegistry } from '../../coordination/ownership/ownership-registry.js';

/** Daemon host for tool continuations explicitly attributed by the worker host.
 * Unattributed legacy records are never guessed into a coordination worker.
 */
export class DaemonToolContinuationResumer {
  private stopped = false;
  private active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  constructor(private cwd: string, private config: AlixConfig, private runs: CoordinationStore,
    private approvals: ApprovalStore, private ownership: OwnershipRegistry,
    private createLog: (sessionId: string) => Promise<EventLog>) {}

  async resumeApproved(approvalId: string): Promise<void> {
    if (this.stopped || this.active.has(approvalId)) return;
    const controller = new AbortController();
    const done = this.withResumeLock(approvalId, controller).finally(() => this.active.delete(approvalId));
    this.active.set(approvalId, { controller, done });
    await done;
  }

  private async withResumeLock(approvalId: string, controller: AbortController): Promise<void> {
    if (!/^[\w-]+$/.test(approvalId)) return;
    // Repair never uses leases or executes a tool, so a dead host's execution
    // lock must not delay recovery of an already committed outcome.
    const committed = this.approvals.loadCommitted(approvalId);
    if (committed?.status === 'consumed') {
      if (!this.stopped && !controller.signal.aborted) await this.recoverSucceeded(committed, controller.signal);
      return;
    }
    // Same-agent lease acquisition renews an existing lease. Serialize hosts so
    // a losing continuation cannot release the winner's lease before dispatch.
    // This lock carries no authorization; the normal single-use claim remains.
    const lock = new CoordinationRunLock(this.cwd, `tool-continuation-${approvalId}`);
    if (!(await lock.acquire(50))) return; // A later watcher scan retries contention.
    try {
      if (!this.stopped && !controller.signal.aborted) await this.resume(approvalId, controller);
    } finally { lock.release(); }
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const item of this.active.values()) item.controller.abort('daemon shutdown');
    await Promise.allSettled([...this.active.values()].map(item => item.done));
  }

  private worker(cont: PendingContinuation, run: CoordinationRun | null): WorkerAssignment | undefined {
    const binding = cont.coordinationWorker;
    if (!binding || !run || run.id !== binding.runId || run.hostKind !== 'daemon' ||
        !['running', 'blocked'].includes(run.status) || run.sessionId !== cont.sessionId) return;
    const worker = run.workers.find(w => w.id === binding.workerId);
    if (!worker || worker.status !== 'blocked' || worker.blockReason !== 'approval_required' ||
        worker.approvalId !== cont.approvalId || worker.attempt !== binding.attempt ||
        computeOwnershipClaimsHash(worker.ownershipClaims) !== binding.ownershipHash ||
        JSON.stringify(worker.ownershipScopes) !== JSON.stringify(binding.ownershipScopes) ||
        !isWriteWorker(worker) || !ownedPathsForWorker(worker).length) return;
    return worker;
  }

  private async resume(approvalId: string, controller: AbortController): Promise<void> {
    const approvals = this.approvals;
    await approvals.load();
    const approval = approvals.get(approvalId);
    if (!approval?.sessionId || !/^[\w-]+$/.test(approval.sessionId)) return;
    if (approval.status === 'consumed') {
      const committed = approvals.loadCommitted(approvalId);
      if (committed?.status === 'consumed') await this.recoverSucceeded(committed, controller.signal);
      return;
    }
    const log = await this.createLog(approval.sessionId);
    try {
      const reader = createToolExecutor({ config: this.config, log, root: this.cwd, approvalStore: approvals });
      const cont = (await reader.pendingContinuations()).find(c => c.approvalId === approvalId);
      if (!cont?.coordinationWorker || !cont.toolCall || cont.kind !== 'tool' ||
          resolve(cont.cwd) !== resolve(this.cwd) || !/^[\w-]+$/.test(cont.sessionId)) return;
      const run = await this.runs.load(cont.coordinationWorker.runId);
      const worker = this.worker(cont, run);
      if (!worker) return;
      if (!approval || (approval.workerId && approval.workerId !== worker.id) ||
          (approval.workerAttempt !== undefined && approval.workerAttempt !== worker.attempt) ||
          (approval.coordinationRunId && approval.coordinationRunId !== run!.id) ||
          !invocationMatches(approval, {
            capability: cont.toolCall.capability, toolName: cont.toolCall.name,
            workspace: resolve(this.cwd), argsHash: cont.toolCall.argsHash,
            sessionId: cont.sessionId, agentId: cont.toolCall.agentId,
          })) return;
      if (approval.status === 'denied') {
        await this.runs.updateRun(run!.id, current => {
          const currentWorker = this.worker(cont, current);
          if (currentWorker) Object.assign(currentWorker, { status: 'failed', failureKind: 'approval_denied',
            blockReason: 'execution_failed', error: `Approval ${approvalId} denied`, completedAt: new Date().toISOString() });
        });
        return;
      }
      if (approval.status !== 'approved' || controller.signal.aborted) return;
      if (!cont.toolCall.agentId) return;
      // Preserve the host attribution in the existing approval ledger BEFORE
      // the one-shot continuation disappears. Metadata never supplies this fact.
      let bound = false;
      const context = { ...cont.coordinationWorker, invocationFingerprint: approval.invocationFingerprint! };
      await approvals.mutate(records => {
        const current = records.find(record => record.id === approvalId);
        if (!current || current.status !== 'approved' ||
            current.invocationFingerprint !== context.invocationFingerprint ||
            (current.toolContinuation && JSON.stringify(current.toolContinuation) !== JSON.stringify(context))) return;
        // Legacy approvals were issued before worker attribution existed.
        // After validating the durable continuation, run, worker, attempt and
        // invocation above, bind the record atomically before exposing it to
        // the strictly worker-scoped execution port. Never broaden that port.
        if ((current.workerId && current.workerId !== worker.id) ||
            (current.workerAttempt !== undefined && current.workerAttempt !== worker.attempt) ||
            (current.coordinationRunId && current.coordinationRunId !== run!.id)) return;
        current.workerId = worker.id;
        current.workerAttempt = worker.attempt;
        current.coordinationRunId = run!.id;
        current.toolContinuation = context;
        bound = true;
      });
      if (!bound) return;
      const port = createWorkerApprovalPort(approvals, { workerId: worker.id, workerAttempt: worker.attempt });
      const executor = createToolExecutor({
        config: { ...this.config, ownership: { ...this.config.ownership, autoAcquire: false } }, log, root: this.cwd,
        ownedPaths: ownedPathsForWorker(worker),
        workspacePathResolver: new WorkspacePathResolver(this.cwd),
        ownershipRegistry: this.ownership,
        approvalStore: { ...port, consumeApproved: (id: string, key: string,
          consumer: Parameters<ApprovalStore['consumeApproved']>[2],
          invocation: Parameters<ApprovalStore['consumeApproved']>[3]) =>
          port.consumeApproved(id, key, { ...consumer, workerId: worker.id, workerAttempt: worker.attempt }, invocation) },
      });
      // Acquire explicit, individually tracked leases for the original tool agent.
      // The worker id stays the approval consumer identity, never an agent alias.
      const leases = await acquireWorkerOwnership(this.ownership, run!, { ...worker, agentId: cont.toolCall.agentId }, this.cwd, 60_000);
      if (!leases.acquired) return;
      const held = new Set(leases.leaseIds);
      const release = async (): Promise<void> => {
        for (const id of held) if (await this.ownership.release(id)) held.delete(id);
      };
      // Cancellation changes durable run state; abort an in-flight tool as soon as observed.
      const monitor = setInterval(() => {
        void this.runs.load(run!.id).then(current => {
          if (!this.worker(cont, current)) controller.abort('worker context changed');
        }).catch(() => controller.abort('worker state unavailable'));
      }, 100);
      const renewal = setInterval(() => {
        void Promise.all([...held].map(id => this.ownership.renew(id, 60_000))).then(results => {
          if (results.some(ok => !ok)) controller.abort('continuation lease lost');
        }).catch(() => controller.abort('continuation lease unavailable'));
      }, 10_000);
      try {
        if (this.stopped || controller.signal.aborted || !this.worker(cont, await this.runs.load(run!.id))) return;
        const result = await executor.resumeApprovedContinuation(approvalId, controller.signal);
        await approvals.load();
        const outcome = approvals.get(approvalId)?.executionOutcome;
        await release();
        if (outcome === 'failed') {
          await this.runs.updateRun(run!.id, current => {
            const currentWorker = this.worker(cont, current);
            if (currentWorker && !controller.signal.aborted) Object.assign(currentWorker, {
              status: 'failed', blockReason: 'execution_failed', failureKind: 'execution_error',
              error: result.error ?? 'Approved tool execution failed', completedAt: new Date().toISOString(),
            });
          });
          return;
        }
        if (!result.resumed || outcome !== 'succeeded') return;
        await this.runs.updateRun(run!.id, current => {
          const currentWorker = this.worker(cont, current);
          if (currentWorker && !controller.signal.aborted) Object.assign(currentWorker, {
            status: 'pending', blockReason: undefined, failureKind: undefined, approvalId: undefined,
            error: undefined, executionOwnerId: undefined, completedAt: undefined,
          });
        });
      } finally { clearInterval(monitor); clearInterval(renewal); await release(); }
    } finally { await log.close(); }
  }

  /** Repair only the worker transition; never enter the tool execution path. */
  private async recoverSucceeded(approval: ApprovalRecord, signal: AbortSignal): Promise<void> {
    const context = approval.toolContinuation;
    const invocation = approval.invocation;
    if (!context || !invocation || approval.status !== 'consumed' || approval.executionOutcome !== 'succeeded' ||
        !approval.sessionId || !/^[\w-]+$/.test(approval.sessionId) ||
        !approval.bindingKey || !approval.requestId || !invocation.toolName || !invocation.argsHash ||
        !invocation.agentId || invocation.agentId !== approval.agentId ||
        invocation.sessionId !== approval.sessionId || resolve(invocation.workspace) !== resolve(this.cwd) ||
        !invocationMatches(approval, invocation) || context.invocationFingerprint !== approval.invocationFingerprint ||
        approval.consumedByWorkerId !== context.workerId || approval.consumedAttempt !== context.attempt ||
        (approval.workerId && approval.workerId !== context.workerId) ||
        (approval.workerAttempt !== undefined && approval.workerAttempt !== context.attempt) ||
        (approval.coordinationRunId && approval.coordinationRunId !== context.runId)) return;
    const eligible = (current: CoordinationRun | null): WorkerAssignment | undefined => {
      if (this.stopped || signal.aborted || !current || current.hostKind !== 'daemon' ||
          !['running', 'blocked'].includes(current.status) || current.id !== context.runId ||
          current.sessionId !== approval.sessionId) return;
      const worker = current.workers.find(item => item.id === context.workerId);
      if (!worker || worker.coordinationRunId !== current.id || worker.status !== 'blocked' ||
          worker.blockReason !== 'approval_required' || worker.approvalId !== approval.id ||
          worker.attempt !== context.attempt || !isWriteWorker(worker) || !ownedPathsForWorker(worker).length ||
          computeOwnershipClaimsHash(worker.ownershipClaims) !== context.ownershipHash ||
          JSON.stringify(worker.ownershipScopes) !== JSON.stringify(context.ownershipScopes)) return;
      return worker;
    };
    // Ordinary scans of already-recovered approvals must not append run facts.
    if (!eligible(await this.runs.load(context.runId))) return;
    await this.runs.updateRun(context.runId, current => {
      // Recheck authority and worker context after acquiring the run lock.
      const latest = this.approvals.loadCommitted(approval.id);
      if (JSON.stringify(latest) !== JSON.stringify(approval)) return;
      const worker = eligible(current);
      if (!worker) return;
      Object.assign(worker, { status: 'pending', blockReason: undefined, failureKind: undefined,
        approvalId: undefined, error: undefined, executionOwnerId: undefined, completedAt: undefined });
    });
  }
}
