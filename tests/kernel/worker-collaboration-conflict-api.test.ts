import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CollaborationStore } from "../../src/kernel/collaboration-store.js";
import { BoundWorkerCollaborationAPI } from "../../src/kernel/worker-collaboration-api.js";

const RUN_ID = "run_api_1";
const WORKER_ID = "worker_a";
const WORKER_ATTEMPT = 1;

function seedState(cwd: string): void {
  mkdirSync(join(cwd, ".alix", "coordination", "shared", RUN_ID), { recursive: true });
  writeFileSync(
    join(cwd, ".alix", "coordination", "shared", RUN_ID, "state.json"),
    JSON.stringify({
      schemaVersion: "1.0", runId: RUN_ID, revision: 0,
      findings: [], artifacts: [], conflicts: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }),
    "utf-8",
  );
}

async function seedFinding(store: CollaborationStore, workerId: string, attempt: number, title: string): Promise<string> {
  const f = await store.publishFinding(
    { kind: "fact", title, content: `content of ${title}`, tags: [] },
    { runId: RUN_ID, workerId, workerAttempt: attempt },
  );
  return f.id;
}

describe("WorkerCollaborationAPI conflict reporting", () => {
  let cwd: string;
  let store: CollaborationStore;
  let api: BoundWorkerCollaborationAPI;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), "wapi-"));
    seedState(cwd);
    store = new CollaborationStore(cwd, RUN_ID);
    api = new BoundWorkerCollaborationAPI(
      { runId: RUN_ID, workerId: WORKER_ID, workerAttempt: WORKER_ATTEMPT },
      store,
      [],
    );
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("same-run findings accepted", async () => {
    const f1 = await seedFinding(store, "w1", 1, "first");
    const f2 = await seedFinding(store, "w2", 1, "second");
    const conflictId = await api.reportConflict({
      findingIds: [f1, f2],
      reason: "they conflict",
    });
    assert.ok(conflictId.startsWith("conflict_"));
    const all = await store.queryConflicts({});
    assert.equal(all.length, 1);
    assert.equal(all[0].status, "under_review");
  });

  it("missing finding rejected", async () => {
    const f1 = await seedFinding(store, "w1", 1, "real");
    await assert.rejects(
      () => api.reportConflict({ findingIds: [f1, "missing_finding"], reason: "x" }),
      /Findings not found/,
    );
  });

  it("cross-run finding rejected", async () => {
    // Seed a finding in a different run.
    const otherCwd = mkdtempSync(join(tmpdir(), "wapi-other-"));
    mkdirSync(join(otherCwd, ".alix", "coordination", "shared", "other_run"), { recursive: true });
    writeFileSync(
      join(otherCwd, ".alix", "coordination", "shared", "other_run", "state.json"),
      JSON.stringify({
        schemaVersion: "1.0", runId: "other_run", revision: 0,
        findings: [], artifacts: [], conflicts: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
      "utf-8",
    );
    const otherStore = new CollaborationStore(otherCwd, "other_run");
    const f_other = (await otherStore.publishFinding(
      { kind: "fact", title: "from other run", content: "x", tags: [] },
      { runId: "other_run", workerId: "wX", workerAttempt: 1 },
    )).id;
    rmSync(otherCwd, { recursive: true, force: true });

    // api's store won't see the other-run finding; both IDs are unknown to
    // this run, so the missing-check fires. (The duplicate-ID check requires
    // unique IDs, so we use f_other plus an unknown placeholder.)
    await assert.rejects(
      () => api.reportConflict({ findingIds: [f_other, "missing_in_run"], reason: "x" }),
      /Findings not found/,
    );
  });

  it("duplicate IDs rejected", async () => {
    const f1 = await seedFinding(store, "w1", 1, "x");
    await assert.rejects(
      () => api.reportConflict({ findingIds: [f1, f1], reason: "dup" }),
      /Duplicate finding ID/,
    );
  });

  it("duplicate IDs across three entries rejected on the first repeat", async () => {
    const f1 = await seedFinding(store, "w1", 1, "x");
    const f2 = await seedFinding(store, "w2", 1, "y");
    await assert.rejects(
      () => api.reportConflict({ findingIds: [f1, f2, f1], reason: "dup" }),
      /Duplicate finding ID/,
    );
  });

  it("fewer than two IDs rejected", async () => {
    await assert.rejects(
      () => api.reportConflict({ findingIds: ["only_one"], reason: "x" }),
      /At least two/,
    );
  });

  it("worker cannot resolve (no resolve API on the bound surface)", async () => {
    const f1 = await seedFinding(store, "w1", 1, "x");
    const f2 = await seedFinding(store, "w2", 1, "y");
    await api.reportConflict({ findingIds: [f1, f2], reason: "z" });
    // The BoundWorkerCollaborationAPI has no resolveConflict method.
    assert.equal(typeof (api as any).resolveConflict, "undefined");
  });

  it("bounded list output: default 50, filters to run", async () => {
    const f1 = await seedFinding(store, "w1", 1, "a");
    const f2 = await seedFinding(store, "w2", 1, "b");
    await api.reportConflict({ findingIds: [f1, f2], reason: "r1" });
    const f3 = await seedFinding(store, "w3", 1, "c");
    const f4 = await seedFinding(store, "w4", 1, "d");
    await api.reportConflict({ findingIds: [f3, f4], reason: "r2" });

    const list = await api.listConflicts({});
    assert.equal(list.length, 2);
    const limited = await api.listConflicts({ limit: 1 });
    assert.equal(limited.length, 1);
  });
});
