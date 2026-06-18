/**
 * coordination-routes.ts -- Inspector HTTP routes for coordination visibility.
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
 */

import type { ServerResponse } from "node:http";
import { CoordinationStore } from "../kernel/coordination-store.js";
import { CoordinationAggregateStore } from "../kernel/coordination-aggregate-store.js";
import { buildCoordinationRunView } from "../kernel/coordination-view.js";
import { CollaborationStore } from "../kernel/collaboration-store.js";
import { ConflictRepository } from "../kernel/collaboration-conflict-repository.js";
import type { SecurityContext } from "../security/inspector/security-context.js";
import type { SecureJsonResponder } from "./secure-response.js";

// ---------------------------------------------------------------------------
// Path parameter validation
// ---------------------------------------------------------------------------

/**
 * Validate a path segment extracted from a URL.
 * Rejects empty segments, path traversal attempts, and non-alphanumeric-plus-dash segments.
 */
function validatePathSegment(segment: string | undefined, name: string): string | null {
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
  ctx?: SecurityContext | null,
  responder?: SecureJsonResponder,
): boolean {
  // Create fallback responder if none provided (backward compat for direct callers)
  const r = responder ?? createFallbackResponder(res);

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
