/**
 * runtime-index.ts — Read-only, on-demand aggregation across ALiX storage backends.
 *
 * Builds a unified RuntimeIndex from:
 *   - .alix/audit/audit.jsonl
 *   - .alix/approvals/approvals.json
 *   - .alix/graphs/*.json
 *   - .alix/graphs/*.runs.json
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { AuditRecord } from "../audit/audit-types.js";

export type RuntimeIndexEvent = {
  id: string;
  timestamp?: string;
  source: "session" | "graph" | "graph_run" | "approval" | "audit" | "report";
  action: string;
  graphId?: string;
  nodeId?: string;
  sessionId?: string;
  approvalId?: string;
  reportId?: string;
  status?: string;
  capability?: string;
  summary?: string;
  payload?: Record<string, unknown>;
};

export type RuntimeIndex = {
  events: RuntimeIndexEvent[];
  byGraph(graphId: string): RuntimeIndexEvent[];
  bySession(sessionId: string): RuntimeIndexEvent[];
  byApproval(approvalId: string): RuntimeIndexEvent[];
  byAction(action: string): RuntimeIndexEvent[];
};

/** Build a RuntimeIndex from all available sources. */
export async function buildRuntimeIndex(cwd: string): Promise<RuntimeIndex> {
  const events: RuntimeIndexEvent[] = [];

  // Source 1: audit/audit.jsonl
  const auditPath = join(cwd, ".alix", "audit", "audit.jsonl");
  if (existsSync(auditPath)) {
    try {
      const raw = await readFile(auditPath, "utf-8");
      for (const line of raw.trim().split("\n").filter(Boolean)) {
        try {
          const record = JSON.parse(line) as AuditRecord;
          events.push({
            id: record.id,
            timestamp: record.timestamp,
            source: "audit",
            action: record.action,
            graphId: record.details.graphId,
            nodeId: record.details.nodeId,
            sessionId: record.details.sessionId,
            approvalId: record.details.approvalId,
            capability: record.details.capability,
            summary: record.details.reason,
            payload: record.details as any,
          });
        } catch { /* skip malformed audit line */ }
      }
    } catch { /* skip unreadable audit file */ }
  }

  // Source 2: approvals/approvals.json
  const approvalsPath = join(cwd, ".alix", "approvals", "approvals.json");
  if (existsSync(approvalsPath)) {
    try {
      const raw = await readFile(approvalsPath, "utf-8");
      const records = JSON.parse(raw) as any[];
      for (const record of records) {
        const action = record.status === "pending" ? "approval.created"
          : record.status === "approved" ? "approval.approved"
          : "approval.denied";
        events.push({
          id: record.id,
          timestamp: record.createdAt,
          source: "approval",
          action,
          graphId: record.graphId,
          nodeId: record.nodeId,
          sessionId: record.sessionId,
          approvalId: record.id,
          capability: record.capability,
          status: record.status,
          summary: record.reason,
          payload: record,
        });
      }
    } catch { /* skip unreadable approvals file */ }
  }

  // Source 3: graphs/*.json
  const graphsDir = join(cwd, ".alix", "graphs");
  if (existsSync(graphsDir)) {
    try {
      const files = await readdir(graphsDir);
      for (const f of files) {
        if (!f.endsWith(".json") || f.endsWith(".runs.json")) continue;
        try {
          const raw = await readFile(join(graphsDir, f), "utf-8");
          const graph = JSON.parse(raw);
          const graphId = f.replace(/\.json$/, "");

          // Graph-level event
          events.push({
            id: `graph_${graphId}`,
            timestamp: graph.updatedAt || graph.createdAt,
            source: "graph",
            action: `graph.${graph.status || "created"}`,
            graphId,
            status: graph.status,
            summary: graph.rootGoal,
            payload: { nodeCount: graph.nodes?.length, strategy: graph.strategy },
          });

          // Per-node events
          if (graph.nodes) {
            for (const node of graph.nodes) {
              events.push({
                id: `node_${node.id}`,
                timestamp: node.updatedAt || graph.updatedAt,
                source: "graph",
                action: `node.${node.status || "created"}`,
                graphId,
                nodeId: node.id,
                status: node.status,
                capability: node.requiredCapabilities?.join(","),
                summary: node.title,
                payload: node,
              });
            }
          }
        } catch { /* skip invalid graph JSON */ }
      }
    } catch { /* skip unreadable graphs dir */ }
  }

  // Source 4: graphs/*.runs.json
  if (existsSync(graphsDir)) {
    try {
      const files = await readdir(graphsDir);
      for (const f of files) {
        if (!f.endsWith(".runs.json")) continue;
        try {
          const raw = await readFile(join(graphsDir, f), "utf-8");
          const runs = JSON.parse(raw) as any[];
          const graphId = f.replace(/\.runs\.json$/, "");
          for (const run of runs) {
            events.push({
              id: `run_${graphId}_${run.attempt}`,
              timestamp: run.startedAt || run.completedAt,
              source: "graph_run",
              action: `rerun.${run.status}`,
              graphId,
              nodeId: run.nodeId,
              status: run.status,
              summary: run.summary || run.error,
              payload: run,
            });
          }
        } catch { /* skip invalid runs JSON */ }
      }
    } catch { /* skip unreadable graphs dir */ }
  }

  // Sort by timestamp descending (newest first), fallback to id
  events.sort((a, b) => {
    const tA = a.timestamp || a.id;
    const tB = b.timestamp || b.id;
    return tB.localeCompare(tA);
  });

  const byGraph = (graphId: string) => events.filter(e => e.graphId === graphId);
  const bySession = (sessionId: string) => events.filter(e => e.sessionId === sessionId);
  const byApproval = (approvalId: string) => events.filter(e => e.approvalId === approvalId);
  const byAction = (action: string) => events.filter(e => e.action === action);

  return { events, byGraph, bySession, byApproval, byAction };
}
