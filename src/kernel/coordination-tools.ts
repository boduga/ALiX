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
 * `alix_coordination_*` aliases (TOOL_NAME_MAP). Policy keys/capabilities
 * come from the registry entries in tool-registry.ts.
 */

import type { AlixConfig } from "../config/schema.js";
import { parseSessionMode } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";
import type { ToolResult } from "../tools/types.js";
import { CoordinationStore } from "./coordination-store.js";
import { CoordinationPlanner } from "./coordination-planner.js";
import { createPlannerGenerator } from "./planner-model.js";
import { CoordinationScheduler } from "./coordination-scheduler.js";
import { OwnershipRegistry } from "../ownership/ownership-registry.js";
import { ExecutionAuthorization } from "../runtime/execution-authorization.js";
import { PolicyGate } from "../policy/policy-gate.js";
import type { CoordinationWorkerExecutor } from "./worker-executor.js";
import { buildDefaultToolIndex } from "../tools/tool-registry.js";

export const COORDINATION_RUN_TOOL = "coordination.run";
export const COORDINATION_STATUS_TOOL = "coordination.status";
export const COORDINATION_LIST_TOOL = "coordination.list";
export const COORDINATION_RESULTS_TOOL = "coordination.results";

export const MAX_COORDINATION_TOOL_CONCURRENCY = 8;

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
): Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> {
  return {
    [COORDINATION_RUN_TOOL]: (args) => handleCoordinationRun(deps, args),
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

async function handleCoordinationRun(
  deps: CoordinationToolDeps,
  args: Record<string, unknown>,
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
      retryable: false,
    };
  }
  if (!planResult.valid || !planResult.run) {
    return {
      kind: "error",
      message: `Coordination plan failed: ${planResult.errors.join("; ") || "unknown error"}`,
      retryable: false,
    };
  }

  const runId = planResult.run.id;
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
  const scheduler = new CoordinationScheduler(
    {
      cwd: deps.cwd,
      daemonInstanceId: `tool-${process.pid}`,
      configProvider: async () => config,
      store,
      authorization: auth,
      ownershipRegistry: registry,
      executor,
    },
    { maxConcurrency },
  );

  const result = await scheduler.runUntilIdle(runId);
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
  return { kind: "success", output: lines.join("\n") };
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
  return { kind: "success", output: summarizeAggregate(runId, summary) };
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
