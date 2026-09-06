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

  it("records agent activity durations as timers", () => {
    const m = new MinimalMetrics();
    m.duration("agent_activity_duration_ms", 9001, { state: "completed", invocationId: "inv-1" });
    const snap = m.snapshot();
    assert.equal(snap[0].name, "agent_activity_duration_ms");
    assert.equal(snap[0].type, "timer");
    assert.equal(snap[0].value, 9001);
    assert.equal(snap[0].labels?.state, "completed");
  });

  it("records agent activity/liveness gauges as gauge observations", () => {
    const m = new MinimalMetrics();
    m.gauge("agent_activity_state", 1, { state: "thinking", invocationId: "inv-1" });
    m.gauge("agent_last_progress_age_ms", 125_000, { invocationId: "inv-1" });
    const snap = m.snapshot();
    assert.equal(snap.length, 2);
    assert.equal(snap[0]!.name, "agent_activity_state");
    assert.equal(snap[0]!.type, "gauge");
    assert.equal(snap[0]!.value, 1);
    assert.equal(snap[0]!.labels?.state, "thinking");
    assert.equal(snap[1]!.name, "agent_last_progress_age_ms");
    assert.equal(snap[1]!.type, "gauge");
    assert.equal(snap[1]!.value, 125_000);
  });

  it("drops non-finite gauge observations", () => {
    const m = new MinimalMetrics();
    m.gauge("agent_last_progress_age_ms", Number.NaN);
    m.gauge("agent_last_progress_age_ms", Infinity);
    assert.equal(m.snapshot().length, 0);
  });

  it("increments agent outcome counters", () => {
    const m = new MinimalMetrics();
    m.increment("agent_invocation_failed_total");
    m.increment("agent_invocation_cancelled_total");
    m.increment("agent_stall_warning_total", { state: "warning" });
    const snap = m.snapshot();
    assert.equal(snap.length, 3);
    assert.equal(snap[0]!.type, "counter");
    assert.equal(snap[2]!.labels?.state, "warning");
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
