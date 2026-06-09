# M0.19-A: Core RuntimeIndex

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only, on-demand RuntimeIndex that aggregates events from audit, approvals, graphs, and graph_runs into a single queryable view.

**Architecture:** On-the-fly aggregation across four existing backends — no new storage. All queries run against disk; index is built per-query.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/runtime/runtime-index.ts` | **Create** | RuntimeIndexEvent type, buildRuntimeIndex(), query methods |
| `tests/runtime/runtime-index.test.ts` | **Create** | Tests with seeded data in temp dirs |

---

### Task 1: Create RuntimeIndex module

**Files:**
- Create: `src/runtime/runtime-index.ts`

- [ ] **Step 1: Write the module**

```typescript
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
import type { AuditRecord, AuditAction } from "../audit/audit-types.js";
import type { ApprovalRecord } from "../approvals/approval-store.js";

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
        } catch { /* skip malformed */ }
      }
    } catch { /* skip unreadable */ }
  }

  // Source 2: approvals/approvals.json
  const approvalsPath = join(cwd, ".alix", "approvals", "approvals.json");
  if (existsSync(approvalsPath)) {
    try {
      const raw = await readFile(approvalsPath, "utf-8");
      const records = JSON.parse(raw) as ApprovalRecord[];
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
          payload: record as any,
        });
      }
    } catch { /* skip unreadable */ }
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
        } catch { /* skip invalid */ }
      }
    } catch { /* skip unreadable */ }
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
        } catch { /* skip invalid */ }
      }
    } catch { /* skip unreadable */ }
  }

  // Sort by timestamp descending (newest first), fall back to id
  events.sort((a, b) => {
    const tA = a.timestamp || a.id;
    const tB = b.timestamp || b.id;
    return tB.localeCompare(tA);
  });

  // Build query methods
  const byGraph = (graphId: string) => events.filter(e => e.graphId === graphId);
  const bySession = (sessionId: string) => events.filter(e => e.sessionId === sessionId);
  const byApproval = (approvalId: string) => events.filter(e => e.approvalId === approvalId);
  const byAction = (action: string) => events.filter(e => e.action === action);

  return { events, byGraph, bySession, byApproval, byAction };
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/runtime/runtime-index.ts
git commit -m "feat(runtime): add RuntimeIndex — on-demand aggregation across backends"
```

---

### Task 2: Create RuntimeIndex tests

**Files:**
- Create: `tests/runtime/runtime-index.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimeIndex } from "../../src/runtime/runtime-index.js";

function seedDir(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "runtime-index-test-"));
  const auditDir = join(tmpDir, ".alix", "audit");
  const approvalsDir = join(tmpDir, ".alix", "approvals");
  const graphsDir = join(tmpDir, ".alix", "graphs");
  mkdirSync(auditDir, { recursive: true });
  mkdirSync(approvalsDir, { recursive: true });
  mkdirSync(graphsDir, { recursive: true });
  return tmpDir;
}

function writeAudit(dir: string, lines: string[]) {
  const { writeFileSync } = require("fs");
  writeFileSync(join(dir, ".alix", "audit", "audit.jsonl"), lines.join("\n") + "\n");
}

function writeApprovals(dir: string, records: any[]) {
  writeFileSync(join(dir, ".alix", "approvals", "approvals.json"), JSON.stringify(records));
}

function writeGraph(dir: string, graphId: string, graph: any) {
  writeFileSync(join(dir, ".alix", "graphs", `${graphId}.json`), JSON.stringify(graph));
}

function writeRuns(dir: string, graphId: string, runs: any[]) {
  writeFileSync(join(dir, ".alix", "graphs", `${graphId}.runs.json`), JSON.stringify(runs));
}

describe("RuntimeIndex", () => {
  it("returns empty index when no data dirs exist", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "runtime-empty-"));
    try {
      const idx = await buildRuntimeIndex(tmpDir);
      assert.equal(idx.events.length, 0);
      assert.equal(idx.byGraph("x").length, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("includes audit records", async () => {
    const dir = seedDir();
    try {
      writeAudit(dir, [
        `{"id":"audit_1","action":"policy.allowed","timestamp":"2026-06-09T12:00:00Z","details":{"capability":"web.search"}}`,
        `{"id":"audit_2","action":"runtime.blocked","timestamp":"2026-06-09T12:01:00Z","details":{"graphId":"g1","nodeId":"n1","reason":"Missing caps"}}`,
      ]);
      const idx = await buildRuntimeIndex(dir);
      assert.equal(idx.events.length, 2);
      assert.equal(idx.byAction("policy.allowed").length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes approval records", async () => {
    const dir = seedDir();
    try {
      writeApprovals(dir, [
        { id: "app_1", status: "pending", createdAt: "2026-06-09T12:00:00Z", reason: "Need approval", capability: "shell.exec", graphId: "g1", nodeId: "n1" },
        { id: "app_2", status: "approved", createdAt: "2026-06-09T12:05:00Z", decidedAt: "2026-06-09T12:06:00Z", reason: "Looks good", capability: "shell.exec" },
      ]);
      const idx = await buildRuntimeIndex(dir);
      assert.equal(idx.events.length, 2);
      const approvals = idx.byApproval("app_1");
      assert.equal(approvals.length, 1);
      assert.equal(approvals[0].action, "approval.created");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes graph and node events", async () => {
    const dir = seedDir();
    try {
      writeGraph(dir, "graph_abc", {
        id: "graph_abc", rootGoal: "Research task", status: "running", strategy: "sequential",
        updatedAt: "2026-06-09T12:00:00Z",
        nodes: [
          { id: "n1", title: "Search", status: "done", requiredCapabilities: ["web.search"] },
          { id: "n2", title: "Synthesize", status: "pending" },
        ],
      });
      const idx = await buildRuntimeIndex(dir);
      assert.equal(idx.events.length, 3); // 1 graph + 2 nodes
      const graphEvents = idx.byGraph("graph_abc");
      assert.equal(graphEvents.length, 3);
      const nodes = graphEvents.filter(e => e.nodeId);
      assert.equal(nodes.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes graph run attempts", async () => {
    const dir = seedDir();
    try {
      writeGraph(dir, "graph_abc", { id: "graph_abc", status: "completed", nodes: [] });
      writeRuns(dir, "graph_abc", [
        { attempt: 1, nodeId: "n1", status: "failed", error: "Timeout", startedAt: "2026-06-09T12:00:00Z" },
        { attempt: 2, nodeId: "n1", status: "done", summary: "Success", startedAt: "2026-06-09T12:05:00Z" },
      ]);
      const idx = await buildRuntimeIndex(dir);
      const runs = idx.byAction("rerun.done");
      assert.equal(runs.length, 1);
      assert.equal(runs[0].nodeId, "n1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sorts events newest first", async () => {
    const dir = seedDir();
    try {
      writeAudit(dir, [
        `{"id":"audit_1","action":"policy.allowed","timestamp":"2026-06-09T12:00:00Z","details":{}}`,
        `{"id":"audit_2","action":"runtime.blocked","timestamp":"2026-06-09T12:05:00Z","details":{}}`,
      ]);
      const idx = await buildRuntimeIndex(dir);
      assert.equal(idx.events[0].id, "audit_2");
      assert.equal(idx.events[1].id, "audit_1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("byAction filters correctly", async () => {
    const dir = seedDir();
    try {
      writeAudit(dir, [
        `{"id":"a1","action":"policy.allowed","timestamp":"2026-06-09T12:00:00Z","details":{}}`,
        `{"id":"a2","action":"policy.denied","timestamp":"2026-06-09T12:01:00Z","details":{}}`,
        `{"id":"a3","action":"policy.allowed","timestamp":"2026-06-09T12:02:00Z","details":{}}`,
      ]);
      const idx = await buildRuntimeIndex(dir);
      assert.equal(idx.byAction("policy.allowed").length, 2);
      assert.equal(idx.byAction("policy.denied").length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/runtime/runtime-index.test.js 2>&1
```

Expected: 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/runtime/runtime-index.test.ts
git commit -m "test(runtime): add RuntimeIndex tests with seeded data"
```
