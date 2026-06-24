/**
 * P10.1 — Trend Store unit tests.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExecutiveTrendStore } from "../../src/executive/trend-store.js";
import type { ExecutiveHealthReport } from "../../src/executive/executive-health.js";

function makeHealthReport(generatedAt: string): ExecutiveHealthReport {
  return {
    schemaVersion: "p10.0.0",
    generatedAt,
    windowDays: 90,
    overallScore: 78,
    rankedSubsystems: [
      { subsystem: "tools", score: 54, status: "critical", summary: "t", topIssues: [] },
      { subsystem: "governance", score: 91, status: "healthy", summary: "g", topIssues: [] },
      { subsystem: "security", score: 95, status: "healthy", summary: "s", topIssues: [] },
      { subsystem: "learning", score: 76, status: "warning", summary: "l", topIssues: [] },
      { subsystem: "adaptation", score: 88, status: "healthy", summary: "a", topIssues: [] },
      { subsystem: "agents", score: 82, status: "healthy", summary: "ag", topIssues: [] },
      { subsystem: "workflow", score: 79, status: "warning", summary: "w", topIssues: [] },
      { subsystem: "memory", score: 68, status: "warning", summary: "m", topIssues: [] },
    ],
  };
}

describe("ExecutiveTrendStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "trend-store-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loadLatest returns null on empty store", async () => {
    const store = new ExecutiveTrendStore(dir);
    expect(await store.loadLatest()).toBeNull();
  });

  it("save then loadLatest returns the same snapshot", async () => {
    const store = new ExecutiveTrendStore(dir);
    const report = makeHealthReport("2026-06-24T00:00:00.000Z");
    const saved = await store.save(report);
    expect(saved.id).toContain("exec-trend-");
    expect(saved.subsystemScores.tools).toBe(54);

    const loaded = await store.loadLatest();
    expect(loaded).not.toBeNull();
    expect(loaded!.subsystemScores.tools).toBe(54);
    expect(loaded!.generatedAt).toBe("2026-06-24T00:00:00.000Z");
  });

  it("loadLatest returns the most recent snapshot", async () => {
    const store = new ExecutiveTrendStore(dir);
    await store.save(makeHealthReport("2026-06-23T00:00:00.000Z"));
    await store.save(makeHealthReport("2026-06-24T00:00:00.000Z"));
    const loaded = await store.loadLatest();
    expect(loaded).not.toBeNull();
    expect(loaded!.generatedAt).toBe("2026-06-24T00:00:00.000Z");
  });

  it("round-trip preserves all 8 subsystem scores", async () => {
    const store = new ExecutiveTrendStore(dir);
    const report = makeHealthReport("2026-06-24T00:00:00.000Z");
    await store.save(report);
    const loaded = await store.loadLatest();
    expect(Object.keys(loaded!.subsystemScores).length).toBe(8);
    expect(loaded!.subsystemScores.tools).toBe(54);
    expect(loaded!.subsystemScores.governance).toBe(91);
    expect(loaded!.subsystemScores.security).toBe(95);
    expect(loaded!.subsystemScores.learning).toBe(76);
    expect(loaded!.subsystemScores.adaptation).toBe(88);
    expect(loaded!.subsystemScores.agents).toBe(82);
    expect(loaded!.subsystemScores.workflow).toBe(79);
    expect(loaded!.subsystemScores.memory).toBe(68);
  });
});
