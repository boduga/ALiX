import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTEXT_RELEVANCE_PROFILES,
  LOCAL_ENGINE_ID,
  ProfileValidationError,
  activeProfile,
  activeProfilesForEngine,
  computeReliability,
  createCalibrationProvenance,
  createProfileRegistry,
  deriveThresholdProfile,
  deriveThresholdProfileFromAccuracySweep,
  loadProfileRegistry,
  profileById,
  promoteProfile,
  provenanceFromReliability,
  reportAccuracy,
  resolveProfileForEngine,
  rollbackProfile,
  saveProfileRegistry,
  suggestThreshold,
  thresholdProfileById,
  thresholdProfileForEngine,
  type CalibrationSample,
  type ThresholdProfile,
} from "../../src/decision/index.js";

function provenance(overrides?: { sampleCount?: number }) {
  return createCalibrationProvenance({
    datasetId: "fixture/v1",
    sampleCount: overrides?.sampleCount ?? 50,
    metric: "accuracy",
    value: 0.9,
    computedAt: 1,
  });
}

function profile(overrides: Partial<ThresholdProfile> & { id: string }): ThresholdProfile {
  return {
    decision: "context-relevance",
    engineId: LOCAL_ENGINE_ID,
    threshold: 0.4,
    status: "shadow",
    ...overrides,
  };
}

function sample(overrides: Partial<CalibrationSample> & { correct: boolean }): CalibrationSample {
  return {
    decisionId: "d",
    decision: "context-relevance",
    engineId: LOCAL_ENGINE_ID,
    kind: "noul",
    ...overrides,
  };
}

describe("calibration provenance", () => {
  it("validates its shape", () => {
    assert.equal(provenance().datasetId, "fixture/v1");
    assert.throws(() => createCalibrationProvenance({ datasetId: "", sampleCount: 1, metric: "accuracy", value: 1 }), ProfileValidationError);
    assert.throws(() => createCalibrationProvenance({ datasetId: "d", sampleCount: 0, metric: "accuracy", value: 1 }), /sampleCount/);
    assert.throws(() => createCalibrationProvenance({ datasetId: "d", sampleCount: 1, metric: "vibes" as never, value: 1 }), /unknown metric/);
  });

  it("derives from a reliability report", () => {
    const report = computeReliability([
      sample({ correct: true, probability: 0.8 }),
      sample({ correct: false, probability: 0.2 }),
    ]);
    assert.equal(reportAccuracy(report), 0.5);
    assert.equal(
      provenanceFromReliability(report, { datasetId: "ds/1", metric: "accuracy" }).value,
      0.5,
    );
    assert.equal(
      provenanceFromReliability(report, { datasetId: "ds/1", metric: "brierScore" }).value,
      report.brierScore,
    );
    assert.equal(
      provenanceFromReliability(report, { datasetId: "ds/1", metric: "expectedCalibrationError" }).value,
      report.expectedCalibrationError,
    );
  });
});

describe("profile registry", () => {
  it("rejects duplicate ids, bad thresholds and unproven active profiles", () => {
    assert.throws(() => createProfileRegistry([profile({ id: "a" }), profile({ id: "a" })]), /duplicate profile id/);
    assert.throws(() => createProfileRegistry([profile({ id: "a", threshold: 1.4 })]), /outside 0..1/);
    assert.throws(
      () => createProfileRegistry([profile({ id: "a", status: "active" })]),
      /no provenance/,
    );
  });

  it("resolves active profiles by scope, preferring a risk-specific one", () => {
    const registry = createProfileRegistry([
      profile({ id: "all-risk", status: "active", provenance: provenance() }),
      profile({ id: "high-risk", status: "active", risk: "high", threshold: 0.7, provenance: provenance() }),
      profile({ id: "shadow-only", threshold: 0.1 }),
    ]);
    assert.equal(activeProfile(registry, { decision: "context-relevance", engineId: LOCAL_ENGINE_ID })?.id, "all-risk");
    assert.equal(
      activeProfile(registry, { decision: "context-relevance", engineId: LOCAL_ENGINE_ID, risk: "high" })?.id,
      "high-risk",
    );
    // A risk-specific profile is never borrowed when no risk is given.
    assert.equal(
      activeProfile(registry, { decision: "context-relevance", engineId: LOCAL_ENGINE_ID, risk: "low" })?.id,
      "all-risk",
    );
    assert.equal(activeProfilesForEngine(registry, "context-relevance", LOCAL_ENGINE_ID).length, 2);
  });

  it("never selects a shadow profile", () => {
    const registry = createProfileRegistry([profile({ id: "shadow-only" })]);
    assert.equal(activeProfile(registry, { decision: "context-relevance", engineId: LOCAL_ENGINE_ID }), undefined);
  });
});

describe("promotion and rollback", () => {
  const v1 = profile({ id: "p/v1", status: "active", provenance: provenance() });
  const v2 = profile({ id: "p/v2", status: "shadow", threshold: 0.5, provenance: provenance() });

  it("promotes a calibrated profile and retires the incumbent", () => {
    const promoted = promoteProfile(createProfileRegistry([v1, v2]), "p/v2", { now: 7, approved: true });
    assert.equal(activeProfile(promoted, { decision: "context-relevance", engineId: LOCAL_ENGINE_ID })?.id, "p/v2");
    assert.equal(profileById(promoted, "p/v1")?.status, "retired");
    assert.equal(profileById(promoted, "p/v1")?.retiredAt, 7);
    assert.equal(profileById(promoted, "p/v2")?.promotedAt, 7);
  });

  it("requires an affirmative governance approval to promote", () => {
    const registry = createProfileRegistry([v1, v2]);
    assert.throws(
      () => promoteProfile(registry, "p/v2", { now: 7 }),
      /affirmative governance approval/,
    );
    const promoted = promoteProfile(registry, "p/v2", { now: 7, approved: true, approvedBy: "op-1" });
    assert.equal(profileById(promoted, "p/v2")?.approvedBy, "op-1");
  });

  it("fails closed on unknown, uncalibrated, or already-active promotion", () => {
    const registry = createProfileRegistry([v1, profile({ id: "p/v3" })]);
    assert.throws(() => promoteProfile(registry, "nope", { approved: true }), /unknown profile/);
    assert.throws(() => promoteProfile(registry, "p/v3", { approved: true }), /no calibration provenance/);
    assert.throws(() => promoteProfile(registry, "p/v1", { approved: true }), /already active/);
  });

  it("rolls back to the most recently retired profile", () => {
    const registry = createProfileRegistry([v1, v2]);
    const promoted = promoteProfile(registry, "p/v2", { now: 7, approved: true });
    const rolledBack = rollbackProfile(promoted, { decision: "context-relevance", engineId: LOCAL_ENGINE_ID }, { now: 9 });
    assert.equal(activeProfile(rolledBack, { decision: "context-relevance", engineId: LOCAL_ENGINE_ID })?.id, "p/v1");
    assert.equal(profileById(rolledBack, "p/v2")?.status, "retired");
    assert.equal(profileById(rolledBack, "p/v1")?.promotedAt, 9);
  });

  it("closes the loop: report -> derived profile -> approved promotion", () => {
    const report = computeReliability([
      { decisionId: "d1", decision: "context-relevance", engineId: "local", kind: "noul" as const, probability: 0.8, correct: true },
      { decisionId: "d2", decision: "context-relevance", engineId: "local", kind: "noul" as const, probability: 0.9, correct: true },
      { decisionId: "d3", decision: "context-relevance", engineId: "local", kind: "noul" as const, probability: 0.2, correct: false },
    ]);
    const derived = deriveThresholdProfile({
      report,
      datasetId: "fixture/first",
      id: "context-relevance/local/v2",
      decision: "context-relevance",
      engineId: "local",
      targetAccuracy: 0.5,
      computedAt: 2,
    });
    assert.equal(derived.status, "shadow");
    assert.equal(derived.provenance?.datasetId, "fixture/first");
    assert.ok(typeof derived.threshold === "number" && derived.threshold >= 0);

    const registry = promoteProfile(createProfileRegistry([derived]), "context-relevance/local/v2", {
      now: 4,
      approved: true,
      approvedBy: "op-1",
    });
    assert.equal(thresholdProfileForEngine(LOCAL_ENGINE_ID, registry).threshold, derived.threshold);
    assert.equal(profileById(registry, "context-relevance/local/v2")?.approvedBy, "op-1");
  });

  it("fails closed when there is nothing to roll back to", () => {
    assert.throws(
      () => rollbackProfile(createProfileRegistry([v1]), { decision: "context-relevance", engineId: LOCAL_ENGINE_ID }),
      /no retired profile/,
    );
    assert.throws(
      () => rollbackProfile(createProfileRegistry([]), { decision: "context-relevance", engineId: LOCAL_ENGINE_ID }),
      /no active profile/,
    );
  });
});

describe("profile persistence", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "alix-profiles-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips and treats a missing file as empty", () => {
    const path = join(dir, "profiles.json");
    assert.deepEqual(loadProfileRegistry(path).profiles, []);
    const registry = createProfileRegistry([
      profile({ id: "p/v1", status: "active", provenance: provenance() }),
    ]);
    saveProfileRegistry(path, registry);
    assert.equal(loadProfileRegistry(path).profiles.length, 1);
  });

  it("refuses to persist or load an invalid registry", () => {
    assert.throws(
      () => saveProfileRegistry(join(dir, "bad.json"), createProfileRegistry([profile({ id: "x", threshold: 2 })])),
      ProfileValidationError,
    );
    const path = join(dir, "corrupt.json");
    writeFileSync(path, JSON.stringify({ profiles: [{ id: "x" }] }), "utf8");
    assert.throws(() => loadProfileRegistry(path), ProfileValidationError);
  });
  it("suggests the least context dropped for an acceptable error rate", () => {
    const report = computeReliability([
      { decisionId: "d1", decision: "context-relevance", engineId: "local", kind: "noul" as const, probability: 0.9, correct: true },
      { decisionId: "d2", decision: "context-relevance", engineId: "local", kind: "noul" as const, probability: 0.9, correct: false },
      { decisionId: "d3", decision: "context-relevance", engineId: "local", kind: "noul" as const, probability: 0.1, correct: false },
    ]);
    const suggestion = suggestThreshold(report, { targetAccuracy: 0.5 });
    assert.equal(suggestion.threshold, 0.2);
    assert.ok(Math.abs(suggestion.accuracy - 0.5) < 1e-9, `accuracy ${suggestion.accuracy} ≈ 1/2`);
    assert.ok(Math.abs(suggestion.coverage - 2 / 3) < 1e-9, `coverage ${suggestion.coverage} ≈ 2/3`);
  });

  it("fails closed on a threshold suggestion no one could beat", () => {
    const report = computeReliability([
      { decisionId: "d1", decision: "context-relevance", engineId: "local", kind: "noul" as const, probability: 0.9, correct: false },
    ]);
    const suggestion = suggestThreshold(report, { targetAccuracy: 0.9 });
    assert.equal(suggestion.threshold, 1);
    assert.equal(suggestion.coverage, 0);
  });
});

describe("accuracy-sweep profile derivation", () => {
  it("derives a shadow profile with accuracy provenance from a sweep", () => {
    const derived = deriveThresholdProfileFromAccuracySweep({
      sweep: { threshold: 0.1, accuracy: 1, sampleCount: 8 },
      datasetId: "corpus/local-accuracy",
      id: "claim-verification/local/v2",
      decision: "claim-verification",
      engineId: LOCAL_ENGINE_ID,
      computedAt: 5,
    });
    assert.equal(derived.status, "shadow");
    assert.equal(derived.threshold, 0.1);
    assert.equal(derived.decision, "claim-verification");
    assert.equal(derived.provenance?.metric, "accuracy");
    assert.equal(derived.provenance?.value, 1);
    assert.equal(derived.provenance?.sampleCount, 8);
    assert.equal(derived.provenance?.datasetId, "corpus/local-accuracy");
    assert.equal(derived.provenance?.computedAt, 5);
  });

  it("keeps risk scope and rejects a sweep threshold outside 0..1", () => {
    const scoped = deriveThresholdProfileFromAccuracySweep({
      sweep: { threshold: 0.3, accuracy: 0.9, sampleCount: 4 },
      datasetId: "d",
      id: "claim-verification/local/v3",
      decision: "claim-verification",
      engineId: LOCAL_ENGINE_ID,
      risk: "high",
    });
    assert.equal(scoped.risk, "high");
    assert.throws(
      () =>
        deriveThresholdProfileFromAccuracySweep({
          sweep: { threshold: 1.4, accuracy: 1, sampleCount: 4 },
          datasetId: "d",
          id: "bad",
          decision: "claim-verification",
          engineId: LOCAL_ENGINE_ID,
        }),
      /outside 0..1/,
    );
  });
});

describe("first calibration and profile provenance", () => {
  it("the shipped seed is shadow-only, so resolution fails closed", () => {
    assert.equal(profileById(CONTEXT_RELEVANCE_PROFILES, "context-relevance/local/v1")?.status, "shadow");
    assert.throws(
      () => thresholdProfileForEngine(LOCAL_ENGINE_ID),
      /No active relevance threshold profile/,
    );
    assert.throws(
      () => resolveProfileForEngine(LOCAL_ENGINE_ID, "context-relevance/local/v1"),
      /No active relevance threshold profile/,
    );
  });

  it("an uncalibrated seed cannot be promoted; a calibrated one can", () => {
    assert.throws(
      () => promoteProfile(CONTEXT_RELEVANCE_PROFILES, "context-relevance/local/v1", { approved: true }),
      /no calibration provenance/,
    );

    const seed = profileById(CONTEXT_RELEVANCE_PROFILES, "context-relevance/local/v1") as ThresholdProfile;
    const calibrated = createProfileRegistry([{ ...seed, provenance: provenance() }]);
    const promoted = promoteProfile(calibrated, "context-relevance/local/v1", { now: 3, approved: true });
    assert.equal(thresholdProfileForEngine(LOCAL_ENGINE_ID, promoted).threshold, 0.34);
    assert.equal(thresholdProfileById("context-relevance/local/v1", promoted)?.status, "active");
  });
});
