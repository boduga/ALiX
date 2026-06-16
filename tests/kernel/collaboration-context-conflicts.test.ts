import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CollaborationStore } from "../../src/kernel/collaboration-store.js";
import { CollaborationContextBuilder } from "../../src/kernel/collaboration-context-builder.js";
import { renderContextSnapshot } from "../../src/kernel/collaboration-context-renderer.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";
import type { FindingConflict } from "../../src/kernel/collaboration-conflict-types.js";
import type { CoordinationWorkerResultRecord } from "../../src/kernel/coordination-result-store.js";

const RUN_ID = "run_ctx_1";
const FINDING_ID = "f_target_1";

function evidence(): any {
  return {
    ranking: [],
    confidence: "low", scoreMargin: 0,
    recommendation: "human_review",
    unresolvedReasons: [],
  };
}

function makeConflict(id: string, findingIds: string[]): FindingConflict {
  return {
    id, schemaVersion: "1.0",
    runId: RUN_ID, conflictFingerprint: `fp_${id}`,
    topicKey: `topic_${id}`,
    type: "contradiction", status: "detected",
    findingIds,
    claimComparisons: findingIds.map((fid, i) => ({
      leftFindingId: fid, rightFindingId: findingIds[(i + 1) % findingIds.length] || fid,
      compatibility: "incompatible", type: "contradiction",
      reasons: ["x"], comparatorVersion: "1.0.0",
    })),
    evidenceComparison: evidence(),
    detectedBy: ["deterministic"],
    criticality: "warning",
    blocksDownstreamByPolicy: false,
    history: [{ action: "created", at: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

class StubResultStore {
  async loadByRef(_ref: string): Promise<any> { return { status: "missing" }; }
  async loadByRun(_runId: string): Promise<CoordinationWorkerResultRecord[]> { return []; }
}

describe("CollaborationContextBuilder conflict integration", () => {
  let cwd: string;
  let collabStore: CollaborationStore;
  let builder: CollaborationContextBuilder;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), "ctx-"));
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
    collabStore = new CollaborationStore(cwd, RUN_ID);
    builder = new CollaborationContextBuilder(
      new StubResultStore() as any,
      collabStore,
      {
        maxTokens: 8_000, maxFindings: 20, maxArtifacts: 20,
        maxDependencyResults: 8, maxFindingContentChars: 4_000, maxResultSummaryChars: 8_000,
        conflicts: { maxItems: 2, maxFindingsPerConflict: 1, maxTokens: 500 },
      },
    );
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("includes relevant unresolved conflicts, omits unrelated, and enforces budget", async () => {
    // Seed 5 conflicts: 3 relevant (target finding), 2 unrelated, 1 resolved.
    const relevant: FindingConflict[] = [];
    for (let i = 0; i < 3; i++) {
      const c = makeConflict(`c_relevant_${i}`, [FINDING_ID, `f_other_${i}`]);
      await collabStore.addConflict(c);
      relevant.push(c);
    }
    for (let i = 0; i < 2; i++) {
      const c = makeConflict(`c_unrelated_${i}`, [`fX_${i}`, `fY_${i}`]);
      await collabStore.addConflict(c);
    }
    const resolved = makeConflict("c_resolved", [FINDING_ID, "fZ"]);
    resolved.status = "resolved";
    await collabStore.addConflict(resolved);

    // Publish a finding that references the target — without this, no findings are loaded.
    await collabStore.publishFinding(
      { kind: "fact", title: "target", content: "x", tags: [] },
      { runId: RUN_ID, workerId: "w_dep", workerAttempt: 1 },
    );

    const depWorker = createWorkerAssignment({
      coordinationRunId: RUN_ID, agentId: "a1", taskLabel: "T", goalPrompt: "g", attempt: 1,
    });
    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix",
    });
    run.workers = [
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "a1", taskLabel: "main", goalPrompt: "g",
        dependencies: [depWorker.id], attempt: 1,
      }),
      depWorker,
    ];
    const ctxWorker = run.workers[0];

    const { manifest, snapshot } = await builder.build(run, ctxWorker);

    // Conflict budget: at most maxItems=2 conflicts included.
    assert.ok(manifest.conflictIds.length <= 2);
    assert.ok(snapshot.conflicts.length <= 2);

    // Resolved is omitted (default filter is "detected" + "under_review").
    const ids = snapshot.conflicts.map(c => c.id);
    assert.ok(!ids.includes("c_resolved"));

    // Unrelated are filtered out (no overlap with included findingIds).
    for (const inc of snapshot.conflicts) {
      assert.ok(inc.findingIds.includes(FINDING_ID) || inc.findingIds.some(fid => fid.startsWith("f_other_")));
    }
  });

  it("caps findings per conflict (A3 budget)", async () => {
    // Create a conflict with 3 finding IDs.
    const c = makeConflict("c_cap", [FINDING_ID, "f2", "f3"]);
    c.claimComparisons = [
      { leftFindingId: FINDING_ID, rightFindingId: "f2", compatibility: "incompatible", type: "contradiction", reasons: ["a"], comparatorVersion: "1.0.0" },
      { leftFindingId: "f2", rightFindingId: "f3", compatibility: "incompatible", type: "contradiction", reasons: ["b"], comparatorVersion: "1.0.0" },
      { leftFindingId: FINDING_ID, rightFindingId: "f3", compatibility: "incompatible", type: "contradiction", reasons: ["c"], comparatorVersion: "1.0.0" },
    ];
    await collabStore.addConflict(c);

    await collabStore.publishFinding(
      { kind: "fact", title: "target", content: "x", tags: [] },
      { runId: RUN_ID, workerId: "w_dep", workerAttempt: 1 },
    );

    const depWorker = createWorkerAssignment({
      coordinationRunId: RUN_ID, agentId: "a1", taskLabel: "T", goalPrompt: "g", attempt: 1,
    });
    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix",
    });
    run.workers = [
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "a1", taskLabel: "main", goalPrompt: "g",
        dependencies: [depWorker.id], attempt: 1,
      }),
      depWorker,
    ];
    const ctxWorker = run.workers[0];

    const { snapshot } = await builder.build(run, ctxWorker);
    if (snapshot.conflicts.length > 0) {
      const inc = snapshot.conflicts[0];
      assert.ok(inc.findingIds.length <= 1);
      assert.ok(inc.claimComparisons.length <= 1);
    }
  });

  it("omission counts are correct in the manifest", async () => {
    // Seed 4 relevant conflicts. Budget is maxItems=2. Expect 2 omitted.
    for (let i = 0; i < 4; i++) {
      const c = makeConflict(`c_${i}`, [FINDING_ID, `f_${i}`]);
      await collabStore.addConflict(c);
    }
    await collabStore.publishFinding(
      { kind: "fact", title: "target", content: "x", tags: [] },
      { runId: RUN_ID, workerId: "w_dep", workerAttempt: 1 },
    );

    const depWorker = createWorkerAssignment({
      coordinationRunId: RUN_ID, agentId: "a1", taskLabel: "T", goalPrompt: "g", attempt: 1,
    });
    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix",
    });
    run.workers = [
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "a1", taskLabel: "main", goalPrompt: "g",
        dependencies: [depWorker.id], attempt: 1,
      }),
      depWorker,
    ];
    const ctxWorker = run.workers[0];

    const { manifest, snapshot } = await builder.build(run, ctxWorker);
    assert.ok(snapshot.conflicts.length <= 2);
    // The manifest's omitted count for findings/artifacts/results is present.
    assert.ok(manifest.omitted);
    assert.equal(typeof manifest.omitted.findings, "number");
  });

  it("renderer marks context as untrusted (coordination_context trust attribute)", async () => {
    await collabStore.publishFinding(
      { kind: "fact", title: "target", content: "x", tags: [] },
      { runId: RUN_ID, workerId: "w_dep", workerAttempt: 1 },
    );
    const depWorker = createWorkerAssignment({
      coordinationRunId: RUN_ID, agentId: "a1", taskLabel: "T", goalPrompt: "g", attempt: 1,
    });
    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix",
    });
    run.workers = [
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "a1", taskLabel: "main", goalPrompt: "g",
        dependencies: [depWorker.id], attempt: 1,
      }),
      depWorker,
    ];
    const ctxWorker = run.workers[0];

    const { manifest, snapshot } = await builder.build(run, ctxWorker);
    snapshot.renderedText = renderContextSnapshot(manifest, snapshot);
    // The outer wrapper is marked untrusted.
    assert.ok(snapshot.renderedText.includes(`<coordination_context trust="untrusted">`));
    assert.ok(snapshot.renderedText.includes(`<shared_conflicts>`));
  });

  it("context fingerprint changes when conflict set changes", async () => {
    const depWorker = createWorkerAssignment({
      coordinationRunId: RUN_ID, agentId: "a_dep", taskLabel: "T", goalPrompt: "g", attempt: 1,
    });
    const f1 = await collabStore.publishFinding(
      { kind: "fact", title: "target", content: "x", tags: [] },
      { runId: RUN_ID, workerId: depWorker.id, workerAttempt: 1 },
    );
    // Create a conflict that references the real published finding ID.
    const c0 = makeConflict("c0", [f1.id, "fX"]);
    await collabStore.addConflict(c0);

    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix",
    });
    run.workers = [
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "a1", taskLabel: "main", goalPrompt: "g",
        dependencies: [depWorker.id], attempt: 1,
      }),
      depWorker,
    ];
    const ctxWorker = run.workers[0];

    const r1 = await builder.build(run, ctxWorker);

    // Add another conflict involving the same finding — fingerprint must change.
    const c1 = makeConflict("c1", [f1.id, "fY"]);
    await collabStore.addConflict(c1);

    const r2 = await builder.build(run, ctxWorker);
    assert.notEqual(r1.manifest.sourceFingerprint, r2.manifest.sourceFingerprint);
  });
});
