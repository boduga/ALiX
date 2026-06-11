import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TuiStore } from "../../src/tui/store.js";
import type { TraceEvent } from "../../src/runtime/trace-events.js";

function makeTraceEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "t1",
    timestamp: new Date().toISOString(),
    sourceType: "tool",
    eventType: "tool.started",
    label: "shell.run started",
    status: "running",
    ...overrides,
  };
}

describe("Trace panel state", () => {
  let store: TuiStore;

  beforeEach(() => {
    store = new TuiStore();
  });

  it("starts with empty trace events", () => {
    const state = store.getState();
    assert.deepEqual(state.traceEvents, []);
    assert.equal(state.traceFilter, "all");
  });

  it("appends trace events", () => {
    store.appendTraceEvent(makeTraceEvent({ id: "e1" }));
    assert.equal(store.getState().traceEvents.length, 1);
  });

  it("sets trace events in bulk", () => {
    const events = [makeTraceEvent({ id: "e1" }), makeTraceEvent({ id: "e2" })];
    store.setTraceEvents(events);
    assert.equal(store.getState().traceEvents.length, 2);
  });

  it("getFilteredTraceEvents returns all when filter is all", () => {
    store.appendTraceEvent(makeTraceEvent({ id: "e1", sourceType: "tool" }));
    store.appendTraceEvent(makeTraceEvent({ id: "e2", sourceType: "policy" }));
    assert.equal(store.getFilteredTraceEvents().length, 2);
  });

  it("getFilteredTraceEvents filters by sourceType", () => {
    store.setTraceFilter("tool");
    store.appendTraceEvent(makeTraceEvent({ id: "e1", sourceType: "tool" }));
    store.appendTraceEvent(makeTraceEvent({ id: "e2", sourceType: "policy" }));
    assert.equal(store.getFilteredTraceEvents().length, 1);
  });

  it("getLatestTraceEvents returns most recent N reversed", () => {
    store.setTraceEvents([
      makeTraceEvent({ id: "e1", timestamp: "2026-06-11T12:00:01Z" }),
      makeTraceEvent({ id: "e2", timestamp: "2026-06-11T12:00:02Z" }),
      makeTraceEvent({ id: "e3", timestamp: "2026-06-11T12:00:03Z" }),
    ]);
    const latest = store.getLatestTraceEvents(2);
    assert.equal(latest.length, 2);
    assert.equal(latest[0].id, "e3"); // most recent first
  });

  it("sets trace filter", () => {
    store.setTraceFilter("approval");
    assert.equal(store.getState().traceFilter, "approval");
  });
});
