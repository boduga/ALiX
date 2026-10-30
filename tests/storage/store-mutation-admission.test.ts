import { it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalStore } from "../../src/governance/approvals/approval-store.js";
import { ApprovalStoreLock } from "../../src/governance/approvals/approval-store-lock.js";
import { CoordinationStore } from "../../src/coordination/kernel/coordination-store.js";
import { CoordinationRunLock } from "../../src/coordination/kernel/coordination-run-lock.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/coordination/kernel/coordination-types.js";
import { closeAllSharedLedgers } from "../../src/runtime-state/storage/runtime-ledger.js";

function workspace(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "store-admission-"));
  t.after(() => { closeAllSharedLedgers(); rmSync(root, { recursive: true, force: true }); });
  return root;
}
function approval(i: number) {
  return { bindingKey: `binding-${i}`, requestFingerprint: `request-${i}`, policyRevision: "test-v1",
    capabilities: ["file.write"], reason: `independent request ${i}` };
}
async function runWithWorkers(store: CoordinationStore, count: number) {
  const run = createCoordinationRun({ sessionId: "admission", rootGoal: "persist all workers", coordinatorAgentId: "coordinator" });
  run.workers = Array.from({ length: count }, (_, i) => createWorkerAssignment({
    coordinationRunId: run.id, agentId: `worker-${i}`, taskLabel: `${i}`, goalPrompt: `task ${i}`,
  }));
  await store.save(run);
  return run;
}

// Fifty separate store instances must persist fifty durable ledger facts.
it("approval instances sharing a workspace admit every independent writer", { timeout: 60_000 }, async t => {
  const root = workspace(t);
  await Promise.all(Array.from({ length: 50 }, (_, i) => new ApprovalStore(root).requestBound(approval(i))));
  closeAllSharedLedgers();
  const reopened = new ApprovalStore(root);
  await reopened.load();
  assert.equal(reopened.list().length, 50);
  assert.equal(new Set(reopened.list().map(r => r.bindingKey)).size, 50);
});

// One hundred durable worker updates traverse independent store instances.
it("coordination instances preserve all updates and CAS still rejects stale revisions", { timeout: 60_000 }, async t => {
  const root = workspace(t), store = new CoordinationStore(root);
  const run = await runWithWorkers(store, 100);
  const results = await Promise.all(run.workers.map(worker => new CoordinationStore(root).patchWorker(run.id, worker.id, { status: "completed" })));
  assert.ok(results.every(Boolean));
  const completed = await store.load(run.id);
  assert.equal(completed!.workers.filter(w => w.status === "completed").length, 100);
  const revision = completed!.planRevision;
  const revised = await Promise.all([store, new CoordinationStore(root)].map(candidate =>
    candidate.updateRunWithRevisionCheck(run.id, revision, current => { current.rootGoal = "new plan"; })));
  assert.equal(revised.filter(Boolean).length, 1);
  assert.equal((await store.load(run.id))!.planRevision, revision + 1);
});

// The real OS lock's ten-second contention bound must still deny all requests.
it("an externally held approval lock expires queued writes without granting authority", { timeout: 30_000 }, async t => {
  const root = workspace(t), store = new ApprovalStore(root), held = new ApprovalStoreLock(root);
  await store.load();
  assert.equal(await held.acquire(), true);
  try {
    const results = await Promise.allSettled([0, 1, 2].map(i => store.requestBound(approval(i))));
    assert.ok(results.every(r => r.status === "rejected"));
    await store.load();
    assert.equal(store.list().length, 0);
  } finally { held.release(); }
  await store.requestBound(approval(3));
  await store.load();
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].bindingKey, "binding-3");
});

// The per-run OS lock and queue idle window are both ten seconds.
it("an externally held coordination lock leaves workers unchanged and remains recoverable", { timeout: 30_000 }, async t => {
  const root = workspace(t), store = new CoordinationStore(root);
  const run = await runWithWorkers(store, 3), held = new CoordinationRunLock(root, run.id);
  assert.equal(await held.acquire(), true);
  try {
    const results = await Promise.all(run.workers.map(worker => store.patchWorker(run.id, worker.id, { status: "completed" })));
    assert.deepEqual(results, [null, null, null]);
    assert.ok((await store.load(run.id))!.workers.every(w => w.status === "pending"));
  } finally { held.release(); }
  assert.ok(await store.patchWorker(run.id, run.workers[0].id, { status: "completed" }));
  assert.equal((await store.load(run.id))!.workers.filter(w => w.status === "completed").length, 1);
});
