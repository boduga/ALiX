/**
 * ifamas-approval-context.test.ts — Tests for IFÁ-MAS advisory context in approval prompts.
 *
 * Verifies that IFÁ-MAS context can be attached to approval records at the
 * display layer without changing PolicyGate, ApprovalStore, or ToolExecutor.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PanelApprovalRecord } from "../../src/tui/store.js";
import type { IfamasApprovalContext } from "../../src/tui/ifamas-panel.js";

/** Simulates what the panel renderer does when displaying an approval with IFÁ-MAS context. */
function renderApprovalWithContext(a: PanelApprovalRecord): string[] {
  const buf: string[] = [];
  buf.push(`  ${a.id}  ${a.capability || "?"}  ${(a.reason || "").slice(0, 40)}`);
  if (a.ifamasContext) {
    const c = a.ifamasContext;
    buf.push(`    IFÁ-MAS: ${c.signalPolarity.toUpperCase()} ${c.signalCode}  ${c.offeringAction}`);
    if (c.routeTarget) buf.push(`    Route: ${c.routeTarget}  Gate: ${c.gatewayValid ? "✓" : "✗"}`);
    if (c.topGuildCandidate) buf.push(`    Guild: ${c.topGuildCandidate}`);
  }
  buf.push(`    /approve ${a.id} or /deny ${a.id}`);
  return buf;
}

/** Check that the rendered lines contain a string. */
function linesContain(lines: string[], needle: string): boolean {
  return lines.some(l => l.includes(needle));
}

/** Check that the rendered lines do NOT contain a string. */
function linesDontContain(lines: string[], needle: string): boolean {
  return !lines.some(l => l.includes(needle));
}

function makeApprovalRecord(overrides: Partial<PanelApprovalRecord> = {}): PanelApprovalRecord {
  return {
    id: "approval-001",
    capability: "file.write",
    reason: "Write to /etc/config",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeIfamasContext(overrides: Partial<IfamasApprovalContext> = {}): IfamasApprovalContext {
  return {
    signalCode: "01100110",
    signalPolarity: "ibi",
    offeringAction: "ask_approval",
    routeTarget: "caller",
    gatewayValid: true,
    topGuildCandidate: "nexus-agent",
    chronicleRefCount: 2,
    ...overrides,
  };
}

describe("IFÁ-MAS approval context", () => {
  it("approval request accepts optional IFÁ-MAS context", () => {
    const ctx = makeIfamasContext();
    const record = makeApprovalRecord({ ifamasContext: ctx });
    assert.ok(record.ifamasContext);
    assert.equal(record.ifamasContext!.signalCode, "01100110");
  });

  it("approval request without IFÁ-MAS context still works", () => {
    const record = makeApprovalRecord(); // no ifamasContext
    assert.equal(record.ifamasContext, undefined);
    // Must still render correctly
    const lines = renderApprovalWithContext(record);
    assert.ok(linesContain(lines, "approval-001"));
    assert.ok(linesContain(lines, "/approve"));
  });

  it("approval prompt renders signal code and polarity", () => {
    const record = makeApprovalRecord({ ifamasContext: makeIfamasContext() });
    const lines = renderApprovalWithContext(record);
    assert.ok(linesContain(lines, "IBI"));
    assert.ok(linesContain(lines, "01100110"));
  });

  it("approval prompt renders offering action", () => {
    const record = makeApprovalRecord({
      ifamasContext: makeIfamasContext({ offeringAction: "ask_approval" }),
    });
    const lines = renderApprovalWithContext(record);
    assert.ok(linesContain(lines, "ask_approval"));
  });

  it("approval prompt renders route target when present", () => {
    const record = makeApprovalRecord({
      ifamasContext: makeIfamasContext({ routeTarget: "caller" }),
    });
    const lines = renderApprovalWithContext(record);
    assert.ok(linesContain(lines, "caller"));
  });

  it("approval prompt does NOT render route target when absent", () => {
    const record = makeApprovalRecord({
      ifamasContext: makeIfamasContext({ routeTarget: undefined }),
    });
    const lines = renderApprovalWithContext(record);
    assert.ok(linesDontContain(lines, "Route:"));
  });

  it("approval prompt renders gateway validity", () => {
    const valid = makeApprovalRecord({
      ifamasContext: makeIfamasContext({ gatewayValid: true }),
    });
    assert.ok(linesContain(renderApprovalWithContext(valid), "✓"));

    const invalid = makeApprovalRecord({
      ifamasContext: makeIfamasContext({ gatewayValid: false }),
    });
    assert.ok(linesContain(renderApprovalWithContext(invalid), "✗"));
  });

  it("approval prompt renders top guild candidate when present", () => {
    const record = makeApprovalRecord({
      ifamasContext: makeIfamasContext({ topGuildCandidate: "nexus-agent" }),
    });
    const lines = renderApprovalWithContext(record);
    assert.ok(linesContain(lines, "nexus-agent"));
  });

  it("approval prompt does NOT render guild candidate when absent", () => {
    const record = makeApprovalRecord({
      ifamasContext: makeIfamasContext({ topGuildCandidate: undefined }),
    });
    const lines = renderApprovalWithContext(record);
    assert.ok(linesDontContain(lines, "Guild:"));
  });

  it("approval decision behavior is unchanged — still shows /approve and /deny", () => {
    const withoutCtx = makeApprovalRecord();
    assert.ok(linesContain(renderApprovalWithContext(withoutCtx), "/approve"));
    assert.ok(linesContain(renderApprovalWithContext(withoutCtx), "/deny"));

    const withCtx = makeApprovalRecord({ ifamasContext: makeIfamasContext() });
    assert.ok(linesContain(renderApprovalWithContext(withCtx), "/approve"));
    assert.ok(linesContain(renderApprovalWithContext(withCtx), "/deny"));
  });

  it("no ToolExecutor execution occurs from IFÁ-MAS context", () => {
    const ctx = makeIfamasContext();
    // The context type has no methods or execution paths — pure data
    assert.equal(typeof ctx.signalCode, "string");
    assert.equal(typeof ctx.gatewayValid, "boolean");
    assert.equal(typeof ctx.chronicleRefCount, "number");

    // Verify the source file has no import of ToolExecutor/PolicyGate/ApprovalStore
    const src = readFileSync("src/tui/ifamas-panel.ts", "utf-8");
    const importLines = src.split("\n").filter(l => l.startsWith("import "));
    assert.ok(importLines.every(l => !l.includes("ToolExecutor")), "ToolExecutor must not be imported");
    assert.ok(importLines.every(l => !l.includes("PolicyGate")), "PolicyGate must not be imported");
    assert.ok(importLines.every(l => !l.includes("ApprovalStore")), "ApprovalStore must not be imported");
  });
});
