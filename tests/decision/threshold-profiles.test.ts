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
  loadProfileRegistry,
  profileById,
  promoteProfile,
  provenanceFromReliability,
  reportAccuracy,
  resolveProfileForEngine,
  rollbackProfile,
  saveProfileRegistry,
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
    const promoted = promoteProfile(createProfileRegistry([v1, v2]), "p/v2", { now: 7 });
    assert.equal(activeProfile(promoted, { decision: "context-relevance", engineId: LOCAL_ENGINE_ID })?.id, "p/v2");
    assert.equal(profileById(promoted, "p/v1")?.status, "retired");
    assert.equal(profileById(promoted, "p/v1")?.retiredAt, 7);
    assert.equal(profileById(promoted, "p/v2")?.promotedAt, 7);
  });

  it("fails closed on unknown, uncalibrated, or already-active promotion", () => {
    const registry = createProfileRegistry([v1, profile({ id: "p/v3" })]);
    assert.throws(() => promoteProfile(registry, "nope"), /unknown profile/);
    assert.throws(() => promoteProfile(registry, "p/v3"), /no calibration provenance/);
    assert.throws(() => promoteProfile(registry, "p/v1"), /already active/);
  });

  it("rolls back to the most recently retired profile", () => {
    const registry = createProfileRegistry([v1, v2]);
    const promoted = promoteProfile(registry, "p/v2", { now: 7 });
    const rolledBack = rollbackProfile(promoted, { decision: "context-relevance", engineId: LOCAL_ENGINE_ID }, { now: 9 });
    assert.equal(activeProfile(rolledBack, { decision: "context-relevance", engineId: LOCAL_ENGINE_ID })?.id, "p/v1");
    assert.equal(profileById(rolledBack, "p/v2")?.status, "retired");
    assert.equal(profileById(rolledBack, "p/v1")?.promotedAt, 9);
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
});

describe("no automation without a calibrated threshold", () => {
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
      () => promoteProfile(CONTEXT_RELEVANCE_PROFILES, "context-relevance/local/v1"),
      /no calibration provenance/,
    );

    const seed = profileById(CONTEXT_RELEVANCE_PROFILES, "context-relevance/local/v1") as ThresholdProfile;
    const calibrated = createProfileRegistry([{ ...seed, provenance: provenance() }]);
    const promoted = promoteProfile(calibrated, "context-relevance/local/v1", { now: 3 });
    assert.equal(thresholdProfileForEngine(LOCAL_ENGINE_ID, promoted).threshold, 0.34);
    assert.equal(thresholdProfileById("context-relevance/local/v1", promoted)?.status, "active");
  });
});
