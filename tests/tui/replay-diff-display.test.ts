import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderReplayDiffSummary, renderRollbackPreview } from "../../src/tui/trace-detail.js";
import type { ReplayDiffSet, ReplayDiffRecord } from "../../src/runtime/replay-diff-store.js";

const mockRecords: ReplayDiffRecord[] = [
  {
    filePath: "src/index.ts",
    changeType: "modified",
    beforeSnapshotPath: "/tmp/.alix/replays/r1/snapshots/before/src/index.ts",
    afterSnapshotPath: "/tmp/.alix/replays/r1/snapshots/after/src/index.ts",
    diffPreview: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,3 +1,5 @@\n line one\n-line two\n+line two modified",
    diffSize: 120,
    rollbackable: true,
    timestamp: "2026-06-11T12:00:00Z",
  },
  {
    filePath: "src/new-file.ts",
    changeType: "created",
    beforeSnapshotPath: undefined,
    afterSnapshotPath: "/tmp/.alix/replays/r1/snapshots/after/src/new-file.ts",
    diffPreview: "--- /dev/null\n+++ src/new-file.ts\n@@ -0,0 +1 @@\n+new content",
    diffSize: 50,
    rollbackable: false,
    timestamp: "2026-06-11T12:00:01Z",
  },
];

const mockDiffSet: ReplayDiffSet = {
  replayId: "replay_test_001",
  records: mockRecords,
  totalFilesChanged: 2,
  totalRollbackable: 1,
  storePath: "/tmp/.alix/replays/r1",
  createdAt: "2026-06-11T12:00:00Z",
};

describe("renderReplayDiffSummary", () => {
  it("renders file change count", () => {
    const lines = renderReplayDiffSummary(mockDiffSet);
    const joined = lines.join("\n");
    assert.ok(joined.includes("2"));
    assert.ok(joined.includes("1 rollbackable"));
  });

  it("renders change entries with type markers", () => {
    const lines = renderReplayDiffSummary(mockDiffSet);
    const joined = lines.join("\n");
    assert.ok(joined.includes("M"));
    assert.ok(joined.includes("A"));
    assert.ok(joined.includes("src/index.ts"));
    assert.ok(joined.includes("src/new-file.ts"));
  });

  it("shows rollback status per file", () => {
    const lines = renderReplayDiffSummary(mockDiffSet);
    const joined = lines.join("\n");
    assert.ok(joined.includes("rollbackable"));
  });
});

describe("renderRollbackPreview", () => {
  it("shows would-restore for rollbackable files", () => {
    const lines = renderRollbackPreview(mockDiffSet);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Would restore"));
    assert.ok(joined.includes("src/index.ts"));
  });

  it("shows would-delete for non-rollbackable files", () => {
    const lines = renderRollbackPreview(mockDiffSet);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Would delete"));
    assert.ok(joined.includes("src/new-file.ts"));
  });

  it("includes safety warning", () => {
    const lines = renderRollbackPreview(mockDiffSet);
    const joined = lines.join("\n");
    assert.ok(joined.includes("No rollback") || joined.includes("Preview only"));
  });
});
