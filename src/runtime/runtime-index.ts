/**
 * runtime-index.ts — Read-only, on-demand aggregation across ALiX storage backends.
 *
 * Builds a unified RuntimeIndex from:
 *   - .alix/audit/audit.jsonl
 *   - .alix/approvals/approvals.json
 *   - .alix/graphs/*.json
 *   - .alix/graphs/*.runs.json
 *   - .alix/sessions/&lt;id&gt;/events.jsonl (allowlisted event types)
 *
 * Performance (#702): each source file is parsed once and cached by
 * (mtime, size); a repeated query with unchanged sources re-reads nothing.
 * Large JSONL sources (audit, session events) use a bounded ring buffer so
 * worst-case memory is O(cap), not O(file).
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { AuditRecord } from "../audit/audit-types.js";
import { measurePhase } from "./timing-events.js";
import { streamJsonlLines } from "../storage/jsonl-store.js";

export type RuntimeIndexEvent = {
  id: string;
  timestamp?: string;
  source: "session" | "graph" | "graph_run" | "approval" | "audit" | "report" | "daemon_task";
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

export type RuntimeIndexOptions = {
  eventLog?: import("../events/event-log.js").EventLog;
  sessionId?: string;
};

/** Per-source event caps bound worst-case memory (#702). */
export const RUNTIME_INDEX_AUDIT_CAP = 5_000;
export const RUNTIME_INDEX_SESSION_CAP = 2_000;
/** Global cache-entry bound so long-lived processes cannot grow unbounded. */
const CACHE_MAX_ENTRIES = 2_000;

type CacheEntry = { mtimeMs: number; size: number; events: RuntimeIndexEvent[] };
const sourceCache = new Map<string, CacheEntry>();

/** Parse a file once per (mtime, size) and reuse the result on repeat builds. */
async function cachedSource(
  path: string,
  build: () => Promise<RuntimeIndexEvent[]>,
): Promise<RuntimeIndexEvent[]> {
  let st;
  try {
    st = await stat(path);
  } catch {
    sourceCache.delete(path);
    return [];
  }
  const hit = sourceCache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    return hit.events;
  }
  const events = await build();
  if (sourceCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = sourceCache.keys().next().value;
    if (oldest !== undefined) sourceCache.delete(oldest);
  }
  sourceCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, events });
  return events;
}

/**
 * Read a JSONL file retaining only the newest `cap` mapped records.
 * O(cap) memory; malformed lines are skipped.
 */
async function readJsonlBounded<T>(
  path: string,
  cap: number,
  map: (raw: any) => T | null,
): Promise<T[]> {
  const buffer: T[] = [];
  let total = 0;
  for await (const { line } of streamJsonlLines(path)) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const record = map(raw);
    if (record === null) continue;
    if (buffer.length < cap) {
      buffer.push(record);
    } else {
      buffer[total % cap] = record;
    }
    total++;
  }
  if (total <= cap) return buffer;
  // Ring buffer overflowed: reconstruct oldest→newest (oldest sits at total % cap).
  const ordered: T[] = [];
  for (let i = 0; i < cap; i++) ordered.push(buffer[(total + i) % cap]!);
  return ordered;
}

const SESSION_EVENT_ALLOWLIST = new Set([
  "session.started", "session.ended",
  "graph.created", "graph.completed", "graph.status_changed",
  "task.ready", "task.started", "task.done", "task.failed",
  "policy.decision",
  "approval.requested", "approval.resolved",
  "tool.started", "tool.completed", "tool.failed",
  "file.created",
  "runtime.phase.started",
  "runtime.phase.completed",
  "agent.session.activity",
  // Ownership events (M0.75)
  "ownership.acquired", "ownership.released",
  "ownership.renewed", "ownership.expired",
  "ownership.conflict", "ownership.revoked",
  "ownership.denied",
]);

/** Build a RuntimeIndex from all available sources. */
export async function buildRuntimeIndex(
  cwd: string,
  options: RuntimeIndexOptions = {},
): Promise<RuntimeIndex> {
  return measurePhase(
    options.eventLog,
    options.sessionId ?? "system",
    "runtime-index.build",
    async () => {
      const events: RuntimeIndexEvent[] = [];

      // Source 1: audit/audit.jsonl
      const auditPath = join(cwd, ".alix", "audit", "audit.jsonl");
      if (existsSync(auditPath)) {
        events.push(...(await cachedSource(auditPath, () =>
          readJsonlBounded<RuntimeIndexEvent>(auditPath, RUNTIME_INDEX_AUDIT_CAP, (record) => {
            const r = record as AuditRecord;
            if (!r || typeof r.id !== "string") return null;
            return {
              id: r.id,
              timestamp: r.timestamp,
              source: "audit",
              action: r.action,
              graphId: r.details?.graphId,
              nodeId: r.details?.nodeId,
              sessionId: r.details?.sessionId,
              approvalId: r.details?.approvalId,
              capability: r.details?.capability,
              summary: r.details?.reason,
              payload: r.details as Record<string, unknown>,
            };
          }),
        )));
      }

      // Source 2: approvals/approvals.json (+ append-only journal, #703).
      // Journal records override snapshot records by id.
      const approvalsPath = join(cwd, ".alix", "approvals", "approvals.json");
      const approvalsJournalPath = `${approvalsPath}.journal.jsonl`;
      const toApprovalEvent = (record: any): RuntimeIndexEvent | null => {
        if (!record?.id) return null;
        const action = record.status === "pending" ? "approval.created"
          : record.status === "approved" ? "approval.approved"
          : "approval.denied";
        return {
          id: record.id,
          timestamp: record.createdAt,
          source: "approval",
          action,
          graphId: record.graphId,
          nodeId: record.nodeId,
          sessionId: record.sessionId,
          approvalId: record.id,
          capability: record.capabilities?.[0] ?? record.capability,
          status: record.status,
          summary: record.reason,
          payload: record,
        };
      };
      const approvalById = new Map<string, RuntimeIndexEvent>();
      if (existsSync(approvalsPath)) {
        for (const ev of await cachedSource(approvalsPath, async () => {
          const raw = await readFile(approvalsPath, "utf-8");
          const data = JSON.parse(raw);
          const list = Array.isArray(data) ? data : (data.approvals ?? []);
          return list.map(toApprovalEvent).filter((e: RuntimeIndexEvent | null): e is RuntimeIndexEvent => e !== null);
        })) approvalById.set(ev.id, ev);
      }
      if (existsSync(approvalsJournalPath)) {
        for (const ev of await cachedSource(approvalsJournalPath, async () => {
          const raw = await readFile(approvalsJournalPath, "utf-8");
          const out: RuntimeIndexEvent[] = [];
          for (const line of raw.split("\n")) {
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line) as { record?: any };
              const ev = toApprovalEvent(entry?.record);
              if (ev) out.push(ev);
            } catch { /* skip malformed journal line */ }
          }
          return out;
        })) approvalById.set(ev.id, ev);
      }
      events.push(...approvalById.values());

      // Source 3: graphs/*.json
      const graphsDir = join(cwd, ".alix", "graphs");
      if (existsSync(graphsDir)) {
        try {
          const files = await readdir(graphsDir);
          for (const f of files) {
            if (!f.endsWith(".json") || f.endsWith(".runs.json")) continue;
            const graphPath = join(graphsDir, f);
            events.push(...(await cachedSource(graphPath, async () => {
              const out: RuntimeIndexEvent[] = [];
              const raw = await readFile(graphPath, "utf-8");
              const graph = JSON.parse(raw);
              const graphId = f.replace(/\.json$/, "");
              out.push({
                id: `graph_${graphId}`,
                timestamp: graph.updatedAt || graph.createdAt,
                source: "graph",
                action: `graph.${graph.status || "created"}`,
                graphId,
                status: graph.status,
                summary: graph.rootGoal,
                payload: { nodeCount: graph.nodes?.length, strategy: graph.strategy },
              });
              if (graph.nodes) {
                for (const node of graph.nodes) {
                  out.push({
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
              return out;
            })));
          }
        } catch { /* skip unreadable graphs dir */ }
      }

      // Source 4: graphs/*.runs.json
      if (existsSync(graphsDir)) {
        try {
          const files = await readdir(graphsDir);
          for (const f of files) {
            if (!f.endsWith(".runs.json")) continue;
            const runsPath = join(graphsDir, f);
            events.push(...(await cachedSource(runsPath, async () => {
              const raw = await readFile(runsPath, "utf-8");
              const runs = JSON.parse(raw) as any[];
              const graphId = f.replace(/\.runs\.json$/, "");
              return runs.map((run): RuntimeIndexEvent => ({
                id: `run_${graphId}_${run.attempt}`,
                timestamp: run.startedAt || run.completedAt,
                source: "graph_run",
                action: `rerun.${run.status}`,
                graphId,
                nodeId: run.nodeId,
                status: run.status,
                summary: run.summary || run.error,
                payload: run,
              }));
            })));
          }
        } catch { /* skip unreadable graphs dir */ }
      }

      // Source 5: sessions/*/events.jsonl (allowlisted, bounded)
      const sessionsDir = join(cwd, ".alix", "sessions");
      if (existsSync(sessionsDir)) {
        try {
          const sessionDirs = await readdir(sessionsDir);
          for (const sd of sessionDirs) {
            const eventsPath = join(sessionsDir, sd, "events.jsonl");
            if (!existsSync(eventsPath)) continue;
            events.push(...(await cachedSource(eventsPath, () =>
              readJsonlBounded<RuntimeIndexEvent>(eventsPath, RUNTIME_INDEX_SESSION_CAP, (ev) => {
                if (!ev || !SESSION_EVENT_ALLOWLIST.has(ev.type)) return null;
                return {
                  id: `sess_${sd}_${ev.seq ?? ev.id ?? Math.random().toString(36).slice(2)}`,
                  timestamp: ev.timestamp,
                  source: "session",
                  action: ev.type,
                  sessionId: ev.sessionId || sd,
                  graphId: ev.meta?.graphId || ev.payload?.graphId,
                  nodeId: ev.meta?.nodeId || ev.payload?.nodeId,
                  status: ev.payload?.status || ev.payload?.decision,
                  summary: ev.payload?.reason || ev.payload?.summary,
                  capability: ev.payload?.canonicalCapability || ev.payload?.capability,
                  payload: ev,
                };
              }),
            )));
          }
        } catch { /* skip unreadable sessions dir */ }
      }

      // Source 6: daemon-tasks.json (global registry; legacy cwd fallback)
      try {
        const { readDaemonTasks, resolveDaemonTasksReadPath } = await import("../daemon/daemon-paths.js");
        const tasksPath = resolveDaemonTasksReadPath(cwd);
        if (existsSync(tasksPath)) {
          events.push(...(await cachedSource(tasksPath, async () => {
            const records = await readDaemonTasks(cwd);
            if (!records) return [];
            return records.map((r): RuntimeIndexEvent => ({
              id: r.id,
              timestamp: r.updatedAt || r.createdAt,
              source: "daemon_task",
              action: `daemon.task.${r.status}`,
              sessionId: r.sessionId,
              status: r.status,
              summary: r.task,
              payload: { error: r.error },
            }));
          })));
        }
      } catch { /* skip unreadable */ }

      // Sort by timestamp descending (newest first), fallback to id.
      // Sorting cost is bounded by the per-source caps above.
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
    },
  );
}
