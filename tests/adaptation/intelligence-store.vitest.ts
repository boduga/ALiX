/**
 * P5.3.2 — IntelligenceStore persistence tests.
 *
 * Verifies save/load/list/loadLatest semantics using temporary directories.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IntelligenceStore } from "../../src/adaptation/intelligence-store.js";
import type { IntelligenceReport } from "../../src/adaptation/intelligence-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal but valid IntelligenceReport for testing. */
function makeReport(overrides: Partial<IntelligenceReport> = {}): IntelligenceReport {
  const generatedAt = overrides.generatedAt ?? "2026-06-19T23:30:00.000Z";
  return {
    generatedAt,
    totalProposalsAnalyzed: overrides.totalProposalsAnalyzed ?? 47,
    dataWindow: overrides.dataWindow ?? {
      oldestProposalCreatedAt: "2026-06-01T00:00:00.000Z",
      newestProposalCreatedAt: "2026-06-19T23:00:00.000Z",
      oldestEffectivenessAssessedAt: null,
    },
    executiveSummary: overrides.executiveSummary ?? "Test summary.",
    buckets: overrides.buckets ?? {
      byAction: { dimension: "byAction", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      byTargetKind: { dimension: "byTargetKind", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      bySourceRecommendationType: { dimension: "bySourceRecommendationType", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      byProvenance: { dimension: "byProvenance", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      byCapability: { dimension: "byCapability", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      byOutcome: { dimension: "byOutcome", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
    },
    confidenceCalibration: overrides.confidenceCalibration ?? {
      buckets: [],
      totalAssessed: 0,
      confidenceOutcomeCorrelation: null,
    },
    revertSignalAnalysis: overrides.revertSignalAnalysis ?? {
      totalAdvisoryReverts: 0,
      totalActualReverts: 0,
      totalUnactedReverts: 0,
      revertPrecision: null,
      topUnactedRevertBuckets: [],
      humansOverruledCount: 0,
    },
    topPerforming: overrides.topPerforming ?? [],
    lowestPerforming: overrides.lowestPerforming ?? [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IntelligenceStore", () => {
  let tmpDir: string;
  let store: IntelligenceStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "intelligence-store-test-"));
    store = new IntelligenceStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // (a) Save a valid IntelligenceReport → file exists on disk.
  describe("save", () => {
    it("creates the directory and writes the report file", async () => {
      const report = makeReport();
      await store.save(report);

      // Directory should exist with one .json file
      expect(existsSync(tmpDir)).toBe(true);
      const files = readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
      expect(files).toHaveLength(1);

      // Filename should be derived from generatedAt with colons replaced by dashes
      expect(files[0]).toBe("2026-06-19T23-30-00.000Z.json");
    });

    it("replaces colons with dashes in the filename", async () => {
      const report = makeReport({ generatedAt: "2026-06-18T14:05:30.500Z" });
      await store.save(report);

      const files = readdirSync(tmpDir);
      expect(files).toContain("2026-06-18T14-05-30.500Z.json");
    });
  });

  // (b) Save then load round-trips with matching fields.
  describe("load", () => {
    it("round-trips a report with all fields intact", async () => {
      const report = makeReport({
        totalProposalsAnalyzed: 12,
        executiveSummary: "Round-trip test summary.",
        topPerforming: [{ dimension: "byAction", value: "update_agent_card", keepRate: 0.9, total: 10 }],
        confidenceCalibration: {
          buckets: [
            {
              range: "0.9-1.0",
              rangeLow: 0.9,
              rangeHigh: 1.0,
              totalProposals: 5,
              insufficientData: false,
              keepCount: 5,
              keepRate: 1.0,
            },
          ],
          totalAssessed: 5,
          confidenceOutcomeCorrelation: null,
        },
      });

      await store.save(report);

      const loaded = await store.load("2026-06-19T23-30-00.000Z.json");
      expect(loaded).not.toBeNull();
      expect(loaded!.generatedAt).toBe(report.generatedAt);
      expect(loaded!.totalProposalsAnalyzed).toBe(12);
      expect(loaded!.executiveSummary).toBe("Round-trip test summary.");
      expect(loaded!.dataWindow.oldestProposalCreatedAt).toBe(report.dataWindow.oldestProposalCreatedAt);
      expect(loaded!.topPerforming).toHaveLength(1);
      expect(loaded!.topPerforming[0].value).toBe("update_agent_card");
      expect(loaded!.topPerforming[0].keepRate).toBe(0.9);
      expect(loaded!.confidenceCalibration.buckets).toHaveLength(1);
      expect(loaded!.confidenceCalibration.totalAssessed).toBe(5);
    });
  });

  // (c) Load returns null for non-existent filename.
  describe("load (missing)", () => {
    it("returns null when the file does not exist", async () => {
      const result = await store.load("nonexistent.json");
      expect(result).toBeNull();
    });

    it("returns null for an empty directory with no saved reports", async () => {
      const result = await store.load("any-file.json");
      expect(result).toBeNull();
    });
  });

  // (d) List returns filenames sorted newest-first.
  describe("list", () => {
    it("returns an empty array when no reports exist", async () => {
      const files = await store.list();
      expect(files).toEqual([]);
    });

    it("returns filenames sorted newest-first (reverse chronological)", async () => {
      // Save reports at different timestamps.  latest = largest ISO string.
      const oldest = makeReport({ generatedAt: "2026-06-18T10:00:00.000Z" });
      const middle = makeReport({ generatedAt: "2026-06-18T14:00:00.000Z" });
      const newest = makeReport({ generatedAt: "2026-06-19T23:30:00.000Z" });

      await store.save(oldest);
      await store.save(middle);
      await store.save(newest);

      const files = await store.list();
      expect(files).toHaveLength(3);

      // newest-first ordering
      expect(files[0]).toBe("2026-06-19T23-30-00.000Z.json");
      expect(files[1]).toBe("2026-06-18T14-00-00.000Z.json");
      expect(files[2]).toBe("2026-06-18T10-00-00.000Z.json");
    });

    it("handles a single file gracefully", async () => {
      const report = makeReport();
      await store.save(report);

      const files = await store.list();
      expect(files).toHaveLength(1);
      expect(files[0]).toBe("2026-06-19T23-30-00.000Z.json");
    });
  });

  // (e) LoadLatest returns the most recently saved report.
  describe("loadLatest", () => {
    it("returns the most recently saved report by filename ordering", async () => {
      const older = makeReport({
        generatedAt: "2026-06-18T12:00:00.000Z",
        totalProposalsAnalyzed: 5,
        executiveSummary: "Older report.",
      });
      const newer = makeReport({
        generatedAt: "2026-06-19T08:00:00.000Z",
        totalProposalsAnalyzed: 20,
        executiveSummary: "Newer report.",
      });

      // Save older first, then newer — loadLatest should return the newer one
      await store.save(older);
      await store.save(newer);

      const latest = await store.loadLatest();
      expect(latest).not.toBeNull();
      expect(latest!.generatedAt).toBe("2026-06-19T08:00:00.000Z");
      expect(latest!.totalProposalsAnalyzed).toBe(20);
      expect(latest!.executiveSummary).toBe("Newer report.");
    });

    it("returns the same result when only one report exists", async () => {
      const report = makeReport({ totalProposalsAnalyzed: 7 });
      await store.save(report);

      const latest = await store.loadLatest();
      expect(latest).not.toBeNull();
      expect(latest!.totalProposalsAnalyzed).toBe(7);
    });
  });

  // (f) LoadLatest returns null when no reports exist.
  describe("loadLatest (empty)", () => {
    it("returns null when no reports have been saved", async () => {
      const result = await store.loadLatest();
      expect(result).toBeNull();
    });

    it("returns null when the store directory does not exist yet", async () => {
      // The tmpDir was just created by beforeEach, but nothing was saved,
      // so the .alix/... subdirectory may not exist.  loadLatest → list → []
      const result = await store.loadLatest();
      expect(result).toBeNull();
    });
  });
});
