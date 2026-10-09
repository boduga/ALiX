import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderTraceSummary, renderTraceJson, renderTraceLinks, renderTraceChain } from "../../src/tui/trace-detail.js";
import type { TraceEvent } from "../../src/runtime/trace-events.js";

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "e1", timestamp: "2026-06-11T12:00:00Z",
    sourceType: "tool", eventType: "tool.started",
    label: "shell.run started", status: "running",
    toolName: "shell.run", toolCallId: "tc_001",
    ...overrides,
  };
}

describe("traceDetailPanel", () => {
  describe("renderTraceSummary", () => {
    it("includes event type and status", () => {
      const lines = renderTraceSummary(makeEvent({}));
      const joined = lines.join("\n");
      assert.ok(joined.includes("tool.started"));
      assert.ok(joined.includes("running"));
    });

    it("includes tool and toolCallId when present", () => {
      const lines = renderTraceSummary(makeEvent({}));
      const joined = lines.join("\n");
      assert.ok(joined.includes("shell.run"));
      assert.ok(joined.includes("tc_001"));
    });

    it("includes approvalId when present", () => {
      const e = makeEvent({ sourceType: "approval", approvalId: "app_001" });
      const lines = renderTraceSummary(e);
      assert.ok(lines.join("\n").includes("app_001"));
    });
  });

  describe("renderTraceJson", () => {
    it("includes event fields in JSON output", () => {
      const e = makeEvent({ rawEvent: { type: "tool.started", toolName: "shell.run" } });
      const lines = renderTraceJson(e);
      const joined = lines.join("\n");
      assert.ok(joined.includes("tool.started"));
      assert.ok(joined.includes("shell.run"));
    });

    it("falls back to the event itself when rawEvent is absent", () => {
      const e = makeEvent({ rawEvent: undefined });
      const lines = renderTraceJson(e);
      assert.ok(lines.length > 0);
    });
  });

  describe("renderTraceLinks", () => {
    it("shows entity IDs", () => {
      const e = makeEvent({ sessionId: "sess_1", approvalId: "app_1" });
      const lines = renderTraceLinks(e);
      const joined = lines.join("\n");
      assert.ok(joined.includes("sess_1"));
      assert.ok(joined.includes("app_1"));
    });
  });

  describe("renderTraceChain", () => {
    it("shows related events with labels", () => {
      const chain = [
        makeEvent({ id: "e_related", label: "prior event", toolCallId: "tc_001" }),
      ];
      const lines = renderTraceChain(makeEvent({ id: "e_main", toolCallId: "tc_001" }), chain);
      const joined = lines.join("\n");
      assert.ok(joined.includes("prior event"));
      assert.ok(joined.includes("1 related"));
    });

    it("shows no-related message when empty", () => {
      const lines = renderTraceChain(makeEvent({ id: "e_main" }), []);
      assert.ok(lines.join("\n").includes("No related"));
    });
  });
});
