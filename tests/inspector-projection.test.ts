import test from "node:test";
import assert from "node:assert/strict";
import type { AlixEvent } from "../src/events/types.js";
import { buildInspectorSnapshot, compareInspectorSnapshots } from "../src/inspector/projection.js";

function event(seq: number, type: string, payload: unknown, timestamp = `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`): AlixEvent {
  return {
    id: String(seq),
    seq,
    version: 1,
    sessionId: "s1",
    timestamp,
    type,
    actor: "system",
    payload
  };
}

test("buildInspectorSnapshot groups context, shell, diff, approval, verification, token, and ended-session data", () => {
  const snapshot = buildInspectorSnapshot("s1", [
    event(1, "session.started", {}),
    event(2, "context.bundle_compiled", {
      taskType: "feature",
      budget: { maxTokens: 1000, usedTokens: 250 },
      primaryFiles: [{ path: "src/app.ts", kind: "source", symbolName: "run" }],
      pinned: [{ path: "README.md", kind: "doc", reason: "user pinned" }]
    }),
    event(3, "session.started", {}),
    event(4, "tool.requested", { toolCallId: "shell-1", toolName: "shell.run", argsPreview: { command: "npm test" } }),
    event(5, "tool.completed", { toolCallId: "shell-1", toolName: "shell.run", status: "success", outputPreview: "ok" }),
    event(6, "patch.checkpoint_created", { toolCallId: "patch-1", files: ["src/app.ts"] }),
    event(7, "tool.completed", { toolCallId: "patch-1", toolName: "patch.apply", changedFiles: ["src/app.ts"], status: "success" }),
    event(8, "patch.rollback_completed", { toolCallId: "patch-1" }),
    event(9, "autonomy.scope_expansion", { toolCallId: "approval-1", toolName: "write", paths: ["src/app.ts"] }),
    event(10, "autonomy.scope_approved", { toolCallId: "approval-1", toolName: "write", paths: ["src/app.ts"] }),
    event(11, "verification.check_started", { command: "npm run build", reason: "compile" }),
    event(12, "verification.check_finished", { command: "npm run build", status: "passed", output: "clean" }),
    event(13, "model.usage", { provider: "openai", model: "gpt", inputTokens: 10, outputTokens: 5 }),
    event(14, "session.ended", { reason: "completed" })
  ]);

  assert.equal(snapshot.sessionId, "s1");
  assert.deepEqual(snapshot.summary, {
    eventCount: 14,
    status: "completed",
    reason: "completed",
    latestSeq: 14,
    startedAt: "2026-01-01T00:00:01Z",
    endedAt: "2026-01-01T00:00:14Z"
  });
  assert.equal(snapshot.timeline.length, 14);
  assert.deepEqual(snapshot.context, {
    taskType: "feature",
    budget: { maxTokens: 1000, usedTokens: 250 },
    primaryFiles: [{ path: "src/app.ts", kind: "source", symbolName: "run" }],
    tests: [],
    supportingFiles: [],
    pinned: [{ path: "README.md", kind: "doc", reason: "user pinned" }]
  });
  assert.deepEqual(snapshot.terminal, [{ toolCallId: "shell-1", command: "npm test", status: "success", outputPreview: "ok" }]);
  assert.deepEqual(snapshot.diffs, [
    {
      toolCallId: "patch-1",
      changedFiles: ["src/app.ts"],
      checkpointFiles: ["src/app.ts"],
      rolledBack: true,
      status: "rolled_back"
    }
  ]);
  assert.deepEqual(snapshot.approvals, [
    { toolCallId: "approval-1", toolName: "write", paths: ["src/app.ts"], status: "pending" },
    { toolCallId: "approval-1", toolName: "write", paths: ["src/app.ts"], status: "approved" }
  ]);
  assert.deepEqual(snapshot.verification, [{ command: "npm run build", reason: "compile", status: "passed", output: "clean" }]);
  assert.deepEqual(snapshot.tokens, {
    totalInputTokens: 10,
    totalOutputTokens: 5,
    entries: [{ provider: "openai", model: "gpt", inputTokens: 10, outputTokens: 5 }]
  });
});

test("compareInspectorSnapshots reports changed-file differences and verification status differences", () => {
  const left = buildInspectorSnapshot("left", [
    event(1, "tool.completed", { toolCallId: "left-patch", toolName: "patch.apply", changedFiles: ["left.ts", "both.ts"], status: "success" }),
    event(2, "verification.check_finished", { command: "npm test", status: "passed" }),
    event(3, "model.usage", { inputTokens: 100, outputTokens: 20 })
  ]);
  const right = buildInspectorSnapshot("right", [
    event(1, "tool.completed", { toolCallId: "right-patch", toolName: "patch.apply", changedFiles: ["right.ts", "both.ts"], status: "success" }),
    event(2, "verification.check_finished", { command: "npm test", status: "failed" }),
    event(3, "verification.check_finished", { command: "npm run build", status: "passed" }),
    event(4, "model.usage", { inputTokens: 130, outputTokens: 15 })
  ]);

  assert.deepEqual(compareInspectorSnapshots(left, right), {
    leftSessionId: "left",
    rightSessionId: "right",
    changedFilesOnlyLeft: ["left.ts"],
    changedFilesOnlyRight: ["right.ts"],
    changedFilesBoth: ["both.ts"],
    verificationStatus: { left: "passed", right: "mixed" },
    tokenDelta: { inputTokens: 30, outputTokens: -5 }
  });
});

test("buildInspectorSnapshot falls back to checkpoint files when patch apply omits changed files", () => {
  const snapshot = buildInspectorSnapshot("s1", [
    event(1, "patch.checkpoint_created", { toolCallId: "patch-1", files: ["src/app.ts", "tests/app.test.ts"] }),
    event(2, "tool.completed", { toolCallId: "patch-1", toolName: "patch.apply", status: "success" })
  ]);

  assert.deepEqual(snapshot.diffs[0], {
    toolCallId: "patch-1",
    changedFiles: ["src/app.ts", "tests/app.test.ts"],
    checkpointFiles: ["src/app.ts", "tests/app.test.ts"],
    rolledBack: false,
    status: "applied"
  });
});

test("buildInspectorSnapshot finishes the latest matching verification command", () => {
  const snapshot = buildInspectorSnapshot("s1", [
    event(1, "verification.check_started", { command: "npm test", reason: "first run" }),
    event(2, "verification.check_finished", { command: "npm test", status: "failed", output: "first failure" }),
    event(3, "verification.check_started", { command: "npm test", reason: "repair run" }),
    event(4, "verification.check_finished", { command: "npm test", status: "passed", output: "second pass" })
  ]);

  assert.deepEqual(snapshot.verification, [
    { command: "npm test", reason: "first run", status: "failed", output: "first failure" },
    { command: "npm test", reason: "repair run", status: "passed", output: "second pass" }
  ]);
});
