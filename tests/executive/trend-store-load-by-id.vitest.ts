/**
 * P10.9.1-T2 — ExecutiveTrendStore.loadById unit tests.
 *
 * Additive read-only resolver. Used by read sites (evaluate handler,
 * automatic outcome hook) to resolve a `trendSnapshotId` reference stored
 * in an `ExecutivePlanSnapshot.rawSubsystemState` back to the concrete
 * `ExecutiveTrendSnapshot` payload the pure evaluator needs.
 *
 * Linear scan over JSONL — no index added. Returns null if id not found.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExecutiveTrendStore } from "../../src/executive/trend-store.js";
import type { ExecutiveTrendSnapshot } from "../../src/executive/trend-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<ExecutiveTrendSnapshot> = {}): ExecutiveTrendSnapshot {
  return {
    id: "snap-default-id",
    generatedAt: "2026-06-15T00:00:00.000Z",
    windowDays: 7,
    subsystemScores: {
      workflow: 50,
      tools: 50,
      governance: 50,
      security: 50,
      learning: 50,
      adaptation: 50,
      agents: 50,
      memory: 50,
    },
    ...overrides,
  };
}

function writeTrends(dir: string, snapshots: ExecutiveTrendSnapshot[]): void {
  const lines = snapshots.map((s) => JSON.stringify(s)).join("\n");
  writeFileSync(join(dir, "trends.jsonl"), lines + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutiveTrendStore.loadById", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "trend-load-by-id-"));
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns null when trends.jsonl does not exist", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    const result = await store.loadById("any-id");
    expect(result).toBeNull();
  });

  it("returns null when trends.jsonl is empty", async () => {
    writeFileSync(join(tmpDir, "trends.jsonl"), "", "utf-8");
    const store = new ExecutiveTrendStore(tmpDir);
    const result = await store.loadById("any-id");
    expect(result).toBeNull();
  });

  it("returns the snapshot whose id matches exactly", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    const target = makeSnapshot({
      id: "exec-trend-baseline",
      generatedAt: "2026-06-10T00:00:00.000Z",
      subsystemScores: { workflow: 40, tools: 50, governance: 50, security: 50, learning: 50, adaptation: 50, agents: 50, memory: 50 },
    });
    writeTrends(tmpDir, [target]);

    const result = await store.loadById("exec-trend-baseline");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("exec-trend-baseline");
    expect(result!.subsystemScores.workflow).toBe(40);
  });

  it("returns the matching snapshot among many — picks the FIRST line with matching id", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    const older = makeSnapshot({
      id: "exec-trend-baseline",
      generatedAt: "2026-06-10T00:00:00.000Z",
      subsystemScores: { workflow: 40, tools: 50, governance: 50, security: 50, learning: 50, adaptation: 50, agents: 50, memory: 50 },
    });
    const newer = makeSnapshot({
      id: "exec-trend-current",
      generatedAt: "2026-06-20T00:00:00.000Z",
      subsystemScores: { workflow: 80, tools: 50, governance: 50, security: 50, learning: 50, adaptation: 50, agents: 50, memory: 50 },
    });
    writeTrends(tmpDir, [older, newer]);

    const baseline = await store.loadById("exec-trend-baseline");
    expect(baseline).not.toBeNull();
    expect(baseline!.id).toBe("exec-trend-baseline");
    expect(baseline!.subsystemScores.workflow).toBe(40);

    const current = await store.loadById("exec-trend-current");
    expect(current).not.toBeNull();
    expect(current!.id).toBe("exec-trend-current");
    expect(current!.subsystemScores.workflow).toBe(80);
  });

  it("returns null when id is not found among snapshots", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    writeTrends(tmpDir, [
      makeSnapshot({ id: "snap-a", generatedAt: "2026-06-10T00:00:00.000Z" }),
      makeSnapshot({ id: "snap-b", generatedAt: "2026-06-15T00:00:00.000Z" }),
      makeSnapshot({ id: "snap-c", generatedAt: "2026-06-20T00:00:00.000Z" }),
    ]);

    const result = await store.loadById("snap-missing");
    expect(result).toBeNull();
  });

  it("is id-only — does NOT match on generatedAt or subsystemScores", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    writeTrends(tmpDir, [
      makeSnapshot({
        id: "the-only-id",
        generatedAt: "2026-06-10T00:00:00.000Z",
        subsystemScores: { workflow: 50, tools: 50, governance: 50, security: 50, learning: 50, adaptation: 50, agents: 50, memory: 50 },
      }),
    ]);

    // Wrong id even if other fields match
    const wrongId = await store.loadById("different-id");
    expect(wrongId).toBeNull();

    // Right id resolves regardless of subsystemScores
    const rightId = await store.loadById("the-only-id");
    expect(rightId).not.toBeNull();
    expect(rightId!.id).toBe("the-only-id");
  });

  it("skips malformed lines silently and finds the matching snapshot", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    const target = makeSnapshot({
      id: "exec-trend-found",
      generatedAt: "2026-06-15T00:00:00.000Z",
    });

    // Mix valid target with malformed lines around it
    const lines = [
      "{ this is not valid json",
      JSON.stringify(target),
      "{ also broken",
    ];
    writeFileSync(join(tmpDir, "trends.jsonl"), lines.join("\n") + "\n", "utf-8");

    const result = await store.loadById("exec-trend-found");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("exec-trend-found");
  });

  it("does NOT mutate the file — read-only resolver", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    writeTrends(tmpDir, [
      makeSnapshot({ id: "snap-a", generatedAt: "2026-06-10T00:00:00.000Z" }),
    ]);
    const before = readFileSync(join(tmpDir, "trends.jsonl"), "utf-8");

    await store.loadById("snap-a");
    await store.loadById("snap-missing");

    const after = readFileSync(join(tmpDir, "trends.jsonl"), "utf-8");
    expect(after).toBe(before);
  });

  // -----------------------------------------------------------------------
  // Additive invariant — verify loadLatest() and findBaseline() behavior
  // is unchanged after loadById was added.
  // -----------------------------------------------------------------------

  it("loadLatest() still returns the most recent snapshot (no behavior change)", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    // save() generates ids from the timestamp — write directly to disk
    writeTrends(tmpDir, [
      makeSnapshot({ id: "snap-old", generatedAt: "2026-06-10T00:00:00.000Z", subsystemScores: { workflow: 30, tools: 50, governance: 50, security: 50, learning: 50, adaptation: 50, agents: 50, memory: 50 } }),
      makeSnapshot({ id: "snap-new", generatedAt: "2026-06-20T00:00:00.000Z", subsystemScores: { workflow: 90, tools: 50, governance: 50, security: 50, learning: 50, adaptation: 50, agents: 50, memory: 50 } }),
    ]);

    const latest = await store.loadLatest();
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe("snap-new");
    expect(latest!.subsystemScores.workflow).toBe(90);
  });

  it("findBaseline() still returns the most recent snapshot before the cutoff (no behavior change)", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    writeTrends(tmpDir, [
      makeSnapshot({ id: "snap-a", generatedAt: "2026-06-01T00:00:00.000Z", subsystemScores: { workflow: 30, tools: 50, governance: 50, security: 50, learning: 50, adaptation: 50, agents: 50, memory: 50 } }),
      makeSnapshot({ id: "snap-b", generatedAt: "2026-06-10T00:00:00.000Z", subsystemScores: { workflow: 50, tools: 50, governance: 50, security: 50, learning: 50, adaptation: 50, agents: 50, memory: 50 } }),
      makeSnapshot({ id: "snap-c", generatedAt: "2026-06-20T00:00:00.000Z", subsystemScores: { workflow: 90, tools: 50, governance: 50, security: 50, learning: 50, adaptation: 50, agents: 50, memory: 50 } }),
    ]);

    const baseline = await store.findBaseline("2026-06-15T00:00:00.000Z");
    expect(baseline).not.toBeNull();
    expect(baseline!.id).toBe("snap-b");
    expect(baseline!.subsystemScores.workflow).toBe(50);
  });
});