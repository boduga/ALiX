import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityEvolutionStore } from "../../src/adaptation/capability-evolution-store.js";
import type { CapabilityEvolutionReport } from "../../src/adaptation/capability-evolution-types.js";

function makeReport(ts?: string): CapabilityEvolutionReport {
  const generatedAt = ts ?? "2026-06-19T23:30:00.000Z";
  return {
    generatedAt,
    totalCapabilities: 5,
    healthAnalysis: [],
    gapAnalysis: [],
    overlapAnalysis: [],
    driftAnalysis: [],
    lifecycleDistribution: { emerging: 3, active: 2, mature: 0, stagnant: 0, declining: 0, deprecated: 0 },
    executiveSummary: "Test",
  };
}

describe("CapabilityEvolutionStore", () => {
  let dir: string;
  let store: CapabilityEvolutionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "capevol-test-"));
    store = new CapabilityEvolutionStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and loads round-trip", async () => {
    await store.save(makeReport());
    const loaded = await store.load("2026-06-19T23-30-00.000Z.json");
    expect(loaded).not.toBeNull();
    expect(loaded!.totalCapabilities).toBe(5);
  });

  it("load returns null for missing file", async () => {
    expect(await store.load("nonexistent.json")).toBeNull();
  });

  it("loadLatest returns most recent", async () => {
    await store.save(makeReport("2026-06-19T10:00:00.000Z"));
    await store.save(makeReport("2026-06-19T23:00:00.000Z"));
    const latest = await store.loadLatest();
    expect(latest!.generatedAt).toBe("2026-06-19T23:00:00.000Z");
  });

  it("list returns sorted filenames", async () => {
    await store.save(makeReport("2026-06-19T10:00:00.000Z"));
    await store.save(makeReport("2026-06-20T10:00:00.000Z"));
    const files = await store.list();
    expect(files[0]).toContain("2026-06-20");
  });

  it("loadLatest returns null when empty", async () => {
    expect(await store.loadLatest()).toBeNull();
  });
});
