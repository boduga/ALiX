/**
 * coordination-scheduler.ts — Full bounded scheduler with ownership-aware dispatch,
 * heartbeat/lease renewal, runUntilIdle, and cancellation.
 *
 * Ties together CoordinationStore, OwnershipRegistry, ExecutionAuthorization,
 * CoordinationWorkerExecutor, and CoordinationResultStore into a single
 * tick-based dispatch loop.
 */

import { randomUUID } from "node:crypto";
import { CoordinationStore } from "./coordination-store.js";
import { CoordinationResultStore } from "./coordination-result-store.js";
import { acquireWorkerOwnership, releaseWorkerOwnership, renewWorkerOwnership } from "./coordination-ownership.js";
import { reconcileCoordinationRun } from "./coordination-reconciliation.js";
import type { ReconciliationResult as ReconcileResult } from "./coordination-reconciliation.js";
import { authorizeWorker } from "./coordination-authorization.js";
import type { ExecutionAuthorization } from "../runtime/execution-authorization.js";
import type { OwnershipRegistry } from "../ownership/ownership-registry.js";
import type { EventLog } from "../events/event-log.js";
import type { AuditStore } from "../audit/audit-store.js";
import type { AlixConfig } from "../config/schema.js";
import type { CoordinationRun, CoordinationRunStatus, WorkerAssignment } from "./coordination-types.js";
import type { CoordinationCompletionService } from "./coordination-completion-service.js";
import type { CoordinationWorkerExecutor, WorkerExecutionContext, WorkerExecutionResult } from "./worker-executor.js";
import { CollaborationStore } from "./collaboration-store.js";
import { ConflictDetector } from "./collaboration-conflict-detector.js";
import { ConflictCandidateGenerator } from "./collaboration-conflict-candidates.js";
import { ClaimComparator } from "./collaboration-claim-comparator.js";
import { ConflictEvidenceComparator } from "./collaboration-evidence-comparator.js";
import { ConflictRepository } from "./collaboration-conflict-repository.js";
import { systemClock as collabSystemClock } from "./collaboration-freshness.js";
import type { WorkerCollaborationAPI } from "./worker-collaboration-api.js";
import type { WorkerContextManifest, WorkerContextSnapshot } from "./collaboration-types.js";

// ─── Constants ──────────────────────────────────────────────────────────

export const MAX_COORDINATION_CONCURRENCY = 8;
export const DEFAULT_OWNERSHIP_TTL_MS = 30 * 60_000;
export const DEFAULT_OWNERSHIP_RENEW_INTERVAL_MS = 5 * 60_000;
export const DEFAULT_ORPHAN_THRESHOLD_MS = 90_000;
export const DEFAULT_MAX_DISPATCH_PER_TICK = 5;
export const DEFAULT_RUN_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_MAX_IDLE_TICKS = 5;
export const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;

// ─── Clock ──────────────────────────────────────────────────────────────

export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms: number) => new Promise(r => setTimeout(r, ms)),
};

// ─── Options and deps ───────────────────────────────────────────────────

export type SchedulerOptions = {
  maxConcurrency?: number;
  ownershipTtlMs?: number;
  ownershipRenewIntervalMs?: number;
  orphanThresholdMs?: number;
  maxDispatchPerTick?: number;
  enableConflictDetection?: boolean;
};

export type CoordinationSchedulerDeps = {
  cwd: string;
  daemonInstanceId: string;
  configProvider: () => Promise<AlixConfig>;
  store: CoordinationStore;
  authorization: ExecutionAuthorization;
  ownershipRegistry: OwnershipRegistry;
  executor: CoordinationWorkerExecutor;
  collaborationContextFactory?: (
    run: CoordinationRun,
    worker: WorkerAssignment,
  ) => Promise<{
    api: WorkerCollaborationAPI;
    manifest: WorkerContextManifest;
    contextSnapshot: WorkerContextSnapshot;
  }>;
  completionService?: CoordinationCompletionService;
  eventLog?: EventLog;
  auditStore?: AuditStore;
  clock?: Clock;
};

// ─── Result types ───────────────────────────────────────────────────────

export type SchedulerTickResult = {
  runId: string;
  examined: number;
  ready: number;
  dispatched: string[];
  awaitingApproval: string[];
  denied: string[];
  ownershipConflicts: string[];
  dependencyBlocked: string[];
  recoveredOrphans: string[];
  activeRunning: number;
  availableSlots: number;
  runStatus: CoordinationRunStatus;
  progressMade: boolean;
};

export type SchedulerStopReason = "completed" | "failed" | "awaiting_approval" | "blocked" | "idle" | "timeout";

export type SchedulerRunResult = {
  runId: string;
  finalStatus: CoordinationRunStatus;
  stopReason: SchedulerStopReason;
  cycles: number;
  dispatched: number;
  failed: number;
  durationMs: number;
};

export type ReconciliationResult = ReconcileResult;

export type RunUntilIdleOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
  maxIdleTicks?: number;
};

// ─── CoordinationScheduler ──────────────────────────────────────────────

export class CoordinationScheduler {
  private readonly deps: CoordinationSchedulerDeps;
  private readonly options: Required<SchedulerOptions>;
  private readonly resultStore: CoordinationResultStore;
  private readonly activeExecutions = new Map<string, { workerId: string; runId: string; controller: AbortController; promise: Promise<void> }>();

  constructor(deps: CoordinationSchedulerDeps, options: SchedulerOptions = {}) {
    this.deps = deps;
    this.options = {
      maxConcurrency: Math.min(Math.max(options.maxConcurrency ?? 1, 1), MAX_COORDINATION_CONCURRENCY),
      ownershipTtlMs: options.ownershipTtlMs ?? DEFAULT_OWNERSHIP_TTL_MS,
      ownershipRenewIntervalMs: options.ownershipRenewIntervalMs ?? DEFAULT_OWNERSHIP_RENEW_INTERVAL_MS,
      orphanThresholdMs: options.orphanThresholdMs ?? DEFAULT_ORPHAN_THRESHOLD_MS,
      maxDispatchPerTick: options.maxDispatchPerTick ?? DEFAULT_MAX_DISPATCH_PER_TICK,
      enableConflictDetection: options.enableConflictDetection ?? true,
    };
    this.resultStore = new CoordinationResultStore(deps.cwd);
  }

  // ── Reconciliation ─────────────────────────────────────────────────

  async reconcile(runId: string): Promise<ReconciliationResult> {
    const result = await reconcileCoordinationRun({
      store: this.deps.store,
      ownershipRegistry: this.deps.ownershipRegistry,
      daemonInstanceId: this.deps.daemonInstanceId,
      orphanThresholdMs: this.options.orphanThresholdMs,
      clock: this.deps.clock,
      isApproved: async (worker: WorkerAssignment, run: CoordinationRun) => {
        try {
          if (!worker.authorizationEvidence?.decisions?.length) return false;
          const { ApprovalStore } = await import("../approvals/approval-store.js");
          const { computeBindingKey, computeOwnershipClaimsHash } = await import("../approvals/approval-binding.js");
          const store = new ApprovalStore(this.deps.cwd);
          await store.load();

          // Compute the binding key from worker evidence + run
          const bindingKey = computeBindingKey({
            coordinationRunId: run.id,
            workerId: worker.id,
            workerAttempt: worker.attempt,
            capabilities: worker.requiredCapabilities ?? [],
            ownershipClaims: worker.ownershipClaims,
            requestFingerprint: worker.authorizationEvidence.decisions.map(d => d.capability).join(","),
            policyRevision: String(worker.authorizationEvidence.policyRevision ?? "legacy"),
          });

          const record = store.findExact(bindingKey);
          if (!record) return false;
          if (record.status !== "approved") return false;
          if (new Date(record.expiresAt) <= new Date()) return false;

          // If single-use, consume atomically
          if (record.usePolicy === "single_use") {
            const consumed = await store.consumeApproved(record.id, bindingKey, {
              workerId: worker.id,
              workerAttempt: worker.attempt,
            });
            return consumed.consumed;
          }

          return true;
        } catch {
          return false;
        }
      },
      activeExecutionIds: new Set(this.activeExecutions.keys()),
    }, runId);
    return result;
  }

  // ── Tick (core dispatch pipeline) ──────────────────────────────────

  async tick(runId: string): Promise<SchedulerTickResult> {
    let run = await this.deps.store.load(runId);
    if (!run) {
      return emptyTick(runId, "failed");
    }
    if (run.status === "completed" || run.status === "failed") {
      return emptyTick(runId, run.status);
    }

    // Step 1: Reconcile
    const recResult = await this.reconcile(runId);

    // Step 2: Reload after reconcile
    run = (await this.deps.store.load(runId))!;
    const activeRunning = run.workers.filter(w => w.status === "running").length;
    const availableSlots = Math.max(0, this.options.maxConcurrency - activeRunning);

    // Step 3: Find dependency-ready pending workers
    const completedIds = new Set(run.workers.filter(w => w.status === "completed").map(w => w.id));
    const readyWorkers = run.workers
      .filter(w => w.status === "pending" && !w.blockReason && w.dependencies.every(d => completedIds.has(d)))
      .sort((a, b) =>
        (a.planOrder ?? Number.MAX_SAFE_INTEGER) - (b.planOrder ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
      );

    const config = await this.deps.configProvider();
    const dispatched: string[] = [];
    const awaitingApproval: string[] = [];
    const denied: string[] = [];
    const ownershipConflicts: string[] = [];

    const candidates = readyWorkers.slice(0, this.options.maxDispatchPerTick);
    for (const worker of candidates) {
      if (dispatched.length >= availableSlots) break;

      // Retry budget
      if (worker.attempt >= worker.maxAttempts) {
        await this.deps.store.patchWorker(runId, worker.id, {
          status: "failed", blockReason: "execution_failed", failureKind: "execution_error",
          error: "Max attempts reached",
        });
        continue;
      }

      // Authorization
      const authResult = await authorizeWorker({
        authorization: this.deps.authorization,
        worker, run,
        cwd: this.deps.cwd,
        sessionMode: config.permissions.sessionMode ?? "ask",
      });

      if (authResult.status === "denied") {
        denied.push(worker.id);
        await this.deps.store.patchWorker(runId, worker.id, {
          status: "failed", blockReason: "authorization_denied", failureKind: "authorization_denied",
          error: authResult.reason,
          authorizationEvidence: authResult.evidence,
        });
        continue;
      }

      if (authResult.status === "approval_required") {
        awaitingApproval.push(worker.id);
        await this.deps.store.patchWorker(runId, worker.id, {
          status: "blocked", blockReason: "approval_required",
          approvalId: authResult.approvalId,
          authorizationEvidence: authResult.evidence,
        });
        continue;
      }

      // Ownership acquisition
      const ownResult = await acquireWorkerOwnership(
        this.deps.ownershipRegistry, run, worker, this.deps.cwd, this.options.ownershipTtlMs,
      );
      if (!ownResult.acquired) {
        ownershipConflicts.push(worker.id);
        await this.deps.store.patchWorker(runId, worker.id, {
          blockReason: "ownership_conflict",
          error: ownResult.reason,
          authorizationEvidence: authResult.evidence,
        });
        continue;
      }

      // Collaboration context
      if (this.deps.collaborationContextFactory && worker.dependencies.length > 0) {
        try {
          const ctx = await this.deps.collaborationContextFactory(run, worker);
          // Persist manifest
          const manifestRef = await (ctx.manifest?.runId
            ? new CollaborationStore(this.deps.cwd, run.id).persistManifest(ctx.manifest)
            : Promise.resolve(undefined));

          if (manifestRef) {
            // Store manifest ref on the worker for context persistence
            worker.contextManifestRef = manifestRef;
            worker.contextFingerprint = ctx.manifest.sourceFingerprint;
            worker.contextGeneratedAt = ctx.manifest.generatedAt;
            worker.contextTokenEstimate = ctx.manifest.tokenEstimate;
          }
        } catch (error) {
          // Context build failure does NOT consume an execution attempt
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[scheduler] Context build failed for ${worker.id}: ${msg}`);
          // Mark as blocked — worker will retry
          await this.deps.store.patchWorker(runId, worker.id, {
            status: "pending",
            blockReason: "context_unavailable" as any,
            error: `Context unavailable: ${msg}`,
          });
          ownershipConflicts.push(worker.id);
          continue; // skip this worker, try again next tick
        }
      }

      // Persist running state before execution
      const now = (this.deps.clock ?? systemClock).now().toISOString();
      const updatedRun = await this.deps.store.patchWorker(runId, worker.id, {
        status: "running",
        startedAt: now,
        lastHeartbeatAt: now,
        executionOwnerId: this.deps.daemonInstanceId,
        leaseIds: ownResult.leaseIds,
        attempt: worker.attempt + 1,
        blockReason: undefined,
        error: undefined,
        authorizationEvidence: authResult.evidence,
      });

      if (!updatedRun) {
        await releaseWorkerOwnership(this.deps.ownershipRegistry, ownResult.leaseIds);
        continue;
      }

      dispatched.push(worker.id);

      // Emit dispatch event
      this.emit("coordination.worker.dispatched", {
        coordinationRunId: runId,
        workerId: worker.id,
        agentId: worker.agentId,
        sessionId: run.sessionId,
        taskGraphId: run.taskGraphId,
        timestamp: new Date().toISOString(),
      });

      // Start tracked execution
      const controller = new AbortController();
      const execPromise = this.executeWorker(runId, worker.id, controller.signal);
      this.activeExecutions.set(worker.id, { workerId: worker.id, runId, controller, promise: execPromise });
      execPromise.finally(() => this.activeExecutions.delete(worker.id));
    }

    run = (await this.deps.store.load(runId))!;
    const progressMade = dispatched.length > 0 || recResult.orphaned.length > 0 || recResult.dependencyBlocked.length > 0;

    // Emit tick completed
    this.emit("coordination.tick.completed", {
      coordinationRunId: runId,
      sessionId: run?.sessionId ?? "unknown",
      taskGraphId: run?.taskGraphId,
      examined: readyWorkers.length,
      dispatched,
      awaitingApproval,
      denied,
      ownershipConflicts,
      activeRunning,
      availableSlots,
      runStatus: run?.status ?? "failed",
      progressMade,
      timestamp: new Date().toISOString(),
    });

    // Finalize if run became terminal
    if (run?.status === "completed" || run?.status === "failed") {
      // Fire-and-forget — don't block the tick response
      this.maybeFinalizeRun(runId).catch(() => {});
    }

    return {
      runId, examined: readyWorkers.length, ready: readyWorkers.length,
      dispatched, awaitingApproval, denied, ownershipConflicts,
      dependencyBlocked: [...recResult.dependencyBlocked],
      recoveredOrphans: [...recResult.orphaned],
      activeRunning, availableSlots,
      runStatus: run?.status ?? "failed",
      progressMade,
    };
  }

  // ── Worker execution ───────────────────────────────────────────────

  private async executeWorker(runId: string, workerId: string, signal: AbortSignal): Promise<void> {
    const run = await this.deps.store.load(runId);
    if (!run) return;
    const worker = run.workers.find(w => w.id === workerId);
    if (!worker) return;

    try {
      const context: WorkerExecutionContext = {
        run, sessionId: run.sessionId, cwd: this.deps.cwd,
        config: await this.deps.configProvider(),
      };
      const result = await this.deps.executor.execute(worker, context, signal);

      if (result.outcome === "success") {
        const resultRef = await this.resultStore.persist(worker, runId, result);
        await this.deps.store.patchWorker(runId, workerId, {
          status: "completed", completedAt: new Date().toISOString(), resultRef,
        });
        this.emit("coordination.worker.completed", {
          coordinationRunId: runId,
          workerId: worker.id,
          agentId: worker.agentId,
          sessionId: run.sessionId,
          taskGraphId: run.taskGraphId,
          outcome: "success",
          timestamp: new Date().toISOString(),
        });
      } else {
        // Retryable failure check
        const isRetryable = result.failureKind === "timeout" || result.failureKind === "transient_provider" || result.failureKind === "execution_error";
        const currentRun = await this.deps.store.load(runId);
        const currentAttempt = currentRun?.workers.find(w => w.id === workerId)?.attempt ?? worker.attempt;
        if (isRetryable && currentAttempt < worker.maxAttempts) {
          // Persist failure result for audit trail
          try {
            const failureRef = await this.resultStore.persist(worker, runId, {
              outcome: "failure",
              error: result.error,
              failureKind: result.failureKind ?? "execution_error",
            });
            await this.deps.store.patchWorker(runId, workerId, {
              status: "pending", blockReason: undefined, failureKind: result.failureKind,
              error: result.error,
              resultRef: failureRef,
            });
          } catch { /* best-effort */ }
        } else {
          // Persist failure result
          try {
            const failureRef = await this.resultStore.persist(worker, runId, {
              outcome: "failure",
              error: result.error,
              failureKind: result.failureKind ?? "execution_error",
            });
            await this.deps.store.patchWorker(runId, workerId, {
              status: "failed", blockReason: "execution_failed", failureKind: result.failureKind ?? "execution_error",
              error: result.error ?? "Execution failed",
              resultRef: failureRef,
              completedAt: new Date().toISOString(),
            });
          } catch { /* best-effort */ }
          this.emit("coordination.worker.failed", {
            coordinationRunId: runId,
            workerId: worker.id,
            agentId: worker.agentId,
            sessionId: run.sessionId,
            taskGraphId: run.taskGraphId,
            outcome: "failed",
            failureKind: result.failureKind ?? "execution_error",
            error: result.error ?? "Execution failed",
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // AbortSignal errors from shutdown/cancellation are terminal — don't retry
      const isAbort = error instanceof Error && (error.name === "AbortError" || errorMsg.includes("abort"));
      if (isAbort) {
        try {
          await this.deps.store.patchWorker(runId, workerId, {
            status: "failed", blockReason: "cancelled", failureKind: "cancelled",
            error: "Worker cancelled by scheduler shutdown",
            completedAt: new Date().toISOString(),
          });
        } catch { /* best-effort */ }
        return;
      }
      // Check retry budget for catch-path failures (executor threw rather than returning a result)
      const currentRun = await this.deps.store.load(runId);
      const currentAttempt = currentRun?.workers.find(w => w.id === workerId)?.attempt ?? worker.attempt;
      const isRetryable = currentAttempt < (worker.maxAttempts ?? 3);
      // Persist failure result
      try {
        const failureRef = await this.resultStore.persist(worker, runId, {
          outcome: "failure",
          error: errorMsg,
          failureKind: "execution_error",
        });
        if (isRetryable) {
          await this.deps.store.patchWorker(runId, workerId, {
            status: "pending",
            blockReason: undefined,
            failureKind: "execution_error",
            error: errorMsg,
            resultRef: failureRef,
          });
        } else {
          await this.deps.store.patchWorker(runId, workerId, {
            status: "failed", blockReason: "execution_failed", failureKind: "execution_error",
            error: errorMsg,
            resultRef: failureRef,
            completedAt: new Date().toISOString(),
          });
        }
      } catch { /* best-effort */ }
      if (!isRetryable) {
        this.emit("coordination.worker.failed", {
          coordinationRunId: runId,
          workerId,
          agentId: worker.agentId,
          sessionId: run.sessionId,
          taskGraphId: run.taskGraphId,
          outcome: "failed",
          failureKind: "execution_error",
          error: errorMsg,
          timestamp: new Date().toISOString(),
        });
      }
    } finally {
      const finalRun = await this.deps.store.load(runId);
      const finalWorker = finalRun?.workers.find(w => w.id === workerId);
      if (finalWorker?.leaseIds && finalWorker.leaseIds.length > 0) {
        await releaseWorkerOwnership(this.deps.ownershipRegistry, finalWorker.leaseIds);
        await this.deps.store.patchWorker(runId, workerId, { leaseIds: [] });
      }
      // Check if run is now terminal
      if (finalRun?.status === "completed" || finalRun?.status === "failed") {
        this.maybeFinalizeRun(runId).catch(() => {});
      }
    }
  }

  // ── runUntilIdle ───────────────────────────────────────────────────

  async runUntilIdle(runId: string, options: RunUntilIdleOptions = {}): Promise<SchedulerRunResult> {
    const start = performance.now();
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_RUN_POLL_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const maxIdleTicks = options.maxIdleTicks ?? DEFAULT_MAX_IDLE_TICKS;
    const clock = this.deps.clock ?? systemClock;

    let cycles = 0;
    let totalDispatched = 0;
    let totalFailed = 0;
    let idleTicks = 0;

    while (performance.now() - start < timeoutMs) {
      const result = await this.tick(runId);
      cycles++;
      totalDispatched += result.dispatched.length;

      if (result.runStatus === "completed") {
        return { runId, finalStatus: "completed", stopReason: "completed", cycles, dispatched: totalDispatched, failed: totalFailed, durationMs: performance.now() - start };
      }
      if (result.runStatus === "failed") {
        return { runId, finalStatus: "failed", stopReason: "failed", cycles, dispatched: totalDispatched, failed: totalFailed, durationMs: performance.now() - start };
      }

      // Don't idle while active executions exist
      const activeForRun = [...this.activeExecutions.values()].filter(e => e.runId === runId);
      if (activeForRun.length > 0) {
        idleTicks = 0;
        await Promise.race([...activeForRun.map(e => e.promise), clock.sleep(pollIntervalMs)]);
        continue;
      }

      if (result.awaitingApproval.length > 0) {
        return { runId, finalStatus: "blocked", stopReason: "awaiting_approval", cycles, dispatched: totalDispatched, failed: totalFailed, durationMs: performance.now() - start };
      }

      if (result.progressMade) {
        idleTicks = 0;
      } else {
        idleTicks++;
        if (idleTicks >= maxIdleTicks) {
          return { runId, finalStatus: result.runStatus, stopReason: "idle", cycles, dispatched: totalDispatched, failed: totalFailed, durationMs: performance.now() - start };
        }
      }

      await clock.sleep(pollIntervalMs);
    }

    return { runId, finalStatus: "blocked", stopReason: "timeout", cycles, dispatched: totalDispatched, failed: totalFailed, durationMs: performance.now() - start };
  }

  // ── Heartbeat ──────────────────────────────────────────────────────

  async heartbeatActiveWorkers(): Promise<void> {
    const now = new Date().toISOString();
    for (const [workerId, exec] of this.activeExecutions) {
      await this.deps.store.patchWorker(exec.runId, workerId, { lastHeartbeatAt: now }).catch(() => {});
    }
  }

  // ── Lease renewal ──────────────────────────────────────────────────

  async renewActiveLeases(): Promise<void> {
    for (const [, exec] of this.activeExecutions) {
      const run = await this.deps.store.load(exec.runId);
      if (!run) continue;
      const worker = run.workers.find(w => w.id === exec.workerId);
      if (!worker || !worker.leaseIds || worker.leaseIds.length === 0) continue;
      const result = await renewWorkerOwnership(this.deps.ownershipRegistry, worker.leaseIds, this.options.ownershipTtlMs);
      if (result.failed.length > 0) {
        exec.controller.abort();
        await this.deps.store.patchWorker(exec.runId, exec.workerId, {
          status: "failed", blockReason: "lease_lost", failureKind: "lease_lost",
          error: `Lease renewal failed for IDs: ${result.failed.join(", ")}`,
        });
      }
    }
  }

  // ── Event emission (observability, not correctness) ──────────────

  private async emit(event: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.deps.eventLog) return;
    try {
      await this.deps.eventLog.append({
        sessionId: (payload.sessionId as string) ?? "unknown",
        actor: "coordination",
        type: event,
        payload,
      });
    } catch { /* events are observability, not correctness */ }
  }

  // ── Terminal finalization ──────────────────────────────────────────

  /**
   * If the run is terminal and a completion service is configured, finalize it.
   * This is best-effort — errors are logged but never thrown to the caller.
   */
  private async maybeFinalizeRun(runId: string): Promise<void> {
    if (!this.deps.completionService) return;
    try {
      const run = await this.deps.store.load(runId);
      if (!run || (run.status !== "completed" && run.status !== "failed")) return;
      // Run conflict detection once at finalization, before the completion
      // service runs. Best-effort — failures are logged but never thrown.
      if (this.options.enableConflictDetection) {
        await this.runConflictDetection(runId);
      }
      await this.deps.completionService.finalize(runId);
    } catch (error) {
      // Finalization is observability — never affects scheduler correctness
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[scheduler] Finalization failed for ${runId}: ${msg}`);
    }
  }

  private async runConflictDetection(runId: string): Promise<void> {
    try {
      const collabStore = new CollaborationStore(this.deps.cwd, runId);
      const conflictRepo = new ConflictRepository(collabStore);
      const detector = new ConflictDetector({
        collabStore,
        coordinationStore: this.deps.store,
        resultStore: this.resultStore,
        candidateGenerator: new ConflictCandidateGenerator(),
        claimComparator: new ClaimComparator(),
        evidenceComparator: new ConflictEvidenceComparator(collabSystemClock),
        conflictRepo,
      });
      await detector.detectConflicts(runId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[scheduler] Conflict detection failed for ${runId}: ${msg}`);
    }
  }

  // ── Cancel ─────────────────────────────────────────────────────────

  async cancelRun(runId: string): Promise<void> {
    // Abort active executions for this run
    for (const [, exec] of this.activeExecutions) {
      if (exec.runId === runId) exec.controller.abort();
    }
    const run = await this.deps.store.load(runId);
    if (!run) return;
    for (const worker of run.workers) {
      if (worker.status === "running" || worker.status === "pending") {
        if (worker.leaseIds && worker.leaseIds.length > 0) {
          await releaseWorkerOwnership(this.deps.ownershipRegistry, worker.leaseIds);
        }
        await this.deps.store.patchWorker(runId, worker.id, {
          status: "cancelled", blockReason: "cancelled", leaseIds: [],
        });
      }
    }
    await this.maybeFinalizeRun(runId);
  }

  // ── Shutdown ───────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    for (const [, exec] of this.activeExecutions) {
      exec.controller.abort();
    }
    // Wait for all to settle
    const promises = [...this.activeExecutions.values()].map(e => e.promise.catch(() => {}));
    await Promise.all(promises);
    this.activeExecutions.clear();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function emptyTick(runId: string, status: CoordinationRunStatus): SchedulerTickResult {
  return {
    runId, examined: 0, ready: 0, dispatched: [], awaitingApproval: [], denied: [],
    ownershipConflicts: [], dependencyBlocked: [], recoveredOrphans: [], activeRunning: 0, availableSlots: 0,
    runStatus: status, progressMade: false,
  };
}
