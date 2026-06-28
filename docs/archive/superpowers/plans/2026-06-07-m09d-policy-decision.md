# M0.9-D: PolicyDecision Placeholder

**Status:** ✅ Completed (M0.15) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every tool call produces a `PolicyDecision` record with argument hash binding. M0.9 uses a permissive placeholder (allows everything) while establishing the audit trail for M0.12+ policy enforcement.

**Architecture:** A `PolicyDecisionManager` that wraps each tool call. It computes the argument hash (using the same `hashArgs()` from PR 2), creates a permissive `PolicyDecision`, emits `policy.decision` + `tool.approved` events, and verifies argument hash match before execution. The scaffold at `implementation/m0.9-starter/src/kernel/policy-decision.ts` provides the types.

**Tech Stack:** TypeScript, node:crypto, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/policy-decision.ts` | **Create** | `PolicyDecision` types, `createPermissivePolicyDecision()`, `assertPolicyArgumentsMatch()` |
| `src/tools/executor.ts` | **Modify** | Wire `PolicyDecisionManager` around tool execution |
| `tests/kernel/policy-decision.test.ts` | **Create** | Tests |

---

### Task 1: Create PolicyDecision module

**Files:**
- Create: `src/kernel/policy-decision.ts`

- [ ] **Step 1: Write the module**

```typescript
import { createHash, randomUUID } from "node:crypto";

export interface PolicyDecision {
  id: string;
  requestId: string;
  capability: string;
  actorId: string;
  resource?: string;
  decision: "allow" | "ask" | "deny" | "modify";
  riskTier: 0 | 1 | 2 | 3 | 4 | 5;
  reasons: string[];
  argumentHash: string;
  scope: "once" | "session" | "project" | "global";
  validForToolId?: string;
  validForNodeId?: string;
  createdAt: string;
  expiresAt?: string;
}

/** Compute stable SHA-256 of sorted-JSON arguments. */
export function hashArguments(args: Record<string, unknown>): string {
  const sorted = Object.keys(args).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = args[k];
    return acc;
  }, {});
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/** Create a permissive M0.9 placeholder PolicyDecision. */
export function createPermissivePolicyDecision(input: {
  requestId: string;
  capability: string;
  actorId: string;
  args: Record<string, unknown>;
  validForToolId?: string;
  validForNodeId?: string;
}): PolicyDecision {
  return {
    id: `pol_${randomUUID()}`,
    requestId: input.requestId,
    capability: input.capability,
    actorId: input.actorId,
    decision: "allow",
    riskTier: 0,
    reasons: ["M0.9 permissive placeholder — full policy enforcement in M0.12+"],
    argumentHash: hashArguments(input.args),
    scope: "once",
    validForToolId: input.validForToolId,
    validForNodeId: input.validForNodeId,
    createdAt: new Date().toISOString(),
  };
}

/** Throw if the current arguments don't match the approved hash. */
export function assertPolicyArgumentsMatch(decision: PolicyDecision, args: Record<string, unknown>): void {
  const currentHash = hashArguments(args);
  if (decision.argumentHash !== currentHash) {
    throw new Error(`PolicyDecision ${decision.id} argument hash mismatch: expected ${decision.argumentHash}, got ${currentHash}`);
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit src/kernel/policy-decision.ts 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add src/kernel/policy-decision.ts
git commit -m "feat(kernel): PolicyDecision types, permissive placeholder, argument hash binding"
```

---

### Task 2: Wire into ToolExecutor

**Files:**
- Modify: `src/tools/executor.ts`

- [ ] **Step 1: Import and create PolicyDecision before each tool call**

In the `execute()` method, after `const capability = inferCapability(name)`, add:

```typescript
import { createPermissivePolicyDecision, assertPolicyArgumentsMatch } from "../kernel/policy-decision.js";

// Create PolicyDecision placeholder
const policyDecision = createPermissivePolicyDecision({
  requestId: toolCallId,
  capability,
  actorId: name,
  args,
  validForToolId: name,
});
```

- [ ] **Step 2: Emit policy.decision event**

```typescript
await this.log.append({
  sessionId: "", actor: "policy",
  type: "policy.decision",
  payload: {
    toolCallId,
    capability,
    decision: policyDecision.decision,
    reason: policyDecision.reasons[0],
    matchedRuleId: policyDecision.id,
  },
});
```

- [ ] **Step 3: Assert argument match before execution**

Wrap the actual execution with `assertPolicyArgumentsMatch(policyDecision, args)`. In M0.9 this is permissive but establishes the pattern.

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/tools/executor.ts
git commit -m "feat(kernel): wire PolicyDecision placeholder into ToolExecutor"
```

---

### Task 3: Write tests

**Files:**
- Create: `tests/kernel/policy-decision.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPermissivePolicyDecision, hashArguments, assertPolicyArgumentsMatch } from "../../src/kernel/policy-decision.js";

describe("PolicyDecision", () => {

  it("creates permissive allow decision", () => {
    const pd = createPermissivePolicyDecision({
      requestId: "req_1", capability: "filesystem.read",
      actorId: "file.read", args: { path: "/tmp/test.txt" },
    });
    assert.equal(pd.decision, "allow");
    assert.ok(pd.id.startsWith("pol_"));
  });

  it("hashes arguments deterministically", () => {
    const a = hashArguments({ path: "/tmp/a.txt" });
    const b = hashArguments({ path: "/tmp/a.txt" });
    assert.equal(a, b);
  });

  it("different args produce different hashes", () => {
    const a = hashArguments({ path: "/tmp/a.txt" });
    const b = hashArguments({ path: "/tmp/b.txt" });
    assert.notEqual(a, b);
  });

  it("sorted keys produce same hash regardless of insertion order", () => {
    const a = hashArguments({ z: 1, a: 2 });
    const b = hashArguments({ a: 2, z: 1 });
    assert.equal(a, b);
  });

  it("assertPolicyArgumentsMatch passes for matching args", () => {
    const pd = createPermissivePolicyDecision({
      requestId: "req_1", capability: "test",
      actorId: "test", args: { x: 1 },
    });
    assert.doesNotThrow(() => assertPolicyArgumentsMatch(pd, { x: 1 }));
  });

  it("assertPolicyArgumentsMatch throws for mismatched args", () => {
    const pd = createPermissivePolicyDecision({
      requestId: "req_1", capability: "test",
      actorId: "test", args: { x: 1 },
    });
    assert.throws(() => assertPolicyArgumentsMatch(pd, { x: 2 }));
  });
});
```

- [ ] **Step 2: Run tests**

```bash
node --test dist/tests/kernel/policy-decision.test.js 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add tests/kernel/policy-decision.test.ts
git commit -m "test(kernel): PolicyDecision creation, hash, and argument match tests"
```
