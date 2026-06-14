/**
 * execution-authorization.test.ts — Unit tests for ExecutionAuthorization.
 *
 * Tests the evaluate() pipeline: allowed, denied, approval_required,
 * ownership override, capability metadata.
 *
 * No real PolicyGate or ApprovalStore — uses minimal fakes that
 * return known decisions.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ExecutionAuthorization, type AuthorizationDeps } from "../../src/runtime/execution-authorization.js";
import { type ExecutionDecision, type ExecutionDecisionRequest, decisionAllowed, decisionDenied, decisionApprovalRequired } from "../../src/runtime/execution-decision.js";
import { CapabilityRegistry } from "../../src/policy/capability-registry.js";

// ── Fake PolicyGate ──────────────────────────────────────────────────

type FakePolicyConfig = {
  toolResult?: { decision: "allow" | "ask" | "deny"; reason?: string };
  capResult?: { decision: "allow" | "ask" | "deny"; reason?: string };
};

class FakePolicyGate {
  private config: FakePolicyConfig;
  constructor(config: FakePolicyConfig = {}) {
    this.config = config;
  }
  async evaluateToolCall(req: any) {
    return {
      requestId: req.requestId,
      capability: req.capability,
      decision: this.config.toolResult?.decision ?? "allow",
      reason: this.config.toolResult?.reason ?? "Fake allowed",
      matchedRuleId: "fake-policy",
    };
  }
  async evaluateCapability(req: any) {
    return {
      requestId: req.requestId,
      capability: req.capability,
      decision: this.config.capResult?.decision ?? "allow",
      reason: this.config.capResult?.reason ?? "Fake allowed",
      matchedRuleId: "fake-policy",
    };
  }
}

// ── Fake OwnershipGateConfig (always passes or fails) ────────────────

function makeOwnershipGate(passes: boolean): any {
  return {
    registry: {
      authorizeMutation: async () => ({ allowed: passes, reason: passes ? "ok" : "Not covered" }),
    },
    resolver: {
      check: (p: string) => ({
        absolute: p,
        insideWorkspace: true,
        sensitive: false,
        protected: false,
      }),
    },
    autoAcquire: true,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function makeRequest(overrides?: Partial<ExecutionDecisionRequest>): ExecutionDecisionRequest {
  return {
    requestId: "req-1",
    capability: "file.write",
    toolName: "file.write",
    args: { path: "/test/file.txt" },
    cwd: "/test",
    sessionMode: "ask",
    sessionId: "session-1",
    agentId: "alix",
    source: "tool",
    ...overrides,
  };
}

describe("ExecutionDecision types", () => {
  it("decisionAllowed produces allowed status", () => {
    const d = decisionAllowed();
    assert.equal(d.status, "allowed");
  });

  it("decisionDenied includes reason", () => {
    const d = decisionDenied("test reason");
    assert.equal(d.status, "denied");
    assert.equal(d.reason, "test reason");
  });

  it("decisionApprovalRequired includes approvalId and reason", () => {
    const d = decisionApprovalRequired("approval-1", "needs ok");
    assert.equal(d.status, "approval_required");
    assert.equal(d.approvalId, "approval-1");
    assert.equal(d.reason, "needs ok");
  });
});

describe("ExecutionAuthorization", () => {
  let deps: AuthorizationDeps;

  beforeEach(() => {
    deps = {
      policyGate: new FakePolicyGate() as any,
    };
  });

  it("allows when PolicyGate returns allow", async () => {
    deps.policyGate = new FakePolicyGate({ toolResult: { decision: "allow" } }) as any;
    const auth = new ExecutionAuthorization(deps);
    const result = await auth.evaluate(makeRequest());
    assert.equal(result.status, "allowed");
  });

  it("denies when PolicyGate returns deny", async () => {
    deps.policyGate = new FakePolicyGate({ toolResult: { decision: "deny", reason: "blocked" } }) as any;
    const auth = new ExecutionAuthorization(deps);
    const result = await auth.evaluate(makeRequest());
    assert.equal(result.status, "denied");
    assert.equal((result as any).reason, "blocked");
  });

  it("returns approval_required when PolicyGate returns ask", async () => {
    deps.policyGate = new FakePolicyGate({ toolResult: { decision: "ask", reason: "approval needed" } }) as any;
    const auth = new ExecutionAuthorization(deps);
    const result = await auth.evaluate(makeRequest());
    assert.equal(result.status, "approval_required");
    assert.equal((result as any).reason, "approval needed");
  });

  it("denies when ownership gate fails", async () => {
    deps.policyGate = new FakePolicyGate({ toolResult: { decision: "allow" } }) as any;
    deps.ownershipGateConfig = makeOwnershipGate(false);
    const auth = new ExecutionAuthorization(deps);
    const result = await auth.evaluate(makeRequest({ toolName: "file.write", args: { path: "/etc/passwd" } }));
    assert.equal(result.status, "denied");
    assert.match((result as any).reason || "", /ownership/i);
  });

  it("allows when ownership gate passes", async () => {
    deps.policyGate = new FakePolicyGate({ toolResult: { decision: "allow" } }) as any;
    deps.ownershipGateConfig = makeOwnershipGate(true);
    const auth = new ExecutionAuthorization(deps);
    const result = await auth.evaluate(makeRequest({ toolName: "file.write", args: { path: "/safe/file.txt" } }));
    assert.equal(result.status, "allowed");
  });

  it("uses capability metadata when registry provided", async () => {
    const capReg = new CapabilityRegistry();
    deps.policyGate = new FakePolicyGate({ toolResult: { decision: "allow" } }) as any;
    deps.capabilityRegistry = capReg;
    const auth = new ExecutionAuthorization(deps);
    const result = await auth.evaluate(makeRequest({ capability: "file.read" }));
    assert.equal(result.status, "allowed");
  });

  it("handles graph-source requests (no toolName)", async () => {
    deps.policyGate = new FakePolicyGate({ capResult: { decision: "allow" } }) as any;
    const auth = new ExecutionAuthorization(deps);
    const result = await auth.evaluate(makeRequest({
      toolName: undefined,
      source: "graph",
      nodeId: "node-1",
      graphId: "graph-1",
    }));
    assert.equal(result.status, "allowed");
  });
});
