import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RecommendationReportStore,
  RecommendationReportIntegrityError,
  buildRecommendationReportId,
} from "../../src/executive/recommendation-report-store.js";
import type { NewRecommendationReport } from "../../src/executive/recommendation-report-store.js";
import type { ExecutiveRecommendation } from "../../src/executive/recommendation-report-store.js";

function newPayload(over: Partial<NewRecommendationReport> = {}): NewRecommendationReport {
  return {
    generatedAt: "2026-06-26T00:00:00.000Z",
    requestedWindow: 10,
    recommendationStatus: "ok",
    inputReportCount: 3,
    analyzedReportCount: 3,
    skippedReportCount: 0,
    evidenceReportIds: ["outcome-a", "outcome-b", "outcome-c"],
    recommendations: [
      {
        subsystem: "workflow",
        signal: "degrading_trend",
        severity: "high",
        recommendation: "Investigate workflow regressions",
        signalConfidence: 0.88,
        occurrenceCount: 8,
        averageDelta: -3.2,
      },
    ],
    warnings: [],
    loadWarnings: [],
    ...over,
  };
}

let tempRoot: string;
let storeDir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-7b-store-"));
  storeDir = join(tempRoot, ".alix", "executive", "recommendations");
  mkdirSync(storeDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("RecommendationReportStore.save", () => {
  it("round-trips all fields and contentHash on load", () => {
    const store = new RecommendationReportStore(storeDir);
    const id = store.save(newPayload());
    const loaded = store.load(id);

    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe("p10.7b.0");
    expect(loaded!.id).toBe(id);
    expect(loaded!.report.recommendationStatus).toBe("ok");
    expect(loaded!.report.evidenceReportIds).toEqual(["outcome-a", "outcome-b", "outcome-c"]);
    expect(loaded!.report.recommendations[0].subsystem).toBe("workflow");
    expect(loaded!.report.recommendations[0].signalConfidence).toBe(0.88);
  });

  it("preserves reserved fields as undefined (never populated in P10.7b)", () => {
    const store = new RecommendationReportStore(storeDir);
    const id = store.save(newPayload());
    const loaded = store.load(id);
    const rec = loaded!.report.recommendations[0];

    expect(rec.proposalId).toBeUndefined();
    expect(rec.governanceStatus).toBeUndefined();
    expect(rec.disposition).toBeUndefined();
    expect(rec.outcomeConfidence).toBeUndefined();
    expect(rec.outcomeSummary).toBeUndefined();
  });
});

describe("RecommendationReportStore.load — integrity", () => {
  it("rejects tampered contentHash with RecommendationReportIntegrityError", () => {
    const store = new RecommendationReportStore(storeDir);
    const id = store.save(newPayload());
    // Tamper with the on-disk JSON without going through the store.
    const path = join(storeDir, `${id}.json`);
    const raw = JSON.parse(require("node:fs").readFileSync(path, "utf-8")) as any;
    raw.report.recommendations[0].signalConfidence = 0.99;
    writeFileSync(path, JSON.stringify(raw, null, 2), "utf-8");

    expect(() => store.load(id)).toThrow(RecommendationReportIntegrityError);
  });

  it("rejects unknown schemaVersion", () => {
    const store = new RecommendationReportStore(storeDir);
    const id = store.save(newPayload());
    const path = join(storeDir, `${id}.json`);
    const raw = JSON.parse(require("node:fs").readFileSync(path, "utf-8")) as any;
    raw.schemaVersion = "p10.99.0";
    writeFileSync(path, JSON.stringify(raw, null, 2), "utf-8");

    expect(() => store.load(id)).toThrow(RecommendationReportIntegrityError);
  });

  it("returns null for a missing report id", () => {
    const store = new RecommendationReportStore(storeDir);
    expect(store.load("recommendation-does-not-exist")).toBeNull();
  });
});

describe("RecommendationReportStore.list", () => {
  it("skips corrupt files and sorts newest-first", () => {
    const store = new RecommendationReportStore(storeDir);
    store.save(newPayload({ generatedAt: "2026-06-01T00:00:00.000Z" }));
    store.save(newPayload({ generatedAt: "2026-06-15T00:00:00.000Z" }));
    store.save(newPayload({ generatedAt: "2026-06-26T00:00:00.000Z" }));

    // Inject a corrupt file the store cannot parse.
    writeFileSync(join(storeDir, "recommendation-corrupt.json"), "not valid json", "utf-8");

    const metas = store.list();
    expect(metas).toHaveLength(3);
    expect(metas[0].generatedAt).toBe("2026-06-26T00:00:00.000Z");
    expect(metas[1].generatedAt).toBe("2026-06-15T00:00:00.000Z");
    expect(metas[2].generatedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(metas[0].recommendationStatus).toBe("ok");
    expect(metas[0].recommendationCount).toBe(1);
  });

  it("returns an empty list when the directory does not exist", () => {
    const store = new RecommendationReportStore(join(tempRoot, "does-not-exist"));
    expect(store.list()).toEqual([]);
  });
});

describe("buildRecommendationReportId", () => {
  it("is deterministic and filename-safe", () => {
    const a = buildRecommendationReportId("2026-06-26T00:00:00.000Z");
    const b = buildRecommendationReportId("2026-06-26T00:00:00.000Z");
    expect(a).toBe(b);
    expect(a).toMatch(/^recommendation-[0-9TZ:-]+$/);
    expect(a).not.toContain(":");
  });
});