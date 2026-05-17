import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRiskReport } from "../../src/verifier/risk-report.js";
import type { VerificationCheck, VerificationResult } from "../../src/verifier/verifier.js";

describe("buildRiskReport", () => {
  it("reports all checks that were not run", () => {
    const allChecks: VerificationCheck[] = [
      { command: "npm run typecheck", reason: "typecheck" },
      { command: "npm run build", reason: "build" },
      { command: "npm test", reason: "test" },
    ];
    const results: Array<{ check: VerificationCheck; result: VerificationResult }> = [
      { check: allChecks[0], result: { status: "passed", command: "npm run typecheck" } },
      // build and test are missing — not run
    ];

    const report = buildRiskReport(allChecks, results);
    assert.ok(report.includes("build"), "should mention skipped build");
    assert.ok(report.includes("test"), "should mention skipped test");
  });

  it("reports failed checks with output", () => {
    const allChecks: VerificationCheck[] = [
      { command: "npm test", reason: "test" },
    ];
    const results: Array<{ check: VerificationCheck; result: VerificationResult }> = [
      { check: allChecks[0], result: { status: "failed", command: "npm test", output: "FAIL: expected 1 got 2" } },
    ];

    const report = buildRiskReport(allChecks, results);
    assert.ok(report.includes("FAILED"), "should mention failure");
    assert.ok(report.includes("npm test"), "should include command");
  });

  it("returns empty string when all checks passed", () => {
    const allChecks: VerificationCheck[] = [
      { command: "npm run typecheck", reason: "typecheck" },
    ];
    const results: Array<{ check: VerificationCheck; result: VerificationResult }> = [
      { check: allChecks[0], result: { status: "passed", command: "npm run typecheck" } },
    ];

    const report = buildRiskReport(allChecks, results);
    assert.strictEqual(report, "", "should be empty when all passed");
  });
});