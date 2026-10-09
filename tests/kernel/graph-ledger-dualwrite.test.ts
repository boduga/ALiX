// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { persistGraph } from "../../src/kernel/graph-planner.js";
import { markRunGraphCancelled } from "../../src/kernel/coordination-resume.js";
import {
  mirrorGraphAttemptToLedger,
  graphLedgerStatus,
  resetGraphLedgerStatus,
} from "../../src/kernel/graph-ledger.js";
import { reconcileGraphLedger } from "../../src/kernel/graph-ledger-reconcile.js";
import { getSharedLedger, closeSharedLedger, runtimeLedgerPath } from "../../src/storage/runtime-ledger.js";
import type { TaskGraph } from "../../src/kernel/task-graph.js";
import type { CoordinationRun } from "../../src/kernel/coordination-types.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "graph-ledger-"));
  dirs.push(dir);
  resetGraphLedgerStatus(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { closeSharedLedger(dir); } catch { /* ignore */ }
    resetGraphLedgerStatus(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

function graph(id: string, status: TaskGraph["status"] = "ready"): TaskGraph {
  const now = new Date().toISOString();
  return {
    id,
    schemaVersion: "1.0",
    workflowId: "wf-1",
    rootGoal: "build the thing",
    status,
    strategy: "sequential",
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  } as unknown as TaskGraph;
}

describe("graph ledger authority (R2.13)", () => {
  it("persistGraph mirrors created; reconcile clean", async () => {
    const dir = tmp();
    const g = graph(`graph_${randomUUID()}`);
    await persistGraph(g, dir);

    const ledger = getSharedLedger(dir);
    assert.equal(ledger.entityVersion(g.id), 1);
    assert.equal(ledger.lastEvent(g.id)?.eventType, "graph.created");
    assert.equal(graphLedgerStatus(dir).failures, 0);

    const report = await reconcileGraphLedger(dir);
    assert.equal(report.scannedGraphs, 1);
    assert.equal(report.ledgerGraphs, 1);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
    assert.deepEqual(report.unknownEventTypes, {});
    assert.equal(report.truncated, false);
  });

  it("markRunGraphCancelled mirrors the cancelled status; reconcile clean", async () => {
    const dir = tmp();
    const g = graph(`graph_${randomUUID()}`, "running");
    await persistGraph(g, dir);

    const run = { taskGraphId: g.id } as unknown as CoordinationRun;
    await markRunGraphCancelled(dir, run);

    const ledger = getSharedLedger(dir);
    assert.equal(ledger.entityVersion(g.id), 2);
    const payload = ledger.lastEvent(g.id)?.payload as { graph: TaskGraph };
    assert.equal(payload.graph.status, "cancelled");
    // Cancel bumps updatedAt before write+mirror — payload carries the
    // same record that landed on disk; compare against the file instead.
    const onDisk = JSON.parse(readFileSync(join(dir, ".alix", "graphs", `${g.id}.json`), "utf-8")) as TaskGraph;
    assert.equal(payload.graph.updatedAt, onDisk.updatedAt);

    const report = await reconcileGraphLedger(dir);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
  });

  it("legacy graph file reported missing_in_ledger", async () => {
    const dir = tmp();
    mkdirSync(join(dir, ".alix", "graphs"), { recursive: true });
    const g = graph("graph_legacy");
    writeFileSync(join(dir, ".alix", "graphs", "graph_legacy.json"), JSON.stringify(g, null, 2));

    const report = await reconcileGraphLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("missing_in_ledger"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
  });

  it("tampered graph status reported as record_mismatch", async () => {
    const dir = tmp();
    const g = graph(`graph_${randomUUID()}`, "ready");
    await persistGraph(g, dir);

    const path = join(dir, ".alix", "graphs", `${g.id}.json`);
    const file = JSON.parse(readFileSync(path, "utf-8")) as TaskGraph;
    file.status = "completed";
    writeFileSync(path, JSON.stringify(file, null, 2));

    const report = await reconcileGraphLedger(dir);
    const mismatch = report.issues.find(i => i.kind === "record_mismatch");
    assert.ok(mismatch, JSON.stringify(report.issues));
    assert.match(mismatch!.detail, /json=completed ledger=ready/);
    assert.equal(report.ok, false);
  });

  it("rerun attempts reconcile both directions; attempt mirror is idempotent", async () => {
    const dir = tmp();
    const g = graph(`graph_${randomUUID()}`, "failed");
    await persistGraph(g, dir);

    const attempt = { attempt: 1, nodeId: "n1", status: "failed", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 5 };
    mkdirSync(join(dir, ".alix", "graphs"), { recursive: true });
    writeFileSync(join(dir, ".alix", "graphs", `${g.id}.runs.json`), JSON.stringify([attempt], null, 2));
    mirrorGraphAttemptToLedger(dir, g.id, attempt);
    mirrorGraphAttemptToLedger(dir, g.id, attempt); // idempotent — no second event

    const ledger = getSharedLedger(dir);
    assert.equal(ledger.entityVersion(`${g.id}#attempt-1`), 1);

    let report = await reconcileGraphLedger(dir);
    assert.equal(report.scannedAttempts, 1);
    assert.equal(report.ledgerAttempts, 1);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));

    // Attempt in runs.json but never mirrored → record_mismatch.
    const attempt2 = { ...attempt, attempt: 2 };
    writeFileSync(join(dir, ".alix", "graphs", `${g.id}.runs.json`), JSON.stringify([attempt, attempt2], null, 2));
    report = await reconcileGraphLedger(dir);
    assert.ok(report.issues.some(i => i.detail.includes("attempt 2")), JSON.stringify(report.issues));

    // Ledger attempt with no runs.json counterpart → projection_missing.
    writeFileSync(join(dir, ".alix", "graphs", `${g.id}.runs.json`), JSON.stringify([], null, 2));
    report = await reconcileGraphLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("projection_missing"), JSON.stringify(report.issues));
  });

  it("append failure fails the mutation — no JSON-only commit (R2.13 authority)", async () => {
    const dir = tmp();
    closeSharedLedger(dir);
    mkdirSync(runtimeLedgerPath(dir), { recursive: true });

    const g = graph(`graph_${randomUUID()}`);
    await assert.rejects(() => persistGraph(g, dir), /SQLITE|unable|not a database|ledger append failed/i);
    assert.equal(graphLedgerStatus(dir).failures >= 1, true);
    assert.ok(graphLedgerStatus(dir).lastError);
    // Authoritative store unavailable → no projection commit either.
    assert.ok(!existsSync(join(dir, ".alix", "graphs", `${g.id}.json`)));

    rmSync(runtimeLedgerPath(dir), { recursive: true, force: true });
  });

  it("projection write failure is tolerated: ledger holds truth, loadGraph still works", async () => {
    const dir = tmp();
    const g = graph(`graph_${randomUUID()}`);
    // Occupy the graph file path with a DIRECTORY so writeFile fails.
    mkdirSync(join(dir, ".alix", "graphs", `${g.id}.json`), { recursive: true });

    const path = await persistGraph(g, dir); // must NOT throw
    assert.ok(path.endsWith(`${g.id}.json`));
    assert.equal(graphLedgerStatus(dir).projectionFailures, 1);
    assert.ok(graphLedgerStatus(dir).lastProjectionError);
    assert.equal(getSharedLedger(dir).entityVersion(g.id), 1);

    const { loadGraph } = await import("../../src/kernel/graph-executor.js");
    const loaded = await loadGraph(g.id, dir);
    assert.equal(loaded.status, "ready"); // authority read, no usable file

    const report = await reconcileGraphLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("projection_missing"), JSON.stringify(report.issues));
  });

  it("loadGraph prefers the LEDGER over a tampered graph file", async () => {
    const dir = tmp();
    const g = graph(`graph_${randomUUID()}`, "ready");
    await persistGraph(g, dir);

    const filePath = join(dir, ".alix", "graphs", `${g.id}.json`);
    const file = JSON.parse(readFileSync(filePath, "utf-8")) as TaskGraph;
    file.status = "completed";
    writeFileSync(filePath, JSON.stringify(file, null, 2));

    const { loadGraph } = await import("../../src/kernel/graph-executor.js");
    const loaded = await loadGraph(g.id, dir);
    assert.equal(loaded.status, "ready"); // ledger truth, not the tampered file
  });

  it("fresh workspace reconciles clean with zero graphs", async () => {
    const dir = tmp();
    const report = await reconcileGraphLedger(dir);
    assert.equal(report.scannedGraphs, 0);
    assert.equal(report.ok, true);
  });
});

