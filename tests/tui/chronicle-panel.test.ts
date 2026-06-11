import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatChroniclePanel, chronicleEntryToPanelEntry } from "../../src/tui/chronicle-panel.js";
import type { ChroniclePanelData, ChroniclePanelEntry } from "../../src/tui/chronicle-panel.js";

describe("chronicle-panel", () => {
  it("formats empty Chronicle panel", () => {
    const data: ChroniclePanelData = { entries: [], totalEntries: 0, emptyReason: "No entries found." };
    const lines = formatChroniclePanel(data);
    assert.ok(lines.some(l => l.includes("No entries")));
  });

  it("formats one Chronicle entry", () => {
    const data: ChroniclePanelData = {
      entries: [{ chronicleId: "c1", signalCode: "00000000", offeringAction: "proceed", routeTarget: "guild", summary: "test diagnostic", createdAt: new Date().toISOString() }],
      totalEntries: 1,
    };
    const lines = formatChroniclePanel(data);
    assert.ok(lines.some(l => l.includes("1")));
    assert.ok(lines.some(l => l.includes("00000000")));
    assert.ok(lines.some(l => l.includes("proceed")));
  });

  it("formats multiple Chronicle entries", () => {
    const entries: ChroniclePanelEntry[] = [
      { chronicleId: "c1", signalCode: "00000000", offeringAction: "proceed", routeTarget: "guild", summary: "first", createdAt: new Date("2026-01-01").toISOString() },
      { chronicleId: "c2", signalCode: "11111111", offeringAction: "ask_approval", routeTarget: "caller", summary: "second", createdAt: new Date("2026-01-02").toISOString() },
    ];
    const data: ChroniclePanelData = { entries, totalEntries: 2 };
    const lines = formatChroniclePanel(data);
    assert.ok(lines.some(l => l.includes("2")));
    assert.ok(lines.some(l => l.includes("first")));
    assert.ok(lines.some(l => l.includes("second")));
  });

  it("handles no matches with filter", () => {
    const data: ChroniclePanelData = { query: "signal:abcdef", entries: [], totalEntries: 0 };
    const lines = formatChroniclePanel(data);
    assert.ok(lines.some(l => l.includes("filter")));
    assert.ok(lines.some(l => l.includes("No chronicle")));
  });

  it("chronicleEntryToPanelEntry converts ChronicleEntry", () => {
    const chronicleEntry = {
      entryId: "chronicle-001",
      signalCode: "10101010",
      domain: "task" as const,
      polarity: "ire" as const,
      problem: "Test diagnostic run",
      diagnosis: "Offering: proceed",
      actionTaken: "proceed",
      outcome: "success" as const,
      lesson: "Guild candidates: 0",
      offeringsUsed: ["proceed"],
      taboosObserved: [],
      traceRefs: [],
      replayRefs: [],
      rollbackRefs: [],
      createdAt: "2026-06-11T00:00:00.000Z",
    };
    const panelEntry = chronicleEntryToPanelEntry(chronicleEntry);
    assert.equal(panelEntry.chronicleId, "chronicle-001");
    assert.equal(panelEntry.signalCode, "10101010");
    assert.equal(panelEntry.offeringAction, "proceed");
    assert.equal(panelEntry.summary, "Test diagnostic run");
  });

  it("does NOT import ToolExecutor, PolicyGate, or ApprovalStore", () => {
    const source = readFileSync("src/tui/chronicle-panel.ts", "utf-8");
    assert.ok(!source.includes("ToolExecutor"));
    assert.ok(!source.includes("PolicyGate"));
    assert.ok(!source.includes("ApprovalStore"));
  });
});
