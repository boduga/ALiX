import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseOwnerPid, isPidAlive, isOwnerAlive } from "../../src/kernel/owner-liveness.js";
import { reclaimDeadOwnerWorkers, findResumableRuns } from "../../src/kernel/coordination-resume.js";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";

const DEAD_PID = 99_999_999;

describe("owner liveness", () => {
  it("parses known owner kinds and rejects others", () => {
    assert.equal(parseOwnerPid("web-1234"), 1234);
    assert.equal(parseOwnerPid("tool-42"), 42);
    assert.equal(parseOwnerPid("cli-7"), 7);
    assert.equal(parseOwnerPid("daemon-1"), null);
    assert.equal(parseOwnerPid("other-daemon"), null);
    assert.equal(parseOwnerPid(undefined), null);
    assert.equal(parseOwnerPid("web-0"), null);
  });

  it("detects a live PID and a dead one", () => {
    assert.equal(isPidAlive(process.pid), true);
    assert.equal(isPidAlive(DEAD_PID), false);
  });

  it("treats unknown owners as alive (never steal)", () => {
    assert.equal(isOwnerAlive(undefined), true);
    assert.equal(isOwnerAlive("other-daemon"), true);
    assert.equal(isOwnerAlive("daemon-1"), true);
    assert.equal(isOwnerAlive(`web-${process.pid}`), true);
    assert.equal(isOwnerAlive(`web-${DEAD_PID}`), false);
  });
});

describe("coordination resume", () => {
  let cwd: string;
  let store: CoordinationStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coord-resume-"));
    store = new CoordinationStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function addWorker(runId: string, overrides: Record<string, unknown>) {
    return createWorkerAssignment({
      coordinationRunId: runId,
      agentId: "alix#1",
      taskLabel: "T",
      goalPrompt: "do",
      status: "running",
      attempt: 0,
      maxAttempts: 3,
      ...overrides,
    });
  }

  it("reclaims dead-owner running workers to pending and bumps attempt", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    run.hostKind = "inspector";
    await store.save(run);
    const dead = addWorker(run.id, { executionOwnerId: `web-${DEAD_PID}` });
    await store.addWorker(run.id, dead);

    const result = await reclaimDeadOwnerWorkers(store, run.id);
    assert.deepEqual(result.reclaimedWorkerIds, [dead.id]);
    const loaded = await store.load(run.id);
    const worker = loaded!.workers[0];
    assert.equal(worker.status, "pending");
    assert.equal(worker.attempt, 1);
    assert.equal(worker.executionOwnerId, undefined);
    assert.match(worker.error ?? "", /Reclaimed/);
  });

  it("leaves live-owner and unknown-owner workers alone", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    await store.save(run);
    const live = addWorker(run.id, { executionOwnerId: `web-${process.pid}` });
    const unknown = addWorker(run.id, { executionOwnerId: "other-daemon" });
    await store.addWorker(run.id, live);
    await store.addWorker(run.id, unknown);

    const result = await reclaimDeadOwnerWorkers(store, run.id);
    assert.deepEqual(result.reclaimedWorkerIds, []);
    const loaded = await store.load(run.id);
    assert.ok(loaded!.workers.every(w => w.status === "running"));
  });

  it("finds only active runs for the given host kind", async () => {
    const inspector = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    inspector.hostKind = "inspector";
    const cli = createCoordinationRun({ sessionId: "s2", rootGoal: "g", coordinatorAgentId: "alix" });
    cli.hostKind = "cli";
    const done = createCoordinationRun({ sessionId: "s3", rootGoal: "g", coordinatorAgentId: "alix" });
    done.hostKind = "inspector";
    done.status = "completed";
    await store.save(inspector);
    await store.save(cli);
    await store.save(done);

    assert.deepEqual(await findResumableRuns(store, "inspector"), [inspector.id]);
  });
});
