// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Contract types ──────────────────────────────────────────────

import type {
  AgentState,
  TaskScope,
  Expansion,
  ChangeEvaluation,
  ScopeSnapshot,
  RunLimits,
  RunCounters,
  StateSnapshot,
  RunResult,
  RunTransitionContext,
  AgentContext,
} from "../../src/runtime/contracts/agent-contract.js";
import type {
  ScopeTrackerContract,
  RunLimiterContract,
  TaskStateMachineContract,
} from "../../src/runtime/contracts/agent-contract.js";
import {
  AGENT_INVARIANTS,
} from "../../src/runtime/contracts/agent-contract.js";

// ── Source types (structural comparison) ────────────────────────

import type { AgentState as SourceAgentState } from "../../src/autonomy/scope-tracker.js";
import type { TaskScope as SourceTaskScope } from "../../src/autonomy/scope-tracker.js";
import type { ScopeSnapshot as SourceScopeSnapshot } from "../../src/autonomy/scope-tracker.js";
import type { Expansion as SourceExpansion } from "../../src/autonomy/scope-tracker.js";
import type { ChangeEvaluation as SourceChangeEvaluation } from "../../src/autonomy/scope-tracker.js";
import type { RunLimits as SourceRunLimits } from "../../src/autonomy/state-machine.js";
import type { RunCounters as SourceRunCounters } from "../../src/autonomy/state-machine.js";
import type { StateSnapshot as SourceStateSnapshot } from "../../src/autonomy/state-machine.js";
import type { RunResult as SourceRunResult } from "../../src/autonomy/state-machine.js";
import type { AgentContext as SourceAgentContext } from "../../src/agent/agent.js";

import { ScopeTracker } from "../../src/autonomy/scope-tracker.js";
import { RunLimiter, TaskStateMachine } from "../../src/autonomy/state-machine.js";

// ── Tests ───────────────────────────────────────────────────────

describe("M1.2 — Agent Contract", () => {
  // ── AgentState (10 states) ───────────────────────────────────

  it("AgentState has exactly 10 states matching scope-tracker.ts", () => {
    assert.equal(AGENT_INVARIANTS.totalStates, 10);
    assert.equal(AGENT_INVARIANTS.states.length, 10);

    const expected: readonly string[] = [
      "idle",
      "planning",
      "executing",
      "verifying",
      "repairing",
      "summarizing",
      "waiting_approval",
      "completed",
      "failed",
      "stopped",
    ];
    assert.deepEqual([...AGENT_INVARIANTS.states], expected);
  });

  it("AgentState contract type matches source type (assignability)", () => {
    // Structural type check: contract AgentState = source AgentState
    const sourceToContract = <T extends SourceAgentState>(s: T): AgentState => s;
    const contractToSource = <T extends AgentState>(s: T): SourceAgentState => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("AgentState covers all 10 values at runtime", () => {
    const states: AgentState[] = [
      "idle",
      "planning",
      "executing",
      "verifying",
      "repairing",
      "summarizing",
      "waiting_approval",
      "completed",
      "failed",
      "stopped",
    ];
    assert.equal(states.length, 10);
    // Verify each state is assignable to the literal string type of the source
    for (const state of states) {
      const _source: SourceAgentState = state;
      assert.ok(_source, `state "${state}" is valid AgentState`);
    }
  });

  // ── TaskScope ────────────────────────────────────────────────

  it("TaskScope contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceTaskScope>(s: T): TaskScope => s;
    const contractToSource = <T extends TaskScope>(s: T): SourceTaskScope => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("TaskScope shape matches at runtime", () => {
    const scope: TaskScope = { goal: "test", files: ["a.ts"] };
    assert.equal(typeof scope.goal, "string");
    assert.ok(Array.isArray(scope.files));
    assert.equal(scope.files[0], "a.ts");
    // approvedAt is optional
    assert.equal(scope.approvedAt, undefined);
  });

  // ── Expansion ────────────────────────────────────────────────

  it("Expansion contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceExpansion>(s: T): Expansion => s;
    const contractToSource = <T extends Expansion>(s: T): SourceExpansion => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  // ── ChangeEvaluation ─────────────────────────────────────────

  it("ChangeEvaluation contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceChangeEvaluation>(s: T): ChangeEvaluation => s;
    const contractToSource = <T extends ChangeEvaluation>(s: T): SourceChangeEvaluation => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  // ── ScopeSnapshot ────────────────────────────────────────────

  it("ScopeSnapshot contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceScopeSnapshot>(s: T): ScopeSnapshot => s;
    const contractToSource = <T extends ScopeSnapshot>(s: T): SourceScopeSnapshot => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  // ── RunLimits ────────────────────────────────────────────────

  it("RunLimits contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceRunLimits>(s: T): RunLimits => s;
    const contractToSource = <T extends RunLimits>(s: T): SourceRunLimits => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("RunLimits shape has all 5 limit fields", () => {
    const limits: RunLimits = {
      maxIterations: 10,
      maxRepairs: 3,
      maxFileChanges: 50,
      maxShellCommands: 100,
      maxRuntimeMs: 300_000,
    };
    assert.equal(typeof limits.maxIterations, "number");
    assert.equal(typeof limits.maxRepairs, "number");
    assert.equal(typeof limits.maxFileChanges, "number");
    assert.equal(typeof limits.maxShellCommands, "number");
    assert.equal(typeof limits.maxRuntimeMs, "number");
  });

  // ── RunCounters ──────────────────────────────────────────────

  it("RunCounters contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceRunCounters>(s: T): RunCounters => s;
    const contractToSource = <T extends RunCounters>(s: T): SourceRunCounters => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("RunCounters shape has all 5 counter fields", () => {
    const counters: RunCounters = {
      iterations: 0,
      repairs: 0,
      fileChanges: 0,
      shellCommands: 0,
      runtimeMs: 0,
    };
    assert.equal(typeof counters.iterations, "number");
    assert.equal(typeof counters.repairs, "number");
    assert.equal(typeof counters.fileChanges, "number");
    assert.equal(typeof counters.shellCommands, "number");
    assert.equal(typeof counters.runtimeMs, "number");
  });

  // ── StateSnapshot ────────────────────────────────────────────

  it("StateSnapshot contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceStateSnapshot>(s: T): StateSnapshot => s;
    const contractToSource = <T extends StateSnapshot>(s: T): SourceStateSnapshot => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  // ── RunResult ────────────────────────────────────────────────

  it("RunResult contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceRunResult>(s: T): RunResult => s;
    const contractToSource = <T extends RunResult>(s: T): SourceRunResult => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("RunResult shape matches at runtime", () => {
    const counters: RunCounters = { iterations: 1, repairs: 0, fileChanges: 2, shellCommands: 3, runtimeMs: 5000 };
    const result: RunResult = { success: true, reason: "completed", state: "completed", counters };
    assert.equal(result.success, true);
    assert.equal(result.reason, "completed");
    assert.equal(result.state, "completed");
    assert.equal(result.counters.iterations, 1);
  });

  // ── AgentContext ─────────────────────────────────────────────

  it("AgentContext contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceAgentContext>(s: T): AgentContext => s;
    const contractToSource = <T extends AgentContext>(s: T): SourceAgentContext => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  // ── ScopeTrackerContract matches ScopeTracker class ──────────

  it("ScopeTracker satisfies ScopeTrackerContract", () => {
    // Variable annotation asserts structural compatibility at compile time
    const _check: ScopeTrackerContract = null as unknown as ScopeTracker;
    assert.ok(_check !== undefined, "ScopeTracker satisfies ScopeTrackerContract");
  });

  it("ScopeTracker instance methods match ScopeTrackerContract signatures", () => {
    const proto = ScopeTracker.prototype;

    assert.equal(typeof proto.setInitialScope, "function");
    assert.equal(typeof proto.getCurrentScope, "function");
    assert.equal(typeof proto.checkMutation, "function");
    assert.equal(typeof proto.approveScope, "function");
    assert.equal(typeof proto.denyScope, "function");
    assert.equal(typeof proto.setPending, "function");
    assert.equal(typeof proto.checkExpansion, "function");
    assert.equal(typeof proto.getExpansions, "function");
    assert.equal(typeof proto.needsConfirmation, "function");
    assert.equal(typeof proto.evaluateChange, "function");
    assert.equal(typeof proto.confirmExpansion, "function");
    assert.equal(typeof proto.toJSON, "function");

    // pendingApproval is a readonly accessor (getter)
    const tracker = new ScopeTracker();
    assert.equal(typeof tracker.pendingApproval, "object"); // string | null
  });

  it("ScopeTrackerContract matches concrete behavior (setInitialScope, checkMutation, approveScope)", () => {
    const tracker: ScopeTrackerContract = new ScopeTracker();

    // No scope yet
    assert.equal(tracker.checkMutation("any.ts"), "allowed");

    // Set scope
    tracker.setInitialScope({ goal: "test", files: ["a.ts", "b.ts"] });
    assert.equal(tracker.checkMutation("a.ts"), "allowed");
    assert.equal(tracker.checkMutation("b.ts"), "allowed");

    // Out-of-scope file triggers expansion
    assert.equal(tracker.checkMutation("c.ts"), "scope_expansion");
    assert.equal(tracker.pendingApproval, "c.ts");

    // Approve it
    tracker.approveScope("c.ts");
    assert.equal(tracker.checkMutation("c.ts"), "approved");
    assert.equal(tracker.pendingApproval, null);

    // Deny a different file
    tracker.denyScope("d.ts");
    assert.equal(tracker.checkMutation("d.ts"), "denied");
  });

  it("ScopeTracker toJSON/fromJSON round-trip", () => {
    const tracker: ScopeTrackerContract = new ScopeTracker();
    tracker.setInitialScope({ goal: "roundtrip", files: ["x.ts"] });
    tracker.approveScope("x.ts");
    tracker.checkMutation("y.ts"); // triggers scope_expansion, sets pending

    // Round-trip
    const json = tracker.toJSON();
    assert.equal(json.scope?.goal, "roundtrip");
    assert.ok(json.approvedPaths.includes("x.ts"));
    assert.equal(json.pendingApproval, "y.ts");

    // Reconstruct via the static method (casts through the concrete class)
    const restored = ScopeTracker.fromJSON(json);
    assert.equal(restored.getCurrentScope()?.goal, "roundtrip");
    assert.equal(restored.checkMutation("x.ts"), "approved");
  });

  // ── RunLimiterContract matches RunLimiter class ──────────────

  it("RunLimiter satisfies RunLimiterContract", () => {
    const _check: RunLimiterContract = null as unknown as RunLimiter;
    assert.ok(_check !== undefined, "RunLimiter satisfies RunLimiterContract");
  });

  it("RunLimiter instance methods match RunLimiterContract signatures", () => {
    const limits: RunLimits = { maxIterations: 3, maxRepairs: 1, maxFileChanges: 10, maxShellCommands: 20, maxRuntimeMs: 60000 };
    const limiter = new RunLimiter(limits);

    assert.equal(typeof limiter.canTransition, "function");
    assert.equal(typeof limiter.checkCounter, "function");
  });

  it("RunLimiterContract enforces maxIterations", () => {
    const limits: RunLimits = { maxIterations: 2, maxRepairs: 1, maxFileChanges: 10, maxShellCommands: 20, maxRuntimeMs: 60000 };
    const limiter = new RunLimiter(limits);

    const ctx: RunTransitionContext = {
      state: "planning",
      counters: { iterations: 2, repairs: 0, fileChanges: 0, shellCommands: 0, runtimeMs: 1000 },
      scopeExpanded: false,
      verificationPassed: false,
      modelSignaledDone: false,
      pendingScopeFile: null,
    };

    const result = limiter.canTransition("planning", "executing", ctx);
    assert.equal(result.allowed, false);
    assert.ok(result.reason?.includes("Max iterations"));
  });

  // ── TaskStateMachineContract matches TaskStateMachine class ──

  it("TaskStateMachine satisfies TaskStateMachineContract", () => {
    const _check: TaskStateMachineContract = null as unknown as TaskStateMachine;
    assert.ok(_check !== undefined, "TaskStateMachine satisfies TaskStateMachineContract");
  });

  it("TaskStateMachine instance methods match TaskStateMachineContract signatures", () => {
    const limits: RunLimits = { maxIterations: 10, maxRepairs: 3, maxFileChanges: 50, maxShellCommands: 100, maxRuntimeMs: 300000 };
    const limiter = new RunLimiter(limits);
    const sm = new TaskStateMachine(limiter);

    assert.equal(typeof sm.tick, "function");
    assert.equal(typeof sm.recordFileChange, "function");
    assert.equal(typeof sm.recordShellCommand, "function");
    assert.equal(typeof sm.recordRepair, "function");
    assert.equal(typeof sm.toExecuting, "function");
    assert.equal(typeof sm.toVerifying, "function");
    assert.equal(typeof sm.toRepairing, "function");
    assert.equal(typeof sm.toSummarizing, "function");
    assert.equal(typeof sm.stop, "function");
    assert.equal(typeof sm.complete, "function");
    assert.equal(typeof sm.toJSON, "function");
    assert.equal(typeof sm.currentState, "string");
    assert.equal(typeof sm.snapshot, "object");
  });

  it("TaskStateMachine transitions through lifecycle", () => {
    const limits: RunLimits = { maxIterations: 10, maxRepairs: 3, maxFileChanges: 50, maxShellCommands: 100, maxRuntimeMs: 300000 };
    const limiter = new RunLimiter(limits);
    const sm = new TaskStateMachine(limiter);

    // Starts in planning
    assert.equal(sm.currentState, "planning");

    // Execute
    sm.toExecuting(false);
    assert.equal(sm.currentState, "executing");
    sm.recordFileChange();
    sm.recordShellCommand();
    sm.tick(1000);

    // Verify
    sm.toVerifying(true);
    assert.equal(sm.currentState, "verifying");

    // Repair path
    sm.toRepairing();
    assert.equal(sm.currentState, "repairing");
    sm.toVerifying(true);
    assert.equal(sm.currentState, "verifying");

    // Summarize
    sm.toSummarizing();
    assert.equal(sm.currentState, "summarizing");

    // Complete
    const result = sm.complete();
    assert.equal(result.success, true);
    assert.equal(result.state, "stopped");
  });

  it("TaskStateMachine stop produces failed RunResult", () => {
    const limits: RunLimits = { maxIterations: 1, maxRepairs: 1, maxFileChanges: 10, maxShellCommands: 20, maxRuntimeMs: 60000 };
    const limiter = new RunLimiter(limits);
    const sm = new TaskStateMachine(limiter);

    const result = sm.stop("limit_reached");
    assert.equal(result.success, false);
    assert.equal(result.state, "stopped");
    assert.equal(result.reason, "limit_reached");
    assert.ok(result.counters);
  });

  it("TaskStateMachine toJSON/fromJSON round-trip", () => {
    const limits: RunLimits = { maxIterations: 10, maxRepairs: 3, maxFileChanges: 50, maxShellCommands: 100, maxRuntimeMs: 300000 };
    const limiter = new RunLimiter(limits);
    const sm = new TaskStateMachine(limiter);

    sm.toExecuting(false);
    sm.tick(5000);
    sm.recordFileChange();

    const json = sm.toJSON();
    assert.equal(json.state, "executing");
    assert.equal(json.counters.iterations, 1);
    assert.equal(json.counters.fileChanges, 1);

    // Restore
    const restored = TaskStateMachine.fromJSON(json, limiter);
    assert.equal(restored.currentState, "executing");
    assert.equal(restored.snapshot.iterations, 1);
  });

  // ── AGENT_INVARIANTS ─────────────────────────────────────────

  it("AGENT_INVARIANTS documents all invariants", () => {
    assert.equal(AGENT_INVARIANTS.totalStates, 10);
    assert.equal(AGENT_INVARIANTS.noConcurrentStates, true);
    assert.equal(AGENT_INVARIANTS.scopeGovernsMutation, true);
    assert.equal(AGENT_INVARIANTS.limitsEnforcedAtTransitions, true);
    assert.equal(AGENT_INVARIANTS.terminalSinkIsStopped, true);

    // Verify shape: all keys are literal true
    const keys = Object.keys(AGENT_INVARIANTS) as Array<keyof typeof AGENT_INVARIANTS>;
    for (const key of keys) {
      if (key === "states") {
        assert.ok(Array.isArray(AGENT_INVARIANTS.states));
        continue;
      }
      if (key === "totalStates") {
        assert.equal(AGENT_INVARIANTS.totalStates, 10);
        continue;
      }
      assert.equal(AGENT_INVARIANTS[key], true, `invariant "${key}" must be true`);
    }
  });
});
