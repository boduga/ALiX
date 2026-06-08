import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toCanonicalEvent, CanonicalEventSink } from "../../src/kernel/event-envelope.js";
import type { AlixEvent } from "../../src/events/types.js";

describe("toCanonicalEvent", () => {

  const legacy: AlixEvent = {
    id: "evt_123",
    seq: 1,
    version: 1,
    sessionId: "session_abc",
    timestamp: "2026-06-07T00:00:00.000Z",
    type: "tool.requested",
    actor: "tool",
    payload: { toolCallId: "tc_1", toolName: "file.read" },
  };

  it("maps actor correctly", () => {
    const canonical = toCanonicalEvent(legacy);
    assert.equal(canonical.actorType, "tool");
    assert.equal(canonical.actorId, "tool");
  });

  it("preserves legacy payload under payload.legacy", () => {
    const canonical = toCanonicalEvent(legacy);
    assert.deepEqual(canonical.payload.legacy, legacy.payload);
  });

  it("adds schemaVersion and eventType", () => {
    const canonical = toCanonicalEvent(legacy);
    assert.equal(canonical.schemaVersion, "1.0");
    assert.equal(canonical.eventType, "tool.requested");
  });

  it("includes meta fields when provided", () => {
    const canonical = toCanonicalEvent(legacy, {
      workflowId: "wf_abc",
      graphId: "graph_xyz",
      nodeId: "node_42",
    });
    assert.equal(canonical.workflowId, "wf_abc");
    assert.equal(canonical.graphId, "graph_xyz");
    assert.equal(canonical.nodeId, "node_42");
  });

  it("includes traceId and spanId from meta", () => {
    const canonical = toCanonicalEvent(legacy, {
      traceId: "trace_1",
      spanId: "span_2",
    });
    assert.equal(canonical.causality?.traceId, "trace_1");
    assert.equal(canonical.causality?.spanId, "span_2");
  });

  it("maps system events to public visibility", () => {
    const evt: AlixEvent = { ...legacy, type: "session.started", actor: "system" };
    const canonical = toCanonicalEvent(evt);
    assert.equal(canonical.visibility, "public");
  });

  it("maps secret events to sensitive visibility", () => {
    const evt: AlixEvent = { ...legacy, type: "secret.scanned", actor: "policy" };
    const canonical = toCanonicalEvent(evt);
    assert.equal(canonical.visibility, "sensitive");
  });

  it("maps agent events to internal visibility", () => {
    const evt: AlixEvent = { ...legacy, type: "agent.message", actor: "agent" };
    const canonical = toCanonicalEvent(evt);
    assert.equal(canonical.visibility, "internal");
  });
});

describe("CanonicalEventSink", () => {

  it("buffers emitted events", async () => {
    const sink = new CanonicalEventSink();
    const legacy: AlixEvent = {
      id: "evt_1", seq: 1, version: 1,
      sessionId: "s", timestamp: "2026-01-01T00:00:00.000Z",
      type: "test.event", actor: "system", payload: {},
    };
    await sink.emit(toCanonicalEvent(legacy));
    assert.equal(sink.size, 1);
  });

  it("flush returns and clears buffer", async () => {
    const sink = new CanonicalEventSink();
    const legacy: AlixEvent = {
      id: "evt_2", seq: 1, version: 1,
      sessionId: "s", timestamp: "2026-01-01T00:00:00.000Z",
      type: "test.event", actor: "system", payload: {},
    };
    await sink.emit(toCanonicalEvent(legacy));
    const flushed = sink.flush();
    assert.equal(flushed.length, 1);
    assert.equal(sink.size, 0);
  });
});
