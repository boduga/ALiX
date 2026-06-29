import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DefaultExecutiveSnapshotProvider,
} from "../../src/executive/executive-snapshot-provider.js";
import type { ExecutiveSnapshotProvider } from "../../src/executive/executive-snapshot-provider.js";
import type { ExecutiveObservationProvider } from "../../src/executive/executive-observation-provider.js";
import type { ExecutiveObservation } from "../../src/executive/executive-observation-provider.js";
import type { ExecutivePlanSnapshot } from "../../src/executive/executive-snapshot-store.js";
import type {
  ExecutiveSnapshotCaptureSource,
  ExecutiveSnapshotCaptureReason,
} from "../../src/executive/executive-snapshot-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObservation(
  overrides: Partial<ExecutiveObservation> = {},
): ExecutiveObservation {
  return {
    collectedAt: "2026-06-25T12:00:00.000Z",
    trendSnapshotId: "exec-trend-2026-06-25T12:00:00.000Z",
    recentOutcomeReportIds: ["outcome-plan-x-20260625T120000000Z"],
    latestRecommendationReportId: "recommendation-newer",
    latestEffectivenessReportId: "eff-1",
    latestCorrelationReportId: "corr-1",
    ...overrides,
  };
}

function makeStubObservationProvider(): {
  provider: ExecutiveObservationProvider;
  collectSpy: ReturnType<typeof vi.fn>;
} {
  const collectSpy = vi.fn().mockResolvedValue(makeObservation());
  return {
    provider: { collect: collectSpy },
    collectSpy,
  };
}

const FIXED_ALIX_VERSION = "0.5.0";
const FIXED_ENGINE_VERSION = "1.0";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefaultExecutiveSnapshotProvider", () => {
  let obsProvider: ReturnType<typeof makeStubObservationProvider>;
  let provider: ExecutiveSnapshotProvider;

  beforeEach(() => {
    obsProvider = makeStubObservationProvider();
    provider = new DefaultExecutiveSnapshotProvider({
      observationProvider: obsProvider.provider,
      alixVersion: FIXED_ALIX_VERSION,
      executiveEngineVersion: FIXED_ENGINE_VERSION,
    });
  });

  // ─── captureBaseline ─────────────────────────────────────────────────────

  it("captureBaseline returns a snapshot with captureKind=baseline and id=<planId>-baseline", async () => {
    const snap = await provider.captureBaseline("plan-abc");
    expect(snap.captureKind).toBe("baseline");
    expect(snap.id).toBe("plan-abc-baseline");
    expect(snap.planId).toBe("plan-abc");
  });

  it("captureBaseline populates rawSubsystemState from observation", async () => {
    const obs = makeObservation({
      trendSnapshotId: "exec-trend-X",
      recentOutcomeReportIds: ["outcome-1", "outcome-2"],
      latestRecommendationReportId: "rec-1",
      latestEffectivenessReportId: "eff-1",
      latestCorrelationReportId: "corr-1",
    });
    obsProvider.collectSpy.mockResolvedValue(obs);

    const snap = await provider.captureBaseline("plan-abc");
    expect(snap.rawSubsystemState.trendSnapshotId).toBe("exec-trend-X");
    expect(snap.rawSubsystemState.outcomeReportIds).toEqual(["outcome-1", "outcome-2"]);
    expect(snap.rawSubsystemState.recommendationReportId).toBe("rec-1");
    expect(snap.rawSubsystemState.effectivenessReportId).toBe("eff-1");
    expect(snap.rawSubsystemState.correlationReportId).toBe("corr-1");
  });

  it("captureBaseline populates metadata with reason='execution-start' and createdBy='ExecutionEngine'", async () => {
    const snap = await provider.captureBaseline("plan-abc");
    expect(snap.metadata.snapshotVersion).toBe(1);
    expect(snap.metadata.alixVersion).toBe(FIXED_ALIX_VERSION);
    expect(snap.metadata.executiveEngineVersion).toBe(FIXED_ENGINE_VERSION);
    expect(snap.metadata.createdBy).toBe<ExecutiveSnapshotCaptureSource>("ExecutionEngine");
    expect(snap.metadata.reason).toBe<ExecutiveSnapshotCaptureReason>("execution-start");
  });

  it("captureBaseline populates capturedAt with an ISO 8601 timestamp", async () => {
    const before = Date.now();
    const snap = await provider.captureBaseline("plan-abc");
    const after = Date.now();
    const capturedMs = new Date(snap.capturedAt).getTime();
    expect(capturedMs).toBeGreaterThanOrEqual(before);
    expect(capturedMs).toBeLessThanOrEqual(after);
  });

  it("captureBaseline calls observationProvider.collect(planId) exactly once", async () => {
    await provider.captureBaseline("plan-abc");
    expect(obsProvider.collectSpy).toHaveBeenCalledTimes(1);
    expect(obsProvider.collectSpy).toHaveBeenCalledWith("plan-abc");
  });

  // ─── captureCurrent ──────────────────────────────────────────────────────

  it("captureCurrent returns a snapshot with captureKind=current and id=<planId>-current", async () => {
    const snap = await provider.captureCurrent("plan-abc");
    expect(snap.captureKind).toBe("current");
    expect(snap.id).toBe("plan-abc-current");
    expect(snap.planId).toBe("plan-abc");
  });

  it("captureCurrent populates metadata with reason='evaluation' and createdBy='EvaluationHandler'", async () => {
    const snap = await provider.captureCurrent("plan-abc");
    expect(snap.metadata.snapshotVersion).toBe(1);
    expect(snap.metadata.alixVersion).toBe(FIXED_ALIX_VERSION);
    expect(snap.metadata.executiveEngineVersion).toBe(FIXED_ENGINE_VERSION);
    expect(snap.metadata.createdBy).toBe<ExecutiveSnapshotCaptureSource>("EvaluationHandler");
    expect(snap.metadata.reason).toBe<ExecutiveSnapshotCaptureReason>("evaluation");
  });

  it("captureCurrent populates rawSubsystemState from observation", async () => {
    const obs = makeObservation({
      trendSnapshotId: undefined,
      recentOutcomeReportIds: [],
      latestRecommendationReportId: undefined,
      latestEffectivenessReportId: undefined,
      latestCorrelationReportId: undefined,
    });
    obsProvider.collectSpy.mockResolvedValue(obs);

    const snap = await provider.captureCurrent("plan-xyz");
    expect(snap.rawSubsystemState.trendSnapshotId).toBeUndefined();
    expect(snap.rawSubsystemState.outcomeReportIds).toEqual([]);
    expect(snap.rawSubsystemState.recommendationReportId).toBeUndefined();
    expect(snap.rawSubsystemState.effectivenessReportId).toBeUndefined();
    expect(snap.rawSubsystemState.correlationReportId).toBeUndefined();
  });

  it("captureCurrent calls observationProvider.collect(planId) exactly once", async () => {
    await provider.captureCurrent("plan-abc");
    expect(obsProvider.collectSpy).toHaveBeenCalledTimes(1);
    expect(obsProvider.collectSpy).toHaveBeenCalledWith("plan-abc");
  });

  // ─── Purity / seam invariants ────────────────────────────────────────────

  it("does not touch any stores — only the injected observation provider", async () => {
    // Baseline + current capture both pass through to the observation
    // seam. The snapshot provider itself never imports a store.
    await provider.captureBaseline("plan-abc");
    await provider.captureCurrent("plan-abc");
    expect(obsProvider.collectSpy).toHaveBeenCalledTimes(2);
  });

  it("snapshot id matches the documented <planId>-<kind> filename seam", async () => {
    const baseline = await provider.captureBaseline("plan-zzz");
    const current = await provider.captureCurrent("plan-zzz");
    expect(baseline.id).toBe("plan-zzz-baseline");
    expect(current.id).toBe("plan-zzz-current");
    // Id == basename of the persisted file (without .json suffix).
    expect(baseline.id).toMatch(/-baseline$/);
    expect(current.id).toMatch(/-current$/);
  });

  it("returned snapshot is structurally compatible with ExecutivePlanSnapshot", async () => {
    // Compile-time guard: assigning to a typed variable catches drift.
    const baseline: ExecutivePlanSnapshot = await provider.captureBaseline("plan-abc");
    const current: ExecutivePlanSnapshot = await provider.captureCurrent("plan-abc");
    expect(baseline).toBeDefined();
    expect(current).toBeDefined();
  });
});