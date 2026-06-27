/**
 * P10.1 — Trend Store unit tests.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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

function makeSnapshot(generatedAt: string, scores: Record<string, number>) {
  return {
    id: `snap-${generatedAt}`,
    generatedAt,
    windowDays: 7,
    subsystemScores: scores,
  };
}

describe("ExecutiveTrendStore.findBaseline", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "trend-test-"));
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it("returns the snapshot whose generatedAt exactly matches before", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    const snapshot = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 50 });
    const filePath = join(tmpDir, "trends.jsonl");
    writeFileSync(filePath, JSON.stringify(snapshot) + "\n", "utf-8");
    const result = await store.findBaseline("2026-06-15T00:00:00.000Z");
    expect(result).not.toBeNull();
    expect(result!.generatedAt).toBe("2026-06-15T00:00:00.000Z");
  });

  it("returns the most recent snapshot before the given time", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    const filePath = join(tmpDir, "trends.jsonl");
    const older = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 30 });
    const newer = makeSnapshot("2026-06-10T00:00:00.000Z", { workflow: 40 });
    writeFileSync(filePath, [older, newer].map(s => JSON.stringify(s)).join("\n") + "\n", "utf-8");
    const result = await store.findBaseline("2026-06-15T00:00:00.000Z");
    expect(result).not.toBeNull();
    expect(result!.generatedAt).toBe("2026-06-10T00:00:00.000Z");
    expect(result!.subsystemScores.workflow).toBe(40);
  });

  it("returns null when no snapshot is before the given time", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    const snapshot = makeSnapshot("2026-06-20T00:00:00.000Z", { workflow: 50 });
    const filePath = join(tmpDir, "trends.jsonl");
    writeFileSync(filePath, JSON.stringify(snapshot) + "\n", "utf-8");
    const result = await store.findBaseline("2026-06-15T00:00:00.000Z");
    expect(result).toBeNull();
  });

  it("returns null when trends.jsonl does not exist", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    const result = await store.findBaseline("2026-06-15T00:00:00.000Z");
    expect(result).toBeNull();
  });
});
