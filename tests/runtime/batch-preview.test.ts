import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ReplayDiffSet } from "../../src/runtime/replay-diff-store.js";
import { buildBatchRollbackPreview, detectFileOverlaps } from "../../src/runtime/batch-preview.js";

describe("buildBatchRollbackPreview", () => {
  it("combines diff sets from multiple replayIds", async () => {
    const diffSets: Map<string, ReplayDiffSet> = new Map();
    diffSets.set("replay_a", {
      replayId: "replay_a",
      records: [
        { filePath: "src/a.ts", changeType: "modified", rollbackable: true, beforeSnapshotPath: "/tmp/before/a.ts", diffPreview: "", diffSize: 10, timestamp: "" },
      ],
      totalFilesChanged: 1, totalRollbackable: 1, storePath: "", createdAt: "",
    });
    diffSets.set("replay_b", {
      replayId: "replay_b",
      records: [
        { filePath: "src/b.ts", changeType: "created", rollbackable: false, diffPreview: "", diffSize: 5, timestamp: "" },
      ],
      totalFilesChanged: 1, totalRollbackable: 0, storePath: "", createdAt: "",
    });
    const preview = await buildBatchRollbackPreview(diffSets);
    assert.equal(preview.totalReplays, 2);
    assert.equal(preview.totalFiles, 2);
    assert.equal(preview.totalRestore, 1);
    assert.equal(preview.totalDelete, 1);
    assert.equal(preview.overlaps.length, 0);
  });

  it("detects overlapping file paths", async () => {
    const diffSets: Map<string, ReplayDiffSet> = new Map();
    diffSets.set("replay_a", {
      replayId: "replay_a",
      records: [
        { filePath: "src/shared.ts", changeType: "modified", rollbackable: true, beforeSnapshotPath: "/tmp/a/shared.ts", diffPreview: "", diffSize: 10, timestamp: "" },
      ],
      totalFilesChanged: 1, totalRollbackable: 1, storePath: "", createdAt: "",
    });
    diffSets.set("replay_b", {
      replayId: "replay_b",
      records: [
        { filePath: "src/shared.ts", changeType: "modified", rollbackable: true, beforeSnapshotPath: "/tmp/b/shared.ts", diffPreview: "", diffSize: 8, timestamp: "" },
      ],
      totalFilesChanged: 1, totalRollbackable: 1, storePath: "", createdAt: "",
    });
    const preview = await buildBatchRollbackPreview(diffSets);
    assert.equal(preview.overlaps.length, 1);
    assert.equal(preview.overlaps[0].filePath, "src/shared.ts");
    assert.deepEqual(preview.overlaps[0].replayIds.sort(), ["replay_a", "replay_b"]);
  });

  it("handles empty diff set map", async () => {
    const preview = await buildBatchRollbackPreview(new Map());
    assert.equal(preview.totalReplays, 0);
    assert.equal(preview.totalFiles, 0);
    assert.equal(preview.overlaps.length, 0);
  });
});

describe("detectFileOverlaps", () => {
  it("returns empty when no overlaps", () => {
    const result = detectFileOverlaps(new Map([
      ["replay_a", ["src/a.ts"]],
      ["replay_b", ["src/b.ts"]],
    ]));
    assert.equal(result.length, 0);
  });

  it("returns overlapping files with their replayIds", () => {
    const result = detectFileOverlaps(new Map([
      ["replay_a", ["src/a.ts", "src/shared.ts"]],
      ["replay_b", ["src/b.ts", "src/shared.ts"]],
      ["replay_c", ["src/shared.ts"]],
    ]));
    assert.equal(result.length, 1);
    assert.equal(result[0].filePath, "src/shared.ts");
    assert.deepEqual(result[0].replayIds.sort(), ["replay_a", "replay_b", "replay_c"].sort());
  });
});
