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
    event(3, "tool.requested", { toolCallId: "shell-1", toolName: "shell.run", argsPreview: { command: "npm test" } }),
    event(4, "tool.completed", { toolCallId: "shell-1", toolName: "shell.run", status: "success", outputPreview: "ok" }),
    event(5, "patch.checkpoint_created", { toolCallId: "patch-1", checkpointFiles: ["src/app.ts"] }),
    event(6, "tool.completed", { toolCallId: "patch-1", toolName: "patch.apply", changedFiles: ["src/app.ts"], status: "success" }),
    event(7, "patch.rollback_completed", { toolCallId: "patch-1" }),
    event(8, "autonomy.scope_expansion", { toolCallId: "approval-1", toolName: "write", paths: ["src/app.ts"] }),
    event(9, "autonomy.scope_approved", { toolCallId: "approval-1", toolName: "write", paths: ["src/app.ts"] }),
    event(10, "verification.check_started", { command: "npm run build", reason: "compile" }),
    event(11, "verification.check_finished", { command: "npm run build", status: "passed", output: "clean" }),
    event(12, "model.usage", { provider: "openai", model: "gpt", inputTokens: 10, outputTokens: 5 }),
    event(13, "session.ended", { reason: "completed" })
  ]);

  assert.equal(snapshot.sessionId, "s1");
  assert.deepEqual(snapshot.summary, {
    eventCount: 13,
    status: "completed",
    reason: "completed",
    latestSeq: 13,
    startedAt: "2026-01-01T00:00:01Z",
    endedAt: "2026-01-01T00:00:13Z"
  });
  assert.equal(snapshot.timeline.length, 13);
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
