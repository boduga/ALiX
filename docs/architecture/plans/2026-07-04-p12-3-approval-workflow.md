# P12.3 Approval Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given policy + risk, determine what approval gates are required and manage their state — a pure gate-state machine with no ledger writes, no persistence, no orchestration coupling.

**Architecture:** Pure functions only — `buildApprovalWorkflow`, `approveGate`, `denyGate`, `isWorkflowApproved`. No DB, no side effects, no P11 chain coupling. P12.4 owns durable storage.

**Tech Stack:** TypeScript 5.9, Node 24, pnpm, existing governance CLI (`src/cli/commands/governance.ts`)

## Global Constraints

- No DB, no side effects, no persistence — pure functions only
- No risk re-scoring (that's P12.2)
- No policy re-evaluation (that's P12.1)
- No ledger writes (that's P12.4)
- `merge` gate cannot be auto-approved via `approveGate()` — never autonomous
- Immutable state transitions — every function returns a new `ApprovalWorkflowResult`
- All tests use `node:test` + `node:assert/strict`

---
## File Structure

```
src/governance/
  approval-workflow.ts           — Types, gate rules, pure functions, CLI handler

tests/governance/
  approval-workflow.test.ts      — Unit tests

src/cli/commands/
  governance.ts                  — Add 'approval' subcommand (modify)
```

---

### Task 1: Create approval workflow module

**Files:**
- Create: `src/governance/approval-workflow.ts`
- Test: `tests/governance/approval-workflow.test.ts`

**Interfaces:**
- Produces: `ApprovalGateName`, `ApprovalGateStatus`, `ApprovalGate`, `ApprovalWorkflowInput`, `ApprovalWorkflowResult`, `buildApprovalWorkflow()`, `approveGate()`, `denyGate()`, `isWorkflowApproved()`

- [ ] **Step 1: Write buildApprovalWorkflow tests**

```typescript
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

  it("policy deny produces blocked result with no gates", () => {
    const r = buildApprovalWorkflow({ policyDecision: "deny", riskLevel: "critical" });
    assert.strictEqual(r.required, false);
    assert.deepStrictEqual(r.gates, []);
    assert.ok(r.reason.includes("Blocked by policy"));
  });

  it("requires_approval produces same gates as allow", () => {
    const allow = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "medium" });
    const req = buildApprovalWorkflow({ policyDecision: "requires_approval", riskLevel: "medium" });
    assert.strictEqual(req.gates.length, allow.gates.length);
    const allowNames = allow.gates.map((g) => g.gate).sort();
    const reqNames = req.gates.map((g) => g.gate).sort();
    assert.deepStrictEqual(reqNames, allowNames);
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
```

- [ ] **Step 2: Implement buildApprovalWorkflow**

```typescript
// src/governance/approval-workflow.ts
export type ApprovalGateName = "proposal" | "file_scope" | "verification" | "pr" | "merge";
export type ApprovalGateStatus = "pending" | "approved" | "denied";
export type PolicyDecision = "allow" | "deny" | "requires_approval";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalGate {
  gate: ApprovalGateName;
  status: ApprovalGateStatus;
  approvedBy?: string;
  approvedAt?: string;
  reason?: string;
}

export interface ApprovalWorkflowInput {
  policyDecision: PolicyDecision;
  riskLevel: RiskLevel;
}

export interface ApprovalWorkflowResult {
  required: boolean;
  gates: ApprovalGate[];
  reason: string;
}

const GATE_THRESHOLDS: Record<ApprovalGateName, RiskLevel> = {
  proposal: "medium",
  file_scope: "high",
  verification: "low",
  pr: "low",
  merge: "low",
};

const GATE_ORDER: ApprovalGateName[] = [
  "proposal",
  "file_scope",
  "verification",
  "pr",
  "merge",
];

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];

function riskLevelAtLeast(level: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_ORDER.indexOf(level) >= RISK_ORDER.indexOf(threshold);
}

function createGate(gate: ApprovalGateName, status: ApprovalGateStatus = "pending"): ApprovalGate {
  return { gate, status };
}

export function buildApprovalWorkflow(input: ApprovalWorkflowInput): ApprovalWorkflowResult {
  if (input.policyDecision === "deny") {
    return { required: false, gates: [], reason: "Blocked by policy — action denied" };
  }

  const gates: ApprovalGate[] = [];
  for (const gateName of GATE_ORDER) {
    if (riskLevelAtLeast(input.riskLevel, GATE_THRESHOLDS[gateName])) {
      gates.push(createGate(gateName));
    }
  }

  return { required: gates.length > 0, gates, reason: `${gates.length} approval gate(s) required` };
}
```

- [ ] **Step 3: Run buildApprovalWorkflow tests**

```bash
pnpm build && node --test dist/tests/governance/approval-workflow.test.js
Expected: 7 tests pass (buildApprovalWorkflow only)
```

- [ ] **Step 4: Write approveGate + denyGate + isWorkflowApproved tests**

```typescript
// Add to tests/governance/approval-workflow.test.ts

describe("approveGate", () => {
  const baseInput: ApprovalWorkflowInput = { policyDecision: "allow", riskLevel: "medium" };

  it("approves a single gate and leaves others pending", () => {
    const wf = buildApprovalWorkflow(baseInput);
    const result = approveGate(wf, "verification", "test-user");
    const v = result.gates.find((g) => g.gate === "verification");
    assert.strictEqual(v!.status, "approved");
    assert.strictEqual(v!.approvedBy, "test-user");
    assert.ok(v!.approvedAt);
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
    const once = approveGate(wf, "verification", "a");
    assert.strictEqual(approveGate(once, "verification", "b"), once);
  });

  it("does not mutate original result", () => {
    const wf = buildApprovalWorkflow(baseInput);
    approveGate(wf, "verification", "user");
    assert.strictEqual(wf.gates.find((g) => g.gate === "verification")!.status, "pending");
  });

  it("approveGate output is deterministic when called repeatedly on same pending workflow", () => {
    const wf = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" });
    const r1 = approveGate(wf, "verification", "operator");
    const r2 = approveGate(wf, "verification", "operator");
    assert.deepStrictEqual(r1, r2);
  });
});

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
});

describe("isWorkflowApproved", () => {
  it("returns false when no gates", () => {
    assert.strictEqual(isWorkflowApproved({ required: false, gates: [], reason: "" }), false);
  });

  it("returns false when gates pending", () => {
    assert.strictEqual(isWorkflowApproved(buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" })), false);
  });

  it("returns false when any gate denied", () => {
    let wf = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" });
    wf = denyGate(wf, "verification", "failed");
    assert.strictEqual(isWorkflowApproved(wf), false);
  });

  it("deny policy workflow returns false (no gates)", () => {
    assert.strictEqual(isWorkflowApproved(buildApprovalWorkflow({ policyDecision: "deny", riskLevel: "critical" })), false);
  });

  it("denyGate does not mutate original result", () => {
    const wf = buildApprovalWorkflow({ policyDecision: "allow", riskLevel: "low" });
    denyGate(wf, "verification", "failed");
    assert.strictEqual(wf.gates.find((g) => g.gate === "verification")!.status, "pending");
  });
});
```

- [ ] **Step 5: Implement approveGate, denyGate, isWorkflowApproved**

```typescript
// Add to src/governance/approval-workflow.ts

export function approveGate(
  result: ApprovalWorkflowResult,
  gateName: ApprovalGateName,
  approvedBy: string,
): ApprovalWorkflowResult {
  if (gateName === "merge") return result;

  const gateIdx = result.gates.findIndex((g) => g.gate === gateName);
  if (gateIdx === -1) return result;
  if (result.gates[gateIdx].status === "approved") return result;

  const newGates = result.gates.map((g, i) =>
    i === gateIdx
      ? { ...g, status: "approved" as ApprovalGateStatus, approvedBy }
      : { ...g },
  );
  return { ...result, gates: newGates };
}

export function denyGate(
  result: ApprovalWorkflowResult,
  gateName: ApprovalGateName,
  reason?: string,
): ApprovalWorkflowResult {
  const gateIdx = result.gates.findIndex((g) => g.gate === gateName);
  if (gateIdx === -1) return result;
  if (result.gates[gateIdx].status === "denied") return result;

  const newGates = result.gates.map((g, i) =>
    i === gateIdx ? { ...g, status: "denied" as ApprovalGateStatus, reason: reason ?? g.reason } : { ...g },
  );
  return { ...result, gates: newGates };
}

export function isWorkflowApproved(result: ApprovalWorkflowResult): boolean {
  if (result.gates.length === 0) return false;
  return result.gates.every((g) => g.status === "approved");
}
```

- [ ] **Step 6: Run full test suite**

```bash
pnpm typecheck && node --test dist/tests/governance/approval-workflow.test.js
Expected: all tests PASS
```

- [ ] **Step 7: Commit**

```bash
git add src/governance/approval-workflow.ts tests/governance/approval-workflow.test.ts
git commit -m "feat(governance): add P12.3 approval workflow types and pure functions"
```

---

### Task 2: Wire CLI subcommand

**Files:**
- Modify: `src/cli/commands/governance.ts`

- [ ] **Step 1: Add `approval` subcommand to governance handler**

```typescript
case "approval": {
  const { approvalCLI } = await import("../../governance/approval-workflow.js");
  approvalCLI(rest);
  return;
}
```

- [ ] **Step 2: Add approvalCLI function to approval-workflow.ts**

```typescript
export function approvalCLI(args: string[]): void {
  // Build from defaults — policy allows, risk low
  // Override with --policy, --risk flags
  let policyDecision = "allow";
  let riskLevel = "low";
  let jsonMode = false;

  const VALID_POLICIES = ["allow", "deny", "requires_approval"];
  const VALID_RISKS = ["low", "medium", "high", "critical"];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--policy") {
      const val = args[++i] ?? "";
      if (!VALID_POLICIES.includes(val)) {
        console.error(`Error: Invalid policy decision "${val}". Valid: ${VALID_POLICIES.join(", ")}`);
        process.exit(1);
      }
      policyDecision = val;
      continue;
    }
    if (args[i] === "--risk") {
      const val = args[++i] ?? "";
      if (!VALID_RISKS.includes(val)) {
        console.error(`Error: Invalid risk level "${val}". Valid: ${VALID_RISKS.join(", ")}`);
        process.exit(1);
      }
      riskLevel = val;
      continue;
    }
    if (args[i] === "--json") { jsonMode = true; break; }
  }

  const wf = buildApprovalWorkflow({
    policyDecision: policyDecision as PolicyDecision,
    riskLevel: riskLevel as RiskLevel,
  });

  if (jsonMode) {
    console.log(JSON.stringify(wf, null, 2));
    return;
  }

  console.log(`Approval Workflow — ${policyDecision} / ${riskLevel}`);
  console.log(`Required: ${wf.required}`);
  console.log(`Reason: ${wf.reason}`);
  console.log(`\nGates (${wf.gates.length}):`);
  for (const g of wf.gates) {
    const icon = g.status === "approved" ? "✅" : g.status === "denied" ? "❌" : "⏳";
    console.log(`  ${icon} [${g.status}] ${g.gate}${g.approvedBy ? ` by ${g.approvedBy}` : ""}${g.reason ? ` — ${g.reason}` : ""}`);
  }
}
```

- [ ] **Step 3: Verify CLI works**

```bash
pnpm build && node dist/src/cli.js governance approval --policy allow --risk low
Expected: 3 gates (verification, pr, merge) all pending

node dist/src/cli.js governance approval --policy deny --risk critical
Expected: not required, no gates

node dist/src/cli.js governance approval --policy allow --risk critical --json
Expected: JSON output with all 5 gates
```

- [ ] **Step 4: Run full regression suite**

```bash
pnpm typecheck && node --test dist/tests/governance/approval-workflow.test.js && pnpm test:vitest
Expected: all pass
```

- [ ] **Step 5: Commit**

```bash
git add src/governance/approval-workflow.ts \
  tests/governance/approval-workflow.test.ts \
  src/cli/commands/governance.ts \
  docs/architecture/plans/2026-07-04-p12-3-approval-workflow.md \
  docs/architecture/specs/2026-07-04-p12-3-approval-workflow.md
git commit -m "feat(governance): add P12.3 approval workflow"
```

---

### Task 3: Final validation

- [ ] **Step 1: Run full validation gate**

```bash
pnpm build
pnpm typecheck
node --test dist/tests/governance/approval-workflow.test.js
pnpm test:vitest
```

- [ ] **Step 2: Push branch**

```bash
git push -u origin feature/p12-3-approval-workflow
```

---

## Verification

```bash
pnpm build                          # compiles clean
pnpm typecheck                      # 0 type errors
node --test dist/tests/governance/approval-workflow.test.js  # 17+ tests pass
pnpm test:vitest                    # all vitest tests pass
node dist/src/cli.js governance approval --policy allow --risk low   # 3 gates
node dist/src/cli.js governance approval --policy allow --risk critical --json  # 5 gates JSON
```
