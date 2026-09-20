/**
 * state-query.ts — `state.query`: one read-only window into ALiX's own state.
 *
 * The model can read files and search, but it has no way to answer "what are
 * my recent runs / sessions / approvals / audit events / daemon tasks /
 * schedules / graphs?" without guessing or web-searching. This collapses the
 * local-state surfaces into a single bounded, read-only tool keyed by `kind`,
 * so the tool manifest grows by one entry instead of one per surface.
 *
 * All reads are workspace- or user-scoped projections; nothing mutates.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ToolResult } from "./types.js";
import { readUnifiedAudit, type UnifiedAuditRow } from "../audit/audit-read-model.js";
import { ApprovalStore } from "../approvals/approval-store.js";
import { TaskRegistry, type DaemonTaskRecord } from "../daemon/task-registry.js";
import { ScheduledTaskStore } from "../schedule/scheduled-task-store.js";

export const STATE_QUERY_TOOL = "state.query";

export const STATE_QUERY_KINDS = [
  "sessions",
  "audit",
  "approvals",
  "daemon",
  "schedule",
  "graphs",
] as const;

export type StateQueryKind = (typeof STATE_QUERY_KINDS)[number];

/** Injectable backing stores for tests; production uses the real ones. */
export type StateQueryDeps = {
  approvals?: Pick<ApprovalStore, "load" | "listPending">;
  daemon?: { load(): Promise<void>; list(): DaemonTaskRecord[] };
  schedule?: Pick<ScheduledTaskStore, "load" | "list">;
  audit?: (cwd: string, limit: number) => Promise<UnifiedAuditRow[]>;
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function clampLimit(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

export async function handleStateQuery(
  cwd: string,
  args: Record<string, unknown>,
  deps: StateQueryDeps = {},
): Promise<ToolResult> {
  const kind = typeof args.kind === "string" ? args.kind : "";
  if (!(STATE_QUERY_KINDS as readonly string[]).includes(kind)) {
    return {
      kind: "error",
      message: `state.query requires kind: ${STATE_QUERY_KINDS.join("|")}`,
      retryable: false,
    };
  }
  const limit = clampLimit(args.limit);
  try {
    switch (kind as StateQueryKind) {
      case "sessions":
        return { kind: "success", output: await querySessions(cwd, limit) };
      case "audit":
        return { kind: "success", output: await queryAudit(cwd, limit, deps) };
      case "approvals":
        return { kind: "success", output: await queryApprovals(cwd, limit, deps) };
      case "daemon":
        return { kind: "success", output: await queryDaemon(limit, deps) };
      case "schedule":
        return { kind: "success", output: await querySchedule(limit, deps) };
      case "graphs":
        return { kind: "success", output: await queryGraphs(cwd, limit) };
      default:
        return { kind: "error", message: `Unsupported kind: ${kind}`, retryable: false };
    }
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

async function querySessions(cwd: string, limit: number): Promise<string> {
  const dir = join(cwd, ".alix", "sessions");
  if (!existsSync(dir)) return "No sessions.";
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs: Array<{ id: string; mtime: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const s = await stat(join(dir, entry.name));
      dirs.push({ id: entry.name, mtime: s.mtimeMs });
    } catch {
      /* skip unreadable */
    }
  }
  if (dirs.length === 0) return "No sessions.";
  dirs.sort((a, b) => b.mtime - a.mtime);
  const lines: string[] = [];
  for (const { id } of dirs.slice(0, limit)) {
    let last = "";
    try {
      const raw = await readFile(join(dir, id, "events.jsonl"), "utf-8");
      const trimmed = raw.trimEnd();
      const idx = trimmed.lastIndexOf("\n");
      last = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
    } catch {
      /* no events file */
    }
    let summary = "(no events)";
    if (last) {
      try {
        const ev = JSON.parse(last) as { type?: string; timestamp?: string };
        summary = `${ev.timestamp ?? ""}  ${ev.type ?? ""}`.trim();
      } catch {
        summary = last.slice(0, 80);
      }
    }
    lines.push(`${id}  ${summary}`);
  }
  return `Sessions (newest first):\n${lines.join("\n")}`;
}

async function queryAudit(cwd: string, limit: number, deps: StateQueryDeps): Promise<string> {
  const read = deps.audit ?? ((c: string, l: number) => readUnifiedAudit(c, { limit: l }));
  const rows = await read(cwd, limit);
  if (rows.length === 0) return "No audit events.";
  const lines = rows.map(
    (r) => `${r.timestamp}  ${r.domain}  ${r.action}${r.summary ? `  ${r.summary}` : ""}`,
  );
  return `Audit events (newest first):\n${lines.join("\n")}`;
}

async function queryApprovals(cwd: string, limit: number, deps: StateQueryDeps): Promise<string> {
  const store = deps.approvals ?? new ApprovalStore(cwd);
  await store.load();
  const pending = store.listPending().slice(0, limit);
  if (pending.length === 0) return "No pending approvals.";
  const lines = pending.map((a) => {
    const subject = a.toolId ?? a.capabilities.join(",");
    return `${a.id}  ${a.status}  ${a.riskLevel ?? "?"}  ${subject}  ${a.reason}`.trim();
  });
  return `Pending approvals:\n${lines.join("\n")}`;
}

async function queryDaemon(limit: number, deps: StateQueryDeps): Promise<string> {
  const registry = deps.daemon ?? new TaskRegistry();
  await registry.load();
  const tasks = registry.list().slice(0, limit);
  if (tasks.length === 0) return "No daemon tasks.";
  const lines = tasks.map((t) => `${t.id}  ${t.status}  ${t.task.slice(0, 80)}`);
  return `Daemon tasks (newest first):\n${lines.join("\n")}`;
}

async function querySchedule(limit: number, deps: StateQueryDeps): Promise<string> {
  const store = deps.schedule ?? new ScheduledTaskStore();
  await store.load();
  const tasks = store.list().slice(0, limit);
  if (tasks.length === 0) return "No scheduled jobs.";
  const lines = tasks.map((t) => `${t.id}  ${t.name}  ${t.status}  next=${t.nextRunAt}`);
  return `Scheduled jobs:\n${lines.join("\n")}`;
}

async function queryGraphs(cwd: string, limit: number): Promise<string> {
  const dir = join(cwd, ".alix", "graphs");
  if (!existsSync(dir)) return "No graphs.";
  const files = (await readdir(dir)).filter(
    (f) => f.endsWith(".json") && !f.endsWith(".runs.json") && !f.includes(".raw") && !f.includes(".validation"),
  );
  if (files.length === 0) return "No graphs.";
  const loaded: Array<{ id: string; status?: string; nodes?: number; goal?: string; mtime: number }> = [];
  for (const file of files) {
    try {
      const path = join(dir, file);
      const s = await stat(path);
      const graph = JSON.parse(await readFile(path, "utf-8")) as {
        status?: string;
        nodes?: unknown[];
        rootGoal?: string;
      };
      loaded.push({
        id: file.replace(/\.json$/, ""),
        ...(graph.status !== undefined ? { status: graph.status } : {}),
        ...(Array.isArray(graph.nodes) ? { nodes: graph.nodes.length } : {}),
        ...(graph.rootGoal !== undefined ? { goal: graph.rootGoal } : {}),
        mtime: s.mtimeMs,
      });
    } catch {
      /* skip unreadable graph */
    }
  }
  loaded.sort((a, b) => b.mtime - a.mtime);
  const lines = loaded
    .slice(0, limit)
    .map((g) => `${g.id}  ${g.status ?? "?"}  ${g.nodes ?? "?"} nodes  "${(g.goal ?? "").slice(0, 80)}"`);
  return `Graphs (newest first):\n${lines.join("\n")}`;
}
