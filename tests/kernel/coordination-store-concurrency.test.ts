import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";

describe("CoordinationStore concurrency", () => {
  let cwd: string;
  let store: CoordinationStore;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "store-con-")); store = new CoordinationStore(cwd); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("concurrent worker completions both survive", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);
    const w1 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "A", goalPrompt: "a" });
    const w2 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "w2", taskLabel: "B", goalPrompt: "b" });
    await store.addWorker(run.id, w1);
    await store.addWorker(run.id, w2);

    await Promise.all([
      store.patchWorker(run.id, w1.id, { status: "completed", resultRef: "out1.json" }),
      store.patchWorker(run.id, w2.id, { status: "completed", resultRef: "out2.json" }),
    ]);

    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers.find(w => w.id === w1.id)!.status, "completed");
    assert.equal(loaded!.workers.find(w => w.id === w2.id)!.status, "completed");
  });
});
