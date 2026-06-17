/**
 * replan-applier.test.ts — Unit tests for ReplanApplier.
 *
 * Covers:
 * - Empty draft applied successfully
 * - Cancel pending/ready/blocked workers
 * - Cancel running/completed/failed rejected
 * - Replace preserves superseded worker with lineage
 * - Multiple replaces
 * - Add new workers
 * - Modify workers
 * - Auto downstream dependency rewiring for replacements
 * - Explicit dependency rewiring overrides auto-rewiring
 * - CAS conflict returns applied: false without mutation
 * - Replacement worker gets fresh execution state (security reset)
 * - Revision history preserved with diff entries
 * - Worker not found aborts without partial commit
 * - Run not found returns error
 * - Dependency rewiring modifies deps correctly
 *
 * All imports use .js extensions (NodeNext).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";
import { ReplanApplier } from "../../src/kernel/replan-applier.js";
import type { PlanRevisionDraft, SimulatedGraph } from "../../src/kernel/replan-types.js";
import type { WorkerAssignment } from "../../src/kernel/coordination-types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

import type { ApplyInput } from "../../src/kernel/replan-applier.js";

function makeApplyInput(
  draft: PlanRevisionDraft,
  graph: SimulatedGraph,
  runId: string,
  agentAssignments?: Record<string, { agentId: string }>,
): ApplyInput {
  // Auto-populate agent assignments for any draftWorkerIds referenced in add/replace
  const assignments: Record<string, { agentId: string }> = { ...(agentAssignments ?? {}) };
  for (const w of draft.workersToAdd) {
    if (!assignments[w.draftWorkerId]) {
      assignments[w.draftWorkerId] = { agentId: "agent_test" };
    }
  }
  for (const rs of draft.workersToReplace) {
    if (!assignments[rs.replacement.draftWorkerId]) {
      assignments[rs.replacement.draftWorkerId] = { agentId: "agent_test" };
    }
  }
  return {
    draft,
    graph,
    agentAssignments: assignments,
    ownershipScopes: [],
    ownershipClaims: [],
    expectedPlanRevision: 0,
    runId,
  };
}

function makeWorker(id: string, deps: string[] = [], overrides: Partial<WorkerAssignment> = {}) {
  return createWorkerAssignment({
    id,
    coordinationRunId: "run_1",
    agentId: "agent_a",
    taskLabel: `Worker ${id}`,
    goalPrompt: `Do ${id}`,
    dependencies: deps,
    requiredCapabilities: [],
    ...overrides,
  });
}

function validDraft(overrides: Partial<PlanRevisionDraft> = {}): PlanRevisionDraft {
  return {
    triggerKind: "worker_completed",
    triggerEvidence: {
      workerId: "w1",
      findingIds: [],
      conflictIds: [],
      reason: "Trigger reason",
    },
    workersToAdd: [],
    workersToReplace: [],
    workersToCancel: [],
    workersToModify: [],
    dependencyRewiring: [],
    expectedBenefit: "Improved workflow",
    confidence: 0.85,
    unresolvedConcerns: [],
    ...overrides,
  };
}

function validGraph(overrides: Partial<SimulatedGraph> = {}): SimulatedGraph {
  return {
    workers: [],
    edges: [],
    idMap: {},
    valid: true,
    errors: [],
    warnings: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("ReplanApplier", () => {
  let cwd: string;
  let store: CoordinationStore;
  let applier: ReplanApplier;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "replan-applier-"));
    store = new CoordinationStore(cwd);
    applier = new ReplanApplier(store);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  // ── 1. Empty draft ────────────────────────────────────────────────────

  it("applies empty draft with no changes", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1")];
    await store.save(run);

    const result = await applier.apply(makeApplyInput(validDraft(), validGraph(), run.id));

    assert.equal(result.applied, true);
    assert(result.run !== null);
    assert.equal(result.run.planRevision, 1);
    assert.equal(result.run.status, "running");
    assert.equal(result.errors.length, 0);
  });

  // ── 2. Cancel pending worker ──────────────────────────────────────────

  it("cancels a pending worker", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1", [], { status: "pending" })];
    await store.save(run);

    const draft = validDraft({ workersToCancel: ["w1"] });
    const result = await applier.apply(makeApplyInput(draft, validGraph(), run.id));

    assert.equal(result.applied, true);
    assert.equal(result.run!.workers[0].status, "cancelled");
  });

  // ── 3. Cancel running worker rejected ─────────────────────────────────

  it("rejects cancel of running worker", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1", [], { status: "running" })];
    await store.save(run);

    const draft = validDraft({ workersToCancel: ["w1"] });
    const result = await applier.apply(makeApplyInput(draft, validGraph(), run.id));

    assert.equal(result.applied, false);
    assert.ok(result.errors[0].includes("running"));
  });

  // ── 4. Cancel completed worker rejected ───────────────────────────────

  it("rejects cancel of completed worker", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1", [], { status: "completed" })];
    await store.save(run);

    const draft = validDraft({ workersToCancel: ["w1"] });
    const result = await applier.apply(makeApplyInput(draft, validGraph(), run.id));

    assert.equal(result.applied, false);
    assert.ok(result.errors[0].includes("completed"));
  });

  // ── 5. Replace preserves superseded worker with lineage ───────────────

  it("replaces worker preserving the original with supersededBy lineage", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1", [], { status: "running" })];
    await store.save(run);

    const graph = validGraph({ idMap: { d1: "worker_replacement_1" } });
    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "Replacement worker",
            goalPrompt: "Do replacement",
            requiredCapabilities: ["code.analyze"],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Better approach",
        },
      ],
    });

    const result = await applier.apply(makeApplyInput(draft, graph, run.id));

    assert.equal(result.applied, true);
    assert.equal(result.run!.workers.length, 2);

    // Original worker still in array, marked superseded
    const original = result.run!.workers.find((w) => w.id === "w1");
    assert.ok(original);
    assert.equal(original.supersededByWorkerId, "worker_replacement_1");

    // Replacement created with lineage back to original
    const replacement = result.run!.workers.find(
      (w) => w.id === "worker_replacement_1",
    );
    assert.ok(replacement);
    assert.equal(replacement.replacementForWorkerId, "w1");
  });

  // ── 6. Multiple replaces ──────────────────────────────────────────────

  it("handles multiple replacement specs", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1"), makeWorker("w2")];
    await store.save(run);

    const graph = validGraph({ idMap: { d1: "worker_r1", d2: "worker_r2" } });
    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "R1",
            goalPrompt: "Do r1",
            requiredCapabilities: [],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Upgrade w1",
        },
        {
          targetWorkerId: "w2",
          replacement: {
            draftWorkerId: "d2",
            taskLabel: "R2",
            goalPrompt: "Do r2",
            requiredCapabilities: [],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Upgrade w2",
        },
      ],
    });

    const result = await applier.apply(makeApplyInput(draft, graph, run.id));

    assert.equal(result.applied, true);
    assert.equal(result.run!.workers.length, 4);
    assert.ok(result.run!.workers.find((w) => w.id === "worker_r1"));
    assert.ok(result.run!.workers.find((w) => w.id === "worker_r2"));
    assert.ok(result.run!.workers.find((w) => w.id === "w1")!.supersededByWorkerId === "worker_r1");
    assert.ok(result.run!.workers.find((w) => w.id === "w2")!.supersededByWorkerId === "worker_r2");
  });

  // ── 7. Add new workers ────────────────────────────────────────────────

  it("adds new workers from draft", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1")];
    await store.save(run);

    const graph = validGraph({ idMap: { d1: "worker_new_1" } });
    const draft = validDraft({
      workersToAdd: [
        {
          draftWorkerId: "d1",
          taskLabel: "New worker",
          goalPrompt: "Do new stuff",
          requiredCapabilities: ["filesystem.read"],
          dependencies: ["w1"],
          verificationRequirements: [],
        },
      ],
    });

    const result = await applier.apply(makeApplyInput(draft, graph, run.id));

    assert.equal(result.applied, true);
    assert.equal(result.run!.workers.length, 2);
    const added = result.run!.workers.find((w) => w.id === "worker_new_1");
    assert.ok(added);
    assert.equal(added.status, "pending");
    assert.deepEqual(added.dependencies, ["w1"]);
  });

  // ── 8. Modify worker ──────────────────────────────────────────────────

  it("modifies a worker's goal prompt and dependencies", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1")];
    await store.save(run);

    const draft = validDraft({
      workersToModify: [
        { workerId: "w1", goalPrompt: "Updated goal", dependencies: ["w2"] },
      ],
    });

    const result = await applier.apply(makeApplyInput(draft, validGraph(), run.id));

    assert.equal(result.applied, true);
    assert.equal(result.run!.workers[0].goalPrompt, "Updated goal");
    assert.deepEqual(result.run!.workers[0].dependencies, ["w2"]);
  });

  // ── 9. Auto downstream dependency rewiring ────────────────────────────

  it("auto-rewires downstream dependencies when replacing a worker", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1"), makeWorker("w2", ["w1"])];
    await store.save(run);

    const graph = validGraph({ idMap: { d1: "worker_r1" } });
    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "R1",
            goalPrompt: "Do r1",
            requiredCapabilities: [],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Upgrade",
        },
      ],
    });

    const result = await applier.apply(makeApplyInput(draft, graph, run.id));

    assert.equal(result.applied, true);
    const w2 = result.run!.workers.find((w) => w.id === "w2");
    assert.ok(w2);
    assert.ok(!w2.dependencies.includes("w1"), "w2 should not depend on replaced w1");
    assert.ok(w2.dependencies.includes("worker_r1"), "w2 should depend on replacement r1");
  });

  // ── 10. Explicit rewire overrides auto-rewiring ───────────────────────

  it("respects explicit dependency rewiring over auto-rewire", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [
      makeWorker("w1"),
      makeWorker("w2", ["w1"]),
      makeWorker("w3", ["w1"]),
    ];
    await store.save(run);

    const graph = validGraph({ idMap: { d1: "worker_r1" } });
    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "R1",
            goalPrompt: "Do r1",
            requiredCapabilities: [],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Upgrade",
        },
      ],
      // w2 gets an explicit rewire: remove dep on w1, add nothing
      // auto-rewire should NOT add "worker_r1" to w2
      dependencyRewiring: [
        {
          dependentWorkerRef: "w2",
          removeDependencyRef: "w1",
          addDependencyRef: "",
          reason: "w2 should be standalone",
        },
      ],
    });

    const result = await applier.apply(makeApplyInput(draft, graph, run.id));

    assert.equal(result.applied, true);

    // w2 had explicit override — dep on w1 removed, but NOT replaced with worker_r1
    const w2 = result.run!.workers.find((w) => w.id === "w2");
    assert.ok(w2);
    assert.ok(!w2.dependencies.includes("w1"));
    assert.ok(
      !w2.dependencies.includes("worker_r1"),
      "w2 should not be auto-rewired to r1 due to explicit override",
    );

    // w3 had no override — auto-rewired to replacement
    const w3 = result.run!.workers.find((w) => w.id === "w3");
    assert.ok(w3);
    assert.ok(
      w3.dependencies.includes("worker_r1"),
      "w3 should be auto-rewired to r1",
    );
  });

  // ── 11. CAS conflict ──────────────────────────────────────────────────

  it("CAS conflict prevents concurrent replan application", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    await store.save(run);

    const draft = validDraft({
      workersToAdd: [
        {
          draftWorkerId: "d1",
          taskLabel: "New worker",
          goalPrompt: "Do new",
          requiredCapabilities: [],
          dependencies: [],
          verificationRequirements: [],
        },
      ],
    });
    const graph = validGraph({ idMap: { d1: "worker_new_1" } });

    // Two concurrent apply calls — the lock serializes them, and the second
    // should see a planRevision mismatch (first call bumps from 0 to 1).
    const [result1, result2] = await Promise.all([
      applier.apply(makeApplyInput(draft, graph, run.id)),
      applier.apply(makeApplyInput(draft, graph, run.id)),
    ]);

    const successCount = [result1, result2].filter((r) => r.applied).length;
    const failCount = [result1, result2].filter((r) => !r.applied).length;
    assert.equal(successCount, 1);
    assert.equal(failCount, 1);

    // The successful one bumped planRevision
    const winner = result1.applied ? result1 : result2;
    assert.equal(winner.run!.planRevision, 1);

    // The loser should report CAS conflict
    const loser = result1.applied ? result2 : result1;
    assert.ok(loser.errors[0].includes("CAS conflict"));

    // Exactly one new worker was added
    const loaded = await store.load(run.id);
    const newWorkers = loaded!.workers.filter((w: WorkerAssignment) => w.id === "worker_new_1");
    assert.equal(newWorkers.length, 1);
  });

  // ── 12. Security reset (fresh execution state) ────────────────────────

  it("replacement worker gets fresh execution state (security reset)", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    // A worker in full flight with stale auth and execution data
    run.workers = [
      makeWorker("w1", [], {
        status: "running",
        attempt: 3,
        approvalId: "apr_123",
        authorizationEvidence: {
          evaluatedAt: "2026-01-01T00:00:00.000Z",
          decisions: [],
        },
        leaseIds: ["lease_1"],
        executionOwnerId: "agent-old",
        resultRef: "ref://old/result",
        error: "old transient error",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: undefined,
        lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    await store.save(run);

    const graph = validGraph({ idMap: { d1: "worker_r1" } });
    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "R1",
            goalPrompt: "Do r1",
            requiredCapabilities: [],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Security reset",
        },
      ],
    });

    const result = await applier.apply(makeApplyInput(draft, graph, run.id));

    assert.equal(result.applied, true);
    const replacement = result.run!.workers.find((w) => w.id === "worker_r1");
    assert.ok(replacement);
    assert.equal(replacement.status, "pending");
    assert.equal(replacement.attempt, 0);
    assert.equal(replacement.approvalId, undefined);
    assert.equal(replacement.authorizationEvidence, undefined);
    assert.deepEqual(replacement.leaseIds, []);
    assert.equal(replacement.executionOwnerId, undefined);
    assert.equal(replacement.resultRef, undefined);
    assert.equal(replacement.error, undefined);
    assert.equal(replacement.startedAt, undefined);
    assert.equal(replacement.completedAt, undefined);
    assert.equal(replacement.lastHeartbeatAt, undefined);
  });

  // ── 13. Revision history ──────────────────────────────────────────────

  it("preserves revision history with correct diff entries", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1")];
    await store.save(run);

    const graph = validGraph({ idMap: { d1: "worker_new_1" } });
    const draft = validDraft({
      workersToAdd: [
        {
          draftWorkerId: "d1",
          taskLabel: "Historian",
          goalPrompt: "Do history",
          requiredCapabilities: [],
          dependencies: [],
          verificationRequirements: [],
        },
      ],
    });

    const result = await applier.apply(makeApplyInput(draft, graph, run.id));

    assert.equal(result.applied, true);
    assert.ok(result.revision);
    assert.equal(result.revision.revisionNumber, 1);
    assert.equal(result.revision.triggerKind, "worker_completed");
    assert.equal(result.revision.diff.length, 1);
    assert.equal(result.revision.diff[0].change, "added");
    assert.equal(result.revision.diff[0].workerId, "worker_new_1");

    // Run object also carries revisionHistory
    assert.equal(result.run!.revisionHistory?.length, 1);
  });

  // ── 14. Run not found ─────────────────────────────────────────────────

  it("returns error when run is not found", async () => {
    const result = await applier.apply(
      makeApplyInput(validDraft(), validGraph(), "nonexistent_run_id"),
    );

    assert.equal(result.applied, false);
    assert.equal(result.run, null);
    assert.ok(result.errors[0].includes("not found"));
  });

  // ── 15. Dependency rewiring modifies deps ─────────────────────────────

  it("applies explicit dependency rewiring to existing workers", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1"), makeWorker("w2", ["w1"]), makeWorker("w3", ["w2"])];
    await store.save(run);

    const draft = validDraft({
      dependencyRewiring: [
        {
          dependentWorkerRef: "w3",
          removeDependencyRef: "w2",
          addDependencyRef: "w1",
          reason: "w3 should depend on w1 directly",
        },
      ],
    });

    const result = await applier.apply(makeApplyInput(draft, validGraph(), run.id));

    assert.equal(result.applied, true);
    const w3 = result.run!.workers.find((w) => w.id === "w3");
    assert.ok(w3);
    assert.ok(!w3.dependencies.includes("w2"), "w3 should no longer depend on w2");
    assert.ok(w3.dependencies.includes("w1"), "w3 should now depend on w1");
  });

  // ── 16. Cancel failed worker rejected ─────────────────────────────────

  it("rejects cancel of failed worker", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1", [], { status: "failed" })];
    await store.save(run);

    const draft = validDraft({ workersToCancel: ["w1"] });
    const result = await applier.apply(makeApplyInput(draft, validGraph(), run.id));

    assert.equal(result.applied, false);
    assert.ok(result.errors[0].includes("failed"));
  });

  // ── 17. Missing worker in cancel aborts no partial commit ─────────────

  it("aborts when cancel target does not exist (no partial commit)", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1")];
    await store.save(run);

    const draft = validDraft({
      workersToAdd: [
        {
          draftWorkerId: "d1",
          taskLabel: "New worker",
          goalPrompt: "Do new",
          requiredCapabilities: [],
          dependencies: [],
          verificationRequirements: [],
        },
      ],
      workersToCancel: ["nonexistent_worker"],
    });

    const graph = validGraph({ idMap: { d1: "worker_new_1" } });
    const result = await applier.apply(makeApplyInput(draft, graph, run.id));

    // Must fail — should never partially apply
    assert.equal(result.applied, false);
    assert.ok(result.errors[0].includes("nonexistent_worker"));

    // Verify no mutation: run should be unchanged
    const loaded = await store.load(run.id);
    assert.equal(loaded!.planRevision, 0);
    assert.equal(loaded!.workers.length, 1);
    assert.equal(loaded!.workers[0].id, "w1");
    assert.ok(
      !loaded!.workers.find((w: WorkerAssignment) => w.id === "worker_new_1"),
    );
  });

  // ── 18. Cancel blocked worker succeeds ────────────────────────────────

  it("cancels a blocked worker", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    run.workers = [makeWorker("w1", [], { status: "blocked" })];
    await store.save(run);

    const draft = validDraft({ workersToCancel: ["w1"] });
    const result = await applier.apply(makeApplyInput(draft, validGraph(), run.id));

    assert.equal(result.applied, true);
    assert.equal(result.run!.workers[0].status, "cancelled");
  });
});
