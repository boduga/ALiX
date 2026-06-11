# M0.16: Runtime Policy Integration

**Status:** ✅ Completed (M0.16) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the policy rule engine, capability resolver, and approval queue into the graph executor so that capability coverage is checked first, then policy rules are evaluated, and `ask` decisions create approval requests.

**Architecture:** Two-layer gate — CapabilityResolver first (does the capability exist?), then RuleEvaluator (is it allowed?). If `ask`, an ApprovalRecord is created and the node is paused. Only when both layers pass does the model execute.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/policy/runtime-gate.ts` | **Create** | Composed evaluateRuntimeGate() — both layers |
| `src/kernel/graph-executor.ts` | **Modify** | Integrate RuntimeGate under --enforce-capabilities |
| `src/cli.ts` | **Modify** | Wire policy evaluator + approval store into graph run |
| `tests/policy/runtime-gate.test.ts` | **Create** | Gate unit tests |
| `tests/kernel/graph-executor.test.ts` | **Modify** | Policy enforcement execution tests |

---

### Task 1: RuntimeGate composer

**Files:**
- Create: `src/policy/runtime-gate.ts`

- [ ] **Step 1: Write RuntimeGate**

Create `src/policy/runtime-gate.ts`:

```typescript
/**
 * runtime-gate.ts — Two-layer execution gate for graph nodes.
 *
 * Layer 1: CapabilityResolver — does any agent/tool cover this capability?
 * Layer 2: RuleEvaluator — is this capability allowed by policy?
 */
import type { CardRegistry } from "../registry/card-registry.js";
import { resolveCapabilities, type CapabilityResolution } from "../registry/capability-resolver.js";
import type { RuleEvaluator } from "./rule-evaluator.js";
import type { TaskNode } from "../kernel/task-graph.js";
import type { ApprovalStore } from "../approvals/approval-store.js";

export type RuntimeGateStatus = "ready" | "blocked" | "needs_approval";

export interface RuntimeGateDecision {
  status: RuntimeGateStatus;
  capabilityResolution?: CapabilityResolution;
  policyDecision?: "allow" | "ask" | "deny";
  policyRuleId?: string;
  policyReason?: string;
  approvalId?: string;
  reason: string;
}

export interface RuntimeGateInput {
  node: TaskNode;
  registry: CardRegistry;
  policyEvaluator: RuleEvaluator;
  approvalStore?: ApprovalStore;
}

export async function evaluateRuntimeGate(input: RuntimeGateInput): Promise<RuntimeGateDecision> {
  const { node, registry, policyEvaluator, approvalStore } = input;
  const caps = node.requiredCapabilities ?? [];

  // Layer 1: Capability coverage check
  if (caps.length > 0) {
    const capResult = resolveCapabilities({
      requiredCapabilities: caps,
      domain: node.domain,
      executionProfile: (node as any).executionProfile,
      registry,
    });
    if (capResult.missingCapabilities.length > 0) {
      return {
        status: "blocked",
        capabilityResolution: capResult,
        reason: `Missing capabilities: ${capResult.missingCapabilities.join(", ")}`,
      };
    }
    // Layer 2: Policy evaluation
    const policyResult = policyEvaluator.evaluate({
      capability: caps[0],
      riskLevel: node.riskLevel as any,
      executionProfile: (node as any).executionProfile,
    });
    if (policyResult.decision === "deny") {
      return {
        status: "blocked",
        capabilityResolution: capResult,
        policyDecision: "deny",
        policyRuleId: policyResult.matchedRuleId,
        policyReason: policyResult.reason,
        reason: policyResult.reason ?? `Blocked by policy rule: ${policyResult.matchedRuleId}`,
      };
    }
    if (policyResult.decision === "ask" && approvalStore) {
      const approval = await approvalStore.request({
        reason: policyResult.reason ?? `Approval required for capability: ${caps[0]}`,
        graphId: node.graphId,
        nodeId: node.id,
        capability: caps[0],
        riskLevel: node.riskLevel as any,
      });
      return {
        status: "needs_approval",
        capabilityResolution: capResult,
        policyDecision: "ask",
        policyRuleId: policyResult.matchedRuleId,
        policyReason: policyResult.reason,
        approvalId: approval.id,
        reason: `Pending approval: ${approval.id}`,
      };
    }
  }

  return { status: "ready", reason: "All gates passed" };
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/policy/runtime-gate.ts
git commit -m "feat(policy): add RuntimeGate composer with two-layer evaluation"
```

---

### Task 2: RuntimeGate unit tests

**Files:**
- Create: `tests/policy/runtime-gate.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateRuntimeGate } from "../../src/policy/runtime-gate.js";
import { RuleEvaluator } from "../../src/policy/rule-evaluator.js";
import { CardRegistry } from "../../src/registry/card-registry.js";
import type { TaskNode } from "../../src/kernel/task-graph.js";

function makeNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "test_node", graphId: "test_graph", title: "Test Node",
    goal: "test", domain: "general", status: "pending",
    dependencies: [], requiredCapabilities: ["web.search"],
    riskLevel: "low", approvalMode: "auto", inputs: {},
    artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "",
    ...overrides,
  };
}

function makeRegistry(): CardRegistry {
  const r = new CardRegistry();
  r.registerAgent({
    id: "test.agent", name: "Test", description: "Test agent",
    version: "1.0.0", domains: ["general"], capabilities: ["web.search"],
    enabled: true,
  });
  r.registerTool({
    id: "web_search", name: "Web Search", description: "Search",
    version: "1.0.0", capabilities: ["web.search"], riskLevel: "low",
    approvalMode: "auto", sideEffects: "read", enabled: true,
  });
  r.registerTool({
    id: "shell_exec", name: "Shell Exec", description: "Shell",
    version: "1.0.0", capabilities: ["shell.exec"], riskLevel: "high",
    approvalMode: "ask", sideEffects: "system", enabled: true,
  });
  return r;
}

function makePolicy(...rules: any[]): RuleEvaluator {
  const e = new RuleEvaluator();
  for (const r of rules) e.addRule(r);
  return e;
}

describe("RuntimeGate", () => {
  it("returns ready when capability exists and policy allows", async () => {
    const registry = makeRegistry();
    const policy = makePolicy({
      id: "allow-search", description: "Allow search",
      match: { capability: "web.search" }, decision: "allow", enabled: true,
    });
    const result = await evaluateRuntimeGate({
      node: makeNode({ requiredCapabilities: ["web.search"] }),
      registry, policyEvaluator: policy,
    });
    assert.equal(result.status, "ready");
  });

  it("returns blocked when capability is missing", async () => {
    const registry = new CardRegistry();
    const policy = makePolicy();
    const result = await evaluateRuntimeGate({
      node: makeNode({ requiredCapabilities: ["nonexistent.cap"] }),
      registry, policyEvaluator: policy,
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.reason.includes("Missing capabilities"));
  });

  it("returns blocked when policy denies", async () => {
    const registry = makeRegistry();
    const policy = makePolicy({
      id: "deny-search", description: "Deny search",
      match: { capability: "web.search" }, decision: "deny", enabled: true,
    });
    const result = await evaluateRuntimeGate({
      node: makeNode({ requiredCapabilities: ["web.search"] }),
      registry, policyEvaluator: policy,
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.policyDecision, "deny");
  });

  it("returns needs_approval when policy asks and approvalStore exists", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "runtime-gate-ask-"));
    try {
      const store = new ApprovalStore(tmpDir);
      await store.load();
      const registry = makeRegistry();
      const policy = makePolicy({
        id: "ask-shell", description: "Ask shell",
        match: { capability: "shell.exec" }, decision: "ask", enabled: true,
        reason: "Shell execution needs approval",
      });
      const result = await evaluateRuntimeGate({
        node: makeNode({ requiredCapabilities: ["shell.exec"], riskLevel: "high" }),
        registry, policyEvaluator: policy, approvalStore: store,
      });
      assert.equal(result.status, "needs_approval");
      assert.equal(result.policyDecision, "ask");
      assert.ok(result.approvalId, "should have created an approval");
      assert.ok(result.reason.includes("Pending approval"));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns ready when node has no requiredCapabilities", async () => {
    const registry = new CardRegistry();
    const policy = makePolicy();
    const result = await evaluateRuntimeGate({
      node: makeNode({ requiredCapabilities: [] }),
      registry, policyEvaluator: policy,
    });
    assert.equal(result.status, "ready");
  });
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/policy/runtime-gate.test.js 2>&1
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/policy/runtime-gate.test.ts
git commit -m "test(policy): add RuntimeGate unit tests"
```

---

### Task 3: GraphExecutor integration

**Files:**
- Modify: `src/kernel/graph-executor.ts`

- [ ] **Step 1: Add imports**

Add at the top of `src/kernel/graph-executor.ts`:

```typescript
import { evaluateRuntimeGate } from "../policy/runtime-gate.js";
import { RuleEvaluator } from "../policy/rule-evaluator.js";
import { ApprovalStore } from "../approvals/approval-store.js";
```

- [ ] **Step 2: Add policyEvaluator and approvalStore to ExecutorOpts**

```typescript
export interface ExecutorOpts {
  registry?: CardRegistry;
  enforceCapabilities?: boolean;
  policyEvaluator?: RuleEvaluator;
  approvalStore?: ApprovalStore;
}
```

- [ ] **Step 3: Store them in constructor**

Add private fields:
```typescript
private policyEvaluator: RuleEvaluator;
private approvalStore?: ApprovalStore;
```

Update constructor:
```typescript
constructor(cwd: string, opts?: ExecutorOpts) {
  this.cwd = cwd;
  this.registry = opts?.registry;
  this.enforceCapabilities = opts?.enforceCapabilities ?? false;
  this.policyEvaluator = opts?.policyEvaluator ?? new RuleEvaluator();
  this.approvalStore = opts?.approvalStore;
}
```

- [ ] **Step 4: Replace the old enforcement gate with RuntimeGate call**

Find the section starting with `// Capability enforcement gate` (around line 162). Replace the entire block from `// Capability enforcement gate` to `// Regular execution path` with:

```typescript
      // Composed enforcement gate (capability + policy + approval)
      if (this.enforceCapabilities && capabilityResolution) {
        const gateResult = await evaluateRuntimeGate({
          node,
          registry: this.registry ?? new CardRegistry(),
          policyEvaluator: this.policyEvaluator,
          approvalStore: this.approvalStore,
        });

        // Use the gate's capabilityResolution (it's more complete)
        if (gateResult.capabilityResolution) {
          capabilityResolution = {
            requiredCapabilities: gateResult.capabilityResolution.requiredCapabilities,
            matchedAgents: gateResult.capabilityResolution.agents.map(a => a.id),
            matchedTools: gateResult.capabilityResolution.tools.map(t => t.id),
            missingCapabilities: gateResult.capabilityResolution.missingCapabilities,
            warnings: gateResult.capabilityResolution.warnings.map(w => w), // keep as string[]
            status: gateResult.status === "ready" ? "ready"
              : gateResult.status === "blocked" ? "blocked" : "needs_approval",
          };
        }

        if (gateResult.status === "blocked") {
          status = "blocked";
          reason = gateResult.reason;
          results.push({
            nodeId: node.id, title: node.title, status, reason,
            durationMs: Date.now() - startTime,
            capabilityResolution,
          });
          failed = true;
          break;
        }

        if (gateResult.status === "needs_approval") {
          status = "blocked";
          reason = gateResult.reason;
          results.push({
            nodeId: node.id, title: node.title, status, reason,
            durationMs: Date.now() - startTime,
            capabilityResolution,
          });
          failed = true;
          break;
        }
        // If "ready", fall through to regular execution
      }
```

- [ ] **Step 5: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/kernel/graph-executor.ts
git commit -m "feat(graph): integrate RuntimeGate into GraphExecutor execution flow"
```

---

### Task 4: Wire into CLI handlers

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add to `graph run` handler**

Find the `graph run` handler. After the registry loading, add:

```typescript
  const { RuleEvaluator } = await import("./policy/rule-evaluator.js");
  const { defaultPolicyRules } = await import("./policy/default-policies.js");
  const { ApprovalStore } = await import("./approvals/approval-store.js");
  const policyEvaluator = new RuleEvaluator(defaultPolicyRules());
  const approvalStore = new ApprovalStore(cwd);
  await approvalStore.load();
```

Then change the executor constructor to pass them:
```typescript
  const executor = new GraphExecutor(cwd, { registry, enforceCapabilities: enforce, policyEvaluator, approvalStore });
```

Apply the same pattern to `graph rerun` and `sop run` handlers.

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): wire policy evaluator and approval store into graph run"
```

---

### Task 5: Update graph executor tests

**Files:**
- Modify: `tests/kernel/graph-executor.test.ts`

- [ ] **Step 1: Add policy deny enforcement test**

Add after the existing enforcement tests:

```typescript
it("enforcement: policy deny blocks node", async () => {
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { RuleEvaluator } = await import("../../src/policy/rule-evaluator.js");
  const { CardRegistry } = await import("../../src/registry/card-registry.js");
  const { GraphExecutor } = await import("../../src/kernel/graph-executor.js");
  const tmpDir = mkdtempSync(join(tmpdir(), "exec-policy-deny-"));

  const graphId = "policy_deny_test";
  const graphsDir = join(tmpDir, ".alix", "graphs");
  mkdirSync(graphsDir, { recursive: true });
  writeFileSync(join(graphsDir, `${graphId}.json`), JSON.stringify({
    id: graphId, schemaVersion: "1.0", workflowId: "wf_test",
    rootGoal: "test", status: "ready", strategy: "sequential",
    nodes: [{
      id: "node_p", graphId, title: "Node P", goal: "search",
      domain: "general", status: "pending", dependencies: [],
      requiredCapabilities: ["web.search"],
      riskLevel: "low", approvalMode: "auto", inputs: {},
      artifacts: [], memoryRefs: [],
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }],
    edges: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
  }));

  const registry = new CardRegistry();
  registry.registerTool({
    id: "web_search", name: "Web Search", description: "",
    version: "1.0.0", capabilities: ["web.search"], riskLevel: "low",
    approvalMode: "auto", sideEffects: "read", enabled: true,
  });

  const policy = new RuleEvaluator([
    { id: "deny-web", description: "Deny web search",
      match: { capability: "web.search" }, decision: "deny", enabled: true },
  ]);

  const exec = new GraphExecutor(tmpDir, { registry, enforceCapabilities: true, policyEvaluator: policy });
  const result = await exec.execute(graphId);

  const node = result.results[0];
  assert.equal(node.status, "blocked");
  assert.match(node.reason!, /deny|blocked/i);
  rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/kernel/graph-executor.test.js dist/tests/policy/runtime-gate.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/kernel/graph-executor.test.ts
git commit -m "test(graph): add policy deny enforcement test"
```

---

### Task 6: Full build and push

- [ ] **Step 1: Full build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 2: Run all affected tests**

```bash
node --test dist/tests/policy/runtime-gate.test.js dist/tests/kernel/graph-executor.test.js dist/tests/approvals/approval-store.test.js dist/tests/server/server.test.js 2>&1
```

- [ ] **Step 3: Push**

```bash
git push
```
