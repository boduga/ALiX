/**
 * graph-projection.ts — Reconstruct graph run state from events and graph JSON.
 *
 * A GraphRunProjection answers: What graph ran? Which nodes?
 * Which sessions? Which nodes failed? What artifacts exist?
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface NodeRunInfo {
  nodeId: string;
  title: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  sessionId?: string;
  summary?: string;
  error?: string;
}

export interface GraphRunProjection {
  graphId: string;
  rootGoal: string;
  strategy: string;
  status: string;
  nodeCount: number;
  nodes: NodeRunInfo[];
  reports: string[];
  sessionIds: string[];
}

/**
 * Build a GraphRunProjection from graph JSON + session events.
 *
 * Reads the graph file from .alix/graphs/<graphId>.json for node definitions.
 * Then scans session event logs in .alix/sessions/ for events that
 * carry matching graphId in their meta field.
 */
export async function buildGraphProjection(
  graphId: string,
  cwd: string,
): Promise<GraphRunProjection> {
  // Load graph definition
  const graphPath = join(cwd, ".alix", "graphs", `${graphId}.json`);
  if (!existsSync(graphPath)) {
    throw new Error(`Graph not found: ${graphId}`);
  }
  const graphJson = JSON.parse(await readFile(graphPath, "utf-8"));
  const nodes: NodeRunInfo[] = (graphJson.nodes || []).map((n: any) => ({
    nodeId: n.id,
    title: n.title || n.id,
    status: n.status || "pending",
  }));

  // Scan sessions for events matching this graphId
  const sessionsDir = join(cwd, ".alix", "sessions");
  const sessionIds = new Set<string>();
  const nodeTimestamps: Record<string, { started?: string; completed?: string; sessionId?: string }> = {};
  let reports: string[] = [];

  if (existsSync(sessionsDir)) {
    const sessionDirs = await readdir(sessionsDir);
    for (const sd of sessionDirs) {
      const eventsPath = join(sessionsDir, sd, "events.jsonl");
      if (!existsSync(eventsPath)) continue;
      const raw = await readFile(eventsPath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      let foundGraph = false;
      for (const line of lines) {
        try {
          const ev = JSON.parse(line);
          const meta = ev.meta || {};
          if (meta.graphId === graphId || ev.payload?.graphId === graphId) {
            foundGraph = true;
            sessionIds.add(sd);

            if (ev.type === "task.started" || ev.type === "task.ready") {
              const nid = meta.nodeId || ev.payload?.nodeId;
              if (nid) {
                if (!nodeTimestamps[nid]) nodeTimestamps[nid] = {};
                nodeTimestamps[nid].started = ev.timestamp;
                nodeTimestamps[nid].sessionId = sd;
              }
            }
            if (ev.type === "task.done" || ev.type === "task.failed") {
              const nid = meta.nodeId || ev.payload?.nodeId;
              if (nid) {
                if (!nodeTimestamps[nid]) nodeTimestamps[nid] = {};
                nodeTimestamps[nid].completed = ev.timestamp;
                nodeTimestamps[nid].sessionId = sd;
              }
              // Track task.failed error
              if (ev.type === "task.failed") {
                const nodeIdx = nodes.findIndex(n => n.nodeId === (meta.nodeId || ev.payload?.nodeId));
                if (nodeIdx >= 0) {
                  nodes[nodeIdx].status = "failed";
                  nodes[nodeIdx].error = ev.payload?.reason || ev.payload?.error || "Unknown error";
                }
              }
              if (ev.type === "task.done") {
                const nodeIdx = nodes.findIndex(n => n.nodeId === (meta.nodeId || ev.payload?.nodeId));
                if (nodeIdx >= 0) {
                  nodes[nodeIdx].status = "done";
                  nodes[nodeIdx].summary = ev.payload?.summary;
                }
              }
            }
            // Track report references
            if (ev.payload?.reportDir || ev.payload?.reportId) {
              reports.push(ev.payload?.reportDir || ev.payload?.reportId);
            }
          }
        } catch { /* skip malformed lines */ }
      }
    }
  }

  // Merge timestamps into nodes
  for (const [nid, ts] of Object.entries(nodeTimestamps)) {
    const nodeIdx = nodes.findIndex(n => n.nodeId === nid);
    if (nodeIdx >= 0) {
      nodes[nodeIdx].startedAt = ts.started;
      nodes[nodeIdx].completedAt = ts.completed;
      nodes[nodeIdx].sessionId = ts.sessionId;
      if (ts.started && ts.completed) {
        nodes[nodeIdx].durationMs = new Date(ts.completed).getTime() - new Date(ts.started).getTime();
      }
    }
  }

  // Determine graph-level status
  const hasFailed = nodes.some(n => n.status === "failed");
  const allDone = nodes.every(n => n.status === "done");
  const status = hasFailed ? "failed" : allDone ? "completed" : graphJson.status || "running";

  return {
    graphId,
    rootGoal: graphJson.rootGoal || "",
    strategy: graphJson.strategy || "sequential",
    status,
    nodeCount: nodes.length,
    nodes,
    reports: [...new Set(reports)],
    sessionIds: [...sessionIds],
  };
}
