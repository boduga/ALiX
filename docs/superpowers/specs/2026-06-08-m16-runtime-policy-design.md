# M0.16: Runtime Policy Integration

**Goal:** Connect the policy rule engine, capability resolver, and approval queue into the graph executor — so that during graph execution, capability coverage is checked first, then policy rules are evaluated, and `ask` decisions create approval requests.

## Two-Layer Gate Architecture

```
GraphExecutor node starts
  ↓
CapabilityResolver — can ALiX do this?
  ↓
if missing capability → BLOCKED
  ↓
RuleEvaluator — is ALiX allowed to do this?
  ↓
allow → EXECUTE
ask   → create ApprovalRequest → PENDING_APPROVAL
deny  → BLOCKED
```

Each layer answers one question:

| Layer | Question | Failure |
|-------|----------|---------|
| CapabilityResolver | Does any registered agent/tool cover this? | `missing capability` |
| RuleEvaluator | Is this allowed by policy rules? | `denied` or `requires approval` |
| ApprovalStore | Did the user approve this exact action? | `pending`, `approved`, `denied` |

## Sub-milestones

| # | Title | Description |
|---|-------|-------------|
| A | RuntimeGate composer | Composed evaluateRuntimeGate() that runs both layers |
| B | GraphExecutor integration | Executor uses RuntimeGate under --enforce-capabilities |
| C | ask → ApprovalRequest | Policy "ask" creates ApprovalRecord, node marked pending_approval |
| D | Approval-aware rerun | After approval, rerun respects the resolved approval |
| E | Inspector pending approvals | Read-only pending approval visibility |

## RuntimeGate type

```typescript
export type RuntimeGateStatus = "ready" | "blocked" | "needs_approval";

export interface RuntimeGateDecision {
  status: RuntimeGateStatus;
  capabilityResolution?: CapabilityPreflightResult;
  policyDecision?: "allow" | "ask" | "deny";
  policyRuleId?: string;
  policyReason?: string;
  approvalId?: string;
  reason: string;
}

export async function evaluateRuntimeGate(input: {
  node: TaskNode;
  registry: CardRegistry;
  policyEvaluator: RuleEvaluator;
  approvalStore?: ApprovalStore;
}): Promise<RuntimeGateDecision>;
```

## Files

| File | Action |
|------|--------|
| `src/policy/runtime-gate.ts` | **Create** — RuntimeGate composer |
| `src/kernel/graph-executor.ts` | **Modify** — use RuntimeGate under --enforce-capabilities |
| `src/policy/` | Minor — ensure exports are correct |
| `tests/policy/runtime-gate.test.ts` | **Create** — gate tests |
| `tests/kernel/graph-executor.test.ts` | **Modify** — add policy enforcement tests |
