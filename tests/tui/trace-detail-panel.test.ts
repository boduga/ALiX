import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TuiStore } from "../../src/tui/store.js";
import { renderTraceSummary, renderTraceJson, renderTraceLinks, renderTraceChain } from "../../src/tui/trace-detail.js";
import { traceChainContext, type TraceEvent } from "../../src/runtime/trace-events.js";

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
  let store: TuiStore;

  beforeEach(() => {
    store = new TuiStore();
    store.appendTraceEvent(makeEvent({ id: "e1", toolCallId: "tc_001", toolName: "shell.run" }));
    store.appendTraceEvent(makeEvent({ id: "e2", toolCallId: "tc_001", eventType: "tool.completed", status: "success", label: "shell.run completed", timestamp: "2026-06-11T12:01:00Z" }));
  });

  describe("selection state", () => {
    it("starts with no selection", () => {
      const sel = store.getTraceSelection();
      assert.equal(sel.selectedIndex, -1);
      assert.equal(sel.detailOpen, false);
    });

    it("selects next event", () => {
      store.selectNextTraceEvent();
      assert.equal(store.getTraceSelection().selectedIndex, 0);
    });

    it("selects previous event", () => {
      store.selectNextTraceEvent();
      store.selectNextTraceEvent();
      store.selectPreviousTraceEvent();
      assert.equal(store.getTraceSelection().selectedIndex, 0);
    });

    it("toggles detail open/close", () => {
      store.toggleTraceDetail();
      assert.equal(store.getTraceSelection().detailOpen, true);
      store.toggleTraceDetail();
      assert.equal(store.getTraceSelection().detailOpen, false);
    });

    it("closes detail", () => {
      store.toggleTraceDetail();
      store.closeTraceDetail();
      assert.equal(store.getTraceSelection().detailOpen, false);
    });
  });

  describe("detail mode switching", () => {
    it("defaults to summary mode", () => {
      assert.equal(store.getTraceDetailMode(), "summary");
    });

    it("switches to json", () => {
      store.setTraceDetailMode("json");
      assert.equal(store.getTraceDetailMode(), "json");
    });

    it("switches to links", () => {
      store.setTraceDetailMode("links");
      assert.equal(store.getTraceDetailMode(), "links");
    });

    it("switches to chain", () => {
      store.setTraceDetailMode("chain");
      assert.equal(store.getTraceDetailMode(), "chain");
    });
  });

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
