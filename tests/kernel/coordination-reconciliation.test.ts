import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";
import { reconcileCoordinationRun } from "../../src/kernel/coordination-reconciliation.js";

const ORPHAN_THRESHOLD_MS = 100;

describe("reconcileCoordinationRun", () => {
  let cwd: string;
  let store: CoordinationStore;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "recon-")); store = new CoordinationStore(cwd); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("orphans stale different-owner workers", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);
    const w1 = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "T", goalPrompt: "do it",
      status: "running", lastHeartbeatAt: new Date(Date.now() - 60000).toISOString(),
      executionOwnerId: "other-daemon",
    });
    await store.addWorker(run.id, w1);
    // Wait for stale threshold
    await new Promise(r => setTimeout(r, 50));
    const result = await reconcileCoordinationRun({ store, daemonInstanceId: "my-daemon", orphanThresholdMs: ORPHAN_THRESHOLD_MS }, run.id);
    assert.equal(result.orphaned.length, 1);
    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers[0].status, "failed");
  });

  it("propagates dependency failures transitively", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);
    const w1 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "A", goalPrompt: "a" });
    const w2 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "w2", taskLabel: "B", goalPrompt: "b", dependencies: [w1.id] });
    await store.addWorker(run.id, w1);
    await store.addWorker(run.id, w2);
    await store.patchWorker(run.id, w1.id, { status: "failed", error: "oops" });
    const result = await reconcileCoordinationRun({ store, daemonInstanceId: "d", orphanThresholdMs: ORPHAN_THRESHOLD_MS }, run.id);
    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers.find(w => w.id === w2.id)?.status, "blocked");
  });

  it("resumes approved workers", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);
    const w1 = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "T", goalPrompt: "do it",
      status: "blocked", blockReason: "approval_required", approvalId: "apr-1",
    });
    await store.addWorker(run.id, w1);
    const isApproved = async (id: string) => id === "apr-1";
    const result = await reconcileCoordinationRun(
      { store, daemonInstanceId: "d", orphanThresholdMs: ORPHAN_THRESHOLD_MS, isApproved }, run.id,
    );
    assert.equal(result.approvalResumed.length, 1);
    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers[0].status, "pending");
  });

  it("preserves fresh-heartbeat workers", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);
    const w1 = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "T", goalPrompt: "do it",
      status: "running", lastHeartbeatAt: new Date().toISOString(),
      executionOwnerId: "my-daemon",
    });
    await store.addWorker(run.id, w1);
    const result = await reconcileCoordinationRun(
      { store, daemonInstanceId: "my-daemon", orphanThresholdMs: ORPHAN_THRESHOLD_MS, activeExecutionIds: new Set([w1.id]) }, run.id,
    );
    assert.equal(result.orphaned.length, 0);
    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers[0].status, "running");
  });
});
