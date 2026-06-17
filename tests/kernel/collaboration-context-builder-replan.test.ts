/**
 * collaboration-context-builder-replan.test.ts — Tests for CollaborationContextBuilder.buildReplanContext().
 *
 * Covers:
 * - Returns completed workers from run with status
 * - Returns active conflicts
 * - Returns recent findings
 * - Handles empty run gracefully
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CollaborationStore } from "../../src/kernel/collaboration-store.js";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { CoordinationResultStore } from "../../src/kernel/coordination-result-store.js";
import { CollaborationContextBuilder } from "../../src/kernel/collaboration-context-builder.js";
import {
  createCoordinationRun, createWorkerAssignment,
} from "../../src/kernel/coordination-types.js";
import type { FindingConflict } from "../../src/kernel/collaboration-conflict-types.js";

const RUN_ID = "run_replan_1";

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
  async loadByRun(_runId: string): Promise<any> { return []; }
}

describe("CollaborationContextBuilder.buildReplanContext", () => {
  let cwd: string;
  let collabStore: CollaborationStore;
  let coordStore: CoordinationStore;
  let builder: CollaborationContextBuilder;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), "replan-ctx-"));
    // Create the coordination shared directory for CollaborationStore
    mkdirSync(join(cwd, ".alix", "coordination", "shared", RUN_ID), { recursive: true });
    // Create the coordination directory for CoordinationStore
    mkdirSync(join(cwd, ".alix", "coordination"), { recursive: true });
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
    coordStore = new CoordinationStore(cwd);
    builder = new CollaborationContextBuilder(
      new StubResultStore() as any,
      collabStore,
      coordStore,
    );
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  // ── Empty run ────────────────────────────────────────────────────────

  it("returns empty result when run does not exist", async () => {
    const result = await builder.buildReplanContext("run_does_not_exist");
    assert.deepEqual(result, { completedWorkers: [], activeConflicts: [], recentFindings: [] });
  });

  // ── Completed workers from run ──────────────────────────────────────

  it("returns completed workers from run with their status", async () => {
    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "test goal", coordinatorAgentId: "alix",
    });
    run.workers = [
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "a1", taskLabel: "worker A", goalPrompt: "g",
        status: "completed", attempt: 1,
      }),
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "a2", taskLabel: "worker B", goalPrompt: "g",
        status: "failed", attempt: 2,
      }),
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "a3", taskLabel: "worker C", goalPrompt: "g",
        status: "running", attempt: 1,
      }),
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "a4", taskLabel: "worker D", goalPrompt: "g",
        status: "pending", attempt: 1,
      }),
    ];
    // Assign the run ID to each worker
    for (const w of run.workers) {
      w.coordinationRunId = run.id;
    }
    await coordStore.save(run);

    const result = await builder.buildReplanContext(run.id);
    assert.equal(result.completedWorkers.length, 2);
    assert.ok(result.completedWorkers.some(w => w.workerId === run.workers[0].id && w.outcome === "completed" && w.attempt === 1));
    assert.ok(result.completedWorkers.some(w => w.workerId === run.workers[1].id && w.outcome === "failed" && w.attempt === 2));
    assert.equal(result.completedWorkers[0].taskLabel, "worker A");
    assert.equal(result.completedWorkers[1].taskLabel, "worker B");
  });

  it("returns empty worker list when no workers are completed or failed", async () => {
    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "test goal", coordinatorAgentId: "alix",
    });
    run.workers = [
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "a1", taskLabel: "running worker", goalPrompt: "g",
        status: "running", attempt: 1,
      }),
    ];
    for (const w of run.workers) {
      w.coordinationRunId = run.id;
    }
    await coordStore.save(run);

    const result = await builder.buildReplanContext(run.id);
    assert.equal(result.completedWorkers.length, 0);
  });

  // ── Active conflicts ────────────────────────────────────────────────

  it("returns active conflicts with detected and under_review statuses", async () => {
    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "test goal", coordinatorAgentId: "alix",
    });
    await coordStore.save(run);

    // Seed conflicts
    const detected = makeConflict("c_detected", ["f1", "f2"]);
    const underReview = makeConflict("c_under_review", ["f3", "f4"]);
    underReview.status = "under_review";
    const resolved = makeConflict("c_resolved", ["f5", "f6"]);
    resolved.status = "resolved";
    await collabStore.addConflict(detected);
    await collabStore.addConflict(underReview);
    await collabStore.addConflict(resolved);

    const result = await builder.buildReplanContext(run.id);
    assert.equal(result.activeConflicts.length, 2);
    const ids = result.activeConflicts.map(c => c.id);
    assert.ok(ids.includes("c_detected"));
    assert.ok(ids.includes("c_under_review"));
    assert.ok(!ids.includes("c_resolved"));
  });

  // ── Recent findings ─────────────────────────────────────────────────

  it("returns recent findings up to limit of 20", async () => {
    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "test goal", coordinatorAgentId: "alix",
    });
    await coordStore.save(run);

    // Publish 3 findings
    for (let i = 0; i < 3; i++) {
      await collabStore.publishFinding(
        { kind: "fact", title: `finding ${i}`, content: `content ${i}`, tags: [] },
        { runId: RUN_ID, workerId: `w${i}`, workerAttempt: 1 },
      );
    }

    const result = await builder.buildReplanContext(run.id);
    assert.equal(result.recentFindings.length, 3);
    assert.ok(result.recentFindings.every(f => f.title.startsWith("finding")));
  });

  it("limits findings to 20", async () => {
    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "test goal", coordinatorAgentId: "alix",
    });
    await coordStore.save(run);

    // Publish 25 findings (more than limit of 20)
    for (let i = 0; i < 25; i++) {
      await collabStore.publishFinding(
        { kind: "fact", title: `finding ${i}`, content: `content ${i}`, tags: [] },
        { runId: RUN_ID, workerId: `w${i}`, workerAttempt: 1 },
      );
    }

    const result = await builder.buildReplanContext(run.id);
    assert.ok(result.recentFindings.length <= 20);
  });

  // ── Combined ────────────────────────────────────────────────────────

  it("returns all three sections simultaneously for a populated run", async () => {
    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "test goal", coordinatorAgentId: "alix",
    });
    run.workers = [
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "a1", taskLabel: "worker done", goalPrompt: "g",
        status: "completed", attempt: 1,
      }),
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "a2", taskLabel: "worker failed", goalPrompt: "g",
        status: "failed", attempt: 1,
      }),
    ];
    for (const w of run.workers) {
      w.coordinationRunId = run.id;
    }
    await coordStore.save(run);

    // Seed conflicts
    const c = makeConflict("c1", ["f1", "f2"]);
    await collabStore.addConflict(c);

    // Publish a finding
    await collabStore.publishFinding(
      { kind: "fact", title: "my finding", content: "my content", tags: [] },
      { runId: RUN_ID, workerId: "w1", workerAttempt: 1 },
    );

    const result = await builder.buildReplanContext(run.id);
    assert.equal(result.completedWorkers.length, 2);
    assert.equal(result.activeConflicts.length, 1);
    assert.equal(result.activeConflicts[0].id, "c1");
    assert.equal(result.recentFindings.length, 1);
    assert.equal(result.recentFindings[0].title, "my finding");
  });

  it("returns empty activeConflicts when no conflicts exist", async () => {
    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "test goal", coordinatorAgentId: "alix",
    });
    await coordStore.save(run);

    const result = await builder.buildReplanContext(run.id);
    assert.deepEqual(result.activeConflicts, []);
  });

  it("returns empty recentFindings when no findings exist", async () => {
    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "test goal", coordinatorAgentId: "alix",
    });
    await coordStore.save(run);

    const result = await builder.buildReplanContext(run.id);
    assert.deepEqual(result.recentFindings, []);
  });
});
