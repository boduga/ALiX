# M0.29 — PolicyGate Unification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy `PolicyEngine` from the runtime — `PolicyGate` is now the single authoritative policy decision path for all execution paths.

**Architecture:** `PolicyGate` in `policy-gate.ts` already handles `ToolExecutor.execute()` (tool calls) and `runtime-gate.ts` (graph execution). The legacy `PolicyEngine` is still constructed in 3 places but no longer drives real decisions. This plan removes those constructions, removes the `policyEngine` field from the `Runtime` interface, and collapses the fallback path in `runtime-gate.ts` to require `PolicyGate`.

**Tech Stack:** TypeScript, existing `PolicyGate`/`PolicyEngine`/`runtime-gate.ts`, `node:test`.

---

## File Structure

### Modify
- `src/runtime/runtime.ts` — remove `policyEngine: PolicyEngine` from Runtime interface
- `src/runtime/runtime-builder.ts` — stop constructing PolicyEngine, remove PolicyEngine imports
- `src/agent/agent.ts` — remove PolicyEngine construction (already unused; ToolExecutor uses PolicyGate directly)
- `src/policy/runtime-gate.ts` — make PolicyGate required, remove the fallback to `policyEvaluator.evaluate()`; remove `RuleEvaluator` from the interface
- `src/policy/index.ts` — export PolicyGate types instead of PolicyEngine

### Tests
- `tests/policy/runtime-gate.test.ts` — update to pass PolicyGate instead of relying on policyEvaluator fallback

---

### Task 1: Remove PolicyEngine from Runtime interface

**Files:**
- Modify: `src/runtime/runtime.ts`

- [ ] **Step 1: Remove policyEngine import and field**

```typescript
import type { EventLog } from "../events/event-log.js";
// REMOVE: import type { PolicyEngine } from "../policy/policy-engine.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { ContextCompiler } from "../repomap/context-compiler.js";
import type { ScopeTracker } from "../autonomy/scope-tracker.js";
import type { SubagentManager } from "../agents/subagent-manager.js";

export interface Runtime {
  close(): Promise<void>;
  eventLog: EventLog;
  // REMOVE: policyEngine: PolicyEngine;
  toolExecutor: ToolExecutor;
  contextCompiler: ContextCompiler;
  scopeTracker: ScopeTracker;
  subagentManager?: SubagentManager;
}
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: errors in runtime-builder.ts and any other file referencing `r.policyEngine`

- [ ] **Step 3: Commit**

```bash
git add src/runtime/runtime.ts
git commit -m "refactor(runtime): remove PolicyEngine from Runtime interface"
```

---

### Task 2: Remove PolicyEngine from RuntimeBuilder

**Files:**
- Modify: `src/runtime/runtime-builder.ts`

- [ ] **Step 1: Remove PolicyEngine construction and imports**

Change from:
```typescript
import { PolicyEngine } from "../policy/policy-engine.js";
import { PolicyEngineBuilder } from "../policy/policy-engine.js";
```

To (remove both imports):
```typescript
// PolicyEngine imports removed — PolicyGate handles all policy decisions
```

Remove the `_policyEngine` field:
```typescript
export class RuntimeBuilder {
  private _root: string;
  private _config?: AlixConfig;
  private _sessionId?: string;
  private _eventLog?: EventLog;
  // REMOVE: private _policyEngine?: PolicyEngine;
  private _toolExecutor?: ToolExecutor;
  // ...
```

Remove the PolicyEngineBuilder block in `build()`:
```typescript
// DELETE this block:
// Build policy engine
this._policyEngine = new PolicyEngineBuilder(config)
  .withEventLog(this._eventLog, sessionId)
  .build();
```

Remove `policyEngine: this._policyEngine!` from the returned Runtime object:
```typescript
return {
  close: async () => { ... },
  eventLog: this._eventLog!,
  // REMOVE: policyEngine: this._policyEngine!,
  toolExecutor: this._toolExecutor!,
  contextCompiler: this._contextCompiler!,
  scopeTracker: this._scopeTracker!,
  subagentManager: this._subagentManager,
};
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

- [ ] **Step 3: Run existing tests**

```bash
node --test dist/tests/runtime/*.test.js dist/tests/policy/*.test.js
```
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/runtime/runtime-builder.ts
git commit -m "refactor(runtime): remove PolicyEngine construction from RuntimeBuilder"
```

---

### Task 3: Remove PolicyEngine from agent.ts

**Files:**
- Modify: `src/agent/agent.ts`

- [ ] **Step 1: Remove PolicyEngine creation**

The `ToolExecutor` inside agent already uses `PolicyGate` directly (via dynamic import in `execute()`). The `PolicyEngine` instance at line 86 is constructed but never read — it's not passed to anything. Remove:

```typescript
// DELETE imports
import { PolicyEngine } from "../policy/policy-engine.js";

// DELETE construction at line 86:
const policyEngine = new PolicyEngine(config, {}, {
  eventLog: log,
  sessionId,
});
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

- [ ] **Step 3: Commit**

```bash
git add src/agent/agent.ts
git commit -m "refactor(agent): remove unused PolicyEngine construction"
```

---

### Task 4: Collapse runtime-gate.ts to require PolicyGate

**Files:**
- Modify: `src/policy/runtime-gate.ts`
- Test: `tests/policy/runtime-gate.test.ts`

- [ ] **Step 1: Read existing tests to understand the test structure**

Run: `head -100 tests/policy/runtime-gate.test.ts`
Expected: understand what the tests mock

- [ ] **Step 2: Make PolicyGate required in RuntimeGateInput**

Change the interface:
```typescript
export interface RuntimeGateInput {
  node: TaskNode;
  registry: CardRegistry;
  policyGate: PolicyGate;      // was optional, now required
  // REMOVE: policyEvaluator: RuleEvaluator;
  approvalStore?: ApprovalStore;
  auditStore?: AuditStore;
  config: AlixConfig;           // was optional, now required
}
```

- [ ] **Step 3: Remove the fallback branch in evaluateRuntimeGate**

Remove the `else` block that uses `policyEvaluator.evaluate()`:
```typescript
// DELETE this entire else block:
} else {
  for (const cap of caps) {
    const policyResult = policyEvaluator.evaluate({ ... });
    if (policyResult.decision === "deny") { ... }
    if (policyResult.decision === "ask") { ... }
    if (policyResult.decision === "allow") { ... }
  }
}
```

The remaining `if (input.policyGate && input.config)` block should simply become the unconditional path (no guard needed since both are required).

- [ ] **Step 4: Update tests**

Update `tests/policy/runtime-gate.test.ts`:
- Remove tests that pass no `policyGate` (these relied on the fallback)
- Update any test that passed `{ policyEvaluator: mockEvaluator }` to pass `{ policyGate: mockGate, config: mockConfig }` instead

- [ ] **Step 5: Compile check and run tests**

```bash
npm run build && node --test dist/tests/policy/runtime-gate.test.js
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/policy/runtime-gate.ts tests/policy/runtime-gate.test.ts
git commit -m "refactor(policy): make PolicyGate required in runtime-gate, remove RuleEvaluator fallback"
```

---

### Task 5: Update policy index exports

**Files:**
- Modify: `src/policy/index.ts`

- [ ] **Step 1: Change exports to prefer PolicyGate**

Before:
```typescript
export { PolicyEngine, decidePolicy, type ToolRequest, type PolicyDecision } from "./policy-engine.js";
export type { PolicyEngineOptions } from "./policy-engine.js";
```

After (PolicyEngine still exported for import compat but marked deprecated):
```typescript
export { PolicyGate } from "./policy-gate.js";
export type { PolicyGateDecision, ToolPolicyRequest, CapabilityPolicyRequest } from "./policy-gate.js";

/** @deprecated Use PolicyGate instead. Will be removed in a future version. */
export { PolicyEngine, decidePolicy } from "./policy-engine.js";
export type { PolicyEngineOptions } from "./policy-engine.js";
export type { PolicyDecision as LegacyPolicyDecision } from "./policy-engine.js";
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

- [ ] **Step 3: Commit**

```bash
git add src/policy/index.ts
git commit -m "chore(policy): deprecate PolicyEngine exports in favor of PolicyGate"
```

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/policy/*.test.js` — all policy tests pass
3. `node --test dist/tests/runtime/*.test.js` — all runtime tests pass
4. `node --test dist/tests/agent/*.test.js` — all agent tests pass
5. `node --test dist/tests/tools/*.test.js` — all tool tests pass (ToolExecutor uses PolicyGate)
6. Per CLAUDE.md: `mcp__gitnexus__detect_changes` — confirm only the 6 planned files changed
