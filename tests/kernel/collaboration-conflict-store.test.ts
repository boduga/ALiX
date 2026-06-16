import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CollaborationStore } from "../../src/kernel/collaboration-store.js";
import { ConflictRepository } from "../../src/kernel/collaboration-conflict-repository.js";
import type { FindingConflict, EvidenceComparison, ClaimComparison } from "../../src/kernel/collaboration-conflict-types.js";

const RUN_ID = "run_test_1";
const FINGERPRINT = "fp_001";

function evidence(): EvidenceComparison {
  return {
    ranking: [],
    confidence: "low",
    scoreMargin: 0,
    recommendation: "human_review",
    unresolvedReasons: [],
  };
}

function claimComparison(): ClaimComparison {
  return {
    leftFindingId: "fA", rightFindingId: "fB",
    compatibility: "incompatible",
    type: "contradiction",
    reasons: ["unit test"],
    comparatorVersion: "1.0.0",
  };
}

function baseInput(overrides: Partial<any> = {}): any {
  return {
    conflictFingerprint: FINGERPRINT,
    topicKey: "topic_x",
    type: "contradiction",
    findingIds: ["fA", "fB"],
    claimComparisons: [claimComparison()],
    evidenceComparison: evidence(),
    detectedBy: ["deterministic"],
    criticality: "warning",
    blocksDownstreamByPolicy: false,
    ...overrides,
  };
}

describe("ConflictRepository", () => {
  let cwd: string;
  let store: CollaborationStore;
  let repo: ConflictRepository;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "conf-repo-"));
    mkdirSync(join(cwd, ".alix", "coordination", "shared", RUN_ID), { recursive: true });
    // Pre-write a state.json with empty conflicts so CollaborationStore.loadState
    // overwrites the (module-scoped DEFAULT_STATE reference) with a fresh object.
    writeFileSync(
      join(cwd, ".alix", "coordination", "shared", RUN_ID, "state.json"),
      JSON.stringify({
        schemaVersion: "1.0", runId: RUN_ID, revision: 0,
        findings: [], artifacts: [], conflicts: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
      "utf-8",
    );
    store = new CollaborationStore(cwd, RUN_ID);
    repo = new ConflictRepository(store);
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("creates a conflict on first upsert", async () => {
    const { conflict, created } = await repo.upsertConflict(RUN_ID, baseInput());
    assert.equal(created, true);
    assert.equal(conflict.status, "detected");
    assert.equal(conflict.detectedBy.length, 1);
    assert.equal(conflict.detectedBy[0], "deterministic");
    assert.equal(conflict.history.length, 1);
    assert.equal(conflict.history[0].action, "created");
  });

  it("fingerprint dedup: second upsert with same fingerprint updates, not duplicates", async () => {
    const r1 = await repo.upsertConflict(RUN_ID, baseInput());
    const r2 = await repo.upsertConflict(RUN_ID, baseInput({ detectedBy: ["model_assisted"] }));
    assert.equal(r1.created, true);
    assert.equal(r2.created, false);
    const all = await repo.getConflicts(RUN_ID);
    assert.equal(all.length, 1);
    assert.ok(all[0].detectedBy.includes("model_assisted"));
  });

  it("update appends 'updated' to history", async () => {
    await repo.upsertConflict(RUN_ID, baseInput());
    await repo.upsertConflict(RUN_ID, baseInput());
    const all = await repo.getConflicts(RUN_ID);
    assert.equal(all.length, 1);
    const actions = all[0].history.map(h => h.action);
    assert.equal(actions[0], "created");
    assert.equal(actions[1], "updated");
  });

  it("preserves resolved history: re-upsert after resolved creates a new one", async () => {
    const r1 = await repo.upsertConflict(RUN_ID, baseInput());
    // Resolve as operator.
    const op = { kind: "operator", actorId: "op1" } as const;
    const resolved = await repo.resolveConflict(r1.conflict.id, {
      decision: "chose A", acceptedFindingIds: ["fA"], rejectedFindingIds: ["fB"],
      resolver: { kind: "operator", id: "op1" }, evidenceRefs: [], resolvedAt: new Date().toISOString(),
    }, op);
    assert.ok(resolved);
    // Re-upsert with same fingerprint after resolution → new conflict.
    const r2 = await repo.upsertConflict(RUN_ID, baseInput());
    assert.equal(r2.created, true);
    const all = await repo.getConflicts(RUN_ID);
    assert.equal(all.length, 2);
  });

  it("under_review transition", async () => {
    const { conflict } = await repo.upsertConflict(RUN_ID, baseInput());
    const r = await repo.updateConflictStatus(conflict.id, "under_review", { kind: "operator", actorId: "op" });
    assert.ok(r);
    assert.equal(r!.status, "under_review");
    const last = r!.history[r!.history.length - 1];
    assert.equal(last.action, "under_review");
  });

  it("resolve with authority", async () => {
    const { conflict } = await repo.upsertConflict(RUN_ID, baseInput());
    const r = await repo.resolveConflict(conflict.id, {
      decision: "resolved",
      acceptedFindingIds: ["fA"],
      rejectedFindingIds: ["fB"],
      resolver: { kind: "operator", id: "op" },
      evidenceRefs: [],
      resolvedAt: new Date().toISOString(),
    }, { kind: "operator", actorId: "op" });
    assert.ok(r);
    assert.equal(r!.status, "resolved");
  });

  it("unauthorized resolve is rejected (A1 fix)", async () => {
    const { conflict } = await repo.upsertConflict(RUN_ID, baseInput());
    // Worker without allowedConflictIds cannot resolve.
    const result = await repo.resolveConflict(conflict.id, {
      decision: "x",
      acceptedFindingIds: [],
      rejectedFindingIds: [],
      resolver: { kind: "worker", id: "w1" },
      evidenceRefs: [],
      resolvedAt: new Date().toISOString(),
    }, { kind: "worker", workerId: "w1" });
    assert.equal(result, null);
    // And the conflict remains detected.
    const fetched = await repo.getConflict(conflict.id);
    assert.equal(fetched!.status, "detected");
  });

  it("accept divergence (B4)", async () => {
    const { conflict } = await repo.upsertConflict(RUN_ID, baseInput());
    const r = await repo.acceptConflictDivergence(conflict.id, "we agreed to differ", { kind: "operator", actorId: "op" });
    assert.ok(r);
    assert.equal(r!.status, "accepted_divergence");
    const last = r!.history[r!.history.length - 1];
    assert.equal(last.action, "accepted_divergence");
    assert.equal(last.reason, "we agreed to differ");
  });

  it("dismiss", async () => {
    const { conflict } = await repo.upsertConflict(RUN_ID, baseInput());
    const r = await repo.updateConflictStatus(conflict.id, "dismissed", { kind: "operator", actorId: "op" });
    assert.ok(r);
    assert.equal(r!.status, "dismissed");
  });

  it("concurrent upsert with same fingerprint is safe — only one created", async () => {
    const [r1, r2] = await Promise.all([
      repo.upsertConflict(RUN_ID, baseInput()),
      repo.upsertConflict(RUN_ID, baseInput()),
    ]);
    const createdCount = [r1, r2].filter(r => r.created).length;
    assert.equal(createdCount, 1);
    const all = await repo.getConflicts(RUN_ID);
    assert.equal(all.length, 1);
  });

  it("legacy state normalized (A2 fix): state.json with no conflicts field", async () => {
    const statePath = join(cwd, ".alix", "coordination", "shared", RUN_ID, "state.json");
    writeFileSync(statePath, JSON.stringify({
      schemaVersion: "1.0",
      runId: RUN_ID,
      revision: 0,
      findings: [],
      artifacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }), "utf-8");
    // Re-open the store and assert conflicts default to [].
    const fresh = new CollaborationStore(cwd, RUN_ID);
    const all = await fresh.queryConflicts({});
    assert.deepEqual(all, []);
  });
});
