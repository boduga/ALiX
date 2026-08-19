/**
 * #407 — Governed route execution tests.
 *
 * Pins the governed lifecycle wrapper at the executeRoute seam:
 *   TaskRoute → ExecutionIntent → governor validate/authorize → state
 *   machine → executeRoute → terminal state, with one evidence record per
 *   transition and none authored by the executor.
 *
 * Invariants under test:
 *   - lifecycle sequence created → approved → running → terminal
 *   - execution cannot begin before approval (denial never reaches executor)
 *   - all five route kinds flow through the governed boundary
 *   - terminal states are immutable / illegal transitions rejected
 *   - every evidence record references exactly one intentId
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  executeRouteGoverned,
  ExecutionNotApprovedError,
  CollectingEvidenceEmitter,
} from "../../src/runtime/governed-route-executor.js";
import { ExecutionStateMachine } from "../../src/runtime/execution-state-machine.js";
import {
  ExecutionState,
  type ExecutionEvidenceEmitter,
  type ExecutionEventType,
} from "../../src/runtime/contracts/execution-runtime-contract.js";
import type { ExecutionEvidence, ExecutionIntentEvent } from "../../src/runtime/contracts/execution-intent-contract.js";
import { ExecutionGovernorImpl, type ExecutionGovernor } from "../../src/runtime/execution-governor.js";
import type { RuntimeContext, RuntimeExecutor } from "../../src/runtime/route-executor.js";
import { taskRouter, type TaskRoute } from "../../src/runtime/task-router.js";

const FIXED_NOW = "2026-08-06T00:00:00.000Z";
// Far-future intent lifetime so the governor's real-clock expiration check
// (execution-governor.ts validate: `new Date(intent.expiration) < new Date()`)
// never expires an intent created at the historical FIXED_NOW.
const FAR_FUTURE_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000;

function makeCtx(): RuntimeContext {
  return {
    cwd: "/tmp",
    sessionId: "test",
    sessionDir: "/tmp/.alix/sessions/test",
    eventLog: {} as any,
    config: { model: { provider: "mock", name: "mock-model" } } as any,
  };
}

function makeFakeExecutor(): RuntimeExecutor {
  return {
    executeDirect: async (r) => `direct:${r.prompt}`,
    executeTool: async (r) => `tool:${r.tool}`,
    executeChat: async (r) => `chat:${r.prompt}`,
    executeGroundedChat: async (r) => `grounded:${r.prompt}`,
    executeAgent: async (r) => `agent:${r.task}`,
  };
}

const TOOL_ROUTE: TaskRoute = { kind: "tool", tool: "shell.run", args: { command: "ls" } };
const CHAT_ROUTE: TaskRoute = { kind: "chat", prompt: "research docs" };
const DIRECT_ROUTE: TaskRoute = {
  kind: "direct",
  prompt: "2 + 2",
  answer: "4",
  diagnostic: { classification: "arithmetic", route: "direct", reason: "pure arithmetic" },
};
const GROUNDED_ROUTE: TaskRoute = {
  kind: "grounded_chat",
  prompt: "latest news",
  allowedTools: ["web_search"],
  diagnostic: { classification: "external_retrieval", route: "grounded_chat", reason: "needs current info" },
};
const AGENT_ROUTE: TaskRoute = {
  kind: "agent",
  task: "find SQL usage in my repo",
  diagnostic: { classification: "workspace_action", route: "agent", reason: "workspace analysis" },
};

describe("executeRouteGoverned — lifecycle sequence + evidence per transition", () => {
  const cases: Array<[string, TaskRoute, string]> = [
    ["direct", DIRECT_ROUTE, "direct:2 + 2"],
    ["tool", TOOL_ROUTE, "tool:shell.run"],
    ["chat", CHAT_ROUTE, "chat:research docs"],
    ["grounded_chat", GROUNDED_ROUTE, "grounded:latest news"],
    ["agent", AGENT_ROUTE, "agent:find SQL usage in my repo"],
  ];

  for (const [kind, route, expected] of cases) {
    it(`governs ${kind} routes: created→approved→running→succeeded with evidence per transition`, async () => {
      const out = await executeRouteGoverned(route, makeCtx(), makeFakeExecutor(), {
        now: FIXED_NOW,
        expirationMs: FAR_FUTURE_EXPIRATION_MS,
      });

      // Executor's original behavior preserved.
      assert.equal(out.result, expected);
      assert.equal(out.finalState, ExecutionState.SUCCEEDED);
      assert.ok(out.intentId.length >= 8);
      assert.ok(out.executionId.startsWith("exec-"));

      // Lifecycle evidence: 5 machine transitions (CREATED, VALIDATING,
      // READY, RUNNING, SUCCEEDED) + the governor's hashed COMPLETED
      // terminal evidence = 6 records.
      assert.equal(out.evidence.length, 6, `expected 6 evidence records, got ${out.evidence.length}`);
      const outcomes = out.evidence.map((e) => e.outcome);
      assert.deepEqual(outcomes, ["PARTIAL", "PARTIAL", "PARTIAL", "PARTIAL", "SUCCESS", "SUCCESS"]);

      // The final (governor-authored COMPLETED) record carries a proper
      // evidenceHash — tamper-evident terminal evidence (spec c3).
      const terminal = out.evidence[out.evidence.length - 1];
      assert.match(terminal.evidenceHash, /^[0-9a-f]{64}$/, "governor COMPLETED evidence must be hashed");

      // Every evidence record references exactly one intentId (invariant 7).
      for (const e of out.evidence) {
        assert.equal(e.intentId, out.intentId);
      }
    });
  }

  it("routes a real taskRouter route through the governed boundary", async () => {
    const route = await taskRouter("2 + 2");
    assert.equal(route.kind, "direct");
    const out = await executeRouteGoverned(route, makeCtx(), makeFakeExecutor(), {
        now: FIXED_NOW,
        expirationMs: FAR_FUTURE_EXPIRATION_MS,
      });
    assert.equal(out.intent.action, "arithmetic");
    assert.equal(out.result, "direct:2 + 2");
  });
});

describe("executeRouteGoverned — no execution before approval", () => {
  it("denies execution when the intent is not APPROVED and never reaches the executor", async () => {
    let executorCalled = 0;
    const executor: RuntimeExecutor = {
      executeDirect: async () => { executorCalled++; return "executed"; },
      executeTool: async () => { executorCalled++; return "executed"; },
      executeChat: async () => { executorCalled++; return "executed"; },
      executeGroundedChat: async () => { executorCalled++; return "executed"; },
      executeAgent: async () => { executorCalled++; return "executed"; },
    };

    // Governor that refuses approval: approve() succeeds but validate()
    // rejects (simulate a policy denial) — the gate must deny execution.
    const governorFactory = (events: Map<string, ExecutionIntentEvent[]>): ExecutionGovernor => {
      const base = new ExecutionGovernorImpl(events);
      return {
        approve: async () => Promise.resolve(),
        authorize: (id) => base.authorize(id),
        start: (id) => base.start(id),
        heartbeat: (id, s) => base.heartbeat(id, s),
        complete: (id, o, s) => base.complete(id, o, s),
        fail: (id, r) => base.fail(id, r),
        revoke: (id, r) => base.revoke(id, r),
        validate: async () => ({ valid: false, reason: "policy denied approval" }),
      } as ExecutionGovernor;
    };

    await assert.rejects(
      executeRouteGoverned(DIRECT_ROUTE, makeCtx(), executor, {
        now: FIXED_NOW,
        governorFactory,
      }),
      (err: unknown) => err instanceof ExecutionNotApprovedError,
    );
    assert.equal(executorCalled, 0, "executor must never run for an unapproved intent");
  });
});

describe("executeRouteGoverned — terminal states immutable / illegal transitions rejected", () => {
  it("rejects a transition out of a terminal state with a typed error", () => {
    const emitter = new CollectingEvidenceEmitter();
    const machine = new ExecutionStateMachine(emitter);
    const executionId = machine.createExecution({
      intentId: "intent-123",
      proposalId: "p",
      actor: "system",
      action: "arithmetic",
      target: "direct",
      justification: "test",
      constraints: {
        maxFilesChanged: 1,
        allowedPaths: [],
        blockedPaths: [],
        verificationRequired: false,
        allowedTools: [],
      },
      riskClass: "low",
      expectedEffect: "test",
      sourceEvidenceId: "",
      createdAt: FIXED_NOW,
      expiration: "2026-08-07T00:00:00.000Z",
      approvalReference: "auto",
      approvedBy: "governor",
      approvedAt: FIXED_NOW,
      intentHash: "h".repeat(64),
    });
    machine.transitionTo(executionId, ExecutionState.VALIDATING);
    machine.transitionTo(executionId, ExecutionState.READY);
    machine.transitionTo(executionId, ExecutionState.RUNNING);
    machine.transitionTo(executionId, ExecutionState.SUCCEEDED);

    assert.equal(machine.getStatus(executionId), ExecutionState.SUCCEEDED);
    // Terminal states are immutable — FAILED is not reachable from SUCCEEDED.
    assert.throws(
      () => machine.transitionTo(executionId, ExecutionState.FAILED),
      /Illegal transition/,
    );
  });
});

describe("executeRouteGoverned — executor failure produces FAILED lifecycle", () => {
  it("marks the execution FAILED and emits a FAILED evidence record", async () => {
    const executor: RuntimeExecutor = {
      executeDirect: async () => { throw new Error("provider down"); },
      executeTool: async () => { throw new Error("provider down"); },
      executeChat: async () => { throw new Error("provider down"); },
      executeGroundedChat: async () => { throw new Error("provider down"); },
      executeAgent: async () => { throw new Error("provider down"); },
    };

    await assert.rejects(
      executeRouteGoverned(DIRECT_ROUTE, makeCtx(), executor, {
        now: FIXED_NOW,
        expirationMs: FAR_FUTURE_EXPIRATION_MS,
      }),
      /provider down/,
    );

    // Re-run with a capturing collector to assert the FAILED terminal evidence.
    const collector = new CollectingEvidenceEmitter();
    const deps = { now: FIXED_NOW, emitter: collector, expirationMs: FAR_FUTURE_EXPIRATION_MS };
    await assert.rejects(
      executeRouteGoverned(DIRECT_ROUTE, makeCtx(), executor, deps),
      /provider down/,
    );
    const last = collector.emitted[collector.emitted.length - 1];
    assert.equal(last.outcome, "FAILED");
    // 5 machine transitions + the governor's hashed FAILED terminal evidence.
    assert.equal(collector.emitted.length, 6);
    assert.match(last.evidenceHash, /^[0-9a-f]{64}$/, "governor FAILED evidence must be hashed");
  });
});

// ── CollectingEvidenceEmitter contract (used by the wrapper by default) ──

describe("CollectingEvidenceEmitter", () => {
  it("collects evidence records", () => {
    const emitter = new CollectingEvidenceEmitter();
    const evidence: ExecutionEvidence = {
      evidenceId: "ev-1",
      intentId: "intent-1",
      startedAt: FIXED_NOW,
      completedAt: FIXED_NOW,
      outcome: "SUCCESS",
      summary: "s",
      artifacts: [],
      verificationPassed: true,
      evidenceHash: "h".repeat(64),
    };
    emitter.emit("ExecutionCreated" as ExecutionEventType, evidence);
    assert.equal(emitter.emitted.length, 1);
    assert.equal(emitter.emitted[0].evidenceId, "ev-1");
  });
});
