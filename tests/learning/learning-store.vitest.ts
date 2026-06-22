// tests/learning/learning-store.vitest.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LearningStore } from "../../src/learning/learning-store.js";
import type { LearningSignal, CalibrationProfile, LearningReport } from "../../src/learning/learning-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleSignal(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return {
    id: "",
    subject: "Test signal",
    outcome: "signal_detected",
    confidence: 0.85,
    reasons: ["Test"],
    generatedAt: "",
    sourceReportId: "acc-1",
    signalType: "overconfidence",
    strength: 0.35,
    summary: "Test overconfidence signal",
    evidenceRefs: [],
    ...overrides,
  };
}

function sampleProfile(overrides: Partial<CalibrationProfile> = {}): CalibrationProfile {
  return {
    id: "",
    subject: "Test profile",
    outcome: "suggested",
    confidence: 0.85,
    reasons: ["Test"],
    generatedAt: "",
    target: "recommendation_confidence_multiplier",
    targetName: "test",
    previousValue: 1.0,
    suggestedValue: 0.65,
    reason: "Observed overconfidence",
    evidenceRefs: [],
    sourceSignalIds: [],
    ...overrides,
  };
}

function sampleReport(overrides: Partial<LearningReport> = {}): LearningReport {
  return {
    id: "",
    subject: "Test report",
    outcome: "report_generated",
    confidence: 0.9,
    reasons: [],
    generatedAt: "",
    windowDays: 30,
    windowStart: "2026-05-23T00:00:00.000Z",
    windowEnd: "2026-06-22T00:00:00.000Z",
    signals: [],
    profiles: [],
    sections: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LearningStore", () => {
  let dir: string;
  let store: LearningStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "learning-store-"));
    store = new LearningStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Append — signals
  // -----------------------------------------------------------------------

  describe("appendSignal", () => {
    it("writes a signal to the JSONL file", async () => {
      const signal = sampleSignal({ id: "ls-1" });
      await store.appendSignal(signal);

      const filePath = join(dir, "signals.jsonl");
      expect(existsSync(filePath)).toBe(true);
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw.trim());
      expect(parsed.id).toBe("ls-1");
      expect(parsed.signalType).toBe("overconfidence");
    });

    it("generates an ID when none is provided", async () => {
      const signal = sampleSignal({ id: "" });
      const saved = await store.appendSignal(signal);
      expect(saved.id).toBeTruthy();
    });

    it("creates store directory if it doesn't exist", async () => {
      rmSync(dir, { recursive: true, force: true });
      expect(existsSync(dir)).toBe(false);

      const s = new LearningStore(dir);
      await s.appendSignal(sampleSignal({ id: "ls-dir" }));
      expect(existsSync(dir)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Append — profiles
  // -----------------------------------------------------------------------

  describe("appendProfile", () => {
    it("writes a profile to the JSONL file", async () => {
      const profile = sampleProfile({ id: "cp-1" });
      await store.appendProfile(profile);

      const filePath = join(dir, "profiles.jsonl");
      expect(existsSync(filePath)).toBe(true);
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw.trim());
      expect(parsed.id).toBe("cp-1");
      expect(parsed.target).toBe("recommendation_confidence_multiplier");
    });
  });

  // -----------------------------------------------------------------------
  // Append — reports
  // -----------------------------------------------------------------------

  describe("appendReport", () => {
    it("writes a report to the JSONL file", async () => {
      const report = sampleReport({ id: "lr-1" });
      await store.appendReport(report);

      const filePath = join(dir, "reports.jsonl");
      expect(existsSync(filePath)).toBe(true);
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw.trim());
      expect(parsed.id).toBe("lr-1");
      expect(parsed.windowDays).toBe(30);
    });
  });

  // -----------------------------------------------------------------------
  // Query — signals
  // -----------------------------------------------------------------------

  describe("querySignals", () => {
    it("returns all signals when no filters are applied", async () => {
      await store.appendSignal(sampleSignal({ id: "s1" }));
      await store.appendSignal(
        sampleSignal({ id: "s2", signalType: "underconfidence" }),
      );

      const results = await store.querySignals();
      expect(results).toHaveLength(2);
    });

    it("filters by signal type", async () => {
      await store.appendSignal(sampleSignal({ id: "s1", signalType: "overconfidence" }));
      await store.appendSignal(
        sampleSignal({ id: "s2", signalType: "underconfidence" }),
      );

      const over = await store.querySignals({ signalTypes: ["overconfidence"] });
      expect(over).toHaveLength(1);
      expect(over[0].id).toBe("s1");
    });

    it("filters by time window", async () => {
      const old = new Date();
      old.setDate(old.getDate() - 10);
      await store.appendSignal(
        sampleSignal({ id: "old", generatedAt: old.toISOString() }),
      );
      await store.appendSignal(
        sampleSignal({ id: "recent", generatedAt: new Date().toISOString() }),
      );

      const recent = await store.querySignals({ windowDays: 7 });
      expect(recent).toHaveLength(1);
      expect(recent[0].id).toBe("recent");
    });

    it("respects limit parameter", async () => {
      await store.appendSignal(sampleSignal({ id: "s1" }));
      await store.appendSignal(sampleSignal({ id: "s2" }));
      await store.appendSignal(sampleSignal({ id: "s3" }));

      const limited = await store.querySignals({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it("returns empty array when no signals exist", async () => {
      const results = await store.querySignals();
      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Query — profiles
  // -----------------------------------------------------------------------

  describe("queryProfiles", () => {
    it("returns all profiles when no filters are applied", async () => {
      await store.appendProfile(sampleProfile({ id: "p1" }));
      await store.appendProfile(
        sampleProfile({ id: "p2", target: "risk_dimension_weight" }),
      );

      const results = await store.queryProfiles();
      expect(results).toHaveLength(2);
    });

    it("filters by target", async () => {
      await store.appendProfile(sampleProfile({ id: "p1", target: "recommendation_confidence_multiplier" }));
      await store.appendProfile(
        sampleProfile({ id: "p2", target: "risk_dimension_weight" }),
      );

      const risk = await store.queryProfiles({ targets: ["risk_dimension_weight"] });
      expect(risk).toHaveLength(1);
      expect(risk[0].id).toBe("p2");
    });
  });

  // -----------------------------------------------------------------------
  // Resilience
  // -----------------------------------------------------------------------

  describe("resilience", () => {
    it("skips corrupt lines without crashing", async () => {
      const filePath = join(dir, "signals.jsonl");
      await store.appendSignal(sampleSignal({ id: "good-1" }));
      // Manually inject a corrupt line
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        filePath,
        readFileSync(filePath, "utf-8") + "not json\n",
      );
      await store.appendSignal(sampleSignal({ id: "good-2" }));

      const results = await store.querySignals();
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id).sort()).toEqual(["good-1", "good-2"]);
    });

    it("returns empty array when store directory doesn't exist", async () => {
      rmSync(dir, { recursive: true, force: true });
      const empty = new LearningStore(dir);
      const results = await empty.querySignals();
      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Append-only
  // -----------------------------------------------------------------------

  describe("append-only", () => {
    it("has no delete/update/clear/truncate methods", () => {
      const anyStore = store as unknown as Record<string, unknown>;
      expect(typeof anyStore.delete).not.toBe("function");
      expect(typeof anyStore.update).not.toBe("function");
      expect(typeof anyStore.clear).not.toBe("function");
      expect(typeof anyStore.truncate).not.toBe("function");
    });
  });
});
