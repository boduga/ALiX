import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatIfamasPanel } from "../../src/tui/ifamas-panel.js";
import type { IfamasTracePanel } from "../../src/tui/ifamas-panel.js";

function makePanel(overrides: Partial<IfamasTracePanel> = {}): IfamasTracePanel {
  return {
    signalCode: "00100010",
    polarity: "ire",
    offeringAction: "proceed",
    routeTarget: "guild",
    gatewayValid: true,
    guildCandidateCount: 2,
    topGuildCandidate: "guild-agent-1",
    chronicleRefCount: 0,
    ...overrides,
  };
}

describe("formatIfamasPanel", () => {
  it("renders Signal code and polarity", () => {
    const panel = makePanel({ signalCode: "11111111", polarity: "ibi" });
    const lines = formatIfamasPanel(panel);
    const signalLine = lines.find(l => l.startsWith("Signal:"));
    assert.ok(signalLine);
    assert.ok(signalLine!.includes("11111111"));
    assert.ok(signalLine!.includes("IBI"));
  });

  it("renders Offering action", () => {
    const panel = makePanel({ offeringAction: "ask_approval" });
    const lines = formatIfamasPanel(panel);
    assert.ok(lines.some(l => l.includes("ask_approval")));
  });

  it("renders Nexus route recommendation", () => {
    const panel = makePanel({ routeTarget: "caller" });
    const lines = formatIfamasPanel(panel);
    assert.ok(lines.some(l => l.includes("caller")));
  });

  it("renders gateway validation result", () => {
    const validLines = formatIfamasPanel(makePanel({ gatewayValid: true }));
    assert.ok(validLines.some(l => l.includes("valid")));
    const invalidLines = formatIfamasPanel(makePanel({ gatewayValid: false }));
    assert.ok(invalidLines.some(l => l.includes("invalid")));
  });

  it("renders guild candidate count", () => {
    const lines = formatIfamasPanel(makePanel({ guildCandidateCount: 3 }));
    assert.ok(lines.some(l => l.includes("3")));
  });

  it("handles no candidates", () => {
    const panel = makePanel({ guildCandidateCount: 0, topGuildCandidate: undefined });
    const lines = formatIfamasPanel(panel);
    assert.ok(lines.some(l => l.includes("0")));
    assert.ok(!lines.some(l => l.startsWith("  Top:")));
  });

  it("handles invalid gateway result", () => {
    const panel = makePanel({ gatewayValid: false });
    const lines = formatIfamasPanel(panel);
    assert.ok(lines.some(l => l.includes("invalid")));
  });

  it("does NOT require ToolExecutor / PolicyGate imports", () => {
    const source = readFileSync("src/tui/ifamas-panel.ts", "utf-8");
    const importLines = source.split("\n").filter(l => l.startsWith("import "));
    assert.ok(importLines.every(l => !l.includes("ToolExecutor")), "ToolExecutor must not be imported");
    assert.ok(importLines.every(l => !l.includes("PolicyGate")), "PolicyGate must not be imported");
    assert.ok(importLines.every(l => !l.includes("ApprovalStore")), "ApprovalStore must not be imported");
  });
});
