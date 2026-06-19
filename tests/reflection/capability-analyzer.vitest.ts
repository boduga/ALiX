/**
 * P5.0d — CapabilityAnalyzer tests.
 *
 * Verifies that the CapabilityAnalyzer correctly detects capability gaps
 * from capability_routed evidence records (candidates === 0 means unresolved)
 * and generates severity-graded observations + confidence-scaled recommendations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { CapabilityAnalyzer } from "../../src/reflection/capability-analyzer.js";

describe("CapabilityAnalyzer", () => {
  let storeDir: string;
  let store: EvidenceStore;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), "capability-analyzer-test-"));
    store = new EvidenceStore({ storeDir });
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Empty / no-op cases
  // -----------------------------------------------------------------------

  it("returns empty result when store has no records", async () => {
    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    expect(result.observations).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  it("returns empty result when no capability_routed events exist", async () => {
    // Seed unrelated events
    await store.appendBatch([
      { type: "workflow_aborted", payload: { issue: "a1" } },
      { type: "agent_resolved", payload: { capability: "test", agent: "agent-1" } },
    ]);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    expect(result.observations).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Resolved capabilities (candidates > 0) — no gap
  // -----------------------------------------------------------------------

  it("does not flag capabilities that have candidates", async () => {
    // All capability_routed events have candidates > 0
    await store.appendBatch([
      { type: "capability_routed", payload: { capability: "typescript-fix", candidates: 3 } },
      { type: "capability_routed", payload: { capability: "typescript-fix", candidates: 2 } },
      { type: "capability_routed", payload: { capability: "python-refactor", candidates: 1 } },
      { type: "capability_routed", payload: { capability: "python-refactor", candidates: 1 } },
      { type: "capability_routed", payload: { capability: "python-refactor", candidates: 1 } },
    ]);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    // No unresolved (candidates=0) events, so no gaps
    expect(result.observations).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Below threshold: unresolved but < 2 requests
  // -----------------------------------------------------------------------

  it("does not flag unresolved capability with only 1 request", async () => {
    await store.appendBatch([
      { type: "capability_routed", payload: { capability: "rust-borrow-checker", candidates: 0 } },
    ]);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    expect(result.observations).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Medium severity: unresolved, requested >= 2 but < 5
  // -----------------------------------------------------------------------

  it("detects gap with medium severity when capability requested 2-4 times with zero candidates", async () => {
    await store.appendBatch([
      { type: "capability_routed", payload: { capability: "helm-chart", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "helm-chart", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "helm-chart", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "helm-chart", candidates: 0 } },
    ]);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    const gapObs = result.observations.find((o) => o.type === "capability_gap");
    expect(gapObs).toBeDefined();
    expect(gapObs!.severity).toBe("medium");
    expect(gapObs!.count).toBe(4);
    expect(gapObs!.source).toBe("CapabilityAnalyzer");
    expect(gapObs!.title).toContain("helm-chart");
    expect(gapObs!.title).toContain("4 times");
    expect(gapObs!.title).toContain("zero candidates");
    expect(gapObs!.detail).toContain("No agent could handle");
  });

  it("applies medium severity at the exact lower bound (2 requests)", async () => {
    await store.appendBatch([
      { type: "capability_routed", payload: { capability: "yaml-lint", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "yaml-lint", candidates: 0 } },
    ]);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    const gapObs = result.observations.find((o) => o.type === "capability_gap");
    expect(gapObs).toBeDefined();
    expect(gapObs!.severity).toBe("medium");
    expect(gapObs!.count).toBe(2);
  });

  // -----------------------------------------------------------------------
  // High severity: unresolved, requested >= 5
  // -----------------------------------------------------------------------

  it("detects gap with high severity when capability requested >=5 times with zero candidates", async () => {
    await store.appendBatch([
      { type: "capability_routed", payload: { capability: "kubernetes-deploy", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "kubernetes-deploy", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "kubernetes-deploy", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "kubernetes-deploy", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "kubernetes-deploy", candidates: 0 } },
    ]);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    const gapObs = result.observations.find((o) => o.type === "capability_gap");
    expect(gapObs).toBeDefined();
    expect(gapObs!.severity).toBe("high");
    expect(gapObs!.count).toBe(5);
    expect(gapObs!.title).toContain("kubernetes-deploy");
    expect(gapObs!.title).toContain("5 times");
  });

  it("applies high severity at the exact threshold boundary (5)", async () => {
    await store.appendBatch(
      Array.from({ length: 5 }, () => ({
        type: "capability_routed" as const,
        payload: { capability: "edge-case-cap", candidates: 0 },
      })),
    );

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    const gapObs = result.observations.find((o) => o.type === "capability_gap");
    expect(gapObs).toBeDefined();
    expect(gapObs!.severity).toBe("high");
    expect(gapObs!.count).toBe(5);
  });

  it("applies high severity well above threshold (many requests)", async () => {
    await store.appendBatch(
      Array.from({ length: 20 }, () => ({
        type: "capability_routed" as const,
        payload: { capability: "frequent-cap", candidates: 0 },
      })),
    );

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    const gapObs = result.observations.find((o) => o.type === "capability_gap");
    expect(gapObs).toBeDefined();
    expect(gapObs!.severity).toBe("high");
    expect(gapObs!.count).toBe(20);
  });

  // -----------------------------------------------------------------------
  // Mixed: resolved and unresolved events for the same capability
  // -----------------------------------------------------------------------

  it("flags a gap when some events have candidates and others don't for the same capability", async () => {
    // Some routings found candidates (resolved), but others did not (unresolved gap)
    await store.appendBatch([
      { type: "capability_routed", payload: { capability: "db-migration", candidates: 1 } },
      { type: "capability_routed", payload: { capability: "db-migration", candidates: 2 } },
      { type: "capability_routed", payload: { capability: "db-migration", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "db-migration", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "db-migration", candidates: 0 } },
    ]);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    // db-migration has zero-candidate events, so it should be flagged
    const gapObs = result.observations.find((o) => o.type === "capability_gap");
    expect(gapObs).toBeDefined();
    // Total count = 5 (all events for db-migration, resolved + unresolved)
    expect(gapObs!.count).toBe(5);
    // 5 total >= 5 => high severity
    expect(gapObs!.severity).toBe("high");
  });

  it("detects multiple capability gaps simultaneously", async () => {
    await store.appendBatch([
      // capability A: 2 unresolved (medium)
      { type: "capability_routed", payload: { capability: "gap-a", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "gap-a", candidates: 0 } },
      // capability B: 6 unresolved (high)
      { type: "capability_routed", payload: { capability: "gap-b", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "gap-b", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "gap-b", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "gap-b", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "gap-b", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "gap-b", candidates: 0 } },
    ]);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    const gapObs = result.observations.filter((o) => o.type === "capability_gap");
    expect(gapObs).toHaveLength(2);

    const mediumObs = gapObs.find((o) => o.severity === "medium");
    expect(mediumObs).toBeDefined();
    expect(mediumObs!.count).toBe(2);
    expect(mediumObs!.title).toContain("gap-a");

    const highObs = gapObs.find((o) => o.severity === "high");
    expect(highObs).toBeDefined();
    expect(highObs!.count).toBe(6);
    expect(highObs!.title).toContain("gap-b");
  });

  // -----------------------------------------------------------------------
  // Recommendations
  // -----------------------------------------------------------------------

  it("generates a recommendation for each gap observation", async () => {
    await store.appendBatch([
      { type: "capability_routed", payload: { capability: "rec-test-1", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "rec-test-1", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "rec-test-2", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "rec-test-2", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "rec-test-2", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "rec-test-2", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "rec-test-2", candidates: 0 } },
    ]);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    expect(result.recommendations).toHaveLength(2);

    // All recommendations should be capability_gap type
    for (const rec of result.recommendations) {
      expect(rec.type).toBe("capability_gap");
    }
  });

  it("computes confidence as min(0.5 + count * 0.1, 0.95)", async () => {
    await store.appendBatch(
      Array.from({ length: 7 }, () => ({
        type: "capability_routed" as const,
        payload: { capability: "conf-cap", candidates: 0 },
      })),
    );

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    const rec = result.recommendations[0];
    expect(rec).toBeDefined();
    // count=7 => confidence = min(0.5 + 7*0.1, 0.95) = min(1.2, 0.95) = 0.95
    expect(rec.confidence).toBe(0.95);
  });

  it("clamps confidence at 0.95 for very high request counts", async () => {
    await store.appendBatch(
      Array.from({ length: 50 }, () => ({
        type: "capability_routed" as const,
        payload: { capability: "very-frequent", candidates: 0 },
      })),
    );

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    const rec = result.recommendations[0];
    expect(rec).toBeDefined();
    // count=50 => 0.5 + 50*0.1 = 5.5 => clamped to 0.95
    expect(rec.confidence).toBe(0.95);
  });

  it("computes minimum confidence for exactly 2 requests", async () => {
    await store.appendBatch([
      { type: "capability_routed", payload: { capability: "min-conf", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "min-conf", candidates: 0 } },
    ]);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    const rec = result.recommendations[0];
    expect(rec).toBeDefined();
    // count=2 => confidence = min(0.5 + 2*0.1, 0.95) = 0.7
    expect(rec.confidence).toBe(0.7);
  });

  it("includes evidence references in recommendations", async () => {
    await store.appendBatch([
      { type: "capability_routed", payload: { capability: "ev-cap", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "ev-cap", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "ev-cap", candidates: 0 } },
    ]);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    const rec = result.recommendations[0];
    expect(rec.evidence).toBeDefined();
    expect(rec.evidence.length).toBeGreaterThan(0);
    expect(rec.evidence[0]).toContain("ev-cap");
    expect(rec.evidence[0]).toContain("3");
    expect(rec.recommendedAction).toBeDefined();
    expect(rec.recommendedAction.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Targeted query (not full scan)
  // -----------------------------------------------------------------------

  it("only queries capability_routed events, ignoring others", async () => {
    // Mix capability_routed with large volume of unrelated events
    const batch = [];
    // 50 unrelated events
    for (let i = 0; i < 50; i++) {
      batch.push({
        type: "workflow_aborted" as const,
        payload: { issue: `noise-${i}` },
      });
    }
    // 3 capability_routed with gaps
    batch.push(
      { type: "capability_routed" as const, payload: { capability: "target", candidates: 0 } },
      { type: "capability_routed" as const, payload: { capability: "target", candidates: 0 } },
      { type: "capability_routed" as const, payload: { capability: "target", candidates: 0 } },
    );

    await store.appendBatch(batch);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    // Should only detect the "target" capability gap, ignoring noise
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].title).toContain("target");
    expect(result.observations[0].count).toBe(3);
  });

  // -----------------------------------------------------------------------
  // Analyzer interface compliance
  // -----------------------------------------------------------------------

  it("has the correct analyzer name", () => {
    const analyzer = new CapabilityAnalyzer(store);
    expect(analyzer.name).toBe("CapabilityAnalyzer");
  });

  it("returns a valid AnalysisResult shape", async () => {
    await store.appendBatch([
      { type: "capability_routed", payload: { capability: "shape-test", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "shape-test", candidates: 0 } },
    ]);

    const analyzer = new CapabilityAnalyzer(store);
    const result = await analyzer.analyze();

    expect(result).toHaveProperty("observations");
    expect(result).toHaveProperty("recommendations");
    expect(Array.isArray(result.observations)).toBe(true);
    expect(Array.isArray(result.recommendations)).toBe(true);

    // Observation shape
    const obs = result.observations[0];
    expect(obs).toHaveProperty("type");
    expect(obs).toHaveProperty("severity");
    expect(obs).toHaveProperty("title");
    expect(obs).toHaveProperty("detail");
    expect(obs).toHaveProperty("source");
    expect(obs).toHaveProperty("count");

    // Recommendation shape
    const rec = result.recommendations[0];
    expect(rec).toHaveProperty("type");
    expect(rec).toHaveProperty("confidence");
    expect(rec).toHaveProperty("title");
    expect(rec).toHaveProperty("evidence");
    expect(rec).toHaveProperty("recommendedAction");
  });
});
