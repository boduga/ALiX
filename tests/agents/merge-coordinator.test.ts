import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MergeCoordinator } from "../../src/agents/merge-coordinator.js";

describe("MergeCoordinator", () => {
  const coordinator = new MergeCoordinator();

  it("enqueues and drains results", () => {
    const result = { id: "r1", role: "explorer" as const, status: "success" as const, findings: [{ type: "summary" as const, content: "Found X", confidence: "high" as const, refs: [] }], events: [] };
    coordinator.enqueue(result);
    assert.equal(coordinator.size(), 1);
    const drained = coordinator.drain();
    assert.equal(drained.length, 1);
    assert.equal(drained[0].id, "r1");
    assert.equal(coordinator.size(), 0);
  });

  it("detectConflicts finds path with multiple findings", () => {
    const results = [
      { id: "r1", role: "explorer" as const, status: "success" as const, findings: [{ type: "file_ref" as const, content: "Auth module", confidence: "high" as const, refs: ["src/auth.ts"] }], events: [] },
      { id: "r2", role: "reviewer" as const, status: "success" as const, findings: [{ type: "risk_flag" as const, content: "Missing validation", confidence: "medium" as const, refs: ["src/auth.ts"] }], events: [] },
    ];
    const conflicts = coordinator.detectConflicts(results);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].path, "src/auth.ts");
    assert.equal(conflicts[0].findings.length, 2);
  });

  it("detectConflicts returns empty when no overlapping refs", () => {
    const results = [
      { id: "r1", role: "explorer" as const, status: "success" as const, findings: [{ type: "file_ref" as const, content: "Auth", confidence: "high" as const, refs: ["src/auth.ts"] }], events: [] },
      { id: "r2", role: "explorer" as const, status: "success" as const, findings: [{ type: "file_ref" as const, content: "DB", confidence: "high" as const, refs: ["src/db.ts"] }], events: [] },
    ];
    assert.equal(coordinator.detectConflicts(results).length, 0);
  });

  it("summarize formats findings", () => {
    const results = [
      { id: "abc123", role: "explorer" as const, status: "success" as const, findings: [{ type: "file_ref" as const, content: "auth.ts found", confidence: "high" as const, refs: ["src/auth.ts"] }], events: [] },
    ];
    const summary = coordinator.summarize(results);
    assert.ok(summary.includes("explorer"));
    assert.ok(summary.includes("abc123".slice(0, 8)));
    assert.ok(summary.includes("file_ref"));
    assert.ok(summary.includes("auth.ts found"));
  });

  it("summarize shows error when failed", () => {
    const results = [{ id: "r1", role: "explorer" as const, status: "failed" as const, findings: [], events: [], error: "timeout" }];
    const summary = coordinator.summarize(results);
    assert.ok(summary.includes("timeout"), `Expected timeout in summary, got: ${summary}`);
  });

  it("summarize shows (no findings) when empty", () => {
    const results = [{ id: "r1", role: "explorer" as const, status: "success" as const, findings: [], events: [] }];
    const summary = coordinator.summarize(results);
    assert.ok(summary.includes("(no findings)"));
  });
});