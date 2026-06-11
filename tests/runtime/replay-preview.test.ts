import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReplayPreview, classifyReplayStep } from "../../src/runtime/replay-preview.js";
import type { TraceEvent } from "../../src/runtime/trace-events.js";

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "e1", timestamp: "2026-06-11T12:00:00Z",
    sourceType: "tool", eventType: "tool.started",
    label: "shell.run started", status: "running",
    ...overrides,
  };
}

describe("classifyReplayStep", () => {
  it("policy allow → would-check-policy / safe", () => {
    const e = makeEvent({ eventType: "policy.decision", status: "allowed", sourceType: "policy" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-check-policy");
    assert.equal(r.status, "safe");
  });

  it("policy deny → would-check-policy / blocked", () => {
    const e = makeEvent({ eventType: "policy.decision", status: "denied", sourceType: "policy" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-check-policy");
    assert.equal(r.status, "blocked");
  });

  it("approval.created → would-require-approval", () => {
    const e = makeEvent({ eventType: "approval.created", sourceType: "approval" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-require-approval");
    assert.equal(r.status, "requires-approval");
  });

  it("approval.resolved approved → context-only / safe", () => {
    const e = makeEvent({ eventType: "approval.resolved", status: "success", sourceType: "approval" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "context-only");
    assert.equal(r.status, "safe");
  });

  it("approval.resolved denied → context-only / not-replayable", () => {
    const e = makeEvent({ eventType: "approval.resolved", status: "denied", sourceType: "approval" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "context-only");
    assert.equal(r.status, "not-replayable");
  });

  it("approval.reused → would-reuse-approval", () => {
    const e = makeEvent({ eventType: "approval.reused", sourceType: "approval" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-reuse-approval");
  });

  it("tool.started with rawEvent → would-run-tool / safe", () => {
    const e = makeEvent({ eventType: "tool.started", rawEvent: { payload: { toolCallId: "tc1" } } });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-run-tool");
    assert.equal(r.status, "safe");
  });

  it("tool.started without rawEvent → would-run-tool / not-replayable", () => {
    const e = makeEvent({ eventType: "tool.started", rawEvent: undefined });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-run-tool");
    assert.equal(r.status, "not-replayable");
  });

  it("continuation.consumed → would-run-tool / safe", () => {
    const e = makeEvent({ eventType: "continuation.consumed", sourceType: "continuation", rawEvent: { payload: { toolCallId: "tc1" } } });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-run-tool");
    assert.equal(r.status, "safe");
  });

  it("tool.completed → context-only", () => {
    const e = makeEvent({ eventType: "tool.completed", status: "success" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "context-only");
  });

  it("unknown event → context-only", () => {
    const e = makeEvent({ eventType: "session.started", sourceType: "session" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "context-only");
  });
});

describe("buildReplayPreview", () => {
  it("builds preview for tool chain", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "policy.decision", status: "allowed", sourceType: "policy", label: "policy: shell.run", toolCallId: "tc1" }),
      makeEvent({ id: "e2", eventType: "tool.started", status: "running", label: "shell.run started", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1", toolName: "shell.run" } } }),
      makeEvent({ id: "e3", eventType: "tool.completed", status: "success", label: "shell.run completed", toolCallId: "tc1", timestamp: "2026-06-11T12:00:01Z" }),
    ];
    const preview = buildReplayPreview(events[1], events);
    assert.equal(preview.replayable, true);
    assert.ok(preview.warnings.some(w => w.includes("Preview only")));
    assert.equal(preview.boundaries.toolCallIds.length, 1);
  });

  it("marks denied approval as not replayable", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "policy.decision", status: "pending", sourceType: "policy", label: "policy: shell.run", approvalId: "app_1" }),
      makeEvent({ id: "e2", eventType: "approval.created", sourceType: "approval", label: "approval created", approvalId: "app_1" }),
      makeEvent({ id: "e3", eventType: "approval.resolved", status: "denied", sourceType: "approval", label: "approval denied", approvalId: "app_1", timestamp: "2026-06-11T12:01:00Z" }),
    ];
    const preview = buildReplayPreview(events[1], events);
    assert.equal(preview.replayable, false);
  });

  it("returns not-replayable when no tool call in chain", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "session.started", sourceType: "session", label: "session started" }),
    ];
    const preview = buildReplayPreview(events[0], events);
    assert.equal(preview.replayable, false);
    assert.ok(preview.reason?.includes("No tool call"));
  });

  it("includes safety warning", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "tool.started", label: "shell.run", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1" } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    assert.ok(preview.warnings.some(w => w.includes("Preview only")));
  });
});
