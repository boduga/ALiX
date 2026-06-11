import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderReplayResult } from "../../src/tui/trace-detail.js";
import type { ReplayResult } from "../../src/runtime/replay-executor.js";

function makeResult(overrides: Partial<ReplayResult> = {}): ReplayResult {
  return {
    mode: "dry-run",
    steps: [],
    startedAt: "2026-06-11T12:00:00Z",
    completedAt: "2026-06-11T12:00:01Z",
    totalDurationMs: 142,
    toolCallCount: 2,
    successCount: 2,
    blockedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    warnings: ["Preview only. No execution will occur."],
    ...overrides,
  };
}

describe("renderReplayResult", () => {
  it("renders mode and step counts", () => {
    const result = makeResult({
      mode: "dry-run",
      steps: [
        { index: 1, traceId: "e1", action: "would-check-policy", status: "completed" as const, toolName: "policy", durationMs: 5 },
        { index: 2, traceId: "e2", action: "would-run-tool", status: "completed" as const, toolName: "shell.run", output: "[DRY-RUN] Would run: ls", durationMs: 130 },
      ],
    });
    const lines = renderReplayResult(result);
    const joined = lines.join("\n");
    assert.ok(joined.includes("dry-run"));
    assert.ok(joined.includes("2 completed"));
    assert.ok(joined.includes("142ms"));
  });

  it("renders blocked steps with reason", () => {
    const result = makeResult({
      steps: [
        { index: 1, traceId: "e1", action: "would-run-tool", status: "blocked" as const, toolName: "web_search", blockReason: '"web_search" not available', durationMs: 0 },
      ],
      successCount: 0,
      blockedCount: 1,
    });
    const lines = renderReplayResult(result);
    const joined = lines.join("\n");
    assert.ok(joined.includes("✗"));
    assert.ok(joined.includes("web_search"));
  });

  it("renders warnings section", () => {
    const result = makeResult({ warnings: ["Network tools blocked in dry-run mode"] });
    const lines = renderReplayResult(result);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Warnings"));
    assert.ok(joined.includes("Network tools blocked"));
  });

  it("renders dry-run output marker", () => {
    const result = makeResult({
      steps: [
        { index: 1, traceId: "e1", action: "would-run-tool", status: "completed" as const, toolName: "file.create", output: "[DRY-RUN] Would create: test.txt\nhello", durationMs: 10 },
      ],
    });
    const lines = renderReplayResult(result);
    const joined = lines.join("\n");
    assert.ok(joined.includes("[DRY-RUN]"));
  });
});
