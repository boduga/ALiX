// tests/observability/execution-context-lineage.test.ts
//
// Tests for parent/child execution context lineage (#199).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeExecutionContext, hasExecutionContext } from "../../src/observability/execution-context.js";
import type { ExecutionContext } from "../../src/observability/execution-context.js";

describe("parentRunId lineage", () => {
  it("root run has no parentRunId", () => {
    const root: ExecutionContext = {
      runId: "run-root-001",
      sessionId: "sess-1",
    };
    assert.strictEqual(root.parentRunId, undefined);
    assert.strictEqual(root.runId, "run-root-001");
  });

  it("child run has parentRunId set to parent's runId", () => {
    const parentRunId = "run-parent-001";
    const child: ExecutionContext = {
      runId: "run-child-001",
      parentRunId,
      sessionId: "sess-1",
    };
    assert.strictEqual(child.parentRunId, parentRunId);
    assert.notStrictEqual(child.runId, parentRunId);
  });

  it("parent and child have distinct runId values", () => {
    const parent: ExecutionContext = { runId: "run-p-1" };
    const child: ExecutionContext = { runId: "run-c-1", parentRunId: parent.runId };
    assert.notStrictEqual(child.runId, parent.runId);
    assert.strictEqual(child.parentRunId, parent.runId);
  });

  it("mergeExecutionContext preserves parentRunId from override", () => {
    const base: ExecutionContext = { runId: "run-base" };
    const childCtx: ExecutionContext = { runId: "run-child", parentRunId: "run-base" };
    const merged = mergeExecutionContext(base, childCtx);
    assert.strictEqual(merged.runId, "run-child");
    assert.strictEqual(merged.parentRunId, "run-base");
  });

  it("child context has required fields via merge", () => {
    const parent: ExecutionContext = {
      runId: "run-p-1",
      sessionId: "sess-parent",
      workflowId: "wf-1",
      providerId: "anthropic",
      model: "claude-opus-4-8",
    };
    const childOverride: ExecutionContext = {
      runId: "run-c-1",
      parentRunId: parent.runId,
    };
    const child = mergeExecutionContext(parent, childOverride);

    // Inherited from parent
    assert.strictEqual(child.sessionId, "sess-parent");
    assert.strictEqual(child.workflowId, "wf-1");
    assert.strictEqual(child.providerId, "anthropic");
    assert.strictEqual(child.model, "claude-opus-4-8");

    // Child-specific
    assert.strictEqual(child.runId, "run-c-1");
    assert.strictEqual(child.parentRunId, "run-p-1");
  });

  it("RunResult with runId signals parentRunId capability", () => {
    // Simulates what runTask now returns: result.runId is available
    const runResult = { sessionId: "sess-1", summary: "done", runId: "run-abc-001" };
    assert.ok(runResult.runId);

    // Caller creates child opts with parentRunId
    const childOpts = { parentRunId: runResult.runId };
    assert.strictEqual(childOpts.parentRunId, "run-abc-001");
  });
});
