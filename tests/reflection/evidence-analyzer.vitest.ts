/**
 * P5.0b — EvidenceAnalyzer tests.
 *
 * Verifies that the EvidenceAnalyzer correctly detects patterns in evidence
 * records using targeted type queries (not full scans).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { EvidenceAnalyzer } from "../../src/reflection/evidence-analyzer.js";

describe("EvidenceAnalyzer", () => {
  let storeDir: string;
  let store: EvidenceStore;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), "evidence-analyzer-test-"));
    store = new EvidenceStore({ storeDir });
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  it("detects workflow_failure when >=3 workflow_aborted records exist", async () => {
    // Seed 3 workflow_aborted records
    await store.appendBatch([
      { type: "workflow_aborted", payload: { issue: "test-1", reason: "timeout" } },
      { type: "workflow_aborted", payload: { issue: "test-2", reason: "conflict" } },
      { type: "workflow_aborted", payload: { issue: "test-3", reason: "error" } },
    ]);

    const analyzer = new EvidenceAnalyzer(store);
    const result = await analyzer.analyze();

    // Should produce a workflow_failure observation with high severity
    const failureObs = result.observations.find((o) => o.type === "workflow_failure");
    expect(failureObs).toBeDefined();
    expect(failureObs!.severity).toBe("high");
    expect(failureObs!.count).toBe(3);
    expect(failureObs!.source).toBe("evidence-analyzer");

    // Should include a recommendation
    expect(result.recommendations.length).toBeGreaterThan(0);
    const rec = result.recommendations.find((r) => r.type === "process_change");
    expect(rec).toBeDefined();
    expect(rec!.evidence).toContain("3 workflow_aborted records");
  });

  it("detects multiple patterns across different evidence types", async () => {
    // Seed mixed evidence: 4 blocked, 3 test failures, only 1 aborted
    await store.appendBatch([
      { type: "workflow_blocked", payload: { issue: "b1", reason: "waiting-review" } },
      { type: "workflow_blocked", payload: { issue: "b2", reason: "needs-approval" } },
      { type: "workflow_blocked", payload: { issue: "b3", reason: "dependency" } },
      { type: "workflow_blocked", payload: { issue: "b4", reason: "resource" } },
      { type: "execution_test_failed", payload: { issue: "t1", test: "unit-a" } },
      { type: "execution_test_failed", payload: { issue: "t2", test: "unit-b" } },
      { type: "execution_test_failed", payload: { issue: "t3", test: "unit-c" } },
      { type: "workflow_aborted", payload: { issue: "a1", reason: "timeout" } },
    ]);

    const analyzer = new EvidenceAnalyzer(store);
    const result = await analyzer.analyze();

    // Should detect workflow_stall (medium) from >=3 blocked
    const stallObs = result.observations.find((o) => o.type === "workflow_stall");
    expect(stallObs).toBeDefined();
    expect(stallObs!.severity).toBe("medium");
    expect(stallObs!.count).toBe(4);

    // Should detect test_coverage_gap (medium) from >=3 test failures
    const testObs = result.observations.find((o) => o.type === "test_coverage_gap");
    expect(testObs).toBeDefined();
    expect(testObs!.severity).toBe("medium");
    expect(testObs!.count).toBe(3);

    // Should NOT detect workflow_failure (only 1 aborted)
    const failureObs = result.observations.find((o) => o.type === "workflow_failure");
    expect(failureObs).toBeUndefined();

    // Should have recommendations for each detected pattern
    expect(result.recommendations.length).toBe(2);
  });
});
