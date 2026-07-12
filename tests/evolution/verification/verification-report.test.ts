/**
 * Tests A2.4 — Verification Report Builder.
 *
 * @module verification-report
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  VerificationReportBuilder,
} from "../../../src/evolution/verification/index.js";

describe("VerificationReportBuilder", () => {
  it("builds a report with all collected fields", () => {
    const builder = new VerificationReportBuilder("ver-run-001");
    builder
      .addExecutionLog("Replay started")
      .addExecutionLog("Replay completed")
      .addReplayMetadata("seed", 42)
      .addReplayMetadata("scheduler", "fifo")
      .addMetricResult("success_rate", 0.94, 0.96)
      .addMetricResult("latency_ms", 200, 180)
      .addDiagnostic({ phase: "replay", duration_ms: 1200 });

    const report = builder.build();

    assert.strictEqual(report.verificationId, "ver-run-001");
    assert.strictEqual(report.evidenceClass, "projected");
    assert.strictEqual(report.executionLogs.length, 2);
    assert.strictEqual(report.metricResults.length, 2);
    assert.ok(Math.abs(report.metricResults[0].delta - 0.02) < 1e-9);
    assert.ok(Math.abs(report.metricResults[1].delta - (-20)) < 1e-9);
    assert.strictEqual(report.replayMetadata.seed, 42);
    assert.strictEqual(report.diagnostics.length, 1);
  });

  it("evidenceClass is always 'projected'", () => {
    const report = new VerificationReportBuilder("v-1").build();
    assert.strictEqual(report.evidenceClass, "projected");
  });

  it("generates a reportId when not provided", () => {
    const report = new VerificationReportBuilder("v-1").build();
    assert.ok(report.reportId.startsWith("rep-"));
  });

  it("uses provided reportId", () => {
    const report = new VerificationReportBuilder("v-1", "custom-rep-001").build();
    assert.strictEqual(report.reportId, "custom-rep-001");
  });

  it("returns immutable snapshot (builder can be reused)", () => {
    const builder = new VerificationReportBuilder("v-1");
    builder.addExecutionLog("first");
    const report1 = builder.build();
    builder.addExecutionLog("second");
    const report2 = builder.build();

    assert.strictEqual(report1.executionLogs.length, 1);
    assert.strictEqual(report2.executionLogs.length, 2);
  });

  it("handles large log volumes", () => {
    const builder = new VerificationReportBuilder("v-1");
    for (let i = 0; i < 1000; i++) {
      builder.addExecutionLog(`log-${i}`);
    }
    const report = builder.build();
    assert.strictEqual(report.executionLogs.length, 1000);
  });
});
