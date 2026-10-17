import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { authorizeWorker } from "../../src/coordination/kernel/coordination-authorization.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/coordination/kernel/coordination-types.js";

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

  it("fails closed when approval_required carries no durable approval id (never 'unknown')", async () => {
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "T", goalPrompt: "do it",
      requiredCapabilities: ["file.delete"],
      attempt: 0,
    });
    // A verdict claiming approval is required but naming NO durable approval:
    // fabricating "unknown" would surface a non-existent approval as a
    // legitimate pending block (SRAP PR B).
    const auth = { evaluate: async () => ({ status: "approval_required" as const, reason: "needs ok" }) } as any;
    const result = await authorizeWorker({ authorization: auth, worker, run, cwd: "/test", sessionMode: "ask" });
    assert.equal(result.status, "denied");
    assert.notEqual((result as any).approvalId, "unknown");
    assert.match((result as any).reason, /missing approval id/i);
  });

  it("denies a REAL approval_required verdict whose only id is the 'unknown' sentinel", async () => {
    const { PolicyGate } = await import("../../src/governance/policy/policy-gate.js");
    const { ExecutionAuthorization } = await import("../../src/runtime-state/runtime/execution-authorization.js");
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "T", goalPrompt: "do it",
      requiredCapabilities: ["file.delete"],
      attempt: 0,
    });
    // Drive the REAL boundary: a PolicyGate that returns an id-less `ask`.
    // ExecutionAuthorization coerces the missing id to its legacy graph
    // sentinel "unknown"; the coordination aggregation must reject that too
    // (SRAP PR B requirement 3), not surface it as a pending approval.
    const gate = new PolicyGate({} as never, {});
    (gate as unknown as { evaluateCapability: unknown }).evaluateCapability = async () => ({
      requestId: "r-real", capability: "file.delete", decision: "ask", reason: "needs ok", matchedRuleId: "test-ask",
    });
    const auth = new ExecutionAuthorization({ policyGate: gate } as never);
    const result = await authorizeWorker({ authorization: auth, worker, run, cwd: "/test", sessionMode: "ask" });
    assert.equal(result.status, "denied");
    assert.notEqual((result as any).approvalId, "unknown");
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
