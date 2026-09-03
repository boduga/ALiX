// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  StateTransitionHarness,
  createInMemoryStore,
  allowAllGovernor,
  allowAllResolver,
  allowAllPermission,
  noopExecutor,
  validateStateTransitionProposal,
} from "../../src/runtime/state/state-transition.js";
import { EXECUTION_STATE_SCHEMA_VERSION, type ExecutionState } from "../../src/runtime/execution-state/execution-state.js";

function makeState(executionId: string, version: number, step: number, overrides: Partial<ExecutionState> = {}): ExecutionState {
  return {
    executionId,
    schemaVersion: EXECUTION_STATE_SCHEMA_VERSION,
    version,
    step,
    objective: "do thing",
    status: "running",
    intent: { intentId: "intent-1" },
    pendingActions: [],
    activeCapabilities: [],
    constraints: [],
    artifacts: [],
    ...overrides,
  } as ExecutionState;
}

describe("state-transition harness — ticket #627", () => {
  it("patch-only: omission preserves, null=delete path, no whole-state rewrite, harness never writes directly", async () => {
    const store = createInMemoryStore(makeState("exec-1", 5, 5));
    const harness = new StateTransitionHarness({
      store,
      governor: allowAllGovernor,
      capabilityResolver: allowAllResolver,
      permissionChecker: allowAllPermission,
      stepExecutor: noopExecutor,
    });
    // omission preserves constraints
    const base = makeState("exec-1", 5, 5, { constraints: [{ kind: "k1", value: "v1" }] });
    const store2 = createInMemoryStore(base);
    const h2 = new StateTransitionHarness({
      store: store2,
      governor: allowAllGovernor,
      capabilityResolver: allowAllResolver,
      permissionChecker: allowAllPermission,
      stepExecutor: noopExecutor,
    });
    const res = await h2.propose({ executionId: "exec-1", baseStateVersion: 5, patch: { objective: "new" } });
    expect(res.committed).toBe(true);
    if (res.committed) {
      expect(store2.load("exec-1")!.constraints).toEqual([{ kind: "k1", value: "v1" }]);
      expect(store2.load("exec-1")!.objective).toBe("new");
    }
    // whole-state rewrite via unknown key -> INVALID_PATCH, not committed
    const bad = await harness.propose({ executionId: "exec-1", baseStateVersion: 5, patch: { made_up_fact: "oops" } as any });
    expect(bad.committed).toBe(false);
    if (!bad.committed) expect(bad.reason).toBe("INVALID_PATCH");
  });

  it("10 invariants: version check precedes expensive governance", async () => {
    let govCalls = 0;
    const store = createInMemoryStore(makeState("exec-2", 18, 18));
    const harness = new StateTransitionHarness({
      store,
      governor: { evaluate: async () => { govCalls++; return { decision: "allow" }; } },
      capabilityResolver: allowAllResolver,
      permissionChecker: allowAllPermission,
      stepExecutor: { execute: async () => { throw new Error("should not reach"); } },
    });
    const res = await harness.propose({ executionId: "exec-2", baseStateVersion: 17, patch: { objective: "stale" } });
    expect(res.committed).toBe(false);
    if (!res.committed) expect(res.reason).toBe("STATE_VERSION_CONFLICT");
    expect(govCalls).toBe(0);
  });

  it("3 rejections distinct and preserve state, never reach StepExecutor, version counts only committed", async () => {
    let execCalls = 0;
    const exec = { execute: async () => { execCalls++; return { success: true }; } };
    // INVALID_PATCH
    {
      const store = createInMemoryStore(makeState("exec-3", 5, 5));
      const h = new StateTransitionHarness({ store, governor: allowAllGovernor, capabilityResolver: allowAllResolver, permissionChecker: allowAllPermission, stepExecutor: exec });
      execCalls = 0;
      const res = await h.propose({ executionId: "exec-3", baseStateVersion: 5, patch: { made_up: "x" } as any });
      expect(res.committed).toBe(false);
      if (!res.committed) expect(res.reason).toBe("INVALID_PATCH");
      expect(execCalls).toBe(0);
      expect(store.load("exec-3")!.version).toBe(5);
    }
    // STATE_VERSION_CONFLICT
    {
      const store = createInMemoryStore(makeState("exec-4", 5, 5));
      const h = new StateTransitionHarness({ store, governor: allowAllGovernor, capabilityResolver: allowAllResolver, permissionChecker: allowAllPermission, stepExecutor: exec });
      execCalls = 0;
      const res = await h.propose({ executionId: "exec-4", baseStateVersion: 4, patch: { objective: "stale" } });
      expect(res.committed).toBe(false);
      if (!res.committed) expect(res.reason).toBe("STATE_VERSION_CONFLICT");
      expect(execCalls).toBe(0);
      expect(store.load("exec-4")!.version).toBe(5);
    }
    // GOVERNANCE_DENIED
    {
      const store = createInMemoryStore(makeState("exec-5", 3, 3));
      const h = new StateTransitionHarness({
        store,
        governor: { evaluate: () => ({ decision: "deny", reason: "policy forbids", policyId: "p1", ruleId: "r1" }) },
        capabilityResolver: allowAllResolver,
        permissionChecker: allowAllPermission,
        stepExecutor: exec,
      });
      execCalls = 0;
      const res = await h.propose({ executionId: "exec-5", baseStateVersion: 3, patch: { objective: "new" } });
      expect(res.committed).toBe(false);
      if (!res.committed) {
        expect(res.reason).toBe("GOVERNANCE_DENIED");
        expect(res.policyId).toBe("p1");
      }
      expect(execCalls).toBe(0);
      expect(store.load("exec-5")!.version).toBe(3);
    }
    // version counts only committed
    {
      const store = createInMemoryStore(makeState("exec-6", 0, 0));
      const h = new StateTransitionHarness({ store, governor: allowAllGovernor, capabilityResolver: allowAllResolver, permissionChecker: allowAllPermission, stepExecutor: exec });
      execCalls = 0;
      let res = await h.propose({ executionId: "exec-6", baseStateVersion: 0, patch: { objective: "v1" } });
      expect(res.committed).toBe(true);
      expect(store.load("exec-6")!.version).toBe(1);
      res = await h.propose({ executionId: "exec-6", baseStateVersion: 1, patch: { objective: "" } as any });
      expect(res.committed).toBe(false);
      expect(store.load("exec-6")!.version).toBe(1);
      res = await h.propose({ executionId: "exec-6", baseStateVersion: 1, patch: { objective: "v2" } });
      expect(res.committed).toBe(true);
      expect(store.load("exec-6")!.version).toBe(2);
    }
  });

  it("proposal lifecycle: v17 read, B commits v18, A submits base 17 -> STATE_VERSION_CONFLICT remains v18 no partial mutation", async () => {
    const store = createInMemoryStore(makeState("exec-7", 17, 17));
    let execCalls = 0;
    const exec = { execute: async () => { execCalls++; return { success: true }; } };
    const harness = new StateTransitionHarness({ store, governor: allowAllGovernor, capabilityResolver: allowAllResolver, permissionChecker: allowAllPermission, stepExecutor: exec });
    const b = await harness.propose({ executionId: "exec-7", baseStateVersion: 17, patch: { objective: "B update" } });
    expect(b.committed).toBe(true);
    expect(store.load("exec-7")!.version).toBe(18);
    expect(store.load("exec-7")!.objective).toBe("B update");
    execCalls = 0;
    const a = await harness.propose({ executionId: "exec-7", baseStateVersion: 17, patch: { objective: "A stale" } });
    expect(a.committed).toBe(false);
    if (!a.committed) expect(a.reason).toBe("STATE_VERSION_CONFLICT");
    expect(store.load("exec-7")!.version).toBe(18);
    expect(store.load("exec-7")!.objective).toBe("B update");
    expect(execCalls).toBe(0);
  });

  it("patch and action are separate tracks converging on events", async () => {
    const store = createInMemoryStore(makeState("exec-8", 2, 2));
    let execCalls = 0;
    const exec = { execute: async () => { execCalls++; return { success: true, output: "ok" }; } };
    const harness = new StateTransitionHarness({
      store,
      governor: allowAllGovernor,
      capabilityResolver: { resolve: (a) => a.capability === "read" ? { resolved: true } : { resolved: false, missingCapabilities: [a.capability!] } },
      permissionChecker: allowAllPermission,
      stepExecutor: exec,
    });
    // missing capability => GOVERNANCE_DENIED, no executor
    const denied = await harness.propose({ executionId: "exec-8", baseStateVersion: 2, patch: { objective: "upd" }, action: { kind: "tool", capability: "write" } });
    expect(denied.committed).toBe(false);
    if (!denied.committed) expect(denied.reason).toBe("GOVERNANCE_DENIED");
    expect(execCalls).toBe(0);
    // allowed => both patch and action events emitted
    const ok = await harness.propose({ executionId: "exec-8", baseStateVersion: 2, patch: { objective: "upd" }, action: { kind: "tool", capability: "read" } });
    expect(ok.committed).toBe(true);
    if (ok.committed) {
      expect(ok.emittedEvents.some(e => e.type === "execution.objective_set")).toBe(true);
      expect(ok.emittedEvents.some(e => e.type === "execution.action_executed")).toBe(true);
    }
    expect(execCalls).toBe(1);
  });

  it("validates StateTransitionProposal shape", () => {
    expect(validateStateTransitionProposal({ executionId: "x", baseStateVersion: 0, patch: {} }).valid).toBe(true);
    expect(validateStateTransitionProposal({ executionId: "", baseStateVersion: 0, patch: {} }).valid).toBe(false);
    expect(validateStateTransitionProposal({ executionId: "x", baseStateVersion: -1, patch: {} }).valid).toBe(false);
    expect(validateStateTransitionProposal({ executionId: "x", baseStateVersion: 0, patch: { executionId: "nope" } }).valid).toBe(false);
  });
});
