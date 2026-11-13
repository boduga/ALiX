import { randomUUID } from "node:crypto";
import { resolve } from "path";
import type { SubagentRole, SubagentTask, SubagentResult, SubagentRoleConfig, AlixConfig } from "../operations/config/schema.js";
import { parseSessionMode } from "../operations/config/schema.js";
import { getSubagentRole } from "../operations/config/subagent-config.js";
import { createModelResolver } from "../operations/config/model-resolver.js";
import type { EventLog } from "../runtime-state/events/event-log.js";
import { OwnershipRegistry, type AcquireRequest } from "../coordination/ownership/ownership-registry.js";
import { ExecutionCancelledError } from "../runtime-state/runtime/cancellation-token.js";
import { requireTaskWorkerSupervisor, projectSupervisorTask, snapshotPreparedRequest, snapshotWorkerEvidence, validateTaskCompletion } from "./worker-task-supervisor.js";
import type { TaskWorkerSupervisor, TaskWorkerHandle } from "./worker-task-supervisor.js";
import type { WorkerGrantIdentity } from "./worker-grant-binding.js";
import { WorkerSupervisorUnavailableError } from "./worker-supervisor.js";
import { resolveOwnedScopePrefix } from "../coordination/ownership/path-scope.js";

// Re-export types for consumers
export type { SubagentTask, SubagentResult };

export type SubagentManagerOptions = {
  sessionId: string;
  /** Logical parent identity for Workbench hierarchy. Defaults to the session root. */
  parentAgentId?: string;
  /**
   * Workspace root captured at CONSTRUCTION. Registry files
   * (`<cwd>/.alix/ownership/`) derive from it; per-task `task.cwd` wins for
   * that task's claims. Never re-read from process.cwd() at write time.
   */
  cwd?: string;
  config?: AlixConfig;
  /** Trusted composition only. Runtime configuration cannot select a supervisor. */
  workerSupervisor?: TaskWorkerSupervisor;
  /** @deprecated Rejected: direct worker spawning is no longer supported. */
  spawnOverride?: { command: string; args?: string[] };
  /** Event log for emitting subagent lifecycle events into the session stream. */
  eventLog?: EventLog;
  /** @deprecated Rejected: an observer cannot authorize worker execution. */
  supervisorWorkerLifecycle?: {
    onSpawned: (identity: { pid: number; uid: number; coordinationRunId: string; workerId: string; attempt: number }) => Promise<void>;
    onExited: (pid: number) => void;
  };
};

type RunningSubagent = {
  task: SubagentTask;
  identity: WorkerGrantIdentity;
  supervisor: TaskWorkerSupervisor;
  handle?: TaskWorkerHandle;
  cancelled: boolean;
  launchInvoked: boolean;
  prepareInvoked: boolean;
  clean: boolean;
  revocation?: Promise<void>;
  pendingLaunch?: Promise<TaskWorkerHandle>;
  handleCancellation?: Promise<void>;
  interrupted: Promise<never>;
  interrupt: (error: Error) => void;
};

/** Control-plane bounds never impose a deadline on a running agent. */
async function boundedControl<T>(operation: Promise<T>, milliseconds = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("WorkerSupervisor control operation unresolved")), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export type SubagentResultCallback = (result: SubagentResult) => void;

/**
 * Presentation-only coordination correlation fields for lifecycle events.
 * The three always travel together (planner → task → roster drawer), so
 * they are gathered here rather than spread ad hoc at each emit site.
 */
export function coordinationPresentationMeta(task: SubagentTask): {
  coordinationRunId?: string;
  assignedAgentId?: string;
  taskLabel?: string;
} {
  return {
    ...(task.coordinationRunId ? { coordinationRunId: task.coordinationRunId } : {}),
    ...(task.assignedAgentId ? { assignedAgentId: task.assignedAgentId } : {}),
    ...(task.taskLabel ? { taskLabel: task.taskLabel } : {}),
  };
}

/** Renew active chat-delegate leases well inside the registry's 30-min TTL. */
const LEASE_RENEW_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Decide what a single lease-renewal pass does with a task's entry.
 *
 * A task released while `renew` was awaited is no longer tracked
 * (`tracked === false`): the pass must NOT re-insert it (that resurrects a
 * released task and leaks its leases) — instead the caller releases the ids
 * this pass just renewed. Extracted as a pure function so this
 * release/renew race is unit-testable without waiting out the real interval.
 */
export function resolveRenewalResult(
  tracked: boolean,
  kept: string[],
): { action: "set" | "delete" | "release"; releaseIds: string[] } {
  if (!tracked) return { action: "release", releaseIds: kept };
  return kept.length > 0 ? { action: "set", releaseIds: [] } : { action: "delete", releaseIds: [] };
}

export class SubagentManager {
  private running = new Map<string, RunningSubagent>();
  private callbacks: SubagentResultCallback[] = [];
  /**
   * R3.2: ONE durable ownership authority. Spawn-time claims for chat-path
   * write delegates acquire leases on the shared registry
   * (`<cwd>/.alix/ownership/ownership.json`, cross-process lock) — the old
   * in-process `Map<path, subagentId>` was a second, weaker registry (exact
   * string keys only, died with the process, invisible to other hosts).
   * Coordination tasks (`coordinationRunId`/`assignedAgentId` set) SKIP
   * acquisition: the scheduler already pre-claims their leases before dispatch
   * (`acquireWorkerOwnership`), under a different agentId.
   */
  private readonly registryCwd: string;
  private readonly registries = new Map<string, OwnershipRegistry>();
  private readonly leasesByTask = new Map<string, { cwd: string; ids: string[] }>();
  private renewTimer?: ReturnType<typeof setInterval>;
  /**
   * Bumped by `shutdown()`. Because `spawn` now awaits lease acquisition
   * before the child exists, a shutdown racing an in-flight spawn would
   * otherwise kill nothing and orphan the child behind it: the spawn
   * re-checks the epoch after acquisition and cancels itself instead.
   */
  private spawnEpoch = 0;
  private readonly delegateRunId = `delegate:${randomUUID()}`;
  private readonly attempts = new Map<string, number>();
  private startup?: Promise<void>;
  private quarantined = false;

  constructor(private options: SubagentManagerOptions) {
    this.registryCwd = resolve(options.cwd ?? process.cwd());
  }

  private registryFor(cwd: string): OwnershipRegistry {
    const key = resolve(cwd);
    let registry = this.registries.get(key);
    if (!registry) {
      registry = new OwnershipRegistry(key, { sessionId: this.options.sessionId });
      this.registries.set(key, registry);
    }
    return registry;
  }

  /**
   * Acquire exclusive-write leases for a chat-path write task's ownedPaths.
   * Throws on conflict (overlapping ownership) or on an uninterpretable path —
   * spawn never proceeds without the leases it depends on (fail closed).
   */
  private async acquireTaskOwnership(task: SubagentTask): Promise<void> {
    if (task.mode !== "write" || !task.ownedPaths?.length) return;
    if (task.coordinationRunId || task.assignedAgentId) return; // scheduler pre-claimed
    const cwd = resolve(task.cwd ?? this.registryCwd);
    const registry = this.registryFor(cwd);
    const reqs: AcquireRequest[] = [];
    for (const path of task.ownedPaths) {
      // Enforcement-faithful scope: the same reduction PolicyGate and
      // FileToolRouter apply to ownedPaths (`.`, `dir`, `dir/**`, file all
      // reduce to a workspace prefix), so lease conflicts and runtime
      // authorization agree on what a claim covers.
      const prefix = resolveOwnedScopePrefix(path, cwd);
      if (prefix === undefined) {
        throw new Error(`Invalid ownership path '${path}' — cannot be reduced to a workspace scope`);
      }
      reqs.push({
        agentId: task.id,
        scope: { kind: "path", root: prefix, recursive: true },
        mode: "exclusive-write",
        taskId: task.id,
        sessionId: this.options.sessionId,
        reason: `Subagent ${task.id}`,
      });
    }
    const results = await registry.acquireMany(reqs);
    const acquired: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.acquired && result.record) {
        acquired.push(result.record.id);
        continue;
      }
      for (const id of acquired) {
        await registry.release(id).catch(() => false); // best-effort rollback
      }
      const other = result.conflict?.conflictingRecords[0]?.agentId;
      if (other) {
        throw new Error(`Overlapping ownership: '${task.ownedPaths[i]}' is already owned by '${other}'`);
      }
      throw new Error(result.conflict?.reason ?? `Ownership acquisition failed for '${task.ownedPaths[i]}'`);
    }
    if (acquired.length > 0) {
      this.leasesByTask.set(task.id, { cwd, ids: acquired });
      this.ensureLeaseRenewal();
    }
  }

  /** Release a task's leases. Idempotent; safe to call from exit/error paths. */
  private async releaseTaskOwnership(taskId: string): Promise<void> {
    const entry = this.leasesByTask.get(taskId);
    if (!entry) return;
    this.leasesByTask.delete(taskId);
    const registry = this.registryFor(entry.cwd);
    for (const id of entry.ids) {
      await registry.release(id).catch(() => false); // TTL is the backstop
    }
  }

  /**
   * Keep running delegates' leases alive past the registry TTL (agents have
   * unlimited lifetime). Renewals that find their record gone (released or
   * expired externally) drop the id; the timer stops itself when no leases
   * remain. `unref` so it never holds the process open.
   */
  private ensureLeaseRenewal(): void {
    if (this.renewTimer) return;
    this.renewTimer = setInterval(() => { void this.renewTaskLeases().catch(() => { this.enterQuarantine(); }); }, LEASE_RENEW_INTERVAL_MS);
    this.renewTimer.unref?.();
  }

  private async renewTaskLeases(): Promise<void> {
    for (const [taskId, entry] of [...this.leasesByTask]) {
      const registry = this.registryFor(entry.cwd);
      for (const id of entry.ids) {
        const renewed = await registry.renew(id).catch(() => false);
        if (!this.leasesByTask.has(taskId)) {
          if (renewed) await registry.release(id).catch(() => false);
          continue;
        }
        if (!renewed) {
          // Tracking a lost lease does not preserve exclusivity. Fence execution
          // and quarantine this manager; only canonical recovery can clear it.
          this.cancel(taskId);
          this.enterQuarantine();
          this.emitLifecycle("agent.state_changed", {agentId: taskId, state: "cancelling",
            error: "Ownership renewal failed; supervisor recovery required"});
        }
      }
    }
    if (this.leasesByTask.size === 0 && this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = undefined;
    }
  }

  onResult(cb: SubagentResultCallback): void {
    this.callbacks.push(cb);
  }

  /** Dispatch only through the canonical task supervisor. No direct-spawn fallback. */
  async spawn(input: SubagentTask): Promise<SubagentResult> {
    if (this.quarantined) throw new Error("WorkerSupervisor SECURITY HOLD: unresolved worker cleanup");
    if (this.options.spawnOverride || this.options.supervisorWorkerLifecycle) throw new WorkerSupervisorUnavailableError();
    const supervisor = requireTaskWorkerSupervisor(this.options.workerSupervisor);
    // Snapshot before any await. Caller mutation cannot change the prepared task.
    const task = structuredClone(input);
    if (this.running.has(task.id)) throw new Error("Duplicate active worker task");
    const coordinated = task.coordinationRunId !== undefined || task.coordinationWorkerAttempt !== undefined;
    if ((coordinated && (!task.coordinationRunId?.trim() || !Number.isSafeInteger(task.coordinationWorkerAttempt) || task.coordinationWorkerAttempt! < 1)) ||
        (task.assignedAgentId && !coordinated)) throw new Error("Incomplete coordinated worker identity");
    const attempt = coordinated ? task.coordinationWorkerAttempt! : (this.attempts.get(task.id) ?? 0) + 1;
    const identity = Object.freeze({coordinationRunId: coordinated ? task.coordinationRunId! : this.delegateRunId, workerId: task.id, attempt});
    const model = this.getRoleModel(task.role);
    const projected = projectSupervisorTask(task, identity, resolve(task.cwd ?? this.registryCwd), model,
      parseSessionMode(this.options.config?.permissions?.sessionMode));
    let interrupt!: (error: Error) => void;
    const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
    void interrupted.catch(() => {});
    const state: RunningSubagent = {interrupted, interrupt, task, identity: projected.identity, supervisor, cancelled: false,
      launchInvoked: false, prepareInvoked: false, clean: false};
    this.running.set(task.id, state);
    if (!coordinated) this.attempts.set(task.id, attempt);
    const epoch = this.spawnEpoch;
    const eventSessionId = task.eventSessionId ?? this.options.sessionId;
    const lifecycleBase = {agentId: task.id, parentAgentId: this.options.parentAgentId ?? `session:${eventSessionId}`,
      taskId: task.id, role: task.role, model: `${model.provider}/${model.name}`, ...coordinationPresentationMeta(task)};
    const checkCancelled = (): void => {
      if (this.quarantined) throw new Error("WorkerSupervisor SECURITY HOLD: unresolved worker cleanup");
      if (state.cancelled || epoch !== this.spawnEpoch) throw new ExecutionCancelledError("Manager cancellation");
    };
    try {
      if (!this.startup) {
        const operation = boundedControl(Promise.resolve().then(() => supervisor.reconcile()));
        this.startup = operation;
        void operation.catch(() => { if (this.startup === operation) this.startup = undefined; });
      }
      await Promise.race([this.startup, interrupted]);
      checkCancelled();
      await this.acquireTaskOwnership(task);
      checkCancelled();
      state.prepareInvoked = true;
      const request = snapshotPreparedRequest(await Promise.race([supervisor.prepareTask(projected), interrupted]), projected);
      checkCancelled();
      state.launchInvoked = true;
      const launching = Promise.resolve().then(() => { checkCancelled(); return supervisor.launch(request); });
      state.pendingLaunch = launching;
      // A timed-out launch can return after the caller has been quarantined.
      // Retain cleanup responsibility for that exact late generation.
      void launching.then(async handle => {
        state.handle = handle;
        if (state.cancelled || this.quarantined) {
          if (!handle || typeof handle.cancel !== "function") throw new Error("Late worker has no cancellation handle");
          await this.cancelHandle(state, handle);
        }
      }, () => { /* Main finalization owns launch rejection cleanup. */ }).catch(() => { this.enterQuarantine(); });
      const handle = await Promise.race([launching, interrupted]);
      state.handle = handle;
      if (!handle || typeof handle.cancel !== "function" || typeof handle.wait !== "function" || typeof handle.completion !== "function") {
        throw new Error("WorkerSupervisor returned an incomplete task handle");
      }
      const evidence = snapshotWorkerEvidence(handle.evidence, identity);
      checkCancelled();
      this.emitLifecycle("subagent.started", {role: task.role, taskId: task.id, prompt: task.prompt.slice(0, 200), ownedPaths: task.ownedPaths ?? []}, eventSessionId);
      this.emitLifecycle("agent.spawned", {...lifecycleBase, state: "starting", operation: task.prompt.slice(0, 200), ownedPaths: task.ownedPaths ?? []}, eventSessionId);
      this.emitLifecycle("agent.task_assigned", {...lifecycleBase, title: task.taskLabel ?? task.prompt.slice(0, 200),
        prompt: task.prompt.slice(0, 200), ownedPaths: task.ownedPaths ?? []}, eventSessionId);
      if (task.ownedPaths?.length) this.emitLifecycle("agent.ownership_changed", {...lifecycleBase, ownedPaths: task.ownedPaths}, eventSessionId);
      this.emitLifecycle("agent.state_changed", {...lifecycleBase, state: "thinking", operation: "Supervised worker running"}, eventSessionId);
      const completion = Promise.resolve().then(() => handle.completion()).then(value => validateTaskCompletion(value, evidence, task.role));
      const waiting = Promise.resolve().then(() => handle.wait());
      // Attach handlers immediately: either operation may reject first.
      void completion.catch(() => {});
      void waiting.catch(() => {});
      const afterExit = waiting.then(() => boundedControl(completion, 1000));
      const [raw, exit] = await Promise.race([Promise.all([Promise.race([completion, afterExit]), waiting]), interrupted]);
      if (!exit || (exit.exitCode !== null && (!Number.isSafeInteger(exit.exitCode) || exit.exitCode < 0)) ||
          (exit.signal !== null && typeof exit.signal !== "string")) throw new Error("Invalid supervised worker exit result");
      if (state.revocation) await state.revocation;
      state.clean = true; // Trusted wait contract includes reap/containment, not a PID probe.
      checkCancelled();
      const result: SubagentResult = structuredClone(raw);
      if (result.status === "success" && (exit.exitCode !== 0 || exit.signal !== null)) {
        result.status = "failed";
        result.error = "Worker success report contradicted by abnormal native exit";
      }
      await this.releaseTaskOwnership(task.id);
      checkCancelled();
      this.running.delete(task.id);
      for (const callback of this.callbacks) { try { callback(structuredClone(result)); } catch { /* telemetry cannot change task outcome */ } }
      this.emitLifecycle("subagent.result", {role: task.role, taskId: task.id, status: result.status, findings: result.findings,
        ...coordinationPresentationMeta(task), ...(task.deferTerminalLifecycle ? {attemptTerminal: false} : {}), agentId: task.id}, eventSessionId);
      if (!task.deferTerminalLifecycle) this.emitLifecycle(result.status === "failed" || result.status === "rejected" ? "agent.failed" : "agent.completed",
        {...lifecycleBase, state: result.status === "success" ? "completed" : result.status, status: result.status,
          ...(result.error ? {error: result.error} : {})}, eventSessionId);
      return result;
    } catch (error) {
      let cleanupError: unknown;
      if (!state.clean && state.prepareInvoked) {
        try { await this.confirmCleanup(state); state.clean = true; } catch (failure) { cleanupError = failure; }
      }
      if (cleanupError) {
        this.enterQuarantine();
        this.emitLifecycle("agent.state_changed", {...lifecycleBase, state: "cancelling", error: "Worker cleanup unresolved; dispatch quarantined"}, eventSessionId);
        const combined = new AggregateError([error, cleanupError], "WorkerSupervisor cleanup unresolved; original failure retained");
        if (state.cancelled || epoch !== this.spawnEpoch) {
          const cancelled = new ExecutionCancelledError("Worker cleanup unresolved; dispatch quarantined");
          cancelled.cause = combined;
          throw cancelled;
        }
        throw combined;
      }
      await this.releaseTaskOwnership(task.id);
      this.running.delete(task.id);
      if (state.cancelled || epoch !== this.spawnEpoch) {
        this.emitLifecycle("agent.cancelled", {...lifecycleBase, state: "cancelled", status: "cancelled"}, eventSessionId);
        throw new ExecutionCancelledError("Manager cancellation");
      }
      this.emitLifecycle("agent.failed", {...lifecycleBase, state: "failed", status: "failed",
        error: error instanceof Error ? error.message : "Supervised worker failed"}, eventSessionId);
      throw error;
    }
  }

  private requestRevocation(state: RunningSubagent): Promise<void> {
    if (!state.revocation) {
      state.revocation = boundedControl(Promise.resolve().then(() => state.supervisor.revoke(state.identity)));
      void state.revocation.catch(() => { this.enterQuarantine(); });
    }
    return state.revocation;
  }

  private cancelHandle(state: RunningSubagent, handle: TaskWorkerHandle): Promise<void> {
    if (!state.handleCancellation) {
      state.handleCancellation = boundedControl(Promise.resolve().then(() => handle.cancel("Task failed or cancelled")));
      void state.handleCancellation.catch(() => { this.enterQuarantine(); });
    }
    return state.handleCancellation;
  }

  private enterQuarantine(): void {
    this.quarantined = true;
    for (const state of this.running.values()) {
      state.interrupt(new Error("WorkerSupervisor SECURITY HOLD: unresolved worker cleanup"));
    }
  }

  private async confirmCleanup(state: RunningSubagent): Promise<void> {
    const operations: Promise<unknown>[] = [this.requestRevocation(state)];
    if (state.pendingLaunch) {
      operations.push(boundedControl(state.pendingLaunch.then(async handle => {
        if (!handle || typeof handle.cancel !== "function") throw new Error("Worker cleanup handle unavailable");
        await this.cancelHandle(state, handle);
      }, () => { /* A rejected launch still requires canonical revoke/reconcile. */ })));
    } else if (state.handle && typeof state.handle.cancel === "function") {
      operations.push(this.cancelHandle(state, state.handle));
    }
    const outcomes = await Promise.allSettled(operations);
    await boundedControl(Promise.resolve().then(() => state.supervisor.reconcile()));
    const failure = outcomes.find(item => item.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }

  /**
   * Parallel fan-out: launch every spec before awaiting any of them.
   * Per-child error isolation — a spawn rejection becomes a failed result
   * for that child, never a batch rejection. Results align to input order
   * even when completion order differs. Reuses the single-spawn path, so
   * ownership, lifecycle, and session-mode propagation behave identically.
   */
  async spawnMany(specs: SubagentTask[]): Promise<SubagentResult[]> {
    const settled = await Promise.allSettled(specs.map(task => this.spawn(task)));
    return settled.map((outcome, i) => {
      if (outcome.status === "fulfilled") return outcome.value;
      const task = specs[i];
      return {
        id: task.id,
        role: task.role,
        status: "failed" as const,
        findings: [],
        events: [],
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      };
    });
  }

  /** Accept a cancellation request; termination is confirmed by spawn settlement. */
  cancel(taskId: string): boolean {
    const state = this.running.get(taskId);
    if (!state) return false;
    if (state.cancelled) return true;
    state.cancelled = true;
    state.interrupt(new ExecutionCancelledError("Manager cancellation"));
    this.emitLifecycle("agent.state_changed", {agentId: taskId, taskId, role: state.task.role,
      state: "cancelling", operation: "Manager cancel"}, state.task.eventSessionId ?? this.options.sessionId);
    if (state.prepareInvoked && !state.clean) void this.requestRevocation(state);
    return true;
  }

  shutdown(): void {
    this.spawnEpoch++;
    for (const id of this.running.keys()) this.cancel(id);
  }

  private emitLifecycle(type: string, payload: Record<string, unknown>, sessionId = this.options.sessionId): void {
    try { void this.options.eventLog?.append({sessionId, actor: "system", type, payload}).catch(() => {}); }
    catch { /* Best-effort presentation must not change execution or cleanup. */ }
  }

  getRoleConfig(role: SubagentRole): SubagentRoleConfig | undefined {
    return getSubagentRole(this.options.config, role);
  }

  /**
   * Resolve the model for a subagent role.
   *
   * Reads the CANONICAL `models` object via `createModelResolver` rather than the
   * derived `subagents.<tier>` projection (MP-01). The projection is a loader
   * output for compatibility and will be retired in MP-02; a reader that depends
   * on it would have to be migrated before that removal is safe. Resolution order
   * is preserved exactly: role style, then default.
   *
   * NOTE: reading the projection first when it exists keeps this a pure reader
   * change. `models` and the projection are derived from the same loader pass, so
   * they agree; the canonical source is consulted so MP-02 cannot silently break
   * this call site.
   */
  getRoleModel(role: SubagentRole): { provider: string; name: string } {
    const roleConfig = this.getRoleConfig(role);
    const style = roleConfig?.style ?? "fast";
    const resolved = createModelResolver(this.options.config ?? {}).resolve(style);
    if (!resolved) {
      throw new Error(
        `Subagent tier "${style}" is unconfigured. ` +
        `This should not happen because loadConfig fills unset tiers from the main model. ` +
        `Please file a bug report.`
      );
    }
    return { provider: resolved.provider, name: resolved.name };
  }
}
