import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toTraceEvent, traceEventsFromLog, formatTraceEvent } from "../../src/runtime/trace-events.js";

describe("toTraceEvent", () => {
  it("converts policy.decision allow event", () => {
    const t = toTraceEvent({
      type: "policy.decision",
      timestamp: "2026-06-11T12:00:00Z",
      id: "pol_1",
      payload: { capability: "file.read", decision: "allow", reason: "Allowed by tool policy" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "policy");
    assert.equal(t!.status, "allowed");
    assert.equal(t!.capability, "file.read");
  });

  it("converts policy.decision deny event", () => {
    const t = toTraceEvent({
      type: "policy.decision",
      timestamp: "2026-06-11T12:00:01Z",
      id: "pol_2",
      payload: { capability: "shell.run", decision: "deny", reason: "Command is denied" },
    });
    assert.ok(t);
    assert.equal(t!.status, "denied");
  });

  it("converts approval.created event", () => {
    const t = toTraceEvent({
      type: "approval.created",
      timestamp: "2026-06-11T12:00:02Z",
      id: "app_1",
      payload: { approvalId: "approval_001", capability: "shell.run", reason: "Requires approval" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "approval");
    assert.equal(t!.status, "pending");
    assert.equal(t!.approvalId, "approval_001");
  });

  it("converts approval.resolved approved event", () => {
    const t = toTraceEvent({
      type: "approval.resolved",
      id: "app_2",
      payload: { approvalId: "approval_001", status: "approved", capability: "shell.run" },
    });
    assert.ok(t);
    assert.equal(t!.status, "success");
  });

  it("converts approval.resolved denied event", () => {
    const t = toTraceEvent({
      type: "approval.resolved",
      id: "app_3",
      payload: { approvalId: "approval_002", status: "denied", capability: "file.write" },
    });
    assert.ok(t);
    assert.equal(t!.status, "denied");
  });

  it("converts approval.resumed event", () => {
    const t = toTraceEvent({
      type: "approval.resumed",
      id: "app_4",
      payload: { approvalId: "approval_001", toolName: "shell.run", status: "resumed" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "approval");
    assert.equal(t!.status, "success");
    assert.equal(t!.toolName, "shell.run");
  });

  it("converts approval.resume.failed event", () => {
    const t = toTraceEvent({
      type: "approval.resume.failed",
      id: "app_5",
      payload: { approvalId: "approval_003", reason: "Args hash mismatch" },
    });
    assert.ok(t);
    assert.equal(t!.status, "failed");
    assert.equal(t!.detail, "Args hash mismatch");
  });

  it("converts continuation.created event", () => {
    const t = toTraceEvent({
      type: "continuation.created",
      id: "cont_1",
      payload: { approvalId: "approval_001", toolName: "shell.run" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "continuation");
    assert.equal(t!.status, "pending");
  });

  it("converts continuation.consumed event", () => {
    const t = toTraceEvent({
      type: "continuation.consumed",
      id: "cont_2",
      payload: { approvalId: "approval_001", continuationId: "cont_2" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "continuation");
    assert.equal(t!.status, "success");
    assert.equal(t!.continuationId, "cont_2");
  });

  it("converts tool.started event", () => {
    const t = toTraceEvent({
      type: "tool.started",
      id: "tool_1",
      payload: { toolCallId: "tc_001", toolName: "shell.run", argumentHash: "abc" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "tool");
    assert.equal(t!.status, "running");
    assert.equal(t!.toolName, "shell.run");
    assert.equal(t!.toolCallId, "tc_001");
  });

  it("converts tool.completed event", () => {
    const t = toTraceEvent({
      type: "tool.completed",
      id: "tool_2",
      payload: { toolCallId: "tc_001", toolName: "shell.run", status: "success" },
    });
    assert.ok(t);
    assert.equal(t!.status, "success");
  });

  it("converts tool.failed event", () => {
    const t = toTraceEvent({
      type: "tool.failed",
      id: "tool_3",
      payload: { toolCallId: "tc_002", toolName: "file.write", error: "Permission denied" },
    });
    assert.ok(t);
    assert.equal(t!.status, "failed");
    assert.equal(t!.detail, "Permission denied");
  });

  it("accepts RuntimeIndexEvent with action field", () => {
    const t = toTraceEvent({
      action: "tool.started",
      id: "ri_1",
      timestamp: "2026-06-11T12:00:00Z",
      source: "session",
      payload: { toolName: "ls", toolCallId: "tc1" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "tool");
    assert.equal(t!.status, "running");
  });

  it("returns null for unknown event type", () => {
    const t = toTraceEvent({ type: "unknown.type", id: "x", payload: {} });
    assert.equal(t, null);
  });
});

describe("traceEventsFromLog", () => {
  it("sorts events chronologically", () => {
    const events = [
      { type: "policy.decision", id: "e1", timestamp: "2026-06-11T12:00:03Z", payload: { capability: "c", decision: "allow" } },
      { type: "tool.started", id: "e2", timestamp: "2026-06-11T12:00:01Z", payload: { toolName: "ls", toolCallId: "tc1" } },
      { type: "tool.completed", id: "e3", timestamp: "2026-06-11T12:00:02Z", payload: { toolName: "ls", toolCallId: "tc1", status: "success" } },
    ];
    const traces = traceEventsFromLog(events);
    assert.equal(traces.length, 3);
    // Oldest first
    assert.equal(traces[0].id, "e2");
    assert.equal(traces[2].id, "e1");
  });

  it("filters out unknown types", () => {
    const events = [
      { type: "policy.decision", id: "e1", payload: { capability: "c", decision: "allow" } },
      { type: "some.random.type", id: "e2", payload: {} },
    ];
    const traces = traceEventsFromLog(events);
    assert.equal(traces.length, 1);
  });
});

describe("formatTraceEvent", () => {
  it("produces a string with icon and label", () => {
    const t = toTraceEvent({
      type: "tool.started",
      id: "t1",
      timestamp: "2026-06-11T12:00:00Z",
      payload: { toolName: "shell.run", toolCallId: "tc1" },
    });
    const line = formatTraceEvent(t!);
    assert.ok(line.includes("▶"));
    assert.ok(line.includes("tool"));
  });
});
