import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationResultStore } from "../../src/kernel/coordination-result-store.js";
import { createWorkerAssignment } from "../../src/kernel/coordination-types.js";

describe("CoordinationResultStore", () => {
  let cwd: string;
  let store: CoordinationResultStore;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "res-")); store = new CoordinationResultStore(cwd); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("persists success result and returns relative ref", async () => {
    const worker = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a1", taskLabel: "T", goalPrompt: "do it", attempt: 1 });
    const ref = await store.persist(worker, "r1", { outcome: "success", summary: "done" });
    assert.ok(ref.endsWith(".json"));
    assert.ok(existsSync(join(cwd, ref)));
    assert.ok(!ref.startsWith("/"));
    const content = JSON.parse(readFileSync(join(cwd, ref), "utf-8"));
    assert.equal(content.outcome, "success");
    assert.equal(content.workerId, worker.id);
  });

  it("persists failure result", async () => {
    const worker = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a1", taskLabel: "T", goalPrompt: "do it", attempt: 1 });
    const ref = await store.persist(worker, "r1", { outcome: "failure", error: "timeout", failureKind: "timeout" });
    const content = JSON.parse(readFileSync(join(cwd, ref), "utf-8"));
    assert.equal(content.outcome, "failure");
    assert.equal(content.failureKind, "timeout");
  });

  it("no temp file remains after persist", async () => {
    const worker = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a1", taskLabel: "T", goalPrompt: "do it" });
    await store.persist(worker, "r1", { outcome: "success" });
    const resultsDir = join(cwd, ".alix", "coordination", "results");
    const files = readdirSync(resultsDir);
    const tmpFiles = files.filter(f => f.includes(".tmp."));
    assert.equal(tmpFiles.length, 0);
  });

  it("loads a persisted record", async () => {
    const worker = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a1", taskLabel: "T", goalPrompt: "do it", attempt: 2 });
    await store.persist(worker, "r1", { outcome: "success" });
    const loaded = await store.load(worker.id);
    assert.ok(loaded);
    assert.equal(loaded!.attempt, 2);
  });
});
