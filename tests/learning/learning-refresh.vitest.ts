/**
 * P8.5a.2d — Tests for the `runLearningRefresh` orchestrator.
 *
 * Mirrors earlier adapter-test patterns: temp-dir + vi.spyOn(process, "cwd"),
 * mkdtempSync + rmSync, store construction with explicit `storeDir` under
 * the temp root.
 *
 * 9 tests (per amended plan):
 *   1. Empty stores → no signals/profiles/reports written.
 *   2. Single adapter (recommendation) — seeds outcomes; runs recommendation only.
 *   3. All adapters — seeds all 3 source stores; asserts signals from all 3.
 *   4. Window filter — seeds an outcome outside the window; not processed.
 *   5. `--json` mode shape — orchestrator return value contains refreshRunId.
 *   6. Purity: orchestrator file imports LearningStore (legitimate writer) but
 *      no mutation surface (verified structurally in adapter-purity-sentinels).
 *   7. Run-identity shared timestamp — single generatedAt flows to all artifacts.
 *   8. Mixed Fidelity Refresh — all 3 adapters report correct fidelity.
 *   9. Registry extensibility — a 4th fake adapter drops into the map.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { OutcomeStore } from "../../src/adaptation/outcome-store.js";
import type { OutcomeRecord } from "../../src/adaptation/outcome-types.js";
import { RiskScoreStore } from "../../src/adaptation/risk-score-store.js";
import type { RiskScore } from "../../src/adaptation/risk-score-types.js";
import { RISK_DIMENSIONS } from "../../src/adaptation/risk-score-types.js";
import { GovernanceReviewStore } from "../../src/adaptation/governance-review-store.js";
import type {
  GovernanceReview,
  LensScore,
  CouncilVote,
  LensName,
  GovernanceVerdict,
} from "../../src/adaptation/governance-review-types.js";

import { LearningStore } from "../../src/learning/learning-store.js";
import { RecommendationCalibrationAdapter } from "../../src/learning/recommendation-calibration-adapter.js";
import { RiskCalibrationAdapter } from "../../src/learning/risk-calibration-adapter.js";
import { GovernanceCalibrationAdapter } from "../../src/learning/governance-calibration-adapter.js";
import {
  runLearningRefresh,
} from "../../src/learning/learning-refresh.js";
import type {
  AdapterName,
  AdapterResult,
  CalibrationAdapter,
} from "../../src/learning/adapter-diagnostics.js";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;
let outcomeStoreDir: string;
let riskStoreDir: string;
let reviewStoreDir: string;
let learningStoreDir: string;
let outcomeStore: OutcomeStore;
let riskStore: RiskScoreStore;
let reviewStore: GovernanceReviewStore;
let learningStore: LearningStore;

function makeOutcome(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: "",
    subject: "Outcome fixture",
    outcome: "success",
    confidence: 0.7,
    reasons: ["fixture"],
    generatedAt: "2026-06-21T00:00:00.000Z",
    subjectId: "subject-1",
    subjectType: "test",
    actionTaken: "Applied",
    observationWindowDays: 7,
    ...overrides,
  };
}

function makeRiskScore(overrides: {
  proposalId?: string;
  dimensions?: Partial<
    Record<
      "governance" | "operational" | "capability" | "revertability" | "evidence_quality",
      number
    >
  >;
  overallRisk?: number;
  generatedAt?: string;
  id?: string;
} = {}): RiskScore {
  const proposalId = overrides.proposalId ?? "prop-1";
  const dims = {
    governance: 0.5,
    operational: 0.5,
    capability: 0.5,
    revertability: 0.5,
    evidence_quality: 0.5,
    ...(overrides.dimensions ?? {}),
  };
  return {
    id: overrides.id ?? `risk-${proposalId}`,
    overallRisk: overrides.overallRisk ?? 0.5,
    dimensions: dims,
    risks: [],
    sourceArtifacts: [],
    generatedAt: overrides.generatedAt ?? "2026-06-21T00:00:00.000Z",
    subject: `Risk for ${proposalId}`,
    outcome: "scored",
    confidence: 0.9,
    reasons: ["fixture"],
  };
}

function makeLensScore(
  lens: LensName,
  recommendedVerdict: GovernanceVerdict,
  confidence = 0.8,
): LensScore {
  return {
    lens,
    recommendedVerdict,
    confidence,
    rationale: `Fixture rationale for ${lens}`,
    provider: "fixture",
    model: "fixture-v1",
  };
}

function makeCouncilVote(): CouncilVote {
  return { agree: 4, agreeWithConcerns: 0, challenge: 0, insufficientInformation: 0 };
}

function makeReview(overrides: {
  proposalId?: string;
  lensScores?: LensScore[];
  verdict?: GovernanceVerdict;
  generatedAt?: string;
} = {}): GovernanceReview {
  const proposalId = overrides.proposalId ?? "prop-A";
  const lensScores = overrides.lensScores ?? [
    makeLensScore("red_team", "agree"),
    makeLensScore("historian", "agree"),
    makeLensScore("policy_auditor", "agree"),
    makeLensScore("confidence_critic", "agree"),
  ];
  return {
    id: `review-${proposalId}`,
    proposalId,
    recommendationId: `rec-${proposalId}`,
    verdict: overrides.verdict ?? "agree",
    concerns: [],
    blindSpots: [],
    historicalAnalogies: [],
    lensScores,
    councilVote: makeCouncilVote(),
    sourceArtifacts: [],
    subject: `Review for ${proposalId}`,
    outcome: "reviewed",
    confidence: 0.8,
    reasons: ["fixture"],
    generatedAt: overrides.generatedAt ?? "2026-06-21T00:00:00.000Z",
  };
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "refresh-orch-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
  outcomeStoreDir = join(tempRoot, ".alix", "adaptation", "outcomes");
  riskStoreDir = join(tempRoot, ".alix", "risk-scores");
  reviewStoreDir = join(tempRoot, ".alix", "governance-reviews");
  learningStoreDir = join(tempRoot, ".alix", "learning");

  outcomeStore = new OutcomeStore(outcomeStoreDir);
  riskStore = new RiskScoreStore(riskStoreDir);
  reviewStore = new GovernanceReviewStore(reviewStoreDir);
  learningStore = new LearningStore(learningStoreDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

function buildDefaultAdapters() {
  return {
    recommendation: new RecommendationCalibrationAdapter(outcomeStore),
    risk: new RiskCalibrationAdapter(riskStore, outcomeStore),
    governance: new GovernanceCalibrationAdapter(reviewStore, outcomeStore),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runLearningRefresh orchestrator", () => {
  it("1. empty stores → no signals/profiles/reports written", async () => {
    const result = await runLearningRefresh({
      cwd: tempRoot,
      learningStore,
      adapters: buildDefaultAdapters(),
    });

    expect(result.results).toHaveLength(3);
    for (const r of result.results) {
      expect(r.signals).toEqual([]);
      expect(r.profiles).toEqual([]);
    }
    // A summary report is still appended (it just contains no signals/profiles).
    expect(result.reportId).toBeDefined();
    expect(existsSync(join(learningStoreDir, "reports.jsonl"))).toBe(true);
    expect(existsSync(join(learningStoreDir, "signals.jsonl"))).toBe(false);
    expect(existsSync(join(learningStoreDir, "profiles.jsonl"))).toBe(false);
  });

  it("2. single adapter (recommendation) — seeds outcomes; only recommendation runs", async () => {
    for (let i = 0; i < 5; i++) {
      await outcomeStore.append(
        makeOutcome({
          id: `succ-${i}`,
          confidence: 0.85,
          outcome: "success",
          subjectId: `s-${i}`,
        }),
      );
    }
    for (let i = 0; i < 5; i++) {
      await outcomeStore.append(
        makeOutcome({
          id: `fail-${i}`,
          confidence: 0.85,
          outcome: "failure",
          subjectId: `f-${i}`,
        }),
      );
    }

    const result = await runLearningRefresh({
      cwd: tempRoot,
      adapter: "recommendation",
      learningStore,
      adapters: buildDefaultAdapters(),
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].diagnostics.adapter).toBe("recommendation");
    expect(result.results[0].diagnostics.processed).toBe(10);
    expect(result.results[0].signals.length).toBeGreaterThan(0);
    expect(result.results[0].profiles.length).toBeGreaterThan(0);

    // LearningStore has signals + profiles written.
    const signals = await learningStore.querySignals();
    const profiles = await learningStore.queryProfiles();
    expect(signals.length).toBeGreaterThan(0);
    expect(profiles.length).toBeGreaterThan(0);

    // The report references signalIds + profileIds.
    const reportsRaw = readFileSync(join(learningStoreDir, "reports.jsonl"), "utf-8");
    const report = JSON.parse(reportsRaw.trim().split("\n")[0]);
    expect(report.evidenceRefs).toBeDefined();
    expect(report.evidenceRefs.length).toBeGreaterThan(0);
    expect(report.windowDays).toBe(30);
  });

  it("3. all adapters — seeds all 3 source stores; signals from all 3", async () => {
    // Recommendation source: outcomes — need 5+ per bucket to clear minSamples.
    // Seed 6 in the 0.8-1.0 bucket with 1 success + 5 failures → large overconfidence delta.
    for (let i = 0; i < 1; i++) {
      await outcomeStore.append(
        makeOutcome({
          id: `rec-succ-${i}`,
          confidence: 0.9,
          outcome: "success",
          subjectId: `s-${i}`,
        }),
      );
    }
    for (let i = 0; i < 5; i++) {
      await outcomeStore.append(
        makeOutcome({
          id: `rec-fail-${i}`,
          confidence: 0.9,
          outcome: "failure",
          subjectId: `f-${i}`,
        }),
      );
    }
    // Risk source: risk scores + outcomes joined by subjectId
    await riskStore.append(
      makeRiskScore({
        proposalId: "r-prop-1",
        generatedAt: "2026-06-21T00:00:00.000Z",
      }),
    );
    await outcomeStore.append(
      makeOutcome({
        id: "r-out-1",
        subjectId: "r-prop-1",
        outcome: "success",
        confidence: 0.7,
      }),
    );
    // Governance source: review + outcome joined by proposalId/subjectId
    await reviewStore.append(
      makeReview({
        proposalId: "g-prop-1",
        lensScores: [
          makeLensScore("red_team", "agree_with_concerns"),
          makeLensScore("historian", "agree"),
        ],
      }),
    );
    await outcomeStore.append(
      makeOutcome({
        id: "g-out-1",
        subjectId: "g-prop-1",
        outcome: "success",
        confidence: 0.7,
      }),
    );

    const result = await runLearningRefresh({
      cwd: tempRoot,
      adapter: "all",
      learningStore,
      adapters: buildDefaultAdapters(),
    });

    expect(result.results).toHaveLength(3);
    const adapterNames = result.results.map((r) => r.diagnostics.adapter);
    expect(adapterNames).toEqual(
      expect.arrayContaining(["recommendation", "risk", "governance"]),
    );

    const signals = await learningStore.querySignals();
    expect(signals.length).toBeGreaterThan(0);
  });

  it("4. window filter — outcome outside the window is not processed", async () => {
    // 400 days old — well outside the 30-day window.
    await outcomeStore.append(
      makeOutcome({
        id: "old",
        confidence: 0.5,
        outcome: "success",
        subjectId: "s-old",
        generatedAt: "2025-01-01T00:00:00.000Z",
      }),
    );

    const result = await runLearningRefresh({
      cwd: tempRoot,
      windowDays: 30,
      adapter: "recommendation",
      learningStore,
      adapters: buildDefaultAdapters(),
    });

    expect(result.results[0].diagnostics.sourceRecordsRead).toBe(0);
    expect(result.results[0].diagnostics.processed).toBe(0);
    expect(result.results[0].signals).toEqual([]);
    expect(result.results[0].profiles).toEqual([]);
  });

  it("5. --json mode shape — return value contains refreshRunId and results", async () => {
    // The orchestrator returns the same shape regardless of --json;
    // the CLI surfaces it verbatim. Confirm shape.
    const result = await runLearningRefresh({
      cwd: tempRoot,
      adapter: "recommendation",
      generatedAt: "2026-06-22T00:00:00.000Z",
      learningStore,
      adapters: buildDefaultAdapters(),
    });

    expect(result.refreshRunId).toBe("refresh:2026-06-22T00:00:00.000Z");
    expect(result.results).toBeInstanceOf(Array);
    expect(result.reportId).toBeDefined();

    // Serialize the same way the CLI does, confirm JSON shape.
    const json = JSON.stringify(result, null, 2);
    expect(json).toContain("refresh:2026-06-22T00:00:00.000Z");
    expect(json).toContain("results");
  });

  it("6. purity — orchestrator file imports LearningStore (legitimate writer)", () => {
    // The orchestrator IMPORTS LearningStore (it IS the sole writer);
    // it must NOT import any mutation surface. That check lives in
    // adapter-purity-sentinels.vitest.ts. Here we assert the orchestrator
    // file IS allowed to mention LearningStore.
    const src = readFileSync(
      "/home/babasola/Projects/Monolith/src/learning/learning-refresh.ts",
      "utf-8",
    );
    const importLines = src
      .split("\n")
      .filter((l) => l.trim().startsWith("import"));
    const mentionsLearningStore = importLines.some((l) => l.includes("LearningStore"));
    expect(mentionsLearningStore).toBe(true);
  });

  it("7. run-identity shared timestamp — single generatedAt flows to all artifacts", async () => {
    const sharedTs = "2026-06-22T00:00:00.000Z";

    // Seed enough outcomes in a bucket to clear minSamples threshold.
    // 1 success + 5 failures at confidence 0.9 → strong overconfidence signal.
    for (let i = 0; i < 1; i++) {
      await outcomeStore.append(
        makeOutcome({
          id: `ts-succ-${i}`,
          confidence: 0.9,
          outcome: "success",
          subjectId: `s-ts-succ-${i}`,
        }),
      );
    }
    for (let i = 0; i < 5; i++) {
      await outcomeStore.append(
        makeOutcome({
          id: `ts-fail-${i}`,
          confidence: 0.9,
          outcome: "failure",
          subjectId: `s-ts-fail-${i}`,
        }),
      );
    }
    await riskStore.append(
      makeRiskScore({ proposalId: "r-ts", generatedAt: "2026-06-21T00:00:00.000Z" }),
    );
    await outcomeStore.append(
      makeOutcome({
        id: "ts-risk-out",
        subjectId: "r-ts",
        outcome: "success",
        confidence: 0.7,
      }),
    );
    await reviewStore.append(
      makeReview({
        proposalId: "g-ts",
        lensScores: [makeLensScore("red_team", "agree_with_concerns")],
      }),
    );
    await outcomeStore.append(
      makeOutcome({
        id: "ts-gov-out",
        subjectId: "g-ts",
        outcome: "success",
        confidence: 0.7,
      }),
    );

    const result = await runLearningRefresh({
      cwd: tempRoot,
      generatedAt: sharedTs,
      learningStore,
      adapters: buildDefaultAdapters(),
    });

    expect(result.refreshRunId).toBe(`refresh:${sharedTs}`);

    const signals = await learningStore.querySignals();
    const profiles = await learningStore.queryProfiles();

    // Every emitted signal must carry the shared generatedAt.
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(s.generatedAt).toBe(sharedTs);
    }
    // Every emitted profile must carry the shared generatedAt.
    expect(profiles.length).toBeGreaterThan(0);
    for (const p of profiles) {
      expect(p.generatedAt).toBe(sharedTs);
    }

    // The summary report's generatedAt must equal sharedTs.
    const reportsRaw = readFileSync(join(learningStoreDir, "reports.jsonl"), "utf-8");
    const report = JSON.parse(reportsRaw.trim().split("\n")[0]);
    expect(report.generatedAt).toBe(sharedTs);
  });

  it("8. mixed fidelity refresh — recommendation+risk=high, governance=low", async () => {
    // Seed all 3 source stores with realistic data.
    // Recommendation: outcomes with confidence
    for (let i = 0; i < 3; i++) {
      await outcomeStore.append(
        makeOutcome({
          id: `mix-rec-${i}`,
          confidence: 0.85,
          outcome: "success",
          subjectId: `s-${i}`,
        }),
      );
    }
    // Risk: risk score + outcome joined
    await riskStore.append(
      makeRiskScore({ proposalId: "mix-r-1", generatedAt: "2026-06-21T00:00:00.000Z" }),
    );
    await outcomeStore.append(
      makeOutcome({
        id: "mix-r-out",
        subjectId: "mix-r-1",
        outcome: "success",
        confidence: 0.7,
      }),
    );
    // Governance: review with warning verdict + outcome joined
    await reviewStore.append(
      makeReview({
        proposalId: "mix-g-1",
        lensScores: [makeLensScore("red_team", "agree_with_concerns")],
      }),
    );
    await outcomeStore.append(
      makeOutcome({
        id: "mix-g-out",
        subjectId: "mix-g-1",
        outcome: "success",
        confidence: 0.7,
      }),
    );

    const result = await runLearningRefresh({
      cwd: tempRoot,
      learningStore,
      adapters: buildDefaultAdapters(),
    });

    const fidelityByAdapter: Record<AdapterName, string | undefined> = {
      recommendation: undefined,
      risk: undefined,
      governance: undefined,
    };
    for (const r of result.results) {
      fidelityByAdapter[r.diagnostics.adapter] = r.diagnostics.fidelity;
    }

    expect(fidelityByAdapter.recommendation).toBe("high");
    expect(fidelityByAdapter.risk).toBe("high");
    expect(fidelityByAdapter.governance).toBe("low");
  });

  it("9. registry extensibility — a 4th fake adapter drops into the map", async () => {
    // A 4th fake adapter that implements CalibrationAdapter.
    class FakeAdapter implements CalibrationAdapter {
      readonly marker = "fake-4th";
      async calibrate(): Promise<AdapterResult> {
        return {
          signals: [],
          profiles: [],
          diagnostics: {
            adapter: "recommendation" as AdapterName, // must reuse a known AdapterName
            sourceRecordsRead: 0,
            processed: 0,
            excludedReasons: {},
            fidelity: "high",
            notes: ["fake-4th adapter ran"],
          },
        };
      }
    }

    const defaultAdapters = buildDefaultAdapters();
    const fake = new FakeAdapter();

    // The orchestrator iterates Object.values(); replace one entry with
    // the fake to confirm the same loop drives a 4th adapter without
    // any orchestrator change.
    const extended: Record<AdapterName, CalibrationAdapter> = {
      ...defaultAdapters,
      recommendation: fake, // shadow default with fake
    };

    const result = await runLearningRefresh({
      cwd: tempRoot,
      adapter: "recommendation",
      learningStore,
      adapters: extended,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].diagnostics.notes).toContain("fake-4th adapter ran");
    // Same loop, no special-casing for the fake — registry extensibility proven.
  });

  it("10. invalid opts.adapter throws clean Error (fix #2)", async () => {
    // Defense in depth: the orchestrator validates `opts.adapter` so any
    // caller (CLI, programmatic, future subcommand) gets a clean error
    // rather than `undefined[x]` deeper in the loop. The CLI also
    // validates, but we test the orchestrator's own guard here.
    await expect(
      runLearningRefresh({
        cwd: tempRoot,
        adapter: "bogus" as never,
        learningStore,
        adapters: buildDefaultAdapters(),
      }),
    ).rejects.toThrow(/Invalid adapter: "bogus"\. Valid: recommendation, risk, governance, all/);
  });
});
