/**
 * coordination-store.test.ts — Unit tests for CoordinationStore.
 *
 * Tests persistence, worker lifecycle transitions, ready-worker
 * detection (dependency resolution), and run-status recomputation.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import {
  createCoordinationRun,
  createWorkerAssignment,
  transitionWorkerStatus,
  recomputeRunStatus,
} from "../../src/kernel/coordination-types.js";

describe("CoordinationStore", () => {
  let tmpDir: string;
  let store: CoordinationStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "coord-test-"));
    store = new CoordinationStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads a run", async () => {
    const run = createCoordinationRun({
      sessionId: "session-1",
      rootGoal: "Test goal",
      coordinatorAgentId: "alix",
    });
    await store.save(run);
    const loaded = await store.load(run.id);
    assert.ok(loaded, "should load saved run");
    assert.equal(loaded?.rootGoal, "Test goal");
    assert.equal(loaded?.status, "planning");
  });

  it("returns null for missing run", async () => {
    const loaded = await store.load("coord_nonexistent");
    assert.equal(loaded, null);
  });

  it("lists runs newest first", async () => {
    const run1 = createCoordinationRun({ sessionId: "s1", rootGoal: "First", coordinatorAgentId: "alix" });
    // Small delay ensures distinct timestamps for deterministic sort order
    await new Promise(r => setTimeout(r, 5));
    const run2 = createCoordinationRun({ sessionId: "s2", rootGoal: "Second", coordinatorAgentId: "alix" });
    await store.save(run1);
    await store.save(run2);
    const list = await store.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].rootGoal, "Second"); // newest first
  });

  it("adds a worker to a run", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Test", coordinatorAgentId: "alix" });
    await store.save(run);

    const worker = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "worker-a",
      taskLabel: "Research",
      goalPrompt: "Find relevant info",
    });
    const updated = await store.addWorker(run.id, worker);
    assert.ok(updated);
    assert.equal(updated!.workers.length, 1);
    assert.equal(updated!.workers[0].taskLabel, "Research");
  });

  it("updates a worker's status", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Test", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "Task", goalPrompt: "do it",
    });
    await store.addWorker(run.id, worker);

    const updated = await store.updateWorkerStatus(run.id, worker.id, "running");
    assert.ok(updated);
    const found = updated!.workers.find(w => w.id === worker.id);
    assert.equal(found?.status, "running");
  });

  it("detects ready workers by dependency resolution", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Dep test", coordinatorAgentId: "alix" });
    await store.save(run);

    const w1 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "Step 1", goalPrompt: "do it" });
    const w2 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "w2", taskLabel: "Step 2", goalPrompt: "do it", dependencies: [w1.id] });
    await store.addWorker(run.id, w1);
    const updatedRun = await store.addWorker(run.id, w2);

    // Only w1 should be ready initially (no dependencies)
    let ready = store.getReadyWorkers(updatedRun!);
    assert.equal(ready.length, 1);
    assert.equal(ready[0].id, w1.id);

    // After marking w1 completed, w2 becomes ready
    const nextUpdated = await store.updateWorkerStatus(run.id, w1.id, "completed");
    assert.ok(nextUpdated);
    ready = store.getReadyWorkers(nextUpdated!);
    assert.equal(ready.length, 1);
    assert.equal(ready[0].id, w2.id); // only w2 now
  });

  it("isComplete returns false with no workers", () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Empty", coordinatorAgentId: "alix" });
    assert.equal(store.isComplete(run), false);
  });

  it("isComplete returns true when all workers terminal", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Complete", coordinatorAgentId: "alix" });
    await store.save(run);
    const w1 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "Task", goalPrompt: "do it" });
    await store.addWorker(run.id, w1);
    await store.updateWorkerStatus(run.id, w1.id, "completed");
    const loaded = await store.load(run.id);
    assert.ok(loaded);
    assert.equal(store.isComplete(loaded), true);
  });
});

describe("recomputeRunStatus", () => {
  it("returns running when no workers", () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Test", coordinatorAgentId: "alix" });
    assert.equal(recomputeRunStatus(run), "running");
  });

  it("returns completed when all workers completed", () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Test", coordinatorAgentId: "alix" });
    run.workers = [
      createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "A", goalPrompt: "a" }),
      createWorkerAssignment({ coordinationRunId: run.id, agentId: "w2", taskLabel: "B", goalPrompt: "b" }),
    ];
    run.workers[0] = transitionWorkerStatus(run.workers[0], "completed");
    run.workers[1] = transitionWorkerStatus(run.workers[1], "completed");
    assert.equal(recomputeRunStatus(run), "completed");
  });

  it("returns failed when some workers failed and none running", () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Test", coordinatorAgentId: "alix" });
    run.workers = [
      createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "A", goalPrompt: "a" }),
    ];
    run.workers[0] = transitionWorkerStatus(run.workers[0], "failed", { error: "oops" });
    assert.equal(recomputeRunStatus(run), "failed");
  });

  it("returns running when any worker is active", () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Test", coordinatorAgentId: "alix" });
    run.workers = [
      createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "A", goalPrompt: "a" }),
      createWorkerAssignment({ coordinationRunId: run.id, agentId: "w2", taskLabel: "B", goalPrompt: "b" }),
    ];
    run.workers[0] = transitionWorkerStatus(run.workers[0], "running");
    run.workers[1] = transitionWorkerStatus(run.workers[1], "completed");
    assert.equal(recomputeRunStatus(run), "running");
  });
});
