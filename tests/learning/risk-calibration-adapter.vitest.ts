/**
 * P8.5a.2b — Tests for the RiskCalibrationAdapter.
 *
 * Mirrors the recommendation-adapter test pattern: temp-dir + vi.spyOn
 * cwd, mkdtempSync + rmSync, store construction with explicit storeDir
 * under the temp root.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

/** Repo root resolved from test file location (before cwd mock). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
import { RiskScoreStore } from "../../src/adaptation/risk-score-store.js";
import type { RiskScore } from "../../src/adaptation/risk-score-types.js";
import { RISK_DIMENSIONS } from "../../src/adaptation/risk-score-types.js";
import { OutcomeStore } from "../../src/adaptation/outcome-store.js";
import type { OutcomeRecord } from "../../src/adaptation/outcome-types.js";
import { RiskCalibrationAdapter } from "../../src/learning/risk-calibration-adapter.js";
import { ApprovalRecommendationStore } from "../../src/adaptation/approval-recommendation-store.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;
let riskStoreDir: string;
let outcomeStoreDir: string;
let recStoreDir: string;
let riskStore: RiskScoreStore;
let outcomeStore: OutcomeStore;

// Fixture factory for a RiskScore. Uses the canonical id format
// `risk-${proposalId}` so the adapter's proposalId derivation round-trips.
function makeRiskScore(overrides: {
  proposalId?: string;
  dimensions?: Partial<Record<
    "governance" | "operational" | "capability" | "revertability" | "evidence_quality",
    number
  >>;
  overallRisk?: number;
  generatedAt?: string;
  id?: string;
} = {}): RiskScore {
  const proposalId = overrides.proposalId ?? "prop-1";
  const id = overrides.id ?? `risk-${proposalId}`;
  const dims: Record<
    "governance" | "operational" | "capability" | "revertability" | "evidence_quality",
    number
  > = {
    governance: 0.5,
    operational: 0.5,
    capability: 0.5,
    revertability: 0.5,
    evidence_quality: 0.5,
    ...(overrides.dimensions ?? {}),
  };
  return {
    id,
    subject: `Risk for ${proposalId}`,
    outcome: "medium",
    confidence: 0.7,
    reasons: ["fixture"],
    generatedAt: overrides.generatedAt ?? "2026-06-22T00:00:00.000Z",
    overallRisk: overrides.overallRisk ?? 0.5,
    risks: [],
    dimensions: dims,
    sourceArtifacts: [],
  };
}

// Fixture factory for an OutcomeRecord. subjectId is the proposalId link.
function makeOutcome(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: "",
    subject: "Test outcome",
    outcome: "success",
    confidence: undefined,
    reasons: ["fixture"],
    generatedAt: "2026-06-22T00:00:00.000Z",
    subjectId: "prop-1",
    subjectType: "proposal",
    actionTaken: "Applied",
    observationWindowDays: 7,
    ...overrides,
  };
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "risk-adapter-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
  riskStoreDir = join(tempRoot, ".alix", "risk-scores");
  outcomeStoreDir = join(tempRoot, ".alix", "outcomes");
  recStoreDir = join(tempRoot, ".alix", "recommendations");
  riskStore = new RiskScoreStore(riskStoreDir);
  outcomeStore = new OutcomeStore(outcomeStoreDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("RiskCalibrationAdapter", () => {
  it("returns an empty AdapterResult for empty stores", async () => {
    const adapter = new RiskCalibrationAdapter(riskStore, outcomeStore);
    const result = await adapter.calibrate({
      windowDays: 30,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });

    expect(result.signals).toEqual([]);
    expect(result.profiles).toEqual([]);
    expect(result.diagnostics.adapter).toBe("risk");
    expect(result.diagnostics.sourceRecordsRead).toBe(0);
    expect(result.diagnostics.processed).toBe(0);
    expect(result.diagnostics.excludedReasons).toEqual({});
    expect(result.diagnostics.fidelity).toBe("high");
  });

  it("joins RiskScore × OutcomeRecord by proposalId (proposalId-1)", async () => {
    await riskStore.append(
      makeRiskScore({ proposalId: "prop-1", generatedAt: "2026-06-22T00:00:00.000Z" }),
    );
    await outcomeStore.append(
      makeOutcome({
        id: "out-1",
        subjectId: "prop-1",
        outcome: "success",
      }),
    );

    const adapter = new RiskCalibrationAdapter(riskStore, outcomeStore);
    const result = await adapter.calibrate({
      windowDays: 30,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });

    expect(result.diagnostics.sourceRecordsRead).toBe(1);
    expect(result.diagnostics.processed).toBe(1);
    expect(result.diagnostics.excludedReasons).toEqual({});
  });

  it("excludes risk scores whose proposalId has no outcome (excludedReasons.noOutcome)", async () => {
    // Risk score for prop-A HAS an outcome; prop-B does NOT.
    await riskStore.append(
      makeRiskScore({ proposalId: "prop-A", generatedAt: "2026-06-22T00:00:00.000Z" }),
    );
    await riskStore.append(
      makeRiskScore({ proposalId: "prop-B", generatedAt: "2026-06-22T00:00:00.000Z" }),
    );
    await outcomeStore.append(
      makeOutcome({ id: "out-A", subjectId: "prop-A", outcome: "success" }),
    );
    // No outcome for prop-B.

    const adapter = new RiskCalibrationAdapter(riskStore, outcomeStore);
    const result = await adapter.calibrate({
      windowDays: 30,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });

    expect(result.diagnostics.sourceRecordsRead).toBe(2);
    expect(result.diagnostics.processed).toBe(1);
    expect(result.diagnostics.excludedReasons).toEqual({ noOutcome: 1 });
  });

  it("converts RiskScore.dimensions (Record<RiskDimension, number>) to DimensionScore[] with all 5 dimensions", async () => {
    // Use distinctive scores per dimension so the conversion is observable.
    const customDims = {
      governance: 0.1,
      operational: 0.2,
      capability: 0.3,
      revertability: 0.4,
      evidence_quality: 0.5,
    };
    await riskStore.append(
      makeRiskScore({
        proposalId: "prop-dim",
        dimensions: customDims,
        generatedAt: "2026-06-22T00:00:00.000Z",
      }),
    );
    await outcomeStore.append(
      makeOutcome({
        id: "out-dim",
        subjectId: "prop-dim",
        outcome: "success",
      }),
    );

    // Inspect intermediate: build a small adapter that exposes what the
    // builder would receive. We do that by using the public builder with
    // the dimensions we'd expect the adapter to produce, and confirming
    // the builder accepts it and emits consistent shapes. This stays
    // within the public surface.
    const adapter = new RiskCalibrationAdapter(riskStore, outcomeStore);
    const result = await adapter.calibrate({
      windowDays: 30,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });

    // Adapter result still feeds the builder successfully; we confirm the
    // conversion path itself by re-running the pure builder with the
    // expected DimensionScore[] and asserting the same processed count.
    const { RiskCalibrationBuilder } = await import(
      "../../src/learning/risk-calibration-builder.js"
    );
    const expectedDimensions = RISK_DIMENSIONS.map((d) => ({
      dimension: d,
      score: customDims[d],
    }));
    expect(expectedDimensions).toHaveLength(5);

    const directBuilt = new RiskCalibrationBuilder().calibrate(
      [
        {
          proposalId: "prop-dim",
          dimensions: expectedDimensions,
          outcome: "success",
        },
      ],
      "risk-calibration-window-30",
      "2026-06-22T00:00:00.000Z",
    );
    // Both paths produce 1 processed observation → identical signal count
    // (modulo timestamp-bearing ids). Strip volatile id/timestamp fields
    // before comparing.
    const strip = (s: typeof directBuilt.signals[number]) => ({
      signalType: s.signalType,
      confidence: s.confidence,
      strength: s.strength,
    });
    expect(result.signals.map(strip)).toEqual(directBuilt.signals.map(strip));
  });

  it("reports fidelity: 'high' in diagnostics", async () => {
    await riskStore.append(
      makeRiskScore({ proposalId: "prop-fid", generatedAt: "2026-06-22T00:00:00.000Z" }),
    );
    await outcomeStore.append(
      makeOutcome({ id: "out-fid", subjectId: "prop-fid", outcome: "success" }),
    );

    const adapter = new RiskCalibrationAdapter(riskStore, outcomeStore);
    const result = await adapter.calibrate({
      windowDays: 30,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });

    expect(result.diagnostics.fidelity).toBe("high");
  });

  it("is pure: adapter file does NOT import ApprovalRecommendationStore", async () => {
    // Sanity: instantiate an ApprovalRecommendationStore independently with
    // real data, run the risk adapter on EMPTY stores, confirm no crash.
    // Then read the adapter source and assert it does not pull in the
    // recommendation surface.
    const recStore = new ApprovalRecommendationStore(recStoreDir);
    // Use a minimal valid ApprovalRecommendation shape — we don't actually
    // need to append anything, just exercise construction.
    void recStore;

    const adapter = new RiskCalibrationAdapter(riskStore, outcomeStore);
    const result = await adapter.calibrate({
      windowDays: 30,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });
    expect(result.diagnostics.processed).toBe(0);

    // Static assertion: adapter file imports do NOT mention forbidden
    // mutation surfaces or recommendation substrate.
    const src = readFileSync(
      `${REPO_ROOT}/src/learning/risk-calibration-adapter.ts`,
      "utf-8",
    );
    const importLines = src
      .split("\n")
      .filter((l) => l.trim().startsWith("import"));

    const forbidden = [
      "LearningStore",
      "ProposalStore",
      "ApprovalGate",
      "AdaptationProposalStore",
      "AutomaticProposalGenerator",
      "ApprovalRecommendationStore",
    ];
    for (const term of forbidden) {
      for (const line of importLines) {
        expect(line, `adapter must not import ${term}`).not.toContain(term);
      }
    }
  });

  it("windows outcomeStore by windowDays — stale outcomes are NOT joined (regression for HIGH-severity #1)", async () => {
    // Regression: risk adapter previously used `outcomeStore.list()` which
    // returned outcomes from ALL time, so an in-window RiskScore could pair
    // with a 400-day-old OutcomeRecord. With the fix, the join uses
    // `queryByWindow(windowDays)` so stale outcomes are excluded.
    //
    // Use direct fixture timestamps so the window filter is deterministic:
    //   generatedAt: 2026-06-22 (today)
    //   windowDays:  30
    //   → windowStart = 2026-05-23, windowEnd = 2026-06-22
    //
    // Seed: a RiskScore generated TODAY (in-window) paired with an
    // OutcomeRecord generated 400 days BEFORE today (out-of-window).
    // If the adapter correctly windows the outcome store, the join is empty.
    const today = "2026-06-22T00:00:00.000Z";
    const ancient = "2025-05-17T00:00:00.000Z"; // ~401 days before today

    await riskStore.append(
      makeRiskScore({
        proposalId: "prop-stale-join",
        generatedAt: today,
      }),
    );
    await outcomeStore.append(
      makeOutcome({
        id: "out-stale",
        subjectId: "prop-stale-join",
        outcome: "success",
        generatedAt: ancient,
      }),
    );

    const adapter = new RiskCalibrationAdapter(riskStore, outcomeStore);
    const result = await adapter.calibrate({
      windowDays: 30,
      generatedAt: today,
    });

    // The risk score was IN-window (read), but its stale outcome is OUT of
    // window — so the join must NOT produce a processed observation.
    expect(result.diagnostics.sourceRecordsRead).toBe(1); // 1 risk score in-window
    expect(result.diagnostics.processed).toBe(0); // 0 — stale outcome not joined
    expect(result.diagnostics.excludedReasons).toEqual({ noOutcome: 1 });
    expect(result.signals).toEqual([]);
    expect(result.profiles).toEqual([]);
  });
});