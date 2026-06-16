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

export function registerCoordinationRoutes(
  cwd: string,
  method: string,
  pathname: string,
  res: ServerResponse,
): boolean {
  // GET /api/coordination -- list runs
  if (method === "GET" && pathname === "/api/coordination") {
    handleListRuns(cwd, res);
    return true;
  }

  // GET /api/coordination/:runId -- full view
  const runMatch = pathname.match(/^\/api\/coordination\/([^/]+)$/);
  if (method === "GET" && runMatch) {
    handleRunView(cwd, runMatch[1], res);
    return true;
  }

  // GET /api/coordination/:runId/workers
  const workersMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/workers$/);
  if (method === "GET" && workersMatch) {
    handleWorkers(cwd, workersMatch[1], res);
    return true;
  }

  // GET /api/coordination/:runId/workers/:workerId
  const workerMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/workers\/([^/]+)$/);
  if (method === "GET" && workerMatch) {
    handleWorker(cwd, workerMatch[1], workerMatch[2], res);
    return true;
  }

  // GET /api/coordination/:runId/results
  const resultsMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/results$/);
  if (method === "GET" && resultsMatch) {
    handleResults(cwd, resultsMatch[1], res);
    return true;
  }

  // GET /api/coordination/:runId/events
  const eventsMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/events$/);
  if (method === "GET" && eventsMatch) {
    handleEvents(cwd, eventsMatch[1], res);
    return true;
  }

  // GET /api/coordination/:runId/approvals
  const approvalsMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/approvals$/);
  if (method === "GET" && approvalsMatch) {
    handleApprovals(cwd, approvalsMatch[1], res);
    return true;
  }

  // GET /api/coordination/:runId/ownership
  const ownershipMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/ownership$/);
  if (method === "GET" && ownershipMatch) {
    handleOwnership(cwd, ownershipMatch[1], res);
    return true;
  }

  // GET /api/coordination/:runId/conflicts
  const conflictsMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/conflicts$/);
  if (method === "GET" && conflictsMatch) {
    handleConflicts(cwd, conflictsMatch[1], res);
    return true;
  }

  // GET /api/coordination/:runId/conflicts/:conflictId
  const conflictMatch = pathname.match(/^\/api\/coordination\/([^/]+)\/conflicts\/([^/]+)$/);
  if (method === "GET" && conflictMatch) {
    handleConflict(cwd, conflictMatch[1], conflictMatch[2], res);
    return true;
  }

  return false;
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data, null, 2));
}

async function handleListRuns(cwd: string, res: ServerResponse): Promise<void> {
  try {
    const store = new CoordinationStore(cwd);
    const runs = await store.list();
    const summaries = runs.map(r => ({
      id: r.id,
      goal: r.rootGoal,
      status: r.status,
      outcome: r.outcome,
      workerCount: r.workers.length,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    sendJson(res, summaries);
  } catch (err) {
    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function handleRunView(cwd: string, runId: string, res: ServerResponse): Promise<void> {
  try {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { sendJson(res, { error: "Run not found" }, 404); return; }
    sendJson(res, view);
  } catch (err) {
    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function handleWorkers(cwd: string, runId: string, res: ServerResponse): Promise<void> {
  try {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { sendJson(res, { error: "Run not found" }, 404); return; }
    sendJson(res, view.workers);
  } catch (err) {
    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function handleWorker(cwd: string, runId: string, workerId: string, res: ServerResponse): Promise<void> {
  try {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { sendJson(res, { error: "Run not found" }, 404); return; }
    const worker = view.workers.find(w => w.id === workerId);
    if (!worker) { sendJson(res, { error: "Worker not found" }, 404); return; }
    sendJson(res, worker);
  } catch (err) {
    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function handleResults(cwd: string, runId: string, res: ServerResponse): Promise<void> {
  try {
    const agg = new CoordinationAggregateStore(cwd);
    const summary = await agg.load(runId);
    if (!summary) { sendJson(res, { error: "No aggregate found for this run" }, 404); return; }
    sendJson(res, summary);
  } catch (err) {
    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function handleEvents(cwd: string, runId: string, res: ServerResponse): Promise<void> {
  try {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { sendJson(res, { error: "Run not found" }, 404); return; }
    sendJson(res, view.events);
  } catch (err) {
    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function handleApprovals(cwd: string, runId: string, res: ServerResponse): Promise<void> {
  try {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { sendJson(res, { error: "Run not found" }, 404); return; }
    sendJson(res, view.approvals);
  } catch (err) {
    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function handleOwnership(cwd: string, runId: string, res: ServerResponse): Promise<void> {
  try {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { sendJson(res, { error: "Run not found" }, 404); return; }
    sendJson(res, view.ownershipLeases);
  } catch (err) {
    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function handleConflicts(cwd: string, runId: string, res: ServerResponse): Promise<void> {
  try {
    const store = new CollaborationStore(cwd, runId);
    const repo = new ConflictRepository(store);
    const conflicts = await repo.getConflicts(runId);
    sendJson(res, conflicts);
  } catch (err) {
    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function handleConflict(cwd: string, runId: string, conflictId: string, res: ServerResponse): Promise<void> {
  try {
    const store = new CollaborationStore(cwd, runId);
    const repo = new ConflictRepository(store);
    const conflict = await repo.getConflict(conflictId);
    if (!conflict) { sendJson(res, { error: "Conflict not found" }, 404); return; }
    sendJson(res, conflict);
  } catch (err) {
    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
