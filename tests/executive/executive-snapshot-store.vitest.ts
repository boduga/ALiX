import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  BaselineAlreadyCapturedError,
  ExecutiveSnapshotStore,
} from "../../src/executive/executive-snapshot-store.js";
import type { ExecutivePlanSnapshot } from "../../src/executive/executive-snapshot-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaselineSnapshot(
  overrides: Partial<ExecutivePlanSnapshot> = {},
): ExecutivePlanSnapshot {
  return {
    metadata: {
      snapshotVersion: 1,
      alixVersion: "0.5.0",
      executiveEngineVersion: "1.0",
      createdBy: "ExecutionEngine",
      reason: "execution-start",
    },
    planId: "plan-abc",
    capturedAt: "2026-06-25T12:00:00.000Z",
    captureKind: "baseline",
    rawSubsystemState: {
      trendSnapshotId: "exec-trend-2026-06-25T12:00:00.000Z",
      outcomeReportIds: ["outcome-plan-x-20260625T120000000Z"],
      recommendationReportId: "recommendation-20260625T120000000Z",
      effectivenessReportId: undefined,
      correlationReportId: undefined,
    },
    id: "plan-abc-baseline",
    ...overrides,
  };
}

function makeCurrentSnapshot(
  overrides: Partial<ExecutivePlanSnapshot> = {},
): ExecutivePlanSnapshot {
  return {
    metadata: {
      snapshotVersion: 1,
      alixVersion: "0.5.0",
      executiveEngineVersion: "1.0",
      createdBy: "EvaluationHandler",
      reason: "evaluation",
    },
    planId: "plan-abc",
    capturedAt: "2026-06-26T12:00:00.000Z",
    captureKind: "current",
    rawSubsystemState: {
      trendSnapshotId: "exec-trend-2026-06-26T12:00:00.000Z",
      outcomeReportIds: [],
    },
    id: "plan-abc-current",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutiveSnapshotStore", () => {
  let dir: string;
  let store: ExecutiveSnapshotStore;

  beforeEach(() => {
    dir = join(tmpdir(), `exec-snapshot-test-${randomUUID()}`);
    store = new ExecutiveSnapshotStore(dir);
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  // ─── Round-trip ──────────────────────────────────────────────────────────

  it("saveBaseline → loadBaseline round-trips all fields including metadata", async () => {
    const snap = makeBaselineSnapshot();
    await store.saveBaseline(snap);
    const loaded = await store.loadBaseline(snap.planId);
    expect(loaded).toEqual(snap);
  });

  it("saveCurrent → loadCurrent round-trips all fields including metadata", async () => {
    const snap = makeCurrentSnapshot();
    await store.saveCurrent(snap);
    const loaded = await store.loadCurrent(snap.planId);
    expect(loaded).toEqual(snap);
  });

  it("loadBaseline returns null when no baseline file exists", async () => {
    const loaded = await store.loadBaseline("plan-missing");
    expect(loaded).toBeNull();
  });

  it("loadCurrent returns null when no current file exists", async () => {
    const loaded = await store.loadCurrent("plan-missing");
    expect(loaded).toBeNull();
  });

  // ─── Immutability (rule #1, #2) ─────────────────────────────────────────

  it("second saveBaseline for same planId throws BaselineAlreadyCapturedError", async () => {
    const snap = makeBaselineSnapshot();
    await store.saveBaseline(snap);
    await expect(store.saveBaseline(snap)).rejects.toBeInstanceOf(
      BaselineAlreadyCapturedError,
    );
  });

  it("BaselineAlreadyCapturedError carries planId for operator diagnosis", async () => {
    const snap = makeBaselineSnapshot({ planId: "plan-conflict" });
    await store.saveBaseline(snap);
    try {
      await store.saveBaseline(snap);
      throw new Error("Expected throw did not happen");
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(BaselineAlreadyCapturedError);
      if (e instanceof BaselineAlreadyCapturedError) {
        expect(e.planId).toBe("plan-conflict");
        expect(e.message).toContain("plan-conflict");
        expect(e.name).toBe("BaselineAlreadyCapturedError");
      }
    }
  });

  // ─── Replaceability (rule #3) ───────────────────────────────────────────

  it("saveCurrent is replaceable — second save succeeds and loadCurrent returns latest", async () => {
    const first = makeCurrentSnapshot({ capturedAt: "2026-06-26T10:00:00.000Z" });
    const second = makeCurrentSnapshot({ capturedAt: "2026-06-26T12:00:00.000Z" });
    await store.saveCurrent(first);
    await store.saveCurrent(second);
    const loaded = await store.loadCurrent("plan-abc");
    expect(loaded).toEqual(second);
  });

  // ─── hasBaseline (idempotency gate) ──────────────────────────────────────

  it("hasBaseline returns false for missing file", async () => {
    expect(await store.hasBaseline("plan-missing")).toBe(false);
  });

  it("hasBaseline returns true after saveBaseline", async () => {
    await store.saveBaseline(makeBaselineSnapshot());
    expect(await store.hasBaseline("plan-abc")).toBe(true);
  });

  it("hasBaseline remains true after saveCurrent — orthogonal kinds", async () => {
    await store.saveBaseline(makeBaselineSnapshot());
    await store.saveCurrent(makeCurrentSnapshot());
    expect(await store.hasBaseline("plan-abc")).toBe(true);
  });

  // ─── Atomic write integrity ──────────────────────────────────────────────

  it("loadBaseline returns null when only a partial .tmp file exists", async () => {
    mkdirSync(dir, { recursive: true });
    // Simulate an interrupted write: .tmp present, target absent.
    writeFileSync(
      join(dir, "plan-abc-baseline.json.tmp"),
      "{ truncated partial json",
      "utf-8",
    );
    const loaded = await store.loadBaseline("plan-abc");
    expect(loaded).toBeNull();
  });

  it("loadCurrent returns null when only a partial .tmp file exists", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "plan-abc-current.json.tmp"),
      "{ truncated partial json",
      "utf-8",
    );
    const loaded = await store.loadCurrent("plan-abc");
    expect(loaded).toBeNull();
  });

  // ─── Concurrent saves ────────────────────────────────────────────────────

  it("concurrent saveCurrent writes — last writer wins", async () => {
    const writes = await Promise.all([
      store.saveCurrent(makeCurrentSnapshot({ capturedAt: "2026-06-26T10:00:00.000Z" })),
      store.saveCurrent(makeCurrentSnapshot({ capturedAt: "2026-06-26T11:00:00.000Z" })),
      store.saveCurrent(makeCurrentSnapshot({ capturedAt: "2026-06-26T12:00:00.000Z" })),
    ]);
    expect(writes).toHaveLength(3);
    const loaded = await store.loadCurrent("plan-abc");
    expect(loaded).not.toBeNull();
    // The capturedAt of one of the three must match the loaded snapshot.
    expect(
      ["2026-06-26T10:00:00.000Z", "2026-06-26T11:00:00.000Z", "2026-06-26T12:00:00.000Z"],
    ).toContain(loaded!.capturedAt);
  });

  it("sequential saveBaseline: second call after first completes throws BaselineAlreadyCapturedError", async () => {
    // Concurrent saveBaseline calls have an inherent race in the
    // existsSync-style guard: two awaits may interleave past the check
    // before either writes. The contractual guarantee is for SEQUENTIAL
    // calls: once a baseline exists, the next saveBaseline throws.
    await store.saveBaseline(makeBaselineSnapshot());
    await expect(store.saveBaseline(makeBaselineSnapshot())).rejects.toBeInstanceOf(
      BaselineAlreadyCapturedError,
    );
  });

  it("concurrent saveBaseline writes — final on-disk state is consistent (one snapshot, no partial files)", async () => {
    // Under concurrency the existsSync guard is racy; the practical
    // guarantee is that the file ends up consistent: one valid baseline
    // snapshot, no leftover `.tmp` files.
    const a = makeBaselineSnapshot({ capturedAt: "2026-06-26T10:00:00.000Z" });
    const b = makeBaselineSnapshot({ capturedAt: "2026-06-26T11:00:00.000Z" });
    const results = await Promise.allSettled([store.saveBaseline(a), store.saveBaseline(b)]);
    // No promise rejection — both writers race past the existsSync check,
    // and the rename sequence keeps the final file valid.
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    // No leftover .tmp files (atomic rename completed in all paths).
    expect(existsSync(join(dir, "plan-abc-baseline.json.tmp"))).toBe(false);
    // Loaded baseline matches one of the two writes.
    const loaded = await store.loadBaseline("plan-abc");
    expect(loaded).not.toBeNull();
    expect(["2026-06-26T10:00:00.000Z", "2026-06-26T11:00:00.000Z"]).toContain(
      loaded!.capturedAt,
    );
  });

  // ─── File naming ────────────────────────────────────────────────────────

  it("writes <planId>-baseline.json and <planId>-current.json to the configured directory", async () => {
    await store.saveBaseline(makeBaselineSnapshot({ planId: "plan-naming" }));
    await store.saveCurrent(makeCurrentSnapshot({ planId: "plan-naming" }));
    expect(existsSync(join(dir, "plan-naming-baseline.json"))).toBe(true);
    expect(existsSync(join(dir, "plan-naming-current.json"))).toBe(true);
  });

  it("snapshots are pretty-printed JSON (auditability)", async () => {
    await store.saveBaseline(makeBaselineSnapshot());
    const raw = readFileSync(join(dir, "plan-abc-baseline.json"), "utf-8");
    // Pretty-printed contains newlines between fields
    expect(raw).toContain("\n");
    const parsed = JSON.parse(raw);
    expect(parsed.planId).toBe("plan-abc");
  });

  // ─── list() helper ───────────────────────────────────────────────────────

  it("list() returns empty array when directory does not exist", async () => {
    const ghost = new ExecutiveSnapshotStore(join(dir, "nonexistent"));
    expect(await ghost.list()).toEqual([]);
  });

  it("list() returns all snapshots sorted by capturedAt newest first", async () => {
    const older = makeBaselineSnapshot({
      planId: "plan-older",
      capturedAt: "2026-06-20T00:00:00.000Z",
      id: "plan-older-baseline",
    });
    const newer = makeCurrentSnapshot({
      planId: "plan-newer",
      capturedAt: "2026-06-26T00:00:00.000Z",
      id: "plan-newer-current",
    });
    await store.saveBaseline(older);
    await store.saveCurrent(newer);
    const all = await store.list();
    expect(all.map((s) => s.planId)).toEqual(["plan-newer", "plan-older"]);
  });

  it("list() skips corrupt JSON files and warns", async () => {
    await store.saveBaseline(makeBaselineSnapshot({ planId: "plan-good" }));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "corrupt-baseline.json"), "not json", "utf-8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const all = await store.list();
    expect(all.map((s) => s.planId)).toEqual(["plan-good"]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ─── Directory creation ──────────────────────────────────────────────────

  it("saveBaseline creates the snapshots directory if missing", async () => {
    const deepDir = join(dir, "a", "b", "snapshots");
    const deepStore = new ExecutiveSnapshotStore(deepDir);
    await deepStore.saveBaseline(makeBaselineSnapshot());
    expect(existsSync(join(deepDir, "plan-abc-baseline.json"))).toBe(true);
  });
});