import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderRollbackResult } from "../../src/tui/trace-detail.js";
import type { RollbackResult, RollbackStepResult } from "../../src/runtime/rollback-executor.js";

function makeStep(overrides: Partial<RollbackStepResult> = {}): RollbackStepResult {
  return {
    index: 1,
    path: "src/test.txt",
    action: "restore",
    status: "completed",
    output: "File restored from snapshot",
    durationMs: 5,
    ...overrides,
  };
}

function makeResult(overrides: Partial<RollbackResult> = {}): RollbackResult {
  return {
    rollbackId: "rollback_1718000000_abc",
    replayId: "replay_1718000000_xyz",
    mode: "dry-run",
    steps: [],
    startedAt: "2026-06-11T12:00:00Z",
    completedAt: "2026-06-11T12:00:01Z",
    totalDurationMs: 142,
    totalSteps: 3,
    successCount: 2,
    blockedCount: 0,
    skippedCount: 1,
    warnings: [],
    ...overrides,
  };
}

describe("renderRollbackResult", () => {
  it("renders rollbackId, replayId, and mode", () => {
    const result = makeResult({
      mode: "approved-live",
      steps: [makeStep()],
    });
    const lines = renderRollbackResult(result);
    const joined = lines.join("\n");
    assert.ok(joined.includes("rollback_1718000000_abc"));
    assert.ok(joined.includes("replay_1718000000_xyz"));
    assert.ok(joined.includes("approved-live"));
  });

  it("renders step outcomes", () => {
    const result = makeResult({
      steps: [
        makeStep({ index: 1, path: "src/index.ts", action: "restore", status: "completed", output: "File restored" }),
        makeStep({ index: 2, path: "src/new.ts", action: "delete-created", status: "completed", output: "File deleted" }),
        makeStep({ index: 3, path: "src/skip.ts", action: "skip", status: "skipped" }),
      ],
      successCount: 2,
      skippedCount: 1,
    });
    const lines = renderRollbackResult(result);
    const joined = lines.join("\n");
    assert.ok(joined.includes("restore"));
    assert.ok(joined.includes("delete-created"));
    assert.ok(joined.includes("skip"));
    assert.ok(joined.includes("2 restored"));
    assert.ok(joined.includes("1 skipped"));
  });

  it("renders step counts", () => {
    const result = makeResult({ totalSteps: 3 });
    const lines = renderRollbackResult(result);
    const joined = lines.join("\n");
    assert.ok(joined.includes("3 total"));
  });
});
