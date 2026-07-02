// tests/reasoning/root-cause-store.vitest.ts
//
// P11.2 — Store tests for RootCauseStore.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RootCauseStore, type RootCauseAnalysisMeta } from "../../src/reasoning/root-cause-store.js";
import type { RootCauseAnalysis, AnalysisStatus } from "../../src/reasoning/reasoning-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeAnalysis(overrides?: Partial<RootCauseAnalysis>): RootCauseAnalysis {
  return {
    schemaVersion: "p11.2.0",
    analysisId: "reason-test-1",
    generatedAt: new Date().toISOString(),
    correlationGraphId: "abc123hash",
    status: "ok" as AnalysisStatus,
    findings: [],
    meta: { totalSubsystemsExamined: 8, degradedSubsystems: 0, totalEdgesAnalyzed: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RootCauseStore", () => {
  beforeEach(() => {
    tmpDir = join(tmpdir(), `rca-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // T15 — save + loadLatest round-trips correctly
  it("save + loadLatest round-trips correctly", async () => {
    const analysis = makeAnalysis({
      analysisId: "reason-test-1",
      findings: [{
        primarySubsystem: "workflow" as any,
        currentScore: 35,
        likelyCauses: [],
        drivingMetric: null,
        recommendedAction: "test",
      }],
      meta: { totalSubsystemsExamined: 8, degradedSubsystems: 1, totalEdgesAnalyzed: 5 },
    });
    const store = new RootCauseStore(tmpDir);
    await store.save(analysis);
    const loaded = await store.loadLatest();
    expect(loaded).not.toBeNull();
    expect(loaded!.analysisId).toBe("reason-test-1");
    expect(loaded!.findings).toHaveLength(1);
    expect(loaded!.correlationGraphId).toBe("abc123hash");
  });

  // T16 — loadLatest returns the most recently saved analysis
  it("loadLatest returns last saved analysis", async () => {
    const store = new RootCauseStore(tmpDir);
    await store.save(makeAnalysis({ analysisId: "reason-first", generatedAt: "2026-01-01T00:00:00.000Z" }));
    await store.save(makeAnalysis({ analysisId: "reason-second", generatedAt: "2026-06-01T00:00:00.000Z" }));
    const loaded = await store.loadLatest();
    expect(loaded!.analysisId).toBe("reason-second");
  });

  // T17 — loadLatest returns null when file doesn't exist
  it("loadLatest returns null when file does not exist", async () => {
    const store = new RootCauseStore(join(tmpDir, "nonexistent"));
    const loaded = await store.loadLatest();
    expect(loaded).toBeNull();
  });

  // T18 — invalid schema version throws RootCauseAnalysisError
  it("throws RootCauseAnalysisError on invalid schema version", async () => {
    const store = new RootCauseStore(tmpDir);
    const fs = await import("node:fs");
    fs.writeFileSync(join(tmpDir, "root-causes.jsonl"), JSON.stringify({ schemaVersion: "p11.1.0" }) + "\n", "utf-8");
    await expect(store.loadLatest()).rejects.toMatchObject({ code: "ROOT_CAUSE_ANALYSIS_ERROR" });
  });
});
