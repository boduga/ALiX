import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../src/server/server.js";
import { CollaborationStore } from "../../src/kernel/collaboration-store.js";
import { ConflictRepository } from "../../src/kernel/collaboration-conflict-repository.js";

const RUN_ID = "run_srv_1";

async function seed(root: string): Promise<string> {
  const stateDir = join(root, ".alix", "coordination", "shared", RUN_ID);
  mkdirSync(stateDir, { recursive: true });
  // Pre-write a state file so the store reads from disk (avoids the
  // DEFAULT_STATE shallow-copy issue when constructing fresh store instances).
  writeFileSync(
    join(stateDir, "state.json"),
    JSON.stringify({
      schemaVersion: "1.0", runId: RUN_ID, revision: 0,
      findings: [], artifacts: [], conflicts: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }),
    "utf-8",
  );
  const store = new CollaborationStore(root, RUN_ID);
  const repo = new ConflictRepository(store);
  const r = await repo.upsertConflict(RUN_ID, {
    conflictFingerprint: "fp_srv_1",
    topicKey: "topic_srv",
    type: "contradiction",
    findingIds: ["fA", "fB"],
    claimComparisons: [],
    evidenceComparison: {
      ranking: [], confidence: "low", scoreMargin: 0,
      recommendation: "human_review", unresolvedReasons: [],
    },
    detectedBy: ["deterministic"],
    criticality: "warning",
    blocksDownstreamByPolicy: false,
  });
  return r.conflict.id;
}

describe("Inspector coordination conflict routes", () => {
  let root: string;
  let server: { url: string; close: () => Promise<void> };
  let conflictId: string;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "alix-conflict-srv-"));
    server = await startServer(root, "127.0.0.1", 0);
    conflictId = await seed(root);
  });

  after(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("GET /api/coordination/:runId/conflicts lists conflicts", async () => {
    const res = await fetch(`${server.url}/api/coordination/${RUN_ID}/conflicts`);
    assert.equal(res.status, 200);
    const json = await res.json() as any[];
    assert.ok(Array.isArray(json));
    assert.ok(json.some(c => c.id === conflictId));
  });

  it("GET /api/coordination/:runId/conflicts/:id returns full conflict", async () => {
    const res = await fetch(`${server.url}/api/coordination/${RUN_ID}/conflicts/${conflictId}`);
    assert.equal(res.status, 200);
    const json = await res.json() as any;
    assert.equal(json.id, conflictId);
    assert.equal(json.runId, RUN_ID);
    assert.equal(json.topicKey, "topic_srv");
  });

  it("GET /api/coordination/:runId/conflicts/:id has no side-effect (mtime unchanged)", async () => {
    const { stat } = await import("node:fs/promises");
    const statePath = join(root, ".alix", "coordination", "shared", RUN_ID, "state.json");
    // Sleep long enough that any FS mtime resolution is well below our threshold.
    await new Promise(r => setTimeout(r, 50));
    const mtimeBefore = (await stat(statePath)).mtimeMs;
    // Two GETs in a row.
    const r1 = await fetch(`${server.url}/api/coordination/${RUN_ID}/conflicts/${conflictId}`);
    assert.equal(r1.status, 200);
    const r2 = await fetch(`${server.url}/api/coordination/${RUN_ID}/conflicts/${conflictId}`);
    assert.equal(r2.status, 200);
    const mtimeAfter = (await stat(statePath)).mtimeMs;
    // Strict: a read must not rewrite the state file. The ConflictRepository
    // routes its getConflicts/getConflict lookups through the read-only
    // CollaborationStore.read<T>() primitive, which never touches the file
    // mtime.
    assert.equal(mtimeAfter, mtimeBefore, "GET must not touch the state file");
  });
});
