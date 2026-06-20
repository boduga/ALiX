/**
 * P5.4.1 — PriorityStore tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PriorityStore } from "../../src/adaptation/priority-store.js";
import { SCORING_VERSION } from "../../src/adaptation/priority-types.js";
import type { ProposalPriorityReport } from "../../src/adaptation/priority-types.js";

function makeReport(ts?: string): ProposalPriorityReport {
  const generatedAt = ts ?? "2026-06-19T23:30:00.000Z";
  return {
    generatedAt,
    scoringVersion: SCORING_VERSION,
    intelligenceReportDate: null,
    totalPending: 5,
    totalScored: 4,
    totalLowConfidence: 1,
    scoreDistribution: [{ decile: "0.8-1.0", count: 2 }],
    executiveSummary: "Test report",
    ranked: [],
  };
}

describe("PriorityStore", () => {
  let dir: string;
  let store: PriorityStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "priority-test-"));
    store = new PriorityStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and loads a report round-trip", async () => {
    const report = makeReport();
    await store.save(report);
    const loaded = await store.load("2026-06-19T23-30-00.000Z.json");
    expect(loaded).not.toBeNull();
    expect(loaded!.generatedAt).toBe(report.generatedAt);
    expect(loaded!.scoringVersion).toBe("v1");
    expect(loaded!.totalPending).toBe(5);
  });

  it("load returns null for non-existent file", async () => {
    const loaded = await store.load("nonexistent.json");
    expect(loaded).toBeNull();
  });

  it("loadLatest returns most recent report", async () => {
    await store.save(makeReport("2026-06-19T10:00:00.000Z"));
    await store.save(makeReport("2026-06-19T23:00:00.000Z"));
    const latest = await store.loadLatest();
    expect(latest).not.toBeNull();
    expect(latest!.generatedAt).toBe("2026-06-19T23:00:00.000Z");
  });

  it("loadLatest returns null when empty", async () => {
    expect(await store.loadLatest()).toBeNull();
  });

  it("list returns filenames sorted newest-first", async () => {
    await store.save(makeReport("2026-06-19T10:00:00.000Z"));
    await store.save(makeReport("2026-06-19T23:00:00.000Z"));
    const files = await store.list();
    expect(files[0]).toBe("2026-06-19T23-00-00.000Z.json");
    expect(files[1]).toBe("2026-06-19T10-00-00.000Z.json");
  });

  it("list returns empty array when directory missing", async () => {
    const emptyStore = new PriorityStore(join(dir, "nonexistent"));
    expect(await emptyStore.list()).toEqual([]);
  });

  it("SCORING_VERSION is v1", () => {
    expect(SCORING_VERSION).toBe("v1");
  });
});
