import { describe, it } from "node:test";
import assert from "node:assert";
import { VerificationReporter } from "../../src/verification/verification-reporter.js";

describe("VerificationReporter", () => {
  it("aggregates multiple test results", () => {
    const reporter = new VerificationReporter();

    reporter.addResult({ name: "test-1", result: { success: true, exitCode: 0, durationMs: 100, stdout: "", stderr: "" } });
    reporter.addResult({ name: "test-2", result: { success: true, exitCode: 0, durationMs: 200, stdout: "", stderr: "" } });

    const summary = reporter.getSummary();
    assert.equal(summary.total, 2);
    assert.equal(summary.passed, 2);
    assert.equal(summary.failed, 0);
  });

  it("detects failures from exit code", () => {
    const reporter = new VerificationReporter();

    reporter.addResult({
      name: "failing-test",
      result: { success: false, exitCode: 1, durationMs: 50, stdout: "", stderr: "Assertion failed" }
    });

    const summary = reporter.getSummary();
    assert.equal(summary.failed, 1);
  });

  it("extracts test count from output", () => {
    const reporter = new VerificationReporter();

    reporter.addResult({
      name: "jest-output",
      result: { success: true, exitCode: 0, durationMs: 1000, stdout: "Tests: 5 passed, 1 failed", stderr: "" }
    });

    const analysis = reporter.analyzeOutput("jest-output");
    assert.ok(analysis.testCount);
  });

  it("generates markdown report", () => {
    const reporter = new VerificationReporter();
    reporter.addResult({ name: "example-test", result: { success: true, exitCode: 0, durationMs: 50, stdout: "", stderr: "" } });

    const report = reporter.generateMarkdownReport({ verbose: true });
    assert.ok(report.includes("## Verification Results"));
    assert.ok(report.includes("example-test"));
  });
});