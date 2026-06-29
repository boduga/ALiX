import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExecutiveTrendStore } from "../../src/executive/trend-store.js";
import type { ExecutiveTrendSnapshot } from "../../src/executive/trend-store.js";
import { OutcomeReportStore } from "../../src/executive/outcome-store.js";
import { RecommendationReportStore } from "../../src/executive/recommendation-report-store.js";
import {
  DefaultExecutiveObservationProvider,
} from "../../src/executive/executive-observation-provider.js";
import type {
  EffectivenessObservationSource,
  CorrelationObservationSource,
} from "../../src/executive/executive-observation-provider.js";

// ---------------------------------------------------------------------------
// Test infrastructure — real store instances backed by tmp dir so spyOn works
// ---------------------------------------------------------------------------

function makeTrendSnapshot(
  overrides: Partial<ExecutiveTrendSnapshot> = {},
): ExecutiveTrendSnapshot {
  return {
    id: "exec-trend-2026-06-25T12:00:00.000Z",
    generatedAt: "2026-06-25T12:00:00.000Z",
    windowDays: 7,
    subsystemScores: {
      governance: 80,
      security: 70,
      adaptation: 50,
      learning: 60,
      memory: 65,
      tools: 55,
      agents: 60,
      workflow: 50,
    },
    ...overrides,
  };
}

interface StubBundle {
  trendStore: ExecutiveTrendStore;
  outcomeStore: OutcomeReportStore;
  recommendationStore: RecommendationReportStore;
  effectivenessSource: EffectivenessObservationSource;
  correlationSource: CorrelationObservationSource;
}

function makeStubs(): StubBundle {
  const dir = mkdtempSync(join(tmpdir(), "obs-provider-test-"));

  const trendStore = new ExecutiveTrendStore(dir);
  const outcomeStore = new OutcomeReportStore(join(dir, "outcomes"));
  const recommendationStore = new RecommendationReportStore(
    join(dir, "recommendations"),
  );

  const effectivenessSource: EffectivenessObservationSource = {
    latestReportId: vi.fn().mockResolvedValue("effectiveness-report-1"),
  };
  const correlationSource: CorrelationObservationSource = {
    latestReportId: vi.fn().mockResolvedValue("correlation-report-1"),
  };

  return {
    trendStore,
    outcomeStore,
    recommendationStore,
    effectivenessSource,
    correlationSource,
    _dir: dir,
  } as StubBundle & { _dir: string };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefaultExecutiveObservationProvider", () => {
  let stubs: StubBundle & { _dir: string };

  beforeEach(() => {
    stubs = makeStubs() as StubBundle & { _dir: string };
  });

  afterEach(() => {
    rmSync(stubs._dir, { recursive: true, force: true });
  });

  it("collect returns a fresh observation every call (no caching)", async () => {
    const trend: ExecutiveTrendSnapshot = makeTrendSnapshot({
      id: "exec-trend-2026-06-25T12:00:00.000Z",
    });

    vi.spyOn(stubs.trendStore, "loadLatest").mockResolvedValue(trend);
    vi.spyOn(stubs.outcomeStore, "list").mockReturnValue([]);
    vi.spyOn(stubs.recommendationStore, "list").mockReturnValue([]);
    vi.mocked(stubs.effectivenessSource.latestReportId).mockResolvedValue(undefined);
    vi.mocked(stubs.correlationSource.latestReportId).mockResolvedValue(undefined);

    const provider = new DefaultExecutiveObservationProvider({
      trendStore: stubs.trendStore,
      outcomeStore: stubs.outcomeStore,
      recommendationStore: stubs.recommendationStore,
      effectivenessSource: stubs.effectivenessSource,
      correlationSource: stubs.correlationSource,
    });

    const obs1 = await provider.collect("plan-abc");
    const obs2 = await provider.collect("plan-abc");

    // Two distinct object identities — collect() does not memoize.
    expect(obs1).not.toBe(obs2);
    expect(obs1.collectedAt).toBeDefined();
    expect(obs2.collectedAt).toBeDefined();
  });

  it("collect populates trendSnapshotId from ExecutiveTrendStore.loadLatest", async () => {
    const trend = makeTrendSnapshot({
      id: "exec-trend-2026-06-25T12:00:00.000Z",
    });
    vi.spyOn(stubs.trendStore, "loadLatest").mockResolvedValue(trend);
    vi.spyOn(stubs.outcomeStore, "list").mockReturnValue([]);
    vi.spyOn(stubs.recommendationStore, "list").mockReturnValue([]);

    const provider = new DefaultExecutiveObservationProvider({
      trendStore: stubs.trendStore,
      outcomeStore: stubs.outcomeStore,
      recommendationStore: stubs.recommendationStore,
      effectivenessSource: stubs.effectivenessSource,
      correlationSource: stubs.correlationSource,
    });

    const obs = await provider.collect("plan-abc");
    expect(obs.trendSnapshotId).toBe("exec-trend-2026-06-25T12:00:00.000Z");
  });

  it("collect leaves trendSnapshotId undefined when ExecutiveTrendStore has no snapshot", async () => {
    vi.spyOn(stubs.trendStore, "loadLatest").mockResolvedValue(null);
    vi.spyOn(stubs.outcomeStore, "list").mockReturnValue([]);
    vi.spyOn(stubs.recommendationStore, "list").mockReturnValue([]);

    const provider = new DefaultExecutiveObservationProvider({
      trendStore: stubs.trendStore,
      outcomeStore: stubs.outcomeStore,
      recommendationStore: stubs.recommendationStore,
      effectivenessSource: stubs.effectivenessSource,
      correlationSource: stubs.correlationSource,
    });

    const obs = await provider.collect("plan-abc");
    expect(obs.trendSnapshotId).toBeUndefined();
  });

  it("collect populates recentOutcomeReportIds from OutcomeReportStore.list", async () => {
    vi.spyOn(stubs.trendStore, "loadLatest").mockResolvedValue(null);
    const outcomeMetas = [
      {
        reportId: "outcome-plan-x-20260625T120000000Z",
        planId: "plan-x",
        evaluationStatus: "completed",
        overallDelta: 1,
        generatedAt: "2026-06-25T12:00:00.000Z",
      },
      {
        reportId: "outcome-plan-y-20260624T120000000Z",
        planId: "plan-y",
        evaluationStatus: "completed",
        overallDelta: 2,
        generatedAt: "2026-06-24T12:00:00.000Z",
      },
    ];
    vi.spyOn(stubs.outcomeStore, "list").mockReturnValue(outcomeMetas);
    vi.spyOn(stubs.recommendationStore, "list").mockReturnValue([]);

    const provider = new DefaultExecutiveObservationProvider({
      trendStore: stubs.trendStore,
      outcomeStore: stubs.outcomeStore,
      recommendationStore: stubs.recommendationStore,
      effectivenessSource: stubs.effectivenessSource,
      correlationSource: stubs.correlationSource,
    });

    const obs = await provider.collect("plan-abc");
    expect(obs.recentOutcomeReportIds).toEqual([
      "outcome-plan-x-20260625T120000000Z",
      "outcome-plan-y-20260624T120000000Z",
    ]);
  });

  it("collect populates latestRecommendationReportId from RecommendationReportStore.list (newest first)", async () => {
    vi.spyOn(stubs.trendStore, "loadLatest").mockResolvedValue(null);
    vi.spyOn(stubs.outcomeStore, "list").mockReturnValue([]);
    const recMetas = [
      {
        reportId: "recommendation-newer",
        generatedAt: "2026-06-26T12:00:00.000Z",
        recommendationStatus: "ok",
        recommendationCount: 3,
      },
      {
        reportId: "recommendation-older",
        generatedAt: "2026-06-25T12:00:00.000Z",
        recommendationStatus: "ok",
        recommendationCount: 1,
      },
    ];
    vi.spyOn(stubs.recommendationStore, "list").mockReturnValue(recMetas);

    const provider = new DefaultExecutiveObservationProvider({
      trendStore: stubs.trendStore,
      outcomeStore: stubs.outcomeStore,
      recommendationStore: stubs.recommendationStore,
      effectivenessSource: stubs.effectivenessSource,
      correlationSource: stubs.correlationSource,
    });

    const obs = await provider.collect("plan-abc");
    expect(obs.latestRecommendationReportId).toBe("recommendation-newer");
  });

  it("collect populates latestEffectivenessReportId and latestCorrelationReportId from sources", async () => {
    vi.spyOn(stubs.trendStore, "loadLatest").mockResolvedValue(null);
    vi.spyOn(stubs.outcomeStore, "list").mockReturnValue([]);
    vi.spyOn(stubs.recommendationStore, "list").mockReturnValue([]);
    vi.mocked(stubs.effectivenessSource.latestReportId).mockResolvedValue("eff-1");
    vi.mocked(stubs.correlationSource.latestReportId).mockResolvedValue("corr-1");

    const provider = new DefaultExecutiveObservationProvider({
      trendStore: stubs.trendStore,
      outcomeStore: stubs.outcomeStore,
      recommendationStore: stubs.recommendationStore,
      effectivenessSource: stubs.effectivenessSource,
      correlationSource: stubs.correlationSource,
    });

    const obs = await provider.collect("plan-abc");
    expect(obs.latestEffectivenessReportId).toBe("eff-1");
    expect(obs.latestCorrelationReportId).toBe("corr-1");
  });

  it("collect leaves optional report IDs undefined when sources return nothing", async () => {
    vi.spyOn(stubs.trendStore, "loadLatest").mockResolvedValue(null);
    vi.spyOn(stubs.outcomeStore, "list").mockReturnValue([]);
    vi.spyOn(stubs.recommendationStore, "list").mockReturnValue([]);
    vi.mocked(stubs.effectivenessSource.latestReportId).mockResolvedValue(undefined);
    vi.mocked(stubs.correlationSource.latestReportId).mockResolvedValue(undefined);

    const provider = new DefaultExecutiveObservationProvider({
      trendStore: stubs.trendStore,
      outcomeStore: stubs.outcomeStore,
      recommendationStore: stubs.recommendationStore,
      effectivenessSource: stubs.effectivenessSource,
      correlationSource: stubs.correlationSource,
    });

    const obs = await provider.collect("plan-abc");
    expect(obs.latestEffectivenessReportId).toBeUndefined();
    expect(obs.latestCorrelationReportId).toBeUndefined();
    expect(obs.latestRecommendationReportId).toBeUndefined();
    expect(obs.trendSnapshotId).toBeUndefined();
  });

  it("collect populates collectedAt with an ISO 8601 timestamp", async () => {
    vi.spyOn(stubs.trendStore, "loadLatest").mockResolvedValue(null);
    vi.spyOn(stubs.outcomeStore, "list").mockReturnValue([]);
    vi.spyOn(stubs.recommendationStore, "list").mockReturnValue([]);

    const provider = new DefaultExecutiveObservationProvider({
      trendStore: stubs.trendStore,
      outcomeStore: stubs.outcomeStore,
      recommendationStore: stubs.recommendationStore,
      effectivenessSource: stubs.effectivenessSource,
      correlationSource: stubs.correlationSource,
    });

    const before = Date.now();
    const obs = await provider.collect("plan-abc");
    const after = Date.now();

    const observedMs = new Date(obs.collectedAt).getTime();
    expect(observedMs).toBeGreaterThanOrEqual(before);
    expect(observedMs).toBeLessThanOrEqual(after);
  });

  it("exposes only collect(planId) — single-seam invariant", () => {
    // The provider exposes a single seam (collect). Other modules must
    // interact with the executive store layer through ExecutiveObservation
    // objects, not by reaching past the provider into stores.
    const dir = mkdtempSync(join(tmpdir(), "obs-provider-shape-"));
    try {
      const provider = new DefaultExecutiveObservationProvider({
        trendStore: new ExecutiveTrendStore(dir),
        outcomeStore: new OutcomeReportStore(join(dir, "outcomes")),
        recommendationStore: new RecommendationReportStore(join(dir, "recommendations")),
        effectivenessSource: stubs.effectivenessSource,
        correlationSource: stubs.correlationSource,
      });
      expect(typeof provider.collect).toBe("function");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});