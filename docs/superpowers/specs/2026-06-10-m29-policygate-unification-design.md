# M0.29: PolicyGate Unification — Design Spec

**Status:** Draft
**Builds on:** M0.24 (shared task router), M0.28 (runtime consistency hardening)

---

## Problem

ALiX has multiple overlapping policy paths with no single authority:

| Path | Where | Problem |
|------|-------|---------|
| `createPermissivePolicyDecision()` | `ToolExecutor.execute()` | Creates a placeholder "allow" decision, logs it as `policy.decision`, then ignores it |
| `decidePolicy()` | `policy-engine.ts` | Called immediately after the placeholder, actually enforces policy — but the event already logged a different decision |
| `PolicyEngine.check()` | `policy-engine.ts` | Separate structured path with capability registry, command classifier, network matcher — not called by ToolExecutor at all |
| `evaluateRuntimeGate()` | `runtime-gate.ts` | Own capability + rule evaluation for graph nodes, duplicate decision logic |
| Tool/chat daemon routes | `daemon-server.ts` | Bypass policy entirely for non-agent routes |

The result: **the logged policy decision and the enforced policy decision can diverge**, and different execution paths can produce different outcomes for the same capability.

## Solution

Introduce **PolicyGate** — a single authoritative policy decision engine that all execution paths call. ToolExecutor and RuntimeGate remain separate execution contexts, but both ask PolicyGate for decisions. The logged decision and the enforced decision are the same object.

## Architecture

```
ToolExecutor.execute()          RuntimeGate.evaluate()
       │                              │
       ▼                              ▼
PolicyGate.evaluateToolCall()   PolicyGate.evaluateCapability()
       │                              │
       └──────┬───────────────────────┘
              │
              ▼
     One decision, one event
              │
     ┌────────┼────────┐
     │        │        │
     ▼        ▼        ▼
   allow    deny     ask
                       │
                       ▼
               ApprovalStore
            (create/reuse/check)
```

### PolicyGate

```typescript
// src/policy/policy-gate.ts

type PolicyGateDecision = {
  requestId: string;
  capability: string;
  decision: "allow" | "ask" | "deny";
  reason: string;
  matchedRuleId?: string;
  approvalId?: string;
};

type ToolPolicyRequest = {
  requestId: string;
  toolName: string;
  capability?: string;   // caller-provided, falls back to inferCapability
  args: Record<string, unknown>;
  cwd: string;
  sessionMode: SessionMode;
  sessionId?: string;
  source: "tool" | "graph" | "daemon" | "tui";
};

type CapabilityPolicyRequest = {
  requestId: string;
  capability: string;
  sessionMode: SessionMode;
  nodeId?: string;
  graphId?: string;
  sessionId?: string;
  source: "tool" | "graph" | "daemon" | "tui";
  metadata?: Record<string, unknown>;
};
```

### evaluateToolCall flow

```
1. Resolve capability
   capability = request.capability ?? inferCapability(request.toolName)

2. Check protected paths (if path arg present)
   resolvePolicyPath(cwd, args.path) against config.permissions.protectedPaths
   deny if matched

3. Check deny commands (if command arg present)
   deny if config.permissions.denyCommands includes normalized command

4. Check shell whitelist + evasion patterns (if command arg present)
   deny/ask based on shellWhitelist and EVASION_PATTERNS

5. Check tool permission in config
   config.permissions.tools[capability] → applySessionMode(mode)
   deny/ask/allow

6. Apply default policy
   config.permissions.default

7. If decision is "ask":
     a. Check existing resolved approval → approved → allow | denied → deny
     b. Check existing pending approval → reuse
     c. Create new pending approval via ApprovalStore
     Return ask with approvalId

8. Return decision (allow | deny | ask)
```

### evaluateCapability flow

```
1. Check tool permission in config
   config.permissions.tools[capability] → applySessionMode(mode)

2. Apply default policy

3. If decision is "ask":
     Same approval lifecycle as evaluateToolCall (steps 7a-7c)

4. Return decision
```

No path checks, no command checks, no evasion checks — those are tool-specific.

### What changes in ToolExecutor

**Before (lines 128-163 of executor.ts):**
```
1. Create permissive PolicyDecision placeholder → log as policy.decision
2. Call legacy decidePolicy() separately
3. Enforce legacy decidePolicy() result
4. Two different objects: logged != enforced
```

**After:**
```
1. Call PolicyGate.evaluateToolCall(request) → one decision
2. Log that decision as policy.decision
3. Enforce that decision
4. One object: logged === enforced
```

The `createPermissivePolicyDecision()` call, its associated `log.append({type: "policy.decision", ...})`, and the separate `decidePolicy()` call are all removed from ToolExecutor.

### What changes in RuntimeGate

`evaluateRuntimeGate()` currently has its own policy evaluation loop over capability lists (lines 61-186 of runtime-gate.ts). For M0.29, it calls `PolicyGate.evaluateCapability()` for each capability instead, and uses the result for its gate status (`ready`/`blocked`/`needs_approval`). The graph-specific orchestration (capability resolution via `resolveCapabilities()`, node context, audit logging) stays in RuntimeGate.

### Approval lifecycle

Extracted from RuntimeGate into PolicyGate. Both `evaluateToolCall` and `evaluateCapability` call the same approval logic:

```
ask decision
  → ApprovalStore.findResolved({ capability, graphId, nodeId })
  → if approved → return allow
  → if denied → return deny
  → ApprovalStore.findPending(...)
  → if pending → return ask with existing approvalId
  → ApprovalStore.request(...)
  → return ask with new approvalId
```

No new approval logic in ToolExecutor. It just receives the decision.

### Path resolution

Path checks in `evaluateToolCall` normalize paths against `cwd` before comparing to protected patterns:

```typescript
function resolvePolicyPath(cwd: string, path: string): string {
  if (path.startsWith("/")) return path;
  return resolve(cwd, path);
}
```

This ensures `file.write path="../secrets.env"` is detected even when the raw string doesn't look like a protected path.

## Deprecation strategy

- `decidePolicy()` in `policy-engine.ts` is **not removed** — PolicyGate may call it internally for M0.29 to reuse existing logic
- `PolicyEngine` class is preserved as-is — it may be called by other consumers
- After M0.29 proves parity, M0.30+ can remove the old paths

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `src/policy/policy-gate.ts` | **Create** | `PolicyGate` class, `PolicyGateDecision`, `ToolPolicyRequest`, `CapabilityPolicyRequest`, approval lifecycle |
| `src/tools/executor.ts` | **Modify** | Replace placeholder + legacy policy with single `PolicyGate.evaluateToolCall()` |
| `src/policy/runtime-gate.ts` | **Modify** | Call `PolicyGate.evaluateCapability()` for policy decisions |
| `src/policy/index.ts` | **Modify** | Export `PolicyGate`, `PolicyGateDecision` |
| `tests/policy/policy-gate.test.ts` | **Create** | Unit tests for tool and capability evaluation paths |

## Testing

| Test | Description |
|------|-------------|
| `evaluateToolCall` → allow | Tool with allow permission executes |
| `evaluateToolCall` → deny | Tool with deny permission blocked |
| `evaluateToolCall` → ask creates approval | Ask decision creates pending approval |
| `evaluateToolCall` → ask reuses approval | Duplicate ask reuses existing pending |
| `evaluateToolCall` → approved resolution | Previously approved ask → allow |
| Protected path blocks | Path matching protected pattern → deny |
| Path resolved against cwd | Relative path to protected dir → deny |
| Deny command blocks | Command in denyCommands → deny |
| Shell evasion detected | Evasion pattern → deny/ask |
| Default policy applied | Unknown capability → config default |
| `evaluateCapability` → allow | Capability with allow permission |
| `evaluateCapability` → ask | Capability requiring approval |
| ToolExecutor logs exactly one event | After PolicyGate integration |
| RuntimeGate calls PolicyGate | Capability evaluation goes through gate |

## Acceptance criteria

1. ToolExecutor emits exactly one `policy.decision` per tool call
2. The logged decision is the enforced decision
3. `deny` blocks execution
4. `ask` creates/reuses approval
5. `allow` executes
6. RuntimeGate uses `PolicyGate.evaluateCapability()`
7. Protected path / deny command / shell whitelist behavior is unchanged
8. No `createPermissivePolicyDecision()` in `ToolExecutor.execute()`
