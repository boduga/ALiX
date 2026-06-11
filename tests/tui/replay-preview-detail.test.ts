import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderTraceReplay } from "../../src/tui/trace-detail.js";
import { buildReplayPreview } from "../../src/runtime/replay-preview.js";
import type { TraceEvent } from "../../src/runtime/trace-events.js";

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "e1", timestamp: "2026-06-11T12:00:00Z",
    sourceType: "tool", eventType: "tool.started",
    label: "shell.run started", status: "running",
    ...overrides,
  };
}

describe("renderTraceReplay", () => {
  it("renders safety warning", () => {
    const events = [makeEvent({ id: "e1", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1" } } })];
    const preview = buildReplayPreview(events[0], events);
    const lines = renderTraceReplay(preview);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Preview only"), `Expected safety warning, got: ${joined}`);
  });

  it("renders replayable yes", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "tool.started", label: "shell.run", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1", toolName: "shell.run" } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const lines = renderTraceReplay(preview);
    const joined = lines.join("\n");
    assert.ok(joined.includes("yes"));
  });

  it("renders replayable no with reason", () => {
    const events = [makeEvent({ id: "e1", eventType: "session.started", sourceType: "session", label: "session" })];
    const preview = buildReplayPreview(events[0], events);
    const lines = renderTraceReplay(preview);
    const joined = lines.join("\n");
    assert.ok(joined.includes("no"));
    assert.ok(joined.includes("No tool call"));
  });

  it("renders chain steps with actions", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "policy.decision", status: "allowed", sourceType: "policy", label: "policy: run", toolCallId: "tc1" }),
      makeEvent({ id: "e2", eventType: "tool.started", label: "shell.run", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1" } }, timestamp: "2026-06-11T12:00:01Z" }),
    ];
    const preview = buildReplayPreview(events[1], events);
    const lines = renderTraceReplay(preview);
    const joined = lines.join("\n");
    assert.ok(joined.includes("would-check-policy") || joined.includes("would-run-tool"));
  });

  it("renders boundaries section", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "tool.started", label: "shell.run", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1" } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const lines = renderTraceReplay(preview);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Boundaries") || joined.includes("ToolCall"));
  });

  it("renders warnings section", () => {
    const events = [makeEvent({ id: "e1", eventType: "session.started", sourceType: "session" })];
    const preview = buildReplayPreview(events[0], events);
    const lines = renderTraceReplay(preview);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Warnings") || joined.includes("Preview"));
  });
});
