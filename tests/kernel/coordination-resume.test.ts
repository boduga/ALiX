import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseOwnerPid, isPidAlive, isOwnerAlive, heartbeatStale, shouldReclaimWorker, DEFAULT_ORPHAN_THRESHOLD_MS } from "../../src/coordination/kernel/owner-liveness.js";
import { reclaimDeadOwnerWorkers, findResumableRuns, cancelDeadOwnerRuns } from "../../src/coordination/kernel/coordination-resume.js";
import { CoordinationStore } from "../../src/coordination/kernel/coordination-store.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/coordination/kernel/coordination-types.js";
import { OwnershipRegistry } from "../../src/coordination/ownership/ownership-registry.js";
import { persistGraph } from "../../src/coordination/kernel/graph-planner.js";

const DEAD_PID = 99_999_999;

describe("owner liveness", () => {
  it("parses known owner kinds and rejects others", () => {
    assert.equal(parseOwnerPid("web-1234"), 1234);
    assert.equal(parseOwnerPid("tool-42"), 42);
    assert.equal(parseOwnerPid("cli-7"), 7);
    assert.equal(parseOwnerPid("daemon-9"), 9);
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
    assert.equal(isOwnerAlive("named-daemon"), true);
    assert.equal(isOwnerAlive(`web-${process.pid}`), true);
    assert.equal(isOwnerAlive(`web-${DEAD_PID}`), false);
  });

  it("heartbeatStale treats missing/unparseable timestamps as no evidence", () => {
    const now = new Date();
    assert.equal(heartbeatStale(undefined, 100, now), false);
    assert.equal(heartbeatStale(null, 100, now), false);
    assert.equal(heartbeatStale("not-a-date", 100, now), false);
    assert.equal(heartbeatStale(new Date(now.getTime() - 1000).toISOString(), 100, now), true);
    assert.equal(heartbeatStale(new Date(now.getTime()).toISOString(), 100, now), false);
  });

  it("shouldReclaimWorker is the ONE verdict: prove dead, or ownerless+stale", () => {
    const stale = new Date(Date.now() - 2 * DEFAULT_ORPHAN_THRESHOLD_MS).toISOString();
    const fresh = new Date().toISOString();
    const base = { orphanThresholdMs: DEFAULT_ORPHAN_THRESHOLD_MS };
    // not running → never
    assert.equal(shouldReclaimWorker({ ...base, status: "pending", executionOwnerId: `web-${DEAD_PID}` }), false);
    // locally active → never, regardless of owner/heartbeat
    assert.equal(shouldReclaimWorker({ ...base, status: "running", locallyActive: true, executionOwnerId: `web-${DEAD_PID}` }), false);
    assert.equal(shouldReclaimWorker({ ...base, status: "running", locallyActive: true, lastHeartbeatAt: stale }), false);
    // owned worker: provably dead owner reclaims even with fresh heartbeat
    assert.equal(shouldReclaimWorker({ ...base, status: "running", executionOwnerId: `web-${DEAD_PID}`, lastHeartbeatAt: fresh }), true);
    // owned worker: live or unknown owner never reclaims, however stale
    assert.equal(shouldReclaimWorker({ ...base, status: "running", executionOwnerId: `web-${process.pid}`, lastHeartbeatAt: stale }), false);
    assert.equal(shouldReclaimWorker({ ...base, status: "running", executionOwnerId: "other-daemon", lastHeartbeatAt: stale }), false);
    // ownerless: stale reclaims, fresh/missing does not
    assert.equal(shouldReclaimWorker({ ...base, status: "running", lastHeartbeatAt: stale }), true);
    assert.equal(shouldReclaimWorker({ ...base, status: "running", lastHeartbeatAt: fresh }), false);
    assert.equal(shouldReclaimWorker({ ...base, status: "running" }), false);
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

    const result = await reclaimDeadOwnerWorkers(store, run.id, new OwnershipRegistry(cwd));
    assert.deepEqual(result.reclaimedWorkerIds, [dead.id]);
    const loaded = await store.load(run.id);
    const worker = loaded!.workers[0];
    assert.equal(worker.status, "pending");
    assert.equal(worker.attempt, 1);
    assert.equal(worker.executionOwnerId, undefined);
    assert.match(worker.error ?? "", /Reclaimed/);
  });

  it("releases held leases when reclaiming a dead-owner worker (R3.4)", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    run.hostKind = "inspector";
    await store.save(run);
    const registry = new OwnershipRegistry(cwd);
    const acquired = await registry.acquire({
      agentId: "alix#1",
      scope: { kind: "path", root: join(cwd, "src"), recursive: true },
      mode: "exclusive-write",
      ttlMs: 60_000,
    });
    assert.equal(acquired.acquired, true);
    const leaseId = acquired.record!.id;
    const dead = addWorker(run.id, { executionOwnerId: `web-${DEAD_PID}`, leaseIds: [leaseId] });
    await store.addWorker(run.id, dead);

    await reclaimDeadOwnerWorkers(store, run.id, registry);

    // Releasing, not just forgetting: the registry record is terminal...
    await registry.refresh();
    assert.equal(registry.get(leaseId)?.status, "released");
    // ...and the worker record no longer claims it.
    const loaded = await store.load(run.id);
    assert.deepEqual(loaded!.workers[0].leaseIds, []);
  });

  it("leaves live-owner and unknown-owner workers alone", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    await store.save(run);
    const live = addWorker(run.id, { executionOwnerId: `web-${process.pid}` });
    const unknown = addWorker(run.id, { executionOwnerId: "other-daemon" });
    await store.addWorker(run.id, live);
    await store.addWorker(run.id, unknown);

    const result = await reclaimDeadOwnerWorkers(store, run.id, new OwnershipRegistry(cwd));
    assert.deepEqual(result.reclaimedWorkerIds, []);
    const loaded = await store.load(run.id);
    assert.ok(loaded!.workers.every(w => w.status === "running"));
  });

  it("never reclaims a locally-active worker even with a dead owner", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    run.hostKind = "inspector";
    await store.save(run);
    const dead = addWorker(run.id, { executionOwnerId: `web-${DEAD_PID}` });
    await store.addWorker(run.id, dead);

    const result = await reclaimDeadOwnerWorkers(store, run.id, new OwnershipRegistry(cwd), DEFAULT_ORPHAN_THRESHOLD_MS, {
      isLocallyActive: (id) => id === dead.id,
    });
    assert.deepEqual(result.reclaimedWorkerIds, []);
    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers[0].status, "running");
  });

  it("retains a failed release on the record so a later reclaim retries it", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    run.hostKind = "inspector";
    await store.save(run);
    const dead = addWorker(run.id, { executionOwnerId: `web-${DEAD_PID}`, leaseIds: ["lease-keep"] });
    await store.addWorker(run.id, dead);
    const failingRegistry = { release: async () => false } as unknown as OwnershipRegistry;

    const result = await reclaimDeadOwnerWorkers(store, run.id, failingRegistry);
    assert.deepEqual(result.reclaimedWorkerIds, [dead.id]);
    const loaded = await store.load(run.id);
    assert.deepEqual(loaded!.workers[0].leaseIds, ["lease-keep"]);
  });

  it("finds only active runs for the given host kinds", async () => {
    const inspector = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    inspector.hostKind = "inspector";
    const cli = createCoordinationRun({ sessionId: "s2", rootGoal: "g", coordinatorAgentId: "alix" });
    cli.hostKind = "cli";
    const daemon = createCoordinationRun({ sessionId: "s4", rootGoal: "g", coordinatorAgentId: "alix" });
    daemon.hostKind = "daemon";
    const done = createCoordinationRun({ sessionId: "s3", rootGoal: "g", coordinatorAgentId: "alix" });
    done.hostKind = "inspector";
    done.status = "completed";
    await store.save(inspector);
    await store.save(cli);
    await store.save(daemon);
    await store.save(done);

    const found = await findResumableRuns(store, ["inspector", "cli"]);
    assert.deepEqual(found.sort(), [inspector.id, cli.id].sort());
    // Empty list matches every host.
    assert.equal((await findResumableRuns(store, [])).length, 3);
  });
});

describe("cancelDeadOwnerRuns", () => {
  let cwd: string;
  let store: CoordinationStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coord-dead-owner-"));
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

  it("finalizes a cli run whose running worker owner is dead", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    run.hostKind = "cli";
    await store.save(run);
    const dead = addWorker(run.id, { executionOwnerId: `cli-${DEAD_PID}` });
    await store.addWorker(run.id, dead);

    const cancelled = await cancelDeadOwnerRuns(store, ["cli"]);
    assert.deepEqual(cancelled, [run.id]);
    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers[0].status, "cancelled");
    assert.match(loaded!.workers[0].error ?? "", /host cli-/);
    assert.ok(!["planning", "running"].includes(loaded!.status), "run must leave active statuses");
  });

  it("releases the dead host's leases and marks run + graph cancelled", async () => {
    const graph = {
      id: "graph_dead_owner_case",
      schemaVersion: "1.0",
      workflowId: "wf_dead_owner_case",
      rootGoal: "g",
      status: "running" as const,
      strategy: "sequential" as const,
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await persistGraph(graph as any, cwd);

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    run.hostKind = "cli";
    run.taskGraphId = graph.id;
    await store.save(run);
    const owned = join(cwd, ".tmp", "dead-owner.md");
    const dead = addWorker(run.id, {
      executionOwnerId: `cli-${DEAD_PID}`,
      ownershipClaims: [{ path: ".tmp/dead-owner.md", recursive: false, sourcePattern: ".tmp/dead-owner.md" }],
    });
    await store.addWorker(run.id, dead);

    const registry = new OwnershipRegistry(cwd);
    const acquired = await registry.acquire({
      agentId: "alix#1",
      scope: { kind: "path", root: owned, recursive: false },
      mode: "exclusive-write",
      taskId: dead.id,
      sessionId: "s1",
      ttlMs: 60_000,
      reason: "test lease",
    });
    assert.equal(acquired.acquired, true);
    const leaseId = acquired.record!.id;
    await store.patchWorker(run.id, dead.id, { leaseIds: [leaseId] });

    const cancelled = await cancelDeadOwnerRuns(store, ["cli"], registry);

    assert.deepEqual(cancelled, [run.id]);
    // Clearing leaseIds without releasing the record would leave an active
    // lease blocking every later run in this workspace until its TTL.
    assert.equal(registry.get(leaseId)?.status, "released");
    const loaded = await store.load(run.id);
    assert.equal(loaded!.status, "cancelled");
    assert.equal(loaded!.workers[0].leaseIds?.length, 0);
    const persistedGraph = JSON.parse(
      await readFile(join(cwd, ".alix", "graphs", `${graph.id}.json`), "utf-8"),
    );
    assert.equal(persistedGraph.status, "cancelled");
  });

  it("leaves a live-owner running run alone", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    run.hostKind = "cli";
    await store.save(run);
    await store.addWorker(run.id, addWorker(run.id, { executionOwnerId: `cli-${process.pid}` }));

    assert.deepEqual(await cancelDeadOwnerRuns(store, ["cli"]), []);
    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers[0].status, "running");
  });

  it("leaves a pending-only run alone (never executed)", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    run.hostKind = "cli";
    await store.save(run);
    await store.addWorker(run.id, addWorker(run.id, { status: "pending", executionOwnerId: undefined }));

    assert.deepEqual(await cancelDeadOwnerRuns(store, ["cli"]), []);
    assert.equal((await store.load(run.id))!.workers[0].status, "pending");
  });

  it("ignores runs of other host kinds", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    run.hostKind = "daemon";
    await store.save(run);
    await store.addWorker(run.id, addWorker(run.id, { executionOwnerId: `daemon-${DEAD_PID}` }));

    assert.deepEqual(await cancelDeadOwnerRuns(store, ["cli"]), []);
    assert.equal((await store.load(run.id))!.workers[0].status, "running");
  });

  it("never cancels when a running worker is locally active", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    run.hostKind = "cli";
    await store.save(run);
    const dead = addWorker(run.id, { executionOwnerId: `cli-${DEAD_PID}` });
    await store.addWorker(run.id, dead);

    assert.deepEqual(
      await cancelDeadOwnerRuns(store, ["cli"], new OwnershipRegistry(cwd), DEFAULT_ORPHAN_THRESHOLD_MS, {
        isLocallyActive: (id) => id === dead.id,
      }),
      [],
    );
    assert.equal((await store.load(run.id))!.workers[0].status, "running");
  });

  it("retains a failed release on the cancelled record for a later sweep", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    run.hostKind = "cli";
    await store.save(run);
    const dead = addWorker(run.id, { executionOwnerId: `cli-${DEAD_PID}`, leaseIds: ["lease-keep"] });
    await store.addWorker(run.id, dead);
    const failingRegistry = { release: async () => false } as unknown as OwnershipRegistry;

    assert.deepEqual(await cancelDeadOwnerRuns(store, ["cli"], failingRegistry), [run.id]);
    const loaded = await store.load(run.id);
    assert.deepEqual(loaded!.workers[0].leaseIds, ["lease-keep"]);
  });
});
