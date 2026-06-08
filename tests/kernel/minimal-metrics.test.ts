import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MinimalMetrics } from "../../src/kernel/minimal-metrics.js";

describe("MinimalMetrics", () => {

  it("increments counters", () => {
    const m = new MinimalMetrics();
    m.increment("workflow_runs_total");
    m.increment("tool_calls_total", { tool: "file.read" });
    const snap = m.snapshot();
    assert.equal(snap.length, 2);
    assert.equal(snap[0].name, "workflow_runs_total");
    assert.equal(snap[0].value, 1);
    assert.equal(snap[1].labels?.tool, "file.read");
  });

  it("records duration", () => {
    const m = new MinimalMetrics();
    m.duration("workflow_duration_ms", 1234);
    const snap = m.snapshot();
    assert.equal(snap[0].name, "workflow_duration_ms");
    assert.equal(snap[0].type, "timer");
    assert.equal(snap[0].value, 1234);
  });

  it("flush clears the buffer", () => {
    const m = new MinimalMetrics();
    m.increment("workflow_runs_total");
    m.increment("model_calls_total");
    const flushed = m.flush();
    assert.equal(flushed.length, 2);
    assert.equal(m.snapshot().length, 0);
  });

  it("generates a readable report", () => {
    const m = new MinimalMetrics();
    m.increment("workflow_runs_total");
    m.duration("workflow_duration_ms", 5000);
    const report = m.report();
    assert.ok(report.includes("workflow_runs_total"));
    assert.ok(report.includes("workflow_duration_ms"));
  });
});
