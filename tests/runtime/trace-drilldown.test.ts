import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { traceChainContext, type TraceEvent } from "../../src/runtime/trace-events.js";

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "e1", timestamp: "2026-06-11T12:00:00Z",
    sourceType: "tool", eventType: "tool.started",
    label: "test", status: "running",
    ...overrides,
  };
}

describe("traceChainContext", () => {
  it("returns empty array for event with no linked IDs", () => {
    const events = [makeEvent({ id: "e1" })];
    const result = traceChainContext(events, events[0]);
    assert.deepEqual(result, []);
  });

  it("finds related events by shared toolCallId", () => {
    const events = [
      makeEvent({ id: "e1", toolCallId: "tc_001", label: "started", status: "running" }),
      makeEvent({ id: "e2", toolCallId: "tc_001", label: "completed", status: "success", timestamp: "2026-06-11T12:00:01Z" }),
      makeEvent({ id: "e3", toolCallId: "tc_002", label: "other", status: "running" }),
    ];
    const result = traceChainContext(events, events[0]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "e2");
  });

  it("excludes self from results", () => {
    const events = [makeEvent({ id: "e1", toolCallId: "tc_001" })];
    const result = traceChainContext(events, events[0]);
    assert.equal(result.length, 0);
  });

  it("finds by shared approvalId", () => {
    const events = [
      makeEvent({ id: "e1", sourceType: "approval", eventType: "approval.created", label: "created", status: "pending", approvalId: "app_1" }),
      makeEvent({ id: "e2", sourceType: "approval", eventType: "approval.resolved", label: "resolved", status: "success", approvalId: "app_1", timestamp: "2026-06-11T12:01:00Z" }),
    ];
    const result = traceChainContext(events, events[0]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "e2");
  });

  it("finds by shared continuationId", () => {
    const events = [
      makeEvent({ id: "e1", sourceType: "continuation", eventType: "continuation.created", label: "created", continuationId: "cont_1" }),
      makeEvent({ id: "e2", sourceType: "continuation", eventType: "continuation.consumed", label: "consumed", continuationId: "cont_1", timestamp: "2026-06-11T12:01:00Z" }),
    ];
    const result = traceChainContext(events, events[0]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "e2");
  });

  it("respects maxResults limit", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      makeEvent({ id: `e${i}`, toolCallId: "tc_001", timestamp: `2026-06-11T12:00:${i.toString().padStart(2, "0")}Z` }),
    );
    const result = traceChainContext(events, events[0], 5);
    assert.equal(result.length, 5);
  });

  it("returns results sorted chronologically", () => {
    const events = [
      makeEvent({ id: "e3", toolCallId: "tc_001", timestamp: "2026-06-11T12:00:03Z", label: "third" }),
      makeEvent({ id: "e1", toolCallId: "tc_001", timestamp: "2026-06-11T12:00:01Z", label: "first" }),
      makeEvent({ id: "e2", toolCallId: "tc_001", timestamp: "2026-06-11T12:00:02Z", label: "second" }),
      makeEvent({ id: "e_self", toolCallId: "tc_001", timestamp: "2026-06-11T12:00:00Z", label: "self" }),
    ];
    const result = traceChainContext(events, events[3]); // select self
    assert.equal(result.length, 3);
    assert.equal(result[0].label, "first");
    assert.equal(result[1].label, "second");
    assert.equal(result[2].label, "third");
  });
});
