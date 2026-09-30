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

import type { AlixConfig } from "../config/schema.js";
import { parseSessionMode } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";
import { COORDINATION_EVENT_TYPES } from "../events/types.js";
import type { ToolResult } from "../tools/types.js";
import { CoordinationStore } from "./coordination-store.js";
import { CoordinationPlanner } from "./coordination-planner.js";
import { createPlannerGenerator } from "./planner-model.js";
import { createCoordinationScheduler } from "./coordination-scheduler.js";
import { OwnershipRegistry } from "../ownership/ownership-registry.js";
import { ExecutionAuthorization } from "../runtime/execution-authorization.js";
import { PolicyGate } from "../policy/policy-gate.js";
import type { CoordinationWorkerExecutor } from "./worker-executor.js";
import { buildDefaultToolIndex } from "../tools/tool-registry.js";
import type { ToolCallRequest } from "../tools/types.js";
import { ExecutionCancelledError } from "../runtime/cancellation-token.js";
import { cancelDeadOwnerRuns } from "./coordination-resume.js";

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
  approvalStore?: any;
  eventLog?: EventLog;
  /** Injectable for tests (defaults to a live store/planner). */
  store?: CoordinationStore;
  planner?: CoordinationPlanner;
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

function effectiveSessionMode(
  config: AlixConfig,
  arg: unknown,
): "auto" | "ask" | "bypass" {
  if (arg === "auto" || arg === "ask" || arg === "bypass") return arg;
  return parseSessionMode(config.permissions.sessionMode);
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
    void Promise.resolve(deps.onFailure(err)).catch(() => {});
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
        payload: { ...base, title: worker.taskLabel, prompt: worker.goalPrompt },
      });
    }
  }
  const policyGate = new PolicyGate(config, { eventLog: deps.eventLog, approvalStore: deps.approvalStore });
  const auth = new ExecutionAuthorization({ policyGate, toolRegistry });
  const registry = new OwnershipRegistry(deps.cwd);
  // Unified execution: when subagents are enabled, workers run as
  // subagent child processes (same dispatch/ownership/tiers/session-mode
  // as delegate); otherwise the in-process executor is used.
  let executor: CoordinationWorkerExecutor;
  if (config.subagents?.enabled) {
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
    },
    { maxConcurrency },
  );

  // Operator cancellation is a terminal outcome, not a failure: an abort must
  // finalize the run this turn started — workers cancelled, leases released,
  // run and graph marked cancelled — instead of leaving it running for a later
  // sweep to collide with.
  const signal = request?.signal;
  const guard = createCancelGuard({
    cancel: () => scheduler.cancelRun(runId),
    onFailure: (error) => deps.eventLog?.append({
      sessionId: run?.sessionId ?? "unknown",
      actor: "coordination",
      type: COORDINATION_EVENT_TYPES.CANCEL_FAILED,
      payload: {
        runId,
        error: error instanceof Error ? error.message : String(error),
        // The run may still be `running` with leases held, and a live
        // `tool-<pid>` owner is never reclaimed — this is the only record.
        reason: "operator cancel could not finalize the run",
      },
    }),
  });
  if (signal?.aborted) {
    await guard.cancelRun();
    throw new ExecutionCancelledError("cancelled by operator");
  }
  signal?.addEventListener("abort", guard.onAbort, { once: true });
  let result;
  try {
    result = await scheduler.runUntilIdle(runId);
  } finally {
    signal?.removeEventListener("abort", guard.onAbort);
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
  if (result.finalStatus === "failed") {
    return { kind: "error", message: lines.join("\n"), retryable: false };
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
  const recent = runs
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
 * Derived completion lines for a run. `Status` is the terminal execution state
 * only: it does not imply aggregation, a success outcome, or verification.
 */
async function completionLines(
  run: { id: string; sessionId: string } & Parameters<typeof import("./coordination-types.js").deriveCoordinationCompletion>[0],
  cwd: string,
): Promise<string[]> {
  const { deriveCoordinationCompletion, coordinationCompletionLabel, matchesAttachedAggregateEvent } =
    await import("./coordination-types.js");
  const { computeAggregationSourceFingerprint } = await import("./coordination-aggregation-fingerprint.js");
  const { readRunSessionEvents } = await import("./coordination-view.js");
  const completion = deriveCoordinationCompletion(run, {
    currentFingerprint: computeAggregationSourceFingerprint(run as never),
    aggregateEventMatches: matchesAttachedAggregateEvent(
      run as never,
      await readRunSessionEvents(cwd, run.sessionId),
    ),
  });
  return [
    `Completion: ${coordinationCompletionLabel(completion)}`,
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
  const { ResultAggregator } = await import("./coordination-result-aggregator.js");
  const { CoordinationCompletionService } = await import("./coordination-completion-service.js");

  const store = deps.store ?? new CoordinationStore(deps.cwd);
  const resultStore = new CoordinationResultStore(deps.cwd);
  const aggregateStore = new CoordinationAggregateStore(deps.cwd);

  const existing = await aggregateStore.load(runId);
  if (existing) {
    return { kind: "success", output: summarizeAggregate(runId, existing) };
  }
  const run = await store.load(runId);
  if (!run) {
    return { kind: "error", message: `Run not found: ${runId}`, retryable: false };
  }
  const aggregator = new ResultAggregator(resultStore);
  const completionService = new CoordinationCompletionService({
    coordinationStore: store,
    resultAggregator: aggregator,
    aggregateStore,
  });
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
