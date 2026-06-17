import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { createCoordinationRun } from "../../src/kernel/coordination-types.js";

describe("CoordinationStore updateRunWithRevisionCheck", () => {
  let cwd: string;
  let store: CoordinationStore;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "store-replan-")); store = new CoordinationStore(cwd); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("applies mutate when revision matches (happy path)", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    assert.equal(run.planRevision, 0);
    await store.save(run);

    const updated = await store.updateRunWithRevisionCheck(run.id, 0, (r) => {
      r.rootGoal = "updated goal";
    });

    assert(updated !== null);
    assert.equal(updated!.rootGoal, "updated goal");
    assert.equal(updated!.planRevision, 1);
  });

  it("returns null when revision does not match (CAS guard)", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);

    // Bump revision to 1 manually
    const loaded = await store.load(run.id);
    loaded!.planRevision = 1;
    await store.save(loaded!);

    // Try with expectedRevision=0 — should fail
    const result = await store.updateRunWithRevisionCheck(run.id, 0, (r) => {
      r.rootGoal = "should not apply";
    });

    assert.equal(result, null);

    // Verify the mutate did not apply
    const after = await store.load(run.id);
    assert.equal(after!.rootGoal, "test");
    assert.equal(after!.planRevision, 1);
  });

  it("increments planRevision after successful apply", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);

    const updated = await store.updateRunWithRevisionCheck(run.id, 0, (r) => {
      r.rootGoal = "v1";
    });
    assert.equal(updated!.planRevision, 1);

    const updated2 = await store.updateRunWithRevisionCheck(run.id, 1, (r) => {
      r.rootGoal = "v2";
    });
    assert.equal(updated2!.planRevision, 2);

    const updated3 = await store.updateRunWithRevisionCheck(run.id, 2, (r) => {
      r.rootGoal = "v3";
    });
    assert.equal(updated3!.planRevision, 3);

    // Verify the correct goal was applied at each step
    const final = await store.load(run.id);
    assert.equal(final!.rootGoal, "v3");
    assert.equal(final!.planRevision, 3);
  });

  it("concurrent calls: second call with stale expectedRevision returns null", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);

    // Simulate two concurrent replanning attempts
    const [result1, result2] = await Promise.all([
      store.updateRunWithRevisionCheck(run.id, 0, (r) => {
        r.rootGoal = "from-first";
      }),
      store.updateRunWithRevisionCheck(run.id, 0, (r) => {
        r.rootGoal = "from-second";
      }),
    ]);

    // Exactly one should succeed and one should return null
    const successCount = [result1, result2].filter(r => r !== null).length;
    const failureCount = [result1, result2].filter(r => r === null).length;
    assert.equal(successCount, 1);
    assert.equal(failureCount, 1);

    // The winner should have planRevision=1
    const winner = result1 !== null ? result1 : result2;
    assert.equal(winner!.planRevision, 1);

    // The loser should return null (CAS guard caught it)
    const loaded = await store.load(run.id);
    assert.ok(loaded!.rootGoal === "from-first" || loaded!.rootGoal === "from-second");
    assert.equal(loaded!.planRevision, 1);
  });

  it("existing updateRun still works unchanged (sanity check)", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);

    const updated = await store.updateRun(run.id, (r) => {
      r.rootGoal = "via-updateRun";
    });

    assert(updated !== null);
    assert.equal(updated!.rootGoal, "via-updateRun");

    const loaded = await store.load(run.id);
    assert.equal(loaded!.rootGoal, "via-updateRun");

    // updateRunWithRevisionCheck should still see the current revision
    const casUpdated = await store.updateRunWithRevisionCheck(run.id, 0, (r) => {
      r.rootGoal = "via-revision-check";
    });

    assert(casUpdated !== null);
    assert.equal(casUpdated!.rootGoal, "via-revision-check");
    assert.equal(casUpdated!.planRevision, 1);
  });
});
