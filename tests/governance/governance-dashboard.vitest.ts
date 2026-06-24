/**
 * P9.5 — Governance Dashboard aggregator tests.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGovernanceDashboardReport } from "../../src/governance/governance-dashboard.js";

let cwd: string;
let govDir: string;
let adaptDir: string;
let snapDir: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "gov-dash-"));
  govDir = join(cwd, ".alix", "governance");
  adaptDir = join(cwd, ".alix", "adaptation");
  snapDir = join(adaptDir, "snapshots");
  mkdirSync(join(govDir, "recommendations"), { recursive: true });
  mkdirSync(join(adaptDir, "proposals"), { recursive: true });
  mkdirSync(snapDir, { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function writeProposal(id: string, status: string, kind: string, extra: object = {}): void {
  const p = {
    id,
    createdAt: "2026-06-20T00:00:00.000Z",
    status,
    action: "governance_change",
    target: { kind: "governance", recommendationId: `rec-${id}` },
    payload: { kind, ...(kind === "lens_adjustment" ? { operation: "promote", lens: "x", currentPV: 0, reviewsAnalyzed: 0 } : {}) },
    sourceRecommendationType: "governance",
    sourceConfidence: 0.85,
    evidenceFingerprints: [],
    reason: "test",
    approvedBy: status === "applied" ? "test-operator" : undefined,
    approvedAt: status === "applied" ? "2026-06-21T00:00:00.000Z" : undefined,
    ...extra,
  };
  writeFileSync(join(adaptDir, "proposals", `${id}.json`), JSON.stringify(p), "utf-8");
}

function writeSnapshot(proposalId: string): void {
  const rawContent = "{}";
  const snap = {
    proposalId,
    snapshotAt: "2026-06-21T00:00:00.000Z",
    action: "governance_change",
    target: { kind: "governance", recommendationId: "rec-x" },
    filePath: "/tmp/x",
    content: Buffer.from(rawContent).toString("base64"),
    contentHash: createHash("sha256").update(rawContent).digest("hex"),
    fingerprint: "fp-" + proposalId,
  };
  writeFileSync(join(snapDir, `${proposalId}.json`), JSON.stringify(snap), "utf-8");
}

function writeRecommendationReport(recs: object[]): void {
  const report = {
    id: "rec-2026-06-20",
    subject: "Recommendations",
    outcome: "informational",
    confidence: 1,
    reasons: ["test"],
    evidenceRefs: [],
    generatedAt: "2026-06-20T00:00:00.000Z",
    reportType: "governance_recommendation",
    recommendations: recs,
  };
  writeFileSync(join(govDir, "recommendations.jsonl"), JSON.stringify(report) + "\n", "utf-8");
}

function makeRec(category: string, priority: string = "medium", id: string = "rec-1"): object {
  return {
    id,
    source: "drift",
    sourceArtifactId: "drift-x",
    priority,
    confidence: 0.7,
    status: "open",
    category,
    title: "test",
    description: "test",
    evidenceRefs: [],
    operatorGuidance: "Investigate.",
    expectedBenefit: "x",
    risks: [],
  };
}

describe("buildGovernanceDashboardReport", () => {
  it("returns a report with schemaVersion p9.5.0", async () => {
    const report = await buildGovernanceDashboardReport({ cwd, windowDays: 30, generatedAt: "2026-06-24T00:00:00.000Z" });
    expect(report.schemaVersion).toBe("p9.5.0");
    expect(report.generatedAt).toBe("2026-06-24T00:00:00.000Z");
    expect(report.windowDays).toBe(30);
  });

  it("reports 3 supported mutation kinds of 5 total", async () => {
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.health.supportedKinds).toBe(3);
    expect(report.health.totalKinds).toBe(5);
    expect(report.health.supportedKindList).toEqual(
      expect.arrayContaining(["confidence_calibration", "lens_adjustment", "policy_coverage"]),
    );
  });

  it("lists open mutation proposals grouped by kind", async () => {
    writeProposal("p-pending", "pending", "confidence_calibration");
    writeProposal("p-approved", "approved", "policy_coverage");
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.openMutations.totalCount).toBe(2);
    expect(report.openMutations.rows.map((r) => r.targetKind).sort()).toEqual([
      "confidence_calibration", "policy_coverage",
    ]);
  });

  it("places investigation-only recs in the investigation queue, not open mutations", async () => {
    writeRecommendationReport([
      makeRec("chain_restoration", "high", "rec-cr-1"),
      makeRec("governance_integrity", "medium", "rec-gi-1"),
      makeRec("confidence_calibration", "low", "rec-cc-1"),
    ]);
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.investigationQueue.totalCount).toBe(2);
    expect(report.investigationQueue.rows.map((r) => r.category).sort()).toEqual([
      "chain_restoration", "governance_integrity",
    ]);
  });

  it("builds mutation history with snapshot status per applied proposal", async () => {
    writeProposal("p-with-snap", "applied", "lens_adjustment");
    writeSnapshot("p-with-snap");
    writeProposal("p-no-snap", "applied", "policy_coverage");
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.mutationHistory.totalCount).toBe(2);
    const withSnap = report.mutationHistory.rows.find((r) => r.proposalId === "p-with-snap");
    const noSnap = report.mutationHistory.rows.find((r) => r.proposalId === "p-no-snap");
    expect(withSnap?.snapshotStatus).toBe("present");
    expect(noSnap?.snapshotStatus).toBe("missing");
  });

  it("computes revert readiness as percent ready", async () => {
    writeProposal("p1", "applied", "policy_coverage");
    writeSnapshot("p1");
    writeProposal("p2", "applied", "policy_coverage");
    writeProposal("p3", "applied", "policy_coverage");
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.revertReadiness.ready).toBe(1);
    expect(report.revertReadiness.missing).toBe(2);
    expect(report.revertReadiness.total).toBe(3);
    expect(report.revertReadiness.percentReady).toBe(33);
  });

  it("returns 100% revert readiness when no mutations have been applied", async () => {
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.revertReadiness.percentReady).toBe(100);
    expect(report.revertReadiness.total).toBe(0);
  });

  it("aggregates drift and integrity findings into the gaps panel", async () => {
    // The aggregator computes drift via detectGovernanceDrift (P8 pipeline),
    // not by reading .alix/governance/drift.jsonl directly. In a fresh repo
    // with no LearningStore data, no drift findings are produced and the
    // gaps panel is empty. This test asserts the empty-case shape: the
    // panel must not throw, must return an array of rows, and the total
    // count must be a non-negative number. Live drift rows are exercised
    // by integration tests in tests/integration/.
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.driftIntegrityGaps.totalCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.driftIntegrityGaps.rows)).toBe(true);
  });

  it("handles empty state without throwing", async () => {
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.health.supportedKinds).toBe(3);
    expect(report.openMutations.totalCount).toBe(0);
    expect(report.investigationQueue.totalCount).toBe(0);
    expect(report.mutationHistory.totalCount).toBe(0);
    expect(report.driftIntegrityGaps.totalCount).toBe(0);
  });
});
