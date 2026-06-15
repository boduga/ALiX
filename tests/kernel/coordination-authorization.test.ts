import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { authorizeWorker } from "../../src/kernel/coordination-authorization.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";

describe("authorizeWorker", () => {
  let run: ReturnType<typeof createCoordinationRun>;

  beforeEach(() => {
    run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
  });

  it("denies workers with no capabilities", async () => {
    const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "T", goalPrompt: "do it" });
    const auth = { evaluate: async () => ({ status: "allowed" as const }) } as any;
    const result = await authorizeWorker({ authorization: auth, worker, run, cwd: "/test", sessionMode: "bypass" });
    assert.equal(result.status, "denied");
  });

  it("allows when all capabilities allowed", async () => {
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "T", goalPrompt: "do it",
      requiredCapabilities: ["file.read"],
      attempt: 0,
    });
    const auth = { evaluate: async () => ({ status: "allowed" as const }) } as any;
    const result = await authorizeWorker({ authorization: auth, worker, run, cwd: "/test", sessionMode: "bypass" });
    assert.equal(result.status, "allowed");
    assert.equal(result.evidence.decisions.length, 1);
  });

  it("denies when any capability is denied", async () => {
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "T", goalPrompt: "do it",
      requiredCapabilities: ["file.read", "file.write"],
      attempt: 0,
    });
    let callCount = 0;
    const auth = { evaluate: async () => {
      callCount++;
      return { status: callCount === 2 ? ("denied" as const) : ("allowed" as const), reason: "blocked" };
    }} as any;
    const result = await authorizeWorker({ authorization: auth, worker, run, cwd: "/test", sessionMode: "bypass" });
    assert.equal(result.status, "denied");
  });

  it("returns approval_required when any capability needs approval", async () => {
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "T", goalPrompt: "do it",
      requiredCapabilities: ["file.read", "file.delete"],
      attempt: 0,
    });
    let callCount = 0;
    const auth = { evaluate: async () => {
      callCount++;
      return callCount === 2
        ? { status: "approval_required" as const, approvalId: "apr-1", reason: "needs ok" }
        : { status: "allowed" as const };
    }} as any;
    const result = await authorizeWorker({ authorization: auth, worker, run, cwd: "/test", sessionMode: "ask" });
    assert.equal(result.status, "approval_required");
    assert.equal((result as any).approvalId, "apr-1");
  });

  it("evidence includes every evaluated capability", async () => {
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "T", goalPrompt: "do it",
      requiredCapabilities: ["file.read", "file.create"],
      attempt: 0,
    });
    const decisions: { capability: string; decision: string }[] = [];
    const auth = { evaluate: async (req: any) => {
      decisions.push({ capability: req.capability, decision: "allowed" });
      return { status: "allowed" as const };
    }} as any;
    const result = await authorizeWorker({ authorization: auth, worker, run, cwd: "/test", sessionMode: "bypass" });
    assert.equal(result.evidence.decisions.length, 2);
    assert.equal(result.evidence.decisions[0].capability, "file.read");
    assert.equal(result.evidence.decisions[1].capability, "file.create");
  });

  it("evaluates capabilities in deterministic order", async () => {
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "T", goalPrompt: "do it",
      requiredCapabilities: ["z.last", "a.first"],
      attempt: 0,
    });
    const caps: string[] = [];
    const auth = { evaluate: async (req: any) => {
      caps.push(req.capability);
      return { status: "allowed" as const };
    }} as any;
    await authorizeWorker({ authorization: auth, worker, run, cwd: "/test", sessionMode: "bypass" });
    assert.deepEqual(caps, ["z.last", "a.first"]); // preserves input order
  });
});
