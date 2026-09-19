/**
 * coordination-routes.ts -- Inspector HTTP routes for coordination visibility
 * and execution.
 *
 * Routes:
 *   GET /api/coordination                    -> list runs
 *   GET /api/coordination/:runId             -> full CoordinationRunView
 *   GET /api/coordination/:runId/workers     -> worker list
 *   GET /api/coordination/:runId/workers/:workerId -> single worker
 *   GET /api/coordination/:runId/results     -> aggregate result
 *   GET /api/coordination/:runId/events      -> event timeline
 *   GET /api/coordination/:runId/approvals   -> approvals
 *   GET /api/coordination/:runId/ownership   -> ownership leases
 *   GET /api/coordination/:runId/conflicts            -> unresolved conflict summaries
 *   GET /api/coordination/:runId/conflicts/:conflictId -> full FindingConflict
 *   POST /api/coordination/run               -> plan + dispatch run in background
 *   POST /api/coordination/:runId/cancel     -> cancel a run
 *
 * Execution routes require the coordination:execute permission (declared in
 * route-policy.ts; enforced by the security middleware when authentication
 * is required, passed through on loopback development like all other
 * authenticated routes).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { CoordinationStore } from "../kernel/coordination-store.js";
import { CoordinationAggregateStore } from "../kernel/coordination-aggregate-store.js";
import { buildCoordinationRunView } from "../kernel/coordination-view.js";
import { CollaborationStore } from "../kernel/collaboration-store.js";
import { ConflictRepository } from "../kernel/collaboration-conflict-repository.js";
import { parseSessionMode } from "../config/schema.js";
import type { CoordinationScheduler } from "../kernel/coordination-scheduler.js";
import type { SecurityContext } from "../security/inspector/security-context.js";
import type { SecureJsonResponder } from "./secure-response.js";

// Background schedulers for web-started runs (runId -> scheduler), so
// cancel can reach the live dispatch loop. Entries are removed when the
// run settles. A server restart drops in-flight execution (documented;
// the daemon owns durable ticking).
const backgroundSchedulers = new Map<string, CoordinationScheduler>();

/**
 * Cancel every in-flight web-started run and drop its live handle.
 * Called on server close so a shutdown aborts worker children instead of
 * orphaning them. Detached runs started before a restart cannot be
 * reached here (their handles died with the old process); `POST
 * /:runId/cancel` still marks those runs via the stateless path.
 */
export async function cancelAllBackgroundRuns(): Promise<void> {
  const entries = [...backgroundSchedulers.entries()];
  backgroundSchedulers.clear();
  await Promise.all(entries.map(async ([runId, scheduler]) => {
    try {
      await scheduler.cancelRun(runId);
    } catch {
      // Shutdown is best-effort; a failed cancel must not block close.
    }
  }));
}

const MAX_RUN_BODY_BYTES = 16 * 1024;

/** Read a bounded JSON body (mirrors auth-routes readBody discipline). */
function readJsonBody(req: IncomingMessage | undefined): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  if (!req) return Promise.resolve({ ok: false as const, error: "no_request" });
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const done = (r: { ok: true; value: Record<string, unknown> } | { ok: false; error: string }): void => {
      if (!settled) { settled = true; resolve(r); }
    };
    req.on("data", (chunk: Buffer) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_RUN_BODY_BYTES) {
        done({ ok: false, error: "body_too_large" });
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          done({ ok: false, error: "invalid_json" });
          return;
        }
        done({ ok: true, value: parsed as Record<string, unknown> });
      } catch {
        done({ ok: false, error: "invalid_json" });
      }
    });
    req.on("error", () => done({ ok: false, error: "body_error" }));
    // Premature client disconnect: without this the promise hangs forever
    // when the connection drops mid-body.
    req.on("close", () => done({ ok: false, error: "body_error" }));
  });
}

// ---------------------------------------------------------------------------
// Path parameter validation
// ---------------------------------------------------------------------------

/**
 * Validate a path segment extracted from a URL.
 * Rejects empty segments, path traversal attempts, and non-alphanumeric-plus-dash segments.
 */
function validatePathSegment(segment: string | undefined, _name: string): string | null {
  if (!segment || segment.length === 0) return null;
  // Reject path traversal
  if (segment.includes("..") || segment.includes("/") || segment.includes("\\")) return null;
  // Reject empty or whitespace-only
  if (segment.trim().length === 0) return null;
  return segment;
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export function registerCoordinationRoutes(
  cwd: string,
  method: string,
  pathname: string,
  res: ServerResponse,
  _ctx?: SecurityContext | null,
  responder?: SecureJsonResponder,
  req?: IncomingMessage,
): boolean {
  // Create fallback responder if none provided (backward compat for direct callers)
  const r = responder ?? createFallbackResponder(res);

  // POST /api/coordination/run -- plan + dispatch a run in the background
  if (method === "POST" && pathname === "/api/coordination/run") {
    void handleStartRun(cwd, r, req);
    return true;
  }

  // POST /api/coordination/:runId/cancel -- cancel a run
  const cancelMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/cancel$/);
  if (method === "POST" && cancelMatch) {
    const runId = validatePathSegment(cancelMatch[1], "runId");
    if (!runId) { r.error("invalid_run_id", 400); return true; }
    void handleCancelRun(cwd, runId, r);
    return true;
  }

  // GET /api/coordination -- list runs
  if (method === "GET" && pathname === "/api/coordination") {
    handleListRuns(cwd, r);
    return true;
  }

  // GET /api/coordination/:runId -- full view
  const runMatch = pathname.match(/^\/api\/coordination\/([^/]+)$/);
  if (method === "GET" && runMatch) {
    const runId = validatePathSegment(runMatch[1], "runId");
    if (!runId) { r.error("invalid_run_id", 400); return true; }
    handleRunView(cwd, runId, r);
    return true;
  }

  // GET /api/coordination/:runId/workers
  const workersMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/workers$/);
  if (method === "GET" && workersMatch) {
    const runId = validatePathSegment(workersMatch[1], "runId");
    if (!runId) { r.error("invalid_run_id", 400); return true; }
    handleWorkers(cwd, runId, r);
    return true;
  }

  // GET /api/coordination/:runId/workers/:workerId
  const workerMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/workers\/([^/]+)$/);
  if (method === "GET" && workerMatch) {
    const runId = validatePathSegment(workerMatch[1], "runId");
    const workerId = validatePathSegment(workerMatch[2], "workerId");
    if (!runId || !workerId) { r.error("invalid_path_param", 400); return true; }
    handleWorker(cwd, runId, workerId, r);
    return true;
  }

  // GET /api/coordination/:runId/results
  const resultsMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/results$/);
  if (method === "GET" && resultsMatch) {
    const runId = validatePathSegment(resultsMatch[1], "runId");
    if (!runId) { r.error("invalid_run_id", 400); return true; }
    handleResults(cwd, runId, r);
    return true;
  }

  // GET /api/coordination/:runId/events
  const eventsMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/events$/);
  if (method === "GET" && eventsMatch) {
    const runId = validatePathSegment(eventsMatch[1], "runId");
    if (!runId) { r.error("invalid_run_id", 400); return true; }
    handleEvents(cwd, runId, r);
    return true;
  }

  // GET /api/coordination/:runId/approvals
  const approvalsMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/approvals$/);
  if (method === "GET" && approvalsMatch) {
    const runId = validatePathSegment(approvalsMatch[1], "runId");
    if (!runId) { r.error("invalid_run_id", 400); return true; }
    handleApprovals(cwd, runId, r);
    return true;
  }

  // GET /api/coordination/:runId/ownership
  const ownershipMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/ownership$/);
  if (method === "GET" && ownershipMatch) {
    const runId = validatePathSegment(ownershipMatch[1], "runId");
    if (!runId) { r.error("invalid_run_id", 400); return true; }
    handleOwnership(cwd, runId, r);
    return true;
  }

  // GET /api/coordination/:runId/conflicts
  const conflictsMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/conflicts$/);
  if (method === "GET" && conflictsMatch) {
    const runId = validatePathSegment(conflictsMatch[1], "runId");
    if (!runId) { r.error("invalid_run_id", 400); return true; }
    handleConflicts(cwd, runId, r);
    return true;
  }

  // GET /api/coordination/:runId/conflicts/:conflictId
  const conflictMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/conflicts\/([^/]+)$/);
  if (method === "GET" && conflictMatch) {
    const runId = validatePathSegment(conflictMatch[1], "runId");
    const conflictId = validatePathSegment(conflictMatch[2], "conflictId");
    if (!runId || !conflictId) { r.error("invalid_path_param", 400); return true; }
    handleConflict(cwd, runId, conflictId, r);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Fallback responder (for direct callers without secure-response plumbing)
// ---------------------------------------------------------------------------

function createFallbackResponder(res: ServerResponse): SecureJsonResponder {
  return {
    ok(value: unknown): void {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
    },
    error(code: string, status: number): void {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: code }));
    },
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListRuns(cwd: string, r: SecureJsonResponder): Promise<void> {
  try {
    const store = new CoordinationStore(cwd);
    const runs = await store.list();
    const summaries = runs.map(run => ({
      id: run.id,
      goal: run.rootGoal,
      status: run.status,
      outcome: run.outcome,
      workerCount: run.workers.length,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    }));
    r.ok(summaries);
  } catch (err) {
    r.error("internal_error", 500);
  }
}

async function handleRunView(cwd: string, runId: string, r: SecureJsonResponder): Promise<void> {
  try {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { r.error("run_not_found", 404); return; }
    r.ok(view);
  } catch (err) {
    r.error("internal_error", 500);
  }
}

async function handleWorkers(cwd: string, runId: string, r: SecureJsonResponder): Promise<void> {
  try {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { r.error("run_not_found", 404); return; }
    r.ok(view.workers);
  } catch (err) {
    r.error("internal_error", 500);
  }
}

async function handleWorker(cwd: string, runId: string, workerId: string, r: SecureJsonResponder): Promise<void> {
  try {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { r.error("run_not_found", 404); return; }
    const worker = view.workers.find(w => w.id === workerId);
    if (!worker) { r.error("worker_not_found", 404); return; }
    r.ok(worker);
  } catch (err) {
    r.error("internal_error", 500);
  }
}

async function handleResults(cwd: string, runId: string, r: SecureJsonResponder): Promise<void> {
  try {
    const agg = new CoordinationAggregateStore(cwd);
    const summary = await agg.load(runId);
    if (!summary) { r.error("no_aggregate_found", 404); return; }
    r.ok(summary);
  } catch (err) {
    r.error("internal_error", 500);
  }
}

async function handleEvents(cwd: string, runId: string, r: SecureJsonResponder): Promise<void> {
  try {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { r.error("run_not_found", 404); return; }
    r.ok(view.events);
  } catch (err) {
    r.error("internal_error", 500);
  }
}

async function handleApprovals(cwd: string, runId: string, r: SecureJsonResponder): Promise<void> {
  try {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { r.error("run_not_found", 404); return; }
    r.ok(view.approvals);
  } catch (err) {
    r.error("internal_error", 500);
  }
}

async function handleOwnership(cwd: string, runId: string, r: SecureJsonResponder): Promise<void> {
  try {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { r.error("run_not_found", 404); return; }
    r.ok(view.ownershipLeases);
  } catch (err) {
    r.error("internal_error", 500);
  }
}

async function handleConflicts(cwd: string, runId: string, r: SecureJsonResponder): Promise<void> {
  try {
    const store = new CollaborationStore(cwd, runId);
    const repo = new ConflictRepository(store);
    const conflicts = await repo.getConflicts(runId);
    r.ok(conflicts);
  } catch (err) {
    r.error("internal_error", 500);
  }
}

async function handleConflict(cwd: string, runId: string, conflictId: string, r: SecureJsonResponder): Promise<void> {
  try {
    const store = new CollaborationStore(cwd, runId);
    const repo = new ConflictRepository(store);
    const conflict = await repo.getConflict(conflictId);
    if (!conflict) { r.error("conflict_not_found", 404); return; }
    r.ok(conflict);
  } catch (err) {
    r.error("internal_error", 500);
  }
}

// ---------------------------------------------------------------------------
// Execution handlers (POST)
// ---------------------------------------------------------------------------

async function handleStartRun(
  cwd: string,
  r: SecureJsonResponder,
  req: IncomingMessage | undefined,
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body.ok) { r.error(body.error, 400); return; }
  const goal = typeof body.value.goal === "string" ? body.value.goal.trim() : "";
  if (!goal || goal.length > 8000) { r.error("invalid_goal", 400); return; }
  const rawConcurrency = typeof body.value.maxConcurrency === "number" ? body.value.maxConcurrency : 2;
  const maxConcurrency = Math.min(8, Math.max(1, Math.floor(rawConcurrency)));
  const sessionMode = body.value.sessionMode;
  // Valid modes round-trip through the parser; anything else is rejected.
  if (sessionMode !== undefined && parseSessionMode(sessionMode) !== sessionMode) {
    r.error("invalid_session_mode", 400);
    return;
  }
  const agentPool = Array.isArray(body.value.agentPool)
    ? body.value.agentPool.filter((a): a is string => typeof a === "string" && a.length > 0).slice(0, 8)
    : undefined;

  try {
    const { loadConfig } = await import("../config/loader.js");
    const { CoordinationPlanner } = await import("../kernel/coordination-planner.js");
    const { CoordinationScheduler } = await import("../kernel/coordination-scheduler.js");
    const { OwnershipRegistry } = await import("../ownership/ownership-registry.js");
    const { ExecutionAuthorization } = await import("../runtime/execution-authorization.js");
    const { PolicyGate } = await import("../policy/policy-gate.js");
    const { buildDefaultToolIndex } = await import("../tools/tool-registry.js");
    const { ApprovalStore } = await import("../approvals/approval-store.js");

    const config = await loadConfig(cwd);
    if (sessionMode !== undefined) {
      config.permissions.sessionMode = parseSessionMode(sessionMode);
    }
    const store = new CoordinationStore(cwd);
    const toolRegistry = buildDefaultToolIndex().registry;
    const planner = new CoordinationPlanner(cwd, agentPool?.length ? { agentPool } : {}, { toolRegistry });
    const planResult = await planner.plan(goal, "alix", `coord_web_${Date.now()}`);
    if (!planResult.valid || !planResult.run) {
      r.error("plan_failed", 400);
      return;
    }

    const approvalStore = new ApprovalStore(cwd);
    try { await approvalStore.load(); } catch { /* start unlocked when absent */ }
    const policyGate = new PolicyGate(config, { approvalStore });
    const auth = new ExecutionAuthorization({ policyGate, toolRegistry });
    const registry = new OwnershipRegistry(cwd);
    // Same execution backend as the chat path: subagent child processes
    // when subagents are enabled, so web runs share dispatch, ownership,
    // lifecycle, and sessionMode propagation with delegate/chat. Falls
    // back to the in-process executor when subagents are disabled.
    let executor: import("../kernel/worker-executor.js").CoordinationWorkerExecutor;
    if (config.subagents?.enabled) {
      const { SubagentWorkerExecutor } = await import("../kernel/subagent-worker-executor.js");
      executor = new SubagentWorkerExecutor({
        sessionId: `coord-web-${Date.now()}`,
        config,
      });
    } else {
      const { DefaultWorkerExecutor } = await import("../kernel/worker-executor.js");
      executor = new DefaultWorkerExecutor();
    }
    const scheduler = new CoordinationScheduler(
      {
        cwd,
        daemonInstanceId: `web-${process.pid}`,
        configProvider: async () => config,
        store,
        authorization: auth,
        ownershipRegistry: registry,
        executor,
      },
      { maxConcurrency },
    );
    const runId = planResult.run.id;
    backgroundSchedulers.set(runId, scheduler);
    // Foreground-equivalent execution, detached: the client polls the
    // existing GET routes. A server restart drops in-flight execution.
    scheduler.runUntilIdle(runId).catch((err: unknown) => {
      console.error(`[coordination] background run ${runId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }).finally(() => {
      backgroundSchedulers.delete(runId);
    });
    r.ok({ runId, workers: planResult.run.workers.length, goal });
  } catch (err) {
    r.error("internal_error", 500);
  }
}

async function handleCancelRun(cwd: string, runId: string, r: SecureJsonResponder): Promise<void> {
  try {
    const live = backgroundSchedulers.get(runId);
    if (live) {
      await live.cancelRun(runId);
      backgroundSchedulers.delete(runId);
    } else {
      // Stateless cancel: marks the persisted run without live handles.
      const { CoordinationScheduler } = await import("../kernel/coordination-scheduler.js");
      const { CoordinationStore } = await import("../kernel/coordination-store.js");
      const store = new CoordinationStore(cwd);
      // Unknown runs are an idempotent success. Check before loading config or
      // constructing runtime dependencies so cancellation also works in a
      // fresh workspace with no ALiX configuration.
      if (!await store.load(runId)) {
        r.ok({ runId, cancelled: true });
        return;
      }
      const { loadConfig } = await import("../config/loader.js");
      const { ExecutionAuthorization } = await import("../runtime/execution-authorization.js");
      const { PolicyGate } = await import("../policy/policy-gate.js");
      const { DefaultWorkerExecutor } = await import("../kernel/worker-executor.js");
      const { OwnershipRegistry } = await import("../ownership/ownership-registry.js");
      const { buildDefaultToolIndex } = await import("../tools/tool-registry.js");
      const config = await loadConfig(cwd);
      const scheduler = new CoordinationScheduler(
        {
          cwd,
          daemonInstanceId: `web-${process.pid}`,
          configProvider: async () => config,
          store,
          authorization: new ExecutionAuthorization({
            policyGate: new PolicyGate(config, {}),
            toolRegistry: buildDefaultToolIndex().registry,
          }),
          ownershipRegistry: new OwnershipRegistry(cwd),
          executor: new DefaultWorkerExecutor(),
        },
      );
      await scheduler.cancelRun(runId);
    }
    r.ok({ runId, cancelled: true });
  } catch (err) {
    r.error("internal_error", 500);
  }
}
