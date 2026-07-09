# P12.1 Governance Policy Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a deterministic policy engine that evaluates whether ALiX is allowed to proceed based on configured policies — deny, require approval, or allow.

**Architecture:** Pure policy engine module with no side effects, no DB, no execution coupling. Feeds into P12.2 risk scoring and P12.3 approval workflow later. CLI integrated via existing `alix governance policies` subcommand.

**Tech Stack:** TypeScript 5.9, Node 24, pnpm, existing governance CLI (`src/cli/commands/governance.ts`)

## Global Constraints

- No DB, no side effects, no execution coupling — pure policy evaluation
- No P12.2 risk scoring, no P12.3 approval workflow, no P12.4 run ledger, no P12.5 failure memory
- Precedence: `deny` > `requires_approval` > `allow`
- Default (no policy matched): `requires_approval` (conservative)
- CLI subcommand goes under existing `alix governance` command
- All tests use `node:test` + `node:assert/strict`

---
## File Structure

```
src/governance/
  policy-engine.ts              — Types, evaluator, path matching, default policies

tests/governance/
  policy-engine.test.ts         — Unit tests

src/cli/commands/
  governance.ts                 — Add 'policies' subcommand (modify)
```

---

### Task 1: Create policy engine module

**Files:**
- Create: `src/governance/policy-engine.ts`
- Test: `tests/governance/policy-engine.test.ts`

**Interfaces:**
- Produces: `PolicyDecision`, `PolicyResult`, `PolicyMatch`, `Policy`, `ActionContext`, `evaluatePolicies()`, `pathMatches()`, `policyMatches()`

- [ ] **Step 1: Write types and path matching tests**

```typescript
// tests/governance/policy-engine.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pathMatches } from "../../src/governance/policy-engine.js";

describe("pathMatches", () => {
  it("exact match returns true", () => {
    assert.strictEqual(pathMatches(".env", ".env"), true);
  });
  it("prefix with ** matches nested", () => {
    assert.strictEqual(pathMatches("src/security/auth.ts", "src/security/**"), true);
  });
  it("non-matching prefix returns false", () => {
    assert.strictEqual(pathMatches("src/main.ts", "deploy/**"), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm build && node --test dist/tests/governance/policy-engine.test.js
```

Expected: FAIL — `pathMatches` not defined.

- [ ] **Step 3: Implement path matching**

```typescript
// src/governance/policy-engine.ts (partial)
export function pathMatches(filePath: string, pattern: string): boolean {
  if (pattern === filePath) return true;
  if (pattern.endsWith("/**")) {
    return filePath.startsWith(pattern.slice(0, -3));
  }
  if (pattern.endsWith("**")) {
    return filePath.startsWith(pattern.slice(0, -2));
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*\\\*/g, ".*")
    .replace(/\\\*/g, "[^/]*");
  return new RegExp("^" + escaped + "$").test(filePath);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm build && node --test dist/tests/governance/policy-engine.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/governance/policy-engine.ts tests/governance/policy-engine.test.ts
git commit -m "feat(governance): add P12.1 policy engine types and path matching"
```

---

### Task 2: Add Policy types and matching logic

- [ ] **Step 1: Add types and policyMatches tests**

```typescript
// Add to tests/governance/policy-engine.test.ts
import { policyMatches, type Policy, type ActionContext } from "../../src/governance/policy-engine.js";

describe("policyMatches", () => {
  it("matches on action type", () => {
    const p: Policy = { id: "t1", description: "x", match: { actionTypes: ["issue.run"] }, effect: "deny" };
    assert.strictEqual(policyMatches(p, { actionType: "issue.run" }), true);
    assert.strictEqual(policyMatches(p, { actionType: "issue.pr" }), false);
  });
  it("matches on labels", () => {
    const p: Policy = { id: "t2", description: "x", match: { labels: ["security"] }, effect: "deny" };
    assert.strictEqual(policyMatches(p, { actionType: "x", labels: ["bug", "security"] }), true);
    assert.strictEqual(policyMatches(p, { actionType: "x", labels: ["bug"] }), false);
  });
  it("matches on paths", () => {
    const p: Policy = { id: "t3", description: "x", match: { paths: ["src/security/**"] }, effect: "deny" };
    assert.strictEqual(policyMatches(p, { actionType: "x", files: ["src/security/auth.ts"] }), true);
    assert.strictEqual(policyMatches(p, { actionType: "x", files: ["src/main.ts"] }), false);
  });
  it("matches on maxFiles exceeding limit", () => {
    const p: Policy = { id: "t4", description: "x", match: { maxFiles: 10 }, effect: "deny" };
    const manyFiles = Array.from({ length: 15 }, (_, i) => `f${i}.ts`);
    assert.strictEqual(policyMatches(p, { actionType: "x", files: manyFiles }), true);
    assert.strictEqual(policyMatches(p, { actionType: "x", files: ["a.ts"] }), false);
  });
});
```

- [ ] **Step 2: Add types and policyMatches to source**

```typescript
// src/governance/policy-engine.ts

export type PolicyDecision = "allow" | "deny" | "requires_approval";

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
  matchedPolicies: string[];
  requiredApprovals: string[];
}

export interface PolicyMatch {
  actionTypes?: string[];
  labels?: string[];
  repos?: string[];
  paths?: string[];
  maxFiles?: number;
  branches?: string[];
}

export interface Policy {
  id: string;
  description: string;
  match: PolicyMatch;
  effect: PolicyDecision;
  approvalRole?: string;
}

export interface ActionContext {
  actionType: string;
  labels?: string[];
  repo?: string;
  files?: string[];
  branch?: string;
}

export function policyMatches(policy: Policy, context: ActionContext): boolean {
  const m = policy.match;
  if (m.actionTypes?.length && !m.actionTypes.includes(context.actionType)) return false;
  if (m.labels?.length && !context.labels?.some(l => m.labels!.includes(l))) return false;
  if (m.repos?.length && (!context.repo || !m.repos.includes(context.repo))) return false;
  if (m.branches?.length && (!context.branch || !m.branches.includes(context.branch))) return false;
  if (m.maxFiles !== undefined && (!context.files || context.files.length <= m.maxFiles)) return false;
  if (m.paths?.length && !context.files?.some(f => m.paths!.some(p => pathMatches(f, p)))) return false;
  return true;
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm build && node --test dist/tests/governance/policy-engine.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

---

### Task 3: Implement evaluatePolicies with precedence

- [ ] **Step 1: Add evaluatePolicies tests**

```typescript
describe("evaluatePolicies", () => {
  const policies = [
    { id: "deny-sec", description: "Security denied", match: { paths: ["src/security/**"] }, effect: "deny" },
    { id: "approve-src", description: "Source needs approval", match: { paths: ["src/**"] }, effect: "requires_approval" },
    { id: "allow-others", description: "Default allow", match: {}, effect: "allow" },
  ];

  it("allows when only allow policy matches", () => {
    const r = evaluatePolicies({ actionType: "x", files: ["README.md"] }, policies);
    assert.strictEqual(r.decision, "allow");
  });
  it("denies when deny policy matches", () => {
    const r = evaluatePolicies({ actionType: "x", files: ["src/security/auth.ts"] }, policies);
    assert.strictEqual(r.decision, "deny");
  });
  it("requires_approval when approval policy matches", () => {
    const r = evaluatePolicies({ actionType: "x", files: ["src/main.ts"] }, policies);
    assert.strictEqual(r.decision, "requires_approval");
  });
  it("deny beats requires_approval", () => {
    const r = evaluatePolicies({ actionType: "x", files: ["src/security/auth.ts", "src/main.ts"] }, policies);
    assert.strictEqual(r.decision, "deny");
  });
  it("no policy matched falls back to requires_approval", () => {
    const r = evaluatePolicies({ actionType: "unknown" }, []);
    assert.strictEqual(r.decision, "requires_approval");
  });
});
```

- [ ] **Step 2: Implement evaluatePolicies in source**

```typescript
export function evaluatePolicies(context: ActionContext, policies: Policy[] = DEFAULT_POLICIES): PolicyResult {
  const matched = policies.filter(p => policyMatches(p, context));
  const denyMatch = matched.find(p => p.effect === "deny");
  if (denyMatch) return { decision: "deny", reason: denyMatch.description, matchedPolicies: [denyMatch.id], requiredApprovals: [] };
  const approvalMatches = matched.filter(p => p.effect === "requires_approval");
  if (approvalMatches.length > 0) return { decision: "requires_approval", reason: approvalMatches.map(p => p.description).join("; "), matchedPolicies: approvalMatches.map(p => p.id), requiredApprovals: approvalMatches.filter(p => p.approvalRole).map(p => p.approvalRole!) };
  const allowMatch = matched.find(p => p.effect === "allow");
  if (allowMatch) return { decision: "allow", reason: allowMatch.description, matchedPolicies: [allowMatch.id], requiredApprovals: [] };
  return { decision: "requires_approval", reason: "No matching policy — requires approval by default", matchedPolicies: [], requiredApprovals: [] };
}
```

- [ ] **Step 3: Add default policies**

```typescript
export const DEFAULT_POLICIES: Policy[] = [
  { id: "security-paths-deny", description: "Deny changes to security/auth/infra paths", match: { paths: ["src/security/**", "src/auth/**", "deploy/**", "infra/**"] }, effect: "deny" },
  { id: "secrets-deny", description: "Deny changes to secrets and env config", match: { paths: [".env", ".env.*", "**/secrets/**", "**/credentials/**"] }, effect: "deny" },
  { id: "large-change-approval", description: ">10 files requires human approval", match: { maxFiles: 10 }, effect: "requires_approval" },
  { id: "source-change-approval", description: "Source changes require approval", match: { paths: ["src/**"] }, effect: "requires_approval" },
  { id: "default-allow", description: "Default allow", match: {}, effect: "allow" },
];
```

- [ ] **Step 4: Run full test suite**

```bash
pnpm typecheck && node --test dist/tests/governance/policy-engine.test.js && pnpm test:vitest
```

Expected: all pass.

- [ ] **Step 5: Commit**

---

### Task 4: Wire CLI subcommand

- [ ] **Step 1: Add `policies` subcommand to governance handler**

In `src/cli/commands/governance.ts`, add:

```typescript
if (sub === "policies") {
  const { DEFAULT_POLICIES } = await import("../../governance/policy-engine.js");
  console.log(`P12.1 Governance Policies (${DEFAULT_POLICIES.length}):\n`);
  for (const p of DEFAULT_POLICIES) {
    const icon = p.effect === "deny" ? "🔴" : p.effect === "requires_approval" ? "🟡" : "🟢";
    const matchParts = Object.entries(p.match)
      .filter(([_, v]) => v !== undefined && (Array.isArray(v) ? v.length > 0 : true))
      .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
    console.log(`${icon} [${p.effect}] ${p.id}`);
    console.log(`   ${p.description}`);
    if (matchParts.length) console.log(matchParts.join("\n"));
    if (p.approvalRole) console.log(`   approvalRole: ${p.approvalRole}`);
    console.log();
  }
  return;
}
```

Also add `policies` to the usage error message.

- [ ] **Step 2: Typecheck and build**

```bash
pnpm typecheck && pnpm build
```

Expected: clean.

- [ ] **Step 3: Smoke test CLI**

```bash
node dist/src/cli.js governance policies
```

Expected: prints 5 policies with icons.

- [ ] **Step 4: Run full test suite**

```bash
pnpm test:vitest
```

Expected: 2669+ tests pass (0 regressions).

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/governance.ts src/governance/policy-engine.ts tests/governance/
git commit -m "feat(governance): add P12.1 policy engine and CLI"
```

---

### Task 5: Final validation

- [ ] **Step 1: Run full validation gate**

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
node --test dist/tests/governance/policy-engine.test.js
pnpm test:vitest
```

Expected: all clean.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feature/p12-1-policy-engine
```

---

## Verification

```bash
pnpm build           # compiles clean
pnpm typecheck       # 0 type errors
node --test dist/tests/governance/policy-engine.test.js  # 12+ tests pass
pnpm test:vitest     # 2669+ tests pass, 0 regressions
node dist/src/cli.js governance policies  # prints 5 policies
```
