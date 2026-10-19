/**
 * coordination-tools.ts — Chat-tool handlers for coordination runs.
 *
 * Exposes the CLI foreground flow (`coordination run/status/results`) as
 * ToolExecutor extraHandlers so agent turns (chat, and later web) can
 * start parallel multi-worker runs without shelling out:
 *
 * - `coordination.run` — plan + schedule + runUntilIdle (blocking), returns
 *   run id, final status, and per-worker outcomes as text.
 * - `coordination.status` — run state summary from the store (read-only).
 * - `coordination.results` — aggregate result summary (read-only).
 *
 * Executor names use dots (`coordination.run`); model names use the
 * `alix_coordination_*` model names (tool manifest). Policy keys/capabilities
 * come from the registry entries in tool-registry.ts.
 */

import type { AlixConfig, SessionMode } from "../../operations/config/schema.js";
import { parseSessionMode } from "../../operations/config/schema.js";
import { isSubagentsEnabled } from "../../operations/config/subagent-config.js";
import type { EventLog } from "../../runtime-state/events/event-log.js";
import { COORDINATION_EVENT_TYPES } from "../../runtime-state/events/types.js";
import type { ToolResult } from "../../capabilities/tools/types.js";
import { CoordinationStore } from "./coordination-store.js";
import { CoordinationPlanner } from "./coordination-planner.js";
import { createPlannerGenerator } from "./planner-model.js";
import { createCoordinationScheduler } from "./coordination-scheduler.js";
import { OwnershipRegistry } from "../ownership/ownership-registry.js";
import { ExecutionAuthorization } from "../../runtime-state/runtime/execution-authorization.js";
import { PolicyGate } from "../../governance/policy/policy-gate.js";
import type { CoordinationWorkerExecutor } from "./worker-executor.js";
import { buildDefaultToolIndex } from "../../capabilities/tools/tool-registry.js";
import type { ToolCallRequest } from "../../capabilities/tools/types.js";
import { ExecutionCancelledError } from "../../runtime-state/runtime/cancellation-token.js";
import { cancelDeadOwnerRuns } from "./coordination-resume.js";
import type { ApprovalStore } from "../../governance/approvals/approval-store.js";

export const COORDINATION_RUN_TOOL = "coordination.run";
export const COORDINATION_STATUS_TOOL = "coordination.status";
export const COORDINATION_LIST_TOOL = "coordination.list";
export const COORDINATION_RESULTS_TOOL = "coordination.results";

export const MAX_COORDINATION_TOOL_CONCURRENCY = 8;

/** Bounded per-worker rows in `coordination.status` output. */
const MAX_STATUS_WORKER_ROWS = 20;

/**
 * A rejected plan is fixable — the goal text is the caller's own input — so
 * the failure carries the recovery steps instead of a "do not retry" verdict.
 */
const PLAN_FAILURE_HINT =
  "Fix the goal text and call again: give each worker exactly one owned path, keep owners disjoint, "
  + "and note that auxiliary steps (creating the directory, verifying outputs) do not count toward the stated worker count.";

export type CoordinationToolDeps = {
  cwd: string;
  config: AlixConfig;
  /** Active parent session used by session-scoped runtime projections. */
  sessionId?: string;
  approvalStore?: ApprovalStore;
  eventLog?: EventLog;
  /** Injectable for tests (defaults to a live store/planner). */
  store?: CoordinationStore;
  planner?: CoordinationPlanner;
  /**
   * Injectable worker executor (defaults to the subagent or in-process one
   * chosen from `config.subagents.enabled`).
   *
   * This exists because the operator-abort path could not otherwise be driven
   * end-to-end from a test: `handleCoordinationRun` built its executor
   * internally, so a test could only abort BEFORE the call — which takes the
   * `signal.aborted` early-return and never reaches the abort LISTENER, the
   * in-flight `cancellation()` await, or a real worker being aborted mid-execute.
   * Those are exactly the branches that decide whether a cancelled run leaves
   * leases held, and the unit tests of `createCancelGuard` cannot see them.
   */
  executor?: CoordinationWorkerExecutor;
};

/** ExtraHandlers record for ToolExecutor (mirrors the `delegate` wiring). */
export function createCoordinationHandlers(
  deps: CoordinationToolDeps,
): Record<string, (args: Record<string, unknown>, request?: ToolCallRequest) => Promise<ToolResult>> {
  return {
    [COORDINATION_RUN_TOOL]: (args, request) => handleCoordinationRun(deps, args, request),
    [COORDINATION_STATUS_TOOL]: (args) => handleCoordinationStatus(deps, args),
    [COORDINATION_LIST_TOOL]: (args) => handleCoordinationList(deps, args),
    [COORDINATION_RESULTS_TOOL]: (args) => handleCoordinationResults(deps, args),
  };
}

/**
 * Resolve the approval mode for a model-originated coordination run.
 *
 * `args.sessionMode` is model output, so it is untrusted: it may TIGHTEN the
 * host's session mode but never loosen it. `ask` is the only enforcing mode —
 * `PolicyGate.applySessionMode` turns an `ask` decision into `allow` under
 * `auto`/`bypass` — so accepting a looser argument would let the model
 * downgrade the operator's approval posture for every worker capability
 * (session `run-real`: an `ask` session was downgraded by a
 * `{"sessionMode":"bypass"}` tool argument, and no worker approval was ever
 * requested).
 *
 * Invalid or absent arguments fall back to the host mode, never to a looser
 * one. The value returned here is what the planner persists as
 * `run.sessionMode` and what the scheduler authorizes workers under, including
 * after a reload — so clamping before persistence closes the boundary for the
 * whole lifecycle.
 */
function effectiveSessionMode(
  config: AlixConfig,
  arg: unknown,
): SessionMode {
  const configured = parseSessionMode(config.permissions.sessionMode);
  const requested = parseSessionMode(arg, configured);
  return configured === "ask" || requested === "ask" ? "ask" : configured;
}

/**
 * Build the failure recorder for a cancelling run.
 *
 * `sessionId` is a PARAMETER, not a captured variable, on purpose. The previous
 * version closed over the run record — a `const` declared *after* the cancel
 * sites — so on the failure path the closure hit the temporal dead zone, threw,
 * and the inner catch swallowed it. The event that exists to prove the run was
 * not finalized was the one thing never recorded. Binding the value at
 * construction makes that class of bug structurally impossible.
 */
export function createCancelFailureRecorder(deps: {
  eventLog: EventLog | undefined;
  runId: string;
  sessionId: string;
}): (error: unknown) => Promise<unknown> | undefined {
  return (error: unknown) => deps.eventLog?.append({
    sessionId: deps.sessionId,
    actor: "coordination",
    type: COORDINATION_EVENT_TYPES.CANCEL_FAILED,
    payload: {
      runId: deps.runId,
      error: error instanceof Error ? error.message : String(error),
      // The run may still be `running` with leases held, and a live
      // `tool-<pid>` owner is never reclaimed — this is the only record.
      reason: "operator cancel could not finalize the run",
    },
  });
}

/**
 * Cancel-with-record guard for the operator-abort path.
 *
 * The abort listener is a SYNCHRONOUS callback, so `cancel()` returning a
 * rejected promise there leaves the rejection with no handler: Node reports an
 * unhandled rejection with nothing on the stack and may tear down the process.
 * So the handler is attached at creation, never later.
 *
 * The rejection is caught rather than rethrown — an operator who asked to stop
 * must not be handed a store error instead of a cancellation — but it is never
 * silent: `onFailure` records it. That matters because a cancel that could not
 * complete leaves the run `running` with leases held, and the reclaim sweeps
 * only recover a DEAD owner. Without the record, a failed cancel and a
 * successful one are indistinguishable.
 *
 * Exported so the shape is directly testable: `handleCoordinationRun` builds
 * its scheduler and worker executor internally, so the abort path cannot be
 * driven end-to-end from a test without a much larger seam.
 */
export function createCancelGuard(deps: {
  cancel: () => Promise<void>;
  onFailure: (error: unknown) => Promise<unknown> | unknown;
}): {
  cancelRun: () => Promise<void>;
  onAbort: () => void;
  /** The in-flight cancel, once the listener has fired. */
  cancellation: () => Promise<void> | undefined;
} {
  let pending: Promise<void> | undefined;
  const cancelRun = (): Promise<void> => deps.cancel().catch((err: unknown) => {
    // `onFailure` is awaited-and-caught rather than fire-and-forget, so the
    // record lands before the turn ends. It is still not allowed to reject:
    // a broken recorder must not turn a cancellation into a tool failure, and
    // must not leave an unhandled rejection behind either.
    return Promise.resolve()
      .then(() => deps.onFailure(err))
      .then(() => undefined)
      .catch(() => undefined);
  });
  return {
    cancelRun,
    onAbort: (): void => {
      if (pending) return;
      pending = cancelRun();
    },
    cancellation: (): Promise<void> | undefined => pending,
  };
}

async function handleCoordinationRun(
  deps: CoordinationToolDeps,
  args: Record<string, unknown>,
  request?: ToolCallRequest,
): Promise<ToolResult> {
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  if (!goal) {
    return { kind: "error", message: "coordination.run requires a goal string", retryable: false };
  }
  const rawConcurrency = typeof args.maxConcurrency === "number" ? args.maxConcurrency : 2;
  const maxConcurrency = Math.min(
    MAX_COORDINATION_TOOL_CONCURRENCY,
    Math.max(1, Math.floor(rawConcurrency)),
  );
  const sessionMode = effectiveSessionMode(deps.config, args.sessionMode);
  const config: AlixConfig = {
    ...deps.config,
    permissions: { ...deps.config.permissions, sessionMode },
  };

  const store = deps.store ?? new CoordinationStore(deps.cwd);
  // Self-heal before planning: a run whose host died mid-execution holds
  // leases that would otherwise block this run's claims until the TTL.
  await cancelDeadOwnerRuns(store, ["cli"], new OwnershipRegistry(deps.cwd));
  const toolRegistry = buildDefaultToolIndex().registry;
  const agentPool = Array.isArray(args.agentPool)
    ? (args.agentPool as unknown[]).filter((a): a is string => typeof a === "string" && a.length > 0)
    : undefined;
  const planner = deps.planner ?? new CoordinationPlanner(
    deps.cwd,
    { ...(agentPool?.length ? { agentPool } : {}), generate: createPlannerGenerator(deps.config) },
    { toolRegistry },
  );

  let planResult;
  try {
    planResult = await planner.plan(goal, "alix", deps.sessionId ?? `coord_tool_${Date.now()}`, {
      hostKind: "cli",
      sessionMode,
      maxConcurrency,
    });
  } catch (err) {
    return {
      kind: "error",
      message: `Coordination plan failed: ${err instanceof Error ? err.message : String(err)}`,
      hint: PLAN_FAILURE_HINT,
      retryable: true,
    };
  }
  if (!planResult.valid || !planResult.run) {
    return {
      kind: "error",
      message: `Coordination plan failed: ${planResult.errors.join("; ") || "unknown error"}`,
      hint: PLAN_FAILURE_HINT,
      retryable: true,
    };
  }

  const runId = planResult.run.id;
  if (deps.eventLog) {
    for (const worker of planResult.run.workers) {
      const base = {
        agentId: worker.id,
        taskId: worker.id,
        parentAgentId: `session:${planResult.run.sessionId}`,
        coordinationRunId: runId,
        assignedAgentId: worker.agentId,
        taskLabel: worker.taskLabel,
        dependencyIds: [...worker.dependencies],
        ownedPaths: worker.ownershipClaims.map(claim => claim.path),
      };
      await deps.eventLog.append({
        sessionId: planResult.run.sessionId,
        actor: "coordination",
        type: "agent.spawned",
        payload: { ...base, role: "worker", state: worker.dependencies.length > 0 ? "waiting_dependency" : "queued" },
      });
      await deps.eventLog.append({
        sessionId: planResult.run.sessionId,
        actor: "coordination",
        type: "agent.task_assigned",
        payload: { ...base, title: worker.taskLabel, prompt: worker.goalPrompt,
          state: worker.dependencies.length > 0 ? "waiting_dependency" : "queued" },
      });
    }
  }
  const policyGate = new PolicyGate(config, { eventLog: deps.eventLog, approvalStore: deps.approvalStore });
  const auth = new ExecutionAuthorization({ policyGate, toolRegistry });
  const registry = new OwnershipRegistry(deps.cwd);
  // Unified execution: when subagents are enabled, workers run as
  // subagent child processes (same dispatch/ownership/tiers/session-mode
  // as delegate); otherwise the in-process executor is used. An injected
  // executor wins, so the abort path is drivable end-to-end.
  let executor: CoordinationWorkerExecutor;
  if (deps.executor) {
    executor = deps.executor;
  } else if (isSubagentsEnabled(config)) {
    const { SubagentWorkerExecutor } = await import("./subagent-worker-executor.js");
    executor = new SubagentWorkerExecutor({
      sessionId: `coord-sub-${runId}`,
      config,
      eventLog: deps.eventLog,
    });
  } else {
    const { DefaultWorkerExecutor } = await import("./worker-executor.js");
    executor = new DefaultWorkerExecutor();
  }
  // Scheduler telemetry → the metrics store (not the session EventLog): this is
  // a full run, so it must emit tick/dispatch telemetry like the daemon/Inspector
  // hosts. Fail-open; see CoordinationSchedulerDeps.metricsSink.
  const { MetricsStore } = await import("../../operations/observability/metrics-store.js");
  const { createMetricsStoreSink } = await import("../../operations/observability/metrics-sink.js");
  const metricsStore = new MetricsStore(deps.cwd);
  const metricsSink = createMetricsStoreSink(metricsStore);
  const scheduler = createCoordinationScheduler(
    {
      cwd: deps.cwd,
      daemonInstanceId: `tool-${process.pid}`,
      configProvider: async () => config,
      store,
      authorization: auth,
      ownershipRegistry: registry,
      executor,
      eventLog: deps.eventLog,
      metricsSink,
    },
    { maxConcurrency },
  );

  // Operator cancellation is a terminal outcome, not a failure: an abort must
  // finalize the run this turn started — workers cancelled, leases released,
  // run and graph marked cancelled — instead of leaving it running for a later
  // sweep to collide with.
  const signal = request?.signal;
  // Recorded against the plan's session id. Passed as an argument rather than
  // closed over, so nothing here depends on a declaration below.
  const recordCancelFailure = createCancelFailureRecorder({
    eventLog: deps.eventLog,
    runId,
    sessionId: planResult.run.sessionId,
  });
  const guard = createCancelGuard({
    cancel: () => scheduler.cancelRun(runId),
    onFailure: recordCancelFailure,
  });
  if (signal?.aborted) {
    await guard.cancelRun();
    throw new ExecutionCancelledError("cancelled by operator");
  }
  signal?.addEventListener("abort", guard.onAbort, { once: true });
  let result;
  try {
    result = await scheduler.runUntilIdle(runId);
    // The CLI-hosted TUI run owns this scheduler for the duration of the tool
    // call. Keep it alive while its durable approvals are pending; the daemon
    // intentionally does not tick CLI-hosted runs. Poll the authoritative
    // store so cross-process TUI decisions wake this owner without a CLI tick.
    let lastReconciledApprovalState = "";
    while (result.stopReason === "awaiting_approval" && !signal?.aborted) {
      const current = await store.load(runId);
      const approvalIds = [...new Set((current?.workers ?? [])
        .filter(worker => worker.status === "blocked" && worker.blockReason === "approval_required")
        .map(worker => worker.approvalId)
        .filter((id): id is string => Boolean(id)))].sort();
      if (approvalIds.length === 0 || !deps.approvalStore) break;
      const approvals = await Promise.all(approvalIds.map(id => deps.approvalStore!.loadFresh(id)));
      if (approvals.some(approval => !approval)) break; // missing evidence fails closed
      const hasPending = approvals.some(approval => approval?.status === "pending");
      if (approvals.every(approval => approval?.status === "pending")) {
        await new Promise<void>(resolve => setTimeout(resolve, 250));
        continue;
      }
      const approvalState = approvals.map(approval => `${approval!.id}:${approval!.status}`).join("\n");
      if (lastReconciledApprovalState === approvalState) {
        if (hasPending) {
          await new Promise<void>(resolve => setTimeout(resolve, 250));
          continue;
        }
        break;
      }
      lastReconciledApprovalState = approvalState;
      result = await scheduler.runUntilIdle(runId);
    }
  } finally {
    signal?.removeEventListener("abort", guard.onAbort);
    // Drain and close the metrics sink so no fire-and-forget write outlives this
    // call. Without this a straggling append lands after the caller (or a test)
    // removes the workspace, racing a directory teardown (ENOTEMPTY). Fail-open:
    // telemetry must never turn into a thrown error.
    try {
      await metricsSink.flush();
      await metricsStore.close();
    } catch { /* metrics are best-effort */ }
  }
  if (signal?.aborted) {
    const inFlight = guard.cancellation();
    if (inFlight) await inFlight;
    throw new ExecutionCancelledError("cancelled by operator");
  }
  const run = await store.load(runId);
  const lines = [
    `Coordination run: ${runId}`,
    `Status: ${result.finalStatus} (stop: ${result.stopReason})`,
    `Workers: ${planResult.run.workers.length}, Dispatched: ${result.dispatched}, Cycles: ${result.cycles}, Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
  ];
  if (run) {
    for (const w of run.workers) {
      lines.push(`- ${w.id} (${w.taskLabel}): ${w.status}${w.error ? ` — ${w.error}` : ""}`);
    }
    if (run.aggregateResultRef) lines.push(`Aggregate: ${run.aggregateResultRef}`);
  }

  // ── Completion is derived from AUTHORITATIVE run state, never inferred ──
  // `result.finalStatus`/`stopReason` describe why the SCHEDULER loop returned,
  // not whether the run reached a terminal successful outcome. `stopReason:
  // "idle"` in particular is not evidence of completion: an interleaved
  // retry/approval cycle can exhaust the idle budget while the run is still
  // `running` (Gate 6 F3). Treating every non-`failed` status as success made
  // such a run return a successful tool result and, through the executor,
  // record its single-use outer approval as `executionOutcome: "succeeded"` —
  // a false success receipt for work that never finished.
  //
  // `deriveCoordinationCompletion` owns the four dimensions (execution /
  // aggregation / outcome / verification). Success requires BOTH a terminal
  // `completed` execution AND a `verified` completion, so a run whose results
  // were never aggregated can no longer read as success.
  const completion = run
    ? await (await import("./coordination-view.js")).deriveRunCompletion(deps.cwd, run)
    : undefined;
  if (completion) lines.push(...await completionLines(run!, deps.cwd));

  // Missing/unreadable state fails closed. `outcomeUnknown` tells the executor
  // this call was authorized but reached no provable terminal outcome, so it
  // must NOT write a success OR failure receipt: the consumed claim stays
  // `pending`/`unverified` (fail-closed for replay) rather than being
  // reclassified as something the evidence does not support.
  if (!completion) {
    lines.push("Incomplete: the coordination run could not be read back, so its outcome is unknown.");
    return { kind: "error", message: lines.join("\n"), retryable: false, outcomeUnknown: true };
  }

  const { execution, verification } = completion.completion;

  if (execution === "failed") {
    return { kind: "error", message: lines.join("\n"), retryable: false };
  }
  if (execution === "cancelled") {
    // Explicit cancellation is handled by the signal path above; a cancelled
    // run observed here is still a non-success.
    return { kind: "error", message: lines.join("\n"), retryable: false };
  }
  if (execution !== "completed") {
    // running | planning | replanning | blocked. The run is NOT terminal; do
    // not synthesize a failure (its durable state stays as persisted and it
    // remains resumable) and do not claim success.
    lines.push(
      `Incomplete: the scheduler returned while the run was still ${execution}. ` +
      "The run is not terminal; re-running this tool would start a SECOND run. " +
      "Inspect it with alix_coordination_status and resume/complete it before treating the work as done.",
    );
    return { kind: "error", message: lines.join("\n"), retryable: false, outcomeUnknown: true };
  }
  if (verification !== "verified") {
    // Terminal execution, but the aggregate/verification evidence does not
    // support a success claim (e.g. workers finished but results were never
    // aggregated). Fail closed instead of promoting it to success.
    lines.push(
      `Incomplete: workers finished but completion is unverified (outcome=${completion.completion.outcome}, ` +
      `aggregation=${completion.completion.aggregation}, verification=${verification}).`,
    );
    return { kind: "error", message: lines.join("\n"), retryable: false, outcomeUnknown: true };
  }
  // Report what the run's workers actually wrote, from explicit mutation
  // records — never from worker status or ownership scopes. A completed worker
  // may have written nothing, and a worker that failed after writing a file
  // still wrote it; an assigned path is a claim about where a worker may write,
  // not evidence that it did. Paths are normalized and containment-checked
  // inside the derivation.
  const { deriveCoordinationEvidence } = await import("./coordination-evidence.js");
  const sessionEvents = deps.eventLog
    ? (await deps.eventLog.readAll()).filter(
        event => !deps.sessionId || event.sessionId === deps.sessionId,
      )
    : [];
  const changedFiles = deriveCoordinationEvidence(
    { events: sessionEvents as Array<{ type: string; payload?: Record<string, unknown> }> },
    { cwd: deps.cwd },
  ).changedFiles;
  return {
    kind: "success",
    output: lines.join("\n"),
    // Structured run identity: the completion gate resolves this run's own
    // completion dimensions rather than inferring them from the prose above.
    ...(run ? { coordinationRunId: run.id } : {}),
    ...(changedFiles.length > 0 ? { changed: true, changedFiles } : {}),
  };
}

async function handleCoordinationList(
  deps: CoordinationToolDeps,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const rawLimit = typeof args.limit === "number" ? args.limit : 10;
  const limit = Math.min(50, Math.max(1, Math.floor(rawLimit)));
  const store = deps.store ?? new CoordinationStore(deps.cwd);
  const runs = await store.list();
  // Session scope: a model must not see (or act on) another session's runs.
  // The workspace is shared, so an unscoped list surfaces unrelated runs whose
  // files may no longer exist — session 1791869299834 anchored on an 8-hour-old
  // run from a different session and spent ~20 turns verifying a stale success.
  // The operator CLI (`alix coordination list`) is deliberately workspace-wide;
  // this is the model-facing read and stays scoped when a session is known.
  const scoped = deps.sessionId ? runs.filter((run) => run.sessionId === deps.sessionId) : runs;
  const recent = scoped
    .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
    .slice(0, limit);
  if (recent.length === 0) {
    return { kind: "success", output: "No coordination runs." };
  }
  const lines = recent.map((run) =>
    `${run.id}  ${run.status}  ${run.workers.length} worker(s)  ${(run.rootGoal ?? "").slice(0, 80)}`,
  );
  return { kind: "success", output: `Coordination runs (newest first):\n${lines.join("\n")}` };
}

/**
 * Reject a runId that belongs to a different session. Returns an error result
 * when the run is foreign, else undefined. A run with no recorded sessionId is
 * treated as in-scope (legacy/zero-fact records) only when the caller has no
 * session to scope by.
 */
function foreignRunError(deps: CoordinationToolDeps, run: { sessionId?: string; id: string }): ToolResult | undefined {
  if (!deps.sessionId || !run.sessionId || run.sessionId === deps.sessionId) return undefined;
  return {
    kind: "error",
    retryable: false,
    message:
      `Run ${run.id} belongs to a different session (${run.sessionId}), not the current one. ` +
      `Use alix_coordination_list to see this session's runs.`,
  };
}

/**
 * Derived completion lines for a run. `Status` is the terminal execution state
 * only: it does not imply aggregation, a success outcome, or verification.
 */
async function completionLines(
  run: { id: string; sessionId: string } & Parameters<typeof import("./coordination-types.js").deriveCoordinationCompletion>[0],
  cwd: string,
): Promise<string[]> {
  const { deriveRunCompletion } = await import("./coordination-view.js");
  const { completion, label } = await deriveRunCompletion(cwd, run as never);
  return [
    `Completion: ${label}`,
    `  execution=${completion.execution} aggregation=${completion.aggregation} ` +
    `outcome=${completion.outcome} verification=${completion.verification}`,
  ];
}

async function handleCoordinationStatus(
  deps: CoordinationToolDeps,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const runId = typeof args.runId === "string" ? args.runId : "";
  if (!runId) {
    return { kind: "error", message: "coordination.status requires a runId string", retryable: false };
  }
  const store = deps.store ?? new CoordinationStore(deps.cwd);
  const run = await store.load(runId);
  if (!run) {
    return { kind: "error", message: `Run not found: ${runId}`, retryable: false };
  }
  const foreign = foreignRunError(deps, run);
  if (foreign) return foreign;
  const byStatus: Record<string, number> = {};
  for (const w of run.workers) byStatus[w.status] = (byStatus[w.status] ?? 0) + 1;
  const lines = [
    `Run: ${run.id}`,
    `Status: ${run.status}`,
    `Goal: ${run.rootGoal}`,
    `Workers: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ")}`,
  ];
  const awaitingApproval = run.workers.filter(w => w.blockReason === "approval_required" && w.approvalId);
  if (awaitingApproval.length > 0) {
    lines.push(`Awaiting approval: ${awaitingApproval.map(w => w.approvalId).join(", ")}`);
  }
  const failedWorkers = run.workers.filter(w => w.status === "failed" || w.status === "cancelled");
  for (const w of failedWorkers) {
    lines.push(`- ${w.id} (${w.taskLabel}): ${w.error ?? "no error"}`);
  }
  if (run.aggregateResultRef) lines.push(`Aggregate: ${run.aggregateResultRef}`);
  if (run.outcome) lines.push(`Outcome: ${run.outcome}`);
  lines.push(...(await completionLines(run, deps.cwd)));
  // Per-worker identity is what callers ask for by name (worker id, task id,
  // dependencies, scope, attempt, retry count, result reference). Answering it
  // here keeps that read inside this tool instead of sending the caller to
  // `.alix/coordination/**` — a sensitive path that raw file/shell access
  // cannot open.
  if (run.workers.length > 0) {
    lines.push(`Workers (${run.workers.length}):`);
    for (const w of run.workers.slice(0, MAX_STATUS_WORKER_ROWS)) {
      const deps = w.dependencies.length > 0 ? w.dependencies.join(", ") : "-";
      const scope = (w.ownershipScopes ?? []).join(", ") || "-";
      lines.push(
        `- ${w.id} | ${w.taskLabel} | agent ${w.agentId} | status ${w.status} | attempt ${w.attempt}/${w.maxAttempts}` +
        `${w.planOrder === undefined ? "" : ` | order ${w.planOrder}`} | deps ${deps} | writes ${scope}` +
        `${w.resultRef ? ` | result ${w.resultRef}` : ""}`,
      );
    }
    const hidden = run.workers.length - MAX_STATUS_WORKER_ROWS;
    if (hidden > 0) lines.push(`- ... ${hidden} more worker(s)`);
  }
  return { kind: "success", output: lines.join("\n") };
}

async function handleCoordinationResults(
  deps: CoordinationToolDeps,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const runId = typeof args.runId === "string" ? args.runId : "";
  if (!runId) {
    return { kind: "error", message: "coordination.results requires a runId string", retryable: false };
  }
  const { CoordinationResultStore } = await import("./coordination-result-store.js");
  const { CoordinationAggregateStore } = await import("./coordination-aggregate-store.js");
  const { createCompletionService } = await import("./coordination-completion-service.js");

  const store = deps.store ?? new CoordinationStore(deps.cwd);
  const resultStore = new CoordinationResultStore(deps.cwd);
  const aggregateStore = new CoordinationAggregateStore(deps.cwd);

  // Scope FIRST: never return a foreign run's aggregate. Load the run and
  // reject a cross-session id before touching the aggregate store.
  const run = await store.load(runId);
  if (!run) {
    return { kind: "error", message: `Run not found: ${runId}`, retryable: false };
  }
  const foreign = foreignRunError(deps, run);
  if (foreign) return foreign;

  const existing = await aggregateStore.load(runId);
  if (existing) {
    return { kind: "success", output: summarizeAggregate(runId, existing) };
  }
  const completionService = createCompletionService(deps.cwd, { store, resultStore, aggregateStore });
  const summary = await completionService.finalize(runId);
  const aggregateLines = summarizeAggregate(runId, summary);
  const finalized = await store.load(runId);
  // Show the derived completion next to the aggregate so a caller can tell
  // "aggregate generated" from "verified" (they are different facts).
  return {
    kind: "success",
    output: finalized
      ? `${aggregateLines}\n${(await completionLines(finalized, deps.cwd)).join("\n")}`
      : aggregateLines,
  };
}

function summarizeAggregate(runId: string, aggregate: any): string {
  const lines = [`Results: ${runId}`];
  const workers = aggregate?.workers ?? aggregate?.results;
  if (Array.isArray(workers)) {
    const ok = workers.filter((w: any) => w.status === "success" || w.outcome === "success").length;
    lines.push(`Workers: ${workers.length} total, ${ok} success`);
    for (const w of workers) {
      const label = w.taskLabel ?? w.workerId ?? w.id ?? "worker";
      const status = w.status ?? w.outcome ?? "unknown";
      lines.push(`- ${label}: ${status}${w.summary ? ` — ${String(w.summary).slice(0, 200)}` : ""}`);
    }
  } else {
    lines.push(JSON.stringify(aggregate, null, 2).slice(0, 2000));
  }
  return lines.join("\n");
}
