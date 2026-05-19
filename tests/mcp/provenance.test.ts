import { describe, it } from "node:test";
import assert from "node:assert";
import { ToolProvenanceTracker, type ProvenanceEntry } from "../../src/mcp/provenance.js";

describe("ToolProvenanceTracker", () => {
  it("tracks tool source", () => {
    const tracker = new ToolProvenanceTracker();
    tracker.record("file.read", { source: "builtin" });

    const provenance = tracker.getProvenance("file.read");
    assert.ok(provenance);
    assert.equal(provenance?.source, "builtin");
  });

  it("records invocation count", () => {
    const tracker = new ToolProvenanceTracker();
    tracker.record("file.read", { source: "builtin" });
    tracker.record("file.read", { source: "builtin" });
    tracker.record("file.read", { source: "builtin" });

    const provenance = tracker.getProvenance("file.read");
    assert.equal(provenance?.invocationCount, 3);
  });

  it("exports for event logging", () => {
    const tracker = new ToolProvenanceTracker();
    tracker.record("file.read", { source: "builtin" });

    const exportData = tracker.exportForEvent();
    assert.ok(Array.isArray(exportData));
    assert.ok(exportData.some(e => e.toolName === "file.read"));
  });

  it("clears session data", () => {
    const tracker = new ToolProvenanceTracker();
    tracker.record("file.read", { source: "builtin" });

    tracker.clearSession();
    const provenance = tracker.getProvenance("file.read");
    assert.equal(provenance?.invocationCount, 0);
  });
});