// tests/governance/approval-workflow.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildApprovalWorkflow,
  approveGate,
  denyGate,
  isWorkflowApproved,
  type ApprovalWorkflowInput,
  type ApprovalGateName,
} from "../../src/governance/approval-workflow.js";

// ---------------------------------------------------------------------------
// buildApprovalWorkflow
// ---------------------------------------------------------------------------

describe("buildApprovalWorkflow", () => {
  it("low risk creates verification + pr + merge gates", () => {
    const r = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" });
    assert.strictEqual(r.required, true);
    const names = r.gates.map((g) => g.gate);
    assert.ok(names.includes("verification"));
    assert.ok(names.includes("pr"));
    assert.ok(names.includes("merge"));
    assert.ok(!names.includes("proposal"));
    assert.ok(!names.includes("file_scope"));
    assert.ok(r.gates.every((g) => g.status === "pending"));
  });

  it("medium risk adds proposal gate", () => {
    const r = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "medium" });
    const names = r.gates.map((g) => g.gate);
    assert.ok(names.includes("proposal"));
    assert.ok(names.includes("verification"));
    assert.ok(names.includes("pr"));
    assert.ok(names.includes("merge"));
  });

  it("high risk adds file_scope gate", () => {
    const r = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "high" });
    const names = r.gates.map((g) => g.gate);
    assert.ok(names.includes("file_scope"));
    assert.ok(names.includes("proposal"));
    assert.ok(names.includes("verification"));
    assert.ok(names.includes("pr"));
    assert.ok(names.includes("merge"));
  });

  it("critical risk includes all gates", () => {
    const r = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "critical" });
    const names = r.gates.map((g) => g.gate);
    const allGates: ApprovalGateName[] = ["proposal", "file_scope", "verification", "pr", "merge"];
    for (const g of allGates) {
      assert.ok(names.includes(g), `Expected ${g} in gates`);
    }
  });

  it("policy deny returns not required with no gates", () => {
    const r = buildApprovalWorkflow({ policyDecision: "deny", riskLevel: "critical" });
    assert.strictEqual(r.required, false);
    assert.deepStrictEqual(r.gates, []);
    assert.ok(r.reason.includes("Blocked by policy"));
  });

  it("requires_approval includes all gates regardless of risk", () => {
    const r = buildApprovalWorkflow({ policyDecision: "requires_approval", riskLevel: "low" });
    const names = r.gates.map((g) => g.gate);
    const allGates: ApprovalGateName[] = ["proposal", "file_scope", "verification", "pr", "merge"];
    for (const g of allGates) {
      assert.ok(names.includes(g), `Expected ${g} in gates under requires_approval`);
    }
  });

  it("deterministic: same input → same output", () => {
    const input: ApprovalWorkflowInput = { policyDecision: "allow", riskLevel: "high" };
    const r1 = buildApprovalWorkflow(input);
    const r2 = buildApprovalWorkflow(input);
    assert.deepStrictEqual(r1, r2);
  });

  it("emits gates in deterministic governance order", () => {
    const r = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "critical" });
    assert.deepStrictEqual(
      r.gates.map((g) => g.gate),
      ["proposal", "file_scope", "verification", "pr", "merge"],
    );
  });
});

// ---------------------------------------------------------------------------
// approveGate
// ---------------------------------------------------------------------------

describe("approveGate", () => {
  const baseInput: ApprovalWorkflowInput = { policyDecision: "allow", riskLevel: "medium" };

  it("approves a single gate and leaves others pending", () => {
    const wf = buildApprovalWorkflow(baseInput);
    const result = approveGate(wf, "verification", "test-user");
    const v = result.gates.find((g) => g.gate === "verification");
    assert.strictEqual(v!.status, "approved");
    assert.strictEqual(v!.approvedBy, "test-user");
    const others = result.gates.filter((g) => g.gate !== "verification");
    assert.ok(others.every((g) => g.status === "pending"));
  });

  it("cannot approve merge gate", () => {
    const wf = buildApprovalWorkflow(baseInput);
    const result = approveGate(wf, "merge", "anyone");
    assert.strictEqual(result.gates.find((g) => g.gate === "merge")!.status, "pending");
  });

  it("approving non-existent gate is a no-op", () => {
    const wf = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" });
    assert.strictEqual(approveGate(wf, "proposal", "u"), wf);
  });

  it("approving already approved gate is a no-op", () => {
    const wf = buildApprovalWorkflow(baseInput);
    const once = approveGate(wf, "verification", "user-a");
    const twice = approveGate(once, "verification", "user-b");
    assert.strictEqual(twice, once);
    assert.strictEqual(twice.gates.find((g) => g.gate === "verification")!.approvedBy, "user-a");
  });

  it("does not mutate original result", () => {
    const wf = buildApprovalWorkflow(baseInput);
    approveGate(wf, "verification", "user");
    assert.strictEqual(wf.gates.find((g) => g.gate === "verification")!.status, "pending");
  });

  it("output is deterministic when called repeatedly on same pending workflow", () => {
    const wf = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" });
    const r1 = approveGate(wf, "verification", "operator");
    const r2 = approveGate(wf, "verification", "operator");
    assert.deepStrictEqual(r1, r2);
  });
});

// ---------------------------------------------------------------------------
// denyGate
// ---------------------------------------------------------------------------

describe("denyGate", () => {
  it("denies a gate and adds reason", () => {
    const wf = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" });
    const result = denyGate(wf, "verification", "Tests failed");
    assert.strictEqual(result.gates.find((g) => g.gate === "verification")!.status, "denied");
    assert.strictEqual(result.gates.find((g) => g.gate === "verification")!.reason, "Tests failed");
  });

  it("denying non-existent gate is a no-op", () => {
    const wf = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" });
    assert.strictEqual(denyGate(wf, "proposal", "r"), wf);
  });

  it("denying already denied gate is a no-op", () => {
    const wf = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" });
    const once = denyGate(wf, "verification", "first");
    assert.strictEqual(denyGate(once, "verification", "second"), once);
  });

  it("does not mutate original result", () => {
    const wf = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" });
    denyGate(wf, "verification", "failed");
    assert.strictEqual(wf.gates.find((g) => g.gate === "verification")!.status, "pending");
  });
});

// ---------------------------------------------------------------------------
// isWorkflowApproved
// ---------------------------------------------------------------------------

describe("isWorkflowApproved", () => {
  it("returns false when no gates", () => {
    assert.strictEqual(isWorkflowApproved({ required: false, gates: [], reason: "" }), false);
  });

  it("returns false when gates pending", () => {
    assert.strictEqual(
      isWorkflowApproved(buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" })),
      false,
    );
  });

  it("returns false when any gate denied", () => {
    let wf = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" });
    wf = denyGate(wf, "verification", "failed");
    assert.strictEqual(isWorkflowApproved(wf), false);
  });

  it("deny policy workflow returns false (no gates)", () => {
    assert.strictEqual(
      isWorkflowApproved(buildApprovalWorkflow({ policyDecision: "deny", riskLevel: "critical" })),
      false,
    );
  });

  it("merge always pending means workflow never fully approved automatically", () => {
    // Merge gate cannot be auto-approved — this is the P12 invariant.
    // isWorkflowApproved returns false even with all other gates approved.
    let wf = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" });
    wf = approveGate(wf, "verification", "user");
    wf = approveGate(wf, "pr", "user");
    assert.strictEqual(isWorkflowApproved(wf), false);
  });
});
