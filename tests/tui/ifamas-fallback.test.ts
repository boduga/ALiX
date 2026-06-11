import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatIfamasPanel } from "../../src/tui/ifamas-panel.js";
import type { IfamasTracePanel } from "../../src/tui/ifamas-panel.js";

describe("/ifamas fallback", () => {
  function makePanelData(overrides: Partial<IfamasTracePanel> = {}): IfamasTracePanel {
    return {
      signalCode: "00000000", polarity: "neutral", offeringAction: "proceed",
      routeTarget: "guild", gatewayValid: true, guildCandidateCount: 0,
      chronicleRefCount: 0, ...overrides,
    };
  }

  it("shows latest diagnostic when panel data exists", () => {
    const data = makePanelData({ signalCode: "10101010", polarity: "ire", offeringAction: "proceed" });
    const lines = formatIfamasPanel(data);
    assert.ok(lines.some(l => l.includes("IRE")));
    assert.ok(lines.some(l => l.includes("10101010")));
    assert.ok(lines.some(l => l.includes("proceed")));
  });

  it("handles missing routeTarget gracefully", () => {
    const lines = formatIfamasPanel(makePanelData({ routeTarget: undefined }));
    assert.ok(lines.some(l => l.includes("—")));
  });

  it("handles no top guild candidate gracefully", () => {
    const lines = formatIfamasPanel(makePanelData({ guildCandidateCount: 0, topGuildCandidate: undefined }));
    assert.ok(lines.some(l => l.includes("0")));
    assert.ok(!lines.some(l => l.startsWith("  Top:")));
  });

  it("renders empty state without crashing", () => {
    const lines = formatIfamasPanel(makePanelData({
      signalCode: "", polarity: "", offeringAction: "",
      routeTarget: undefined, gatewayValid: false,
      guildCandidateCount: 0, topGuildCandidate: undefined, chronicleRefCount: 0,
    }));
    assert.ok(lines.length > 0);
    assert.ok(lines.some(l => l.includes("IFÁ-MAS")));
  });
});
