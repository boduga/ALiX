import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRollbackPlan } from "../../src/runtime/rollback-plan.js";
import type { ReplayDiffSet } from "../../src/runtime/replay-diff-store.js";

function makeDiffSet(overrides: Partial<ReplayDiffSet> = {}): ReplayDiffSet {
  return {
    replayId: "replay_test_001",
    records: [],
    totalFilesChanged: 0,
    totalRollbackable: 0,
    storePath: "/tmp/.alix/replays/replay_test_001",
    createdAt: "2026-06-11T12:00:00Z",
    ...overrides,
  };
}

describe("buildRollbackPlan", () => {
  it("maps modified file to restore step", () => {
    const diffSet = makeDiffSet({
      records: [{
        filePath: "src/index.ts",
        changeType: "modified",
        beforeSnapshotPath: "/tmp/.alix/replays/r1/snapshots/before/src/index.ts",
        afterSnapshotPath: "/tmp/.alix/replays/r1/snapshots/after/src/index.ts",
        diffPreview: "some diff",
        diffSize: 20,
        rollbackable: true,
        timestamp: "2026-06-11T12:00:00Z",
      }],
      totalFilesChanged: 1,
      totalRollbackable: 1,
    });
    const plan = buildRollbackPlan("replay_test_001", diffSet, "dry-run");
    assert.equal(plan.replayId, "replay_test_001");
    assert.equal(plan.mode, "dry-run");
    assert.ok(plan.rollbackId.startsWith("rollback_"));
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].path, "src/index.ts");
    assert.equal(plan.steps[0].action, "restore");
    assert.equal(plan.steps[0].rollbackable, true);
  });

  it("maps created file to delete-created step", () => {
    const diffSet = makeDiffSet({
      records: [{
        filePath: "src/new-file.ts",
        changeType: "created",
        beforeSnapshotPath: undefined,
        afterSnapshotPath: "/tmp/.alix/replays/r1/snapshots/after/src/new-file.ts",
        diffPreview: "new file",
        diffSize: 9,
        rollbackable: false,
        timestamp: "2026-06-11T12:00:01Z",
      }],
      totalFilesChanged: 1,
      totalRollbackable: 0,
    });
    const plan = buildRollbackPlan("replay_test_001", diffSet, "dry-run");
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].path, "src/new-file.ts");
    assert.equal(plan.steps[0].action, "delete-created");
  });

  it("maps non-rollbackable modified file to skip", () => {
    const diffSet = makeDiffSet({
      records: [{
        filePath: "src/missing-snapshot.ts",
        changeType: "modified",
        beforeSnapshotPath: undefined,
        afterSnapshotPath: "/tmp/.alix/replays/r1/snapshots/after/src/missing-snapshot.ts",
        diffPreview: "diff",
        diffSize: 10,
        rollbackable: false,
        timestamp: "2026-06-11T12:00:02Z",
      }],
      totalFilesChanged: 1,
      totalRollbackable: 0,
    });
    const plan = buildRollbackPlan("replay_test_001", diffSet, "dry-run");
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].action, "skip");
    assert.ok(plan.steps[0].reason);
  });

  it("handles empty diff set", () => {
    const diffSet = makeDiffSet();
    const plan = buildRollbackPlan("replay_test_001", diffSet, "dry-run");
    assert.equal(plan.steps.length, 0);
  });
});
