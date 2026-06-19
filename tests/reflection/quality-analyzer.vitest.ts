/**
 * P5.0e — QualityAnalyzer tests.
 *
 * Verifies that the QualityAnalyzer correctly detects review quality trends
 * from review_completed evidence records (verdict + findingCount).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { QualityAnalyzer } from "../../src/reflection/quality-analyzer.js";

describe("QualityAnalyzer", () => {
  let storeDir: string;
  let store: EvidenceStore;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), "quality-analyzer-test-"));
    store = new EvidenceStore({ storeDir });
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  it("returns empty result when no review_completed events exist", async () => {
    const analyzer = new QualityAnalyzer(store);
    const result = await analyzer.analyze();

    expect(result.observations).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  it("detects high-severity quality_decline when approval rate < 0.5", async () => {
    // 10 reviews: 3 approved, 3 changes_requested, 4 rejected → approvalRate = 0.3
    await store.appendBatch([
      { type: "review_completed", payload: { verdict: "approved", findingCount: 2 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 1 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 3 } },
      { type: "review_completed", payload: { verdict: "changes_requested", findingCount: 4 } },
      { type: "review_completed", payload: { verdict: "changes_requested", findingCount: 3 } },
      { type: "review_completed", payload: { verdict: "changes_requested", findingCount: 5 } },
      { type: "review_completed", payload: { verdict: "reject", findingCount: 6 } },
      { type: "review_completed", payload: { verdict: "reject", findingCount: 2 } },
      { type: "review_completed", payload: { verdict: "reject", findingCount: 3 } },
      { type: "review_completed", payload: { verdict: "reject", findingCount: 5 } },
    ]);

    const analyzer = new QualityAnalyzer(store);
    const result = await analyzer.analyze();

    // Should have a high-severity quality_decline (approvalRate 0.3 < 0.5)
    const obs = result.observations.find((o) => o.type === "quality_decline" && o.severity === "high");
    expect(obs).toBeDefined();
    expect(obs!.title).toContain("30%");
    expect(obs!.count).toBe(10);
    expect(obs!.source).toBe("QualityAnalyzer");
  });

  it("detects medium-severity quality_decline when approval rate >= 0.5 and < 0.75", async () => {
    // 10 reviews: 6 approved, 2 changes_requested, 2 rejected → approvalRate = 0.6
    await store.appendBatch([
      { type: "review_completed", payload: { verdict: "approved", findingCount: 2 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 1 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 3 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 1 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 2 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 1 } },
      { type: "review_completed", payload: { verdict: "changes_requested", findingCount: 4 } },
      { type: "review_completed", payload: { verdict: "changes_requested", findingCount: 3 } },
      { type: "review_completed", payload: { verdict: "reject", findingCount: 5 } },
      { type: "review_completed", payload: { verdict: "reject", findingCount: 3 } },
    ]);

    const analyzer = new QualityAnalyzer(store);
    const result = await analyzer.analyze();

    // Should have a medium-severity quality_decline (approvalRate 0.6, >= 0.5 but < 0.75)
    const obs = result.observations.find(
      (o) => o.type === "quality_decline" && o.severity === "medium",
    );
    expect(obs).toBeDefined();
    // Should NOT have high severity
    const highObs = result.observations.find(
      (o) => o.type === "quality_decline" && o.severity === "high",
    );
    expect(highObs).toBeUndefined();
  });

  it("detects high average findings when avgFindings > 5", async () => {
    // 5 reviews: all approved, but high finding counts → avgFindings = 8
    await store.appendBatch([
      { type: "review_completed", payload: { verdict: "approved", findingCount: 8 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 7 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 9 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 10 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 6 } },
    ]);

    const analyzer = new QualityAnalyzer(store);
    const result = await analyzer.analyze();

    // Should have a medium-severity quality_decline for high findings
    const obs = result.observations.find(
      (o) => o.type === "quality_decline" && o.title.includes("findings per review"),
    );
    expect(obs).toBeDefined();
    expect(obs!.severity).toBe("medium");
    expect(obs!.count).toBe(8);
    expect(obs!.source).toBe("QualityAnalyzer");
  });

  it("produces no observations when all reviews approved and findings low", async () => {
    // 5 reviews: all approved, low finding counts
    await store.appendBatch([
      { type: "review_completed", payload: { verdict: "approved", findingCount: 2 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 1 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 3 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 2 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 1 } },
    ]);

    const analyzer = new QualityAnalyzer(store);
    const result = await analyzer.analyze();

    expect(result.observations).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  it("detects both low approval rate and high findings simultaneously", async () => {
    // 8 reviews: 2 approved, 3 changes_requested, 3 rejected, avgFindings = 7
    // approvalRate = 0.25 (< 0.5 → high severity), avgFindings = 7 (> 5 → medium)
    await store.appendBatch([
      { type: "review_completed", payload: { verdict: "approved", findingCount: 8 } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 6 } },
      { type: "review_completed", payload: { verdict: "changes_requested", findingCount: 5 } },
      { type: "review_completed", payload: { verdict: "changes_requested", findingCount: 7 } },
      { type: "review_completed", payload: { verdict: "changes_requested", findingCount: 9 } },
      { type: "review_completed", payload: { verdict: "reject", findingCount: 8 } },
      { type: "review_completed", payload: { verdict: "reject", findingCount: 6 } },
      { type: "review_completed", payload: { verdict: "reject", findingCount: 7 } },
    ]);

    const analyzer = new QualityAnalyzer(store);
    const result = await analyzer.analyze();

    // Should have high severity (approval rate 0.25)
    const highObs = result.observations.find(
      (o) => o.type === "quality_decline" && o.severity === "high",
    );
    expect(highObs).toBeDefined();
    expect(highObs!.title).toContain("25%");

    // Should also have medium severity for high findings
    const findingObs = result.observations.find(
      (o) => o.type === "quality_decline" && o.title.includes("findings per review"),
    );
    expect(findingObs).toBeDefined();
    expect(findingObs!.severity).toBe("medium");

    expect(result.observations.length).toBe(2);
  });

  it("handles records with missing findingCount gracefully (defaults to 0)", async () => {
    // 5 reviews: 2 approved, 3 changes_requested, missing findingCount on some
    await store.appendBatch([
      { type: "review_completed", payload: { verdict: "approved" } },
      { type: "review_completed", payload: { verdict: "approved", findingCount: 1 } },
      { type: "review_completed", payload: { verdict: "changes_requested" } },
      { type: "review_completed", payload: { verdict: "changes_requested", findingCount: 2 } },
      { type: "review_completed", payload: { verdict: "changes_requested" } },
    ]);

    const analyzer = new QualityAnalyzer(store);
    const result = await analyzer.analyze();

    // approvalRate = 0.4 (< 0.5 → high)
    const obs = result.observations.find((o) => o.severity === "high");
    expect(obs).toBeDefined();
    // avgFindings = 3/5 = 0.6, should NOT trigger findings observation
    const findingObs = result.observations.find(
      (o) => o.title.includes("findings per review"),
    );
    expect(findingObs).toBeUndefined();
  });
});
