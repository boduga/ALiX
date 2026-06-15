import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFailureChains } from "../../src/kernel/coordination-failure-chain.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";

function makeRun(workers: ReturnType<typeof createWorkerAssignment>[]) {
  const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
  run.workers = workers as any;
  return run;
}

describe("buildFailureChains", () => {
  it("returns empty for all-successful run", () => {
    const w1 = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a1", taskLabel: "A", goalPrompt: "a", status: "completed" });
    const run = makeRun([w1]);
    assert.deepEqual(buildFailureChains(run), []);
  });

  it("finds single root failure with direct dependent", () => {
    const w1 = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a1", taskLabel: "Root", goalPrompt: "root", status: "failed", id: "w1" });
    const w2 = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a2", taskLabel: "Dep", goalPrompt: "dep", status: "blocked", blockReason: "dependency_failed", dependencies: ["w1"], id: "w2" });
    const run = makeRun([w1, w2]);
    const chains = buildFailureChains(run);
    assert.equal(chains.length, 1);
    assert.equal(chains[0].rootWorkerId, "w1");
    assert.deepEqual(chains[0].directDependents, ["w2"]);
    assert.deepEqual(chains[0].allAffectedWorkers, ["w2"]);
  });

  it("finds transitive chain with depth", () => {
    const w1 = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a1", taskLabel: "A", goalPrompt: "a", status: "failed", id: "w1" });
    const w2 = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a2", taskLabel: "B", goalPrompt: "b", status: "blocked", blockReason: "dependency_failed", dependencies: ["w1"], id: "w2" });
    const w3 = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a3", taskLabel: "C", goalPrompt: "c", status: "blocked", blockReason: "dependency_failed", dependencies: ["w2"], id: "w3" });
    const run = makeRun([w1, w2, w3]);
    const chains = buildFailureChains(run);
    assert.equal(chains.length, 1);
    assert.equal(chains[0].rootWorkerId, "w1");
    assert.deepEqual(chains[0].allAffectedWorkers, ["w2", "w3"]);
    assert.equal(chains[0].depthByWorker["w3"], 2);
  });

  it("supports multiple independent roots", () => {
    const w1 = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a1", taskLabel: "A", goalPrompt: "a", status: "failed", id: "w1" });
    const w2 = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a2", taskLabel: "B", goalPrompt: "b", status: "failed", id: "w2" });
    const w3 = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a3", taskLabel: "C", goalPrompt: "c", status: "blocked", blockReason: "dependency_failed", dependencies: ["w1"], id: "w3" });
    const w4 = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a4", taskLabel: "D", goalPrompt: "d", status: "blocked", blockReason: "dependency_failed", dependencies: ["w2"], id: "w4" });
    const run = makeRun([w1, w2, w3, w4]);
    assert.equal(buildFailureChains(run).length, 2);
  });

  it("ignores dependency-blocked workers as roots", () => {
    const w1 = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a1", taskLabel: "A", goalPrompt: "a", status: "failed", id: "w1" });
    const w2 = createWorkerAssignment({ coordinationRunId: "r1", agentId: "a2", taskLabel: "B", goalPrompt: "b", status: "blocked", blockReason: "dependency_failed", dependencies: ["w1"], id: "w2" });
    const run = makeRun([w1, w2]);
    const chains = buildFailureChains(run);
    assert.equal(chains.length, 1);
    assert.equal(chains[0].rootWorkerId, "w1");
  });
});
