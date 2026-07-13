# A3 — Governance Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge A2 verification evidence into governance decisions that drive the evolution lifecycle state machine.

**Architecture:** Pure decision engine evaluates A2 VerificationEvidence (and advisory A2.5 GovernanceRecommendation) against a governance policy config, producing a structured GovernanceDecision. A lifecycle bridge maps that decision to EvolutionStateMachine transitions and emits audit evidence. CLI command `alix governance evolution decide <evolution-id>` wires the pipeline. A3 is policy-dependent — different policies on the same evidence yield different decisions.

**Tech Stack:** TypeScript, Node:test, EvolutionStateMachine (A0.2), VerificationEvidenceLedger (A2.4), RecommendationEngine (A2.5), EvolutionEvidenceBridge (A0.3)

---

## Global Constraints

- Evidence freshness: A3 MUST NOT consume expired VerificationEvidence (fail-closed by default)
- A2.5 recommendations are advisory — A3 owns the final decision
- Decision engine MUST be pure — no side effects, no store access, no I/O
- EvolutionStateMachine.transition() is the single mutation point for lifecycle changes
- Decision MUST be persisted before lifecycle transition (append-first)
- Follow the A1 GovernanceIntakeAdapter pattern for integration
- Same (evidence, recommendation, config) inputs MUST produce identical decision (deterministic)

---

## File Structure

### New Files

| Path | Responsibility |
|------|---------------|
| `src/evolution/governance/contracts/decision-contract.ts` | A3.0: GovernanceDecision, GovernanceDecisionKind, GovernancePolicyConfig types |
| `src/evolution/governance/contracts/decision-store-contract.ts` | A3.1: GovernanceDecisionStore interface |
| `src/evolution/governance/decision-engine.ts` | A3.2: Pure decision function |
| `src/evolution/governance/decision-store.ts` | A3.5: InMemoryGovernanceDecisionStore |
| `src/evolution/governance/governance-decision-bridge.ts` | A3.3: Lifecycle bridge (decision → state machine) |
| `src/evolution/governance/governance-decision-cli.ts` | A3.4: CLI handler |
| `src/evolution/governance/index.ts` | Barrel re-exports |
| `tests/evolution/governance/decision-contract.test.ts` | Validators for decision types |
| `tests/evolution/governance/decision-engine.test.ts` | Unit tests for pure decision logic |
| `tests/evolution/governance/decision-store.test.ts` | Append-only store tests |
| `tests/evolution/governance/governance-decision-bridge.test.ts` | Bridge with mocked state machine |
| `tests/evolution/governance/integration/a3-integration.test.ts` | A2→A3→lifecycle end-to-end |

### Modified Files

| File | Change |
|------|--------|
| `src/governance/evolution-cli.ts` | Add `"decide"` subcommand to `handleEvolutionCommand` switch |
| `src/cli/commands/governance.ts` | Wire A3 dependencies into evolution CLI dispatch |
| `src/evolution/verification/index.ts` | No change — already exports needed types |

---

## Task 1: A3 Contract Types

**Files:**
- Create: `src/evolution/governance/contracts/decision-contract.ts`
- Create: `src/evolution/governance/contracts/decision-store-contract.ts`
- Create: `src/evolution/governance/index.ts`
- Create: `tests/evolution/governance/decision-contract.test.ts`

**Interfaces:**
- Produces: `GovernanceDecisionKind` (type + const array), `GovernanceDecision` (interface), `GovernancePolicyConfig` (interface + DEFAULT_GOVERNANCE_POLICY), `GovernanceDecisionStore` (interface)

### Key Types

```typescript
// GovernanceDecisionKind — 4-value enum
export type GovernanceDecisionKind =
  | "APPROVE"
  | "REJECT"
  | "MONITOR"
  | "REQUEST_MORE_EVIDENCE";

// GovernanceDecision — the core A3 artifact
export interface GovernanceDecision {
  decisionId: string;                    // prefix "govd-"
  proposalId: string;
  evolutionId: string;
  kind: GovernanceDecisionKind;
  confidence: number;                    // 0-1
  reasoning: string;
  risks: readonly string[];
  evidenceId: string;                    // source A2 evidence
  recommendationId?: string;             // optional A2.5 recommendation
  recommendationAvailable: boolean;
  followedRecommendation: boolean;
  overrideReason?: string;
  policySnapshot: GovernancePolicyConfig; // config at decision time
  targetState: "APPROVED" | "REJECTED" | "UNDER_REVIEW";
  decidedAt: string;
  decidedBy: "operator" | "governance_policy" | "auto_escalation";
}

// GovernancePolicyConfig — the policy-dependent parameterization
export interface GovernancePolicyConfig {
  policyName: string;
  minApproveConfidence: number;          // default 0.8
  minMonitorConfidence: number;          // default 0.5
  rejectConfidenceThreshold: number;     // default 0.3
  maxAllowedRegressions: number;         // default 0
  escalateBehavior: "reject" | "request_evidence";
  failClosedOnExpiredEvidence: boolean;  // default true
  minReproducibilityLevel: number;       // default 2
  riskClassOverrides?: Record<string, Partial<GovernancePolicyConfig>>;
}
```

### Validation

Add `validateGovernanceDecision(value: unknown): ValidationResult` pure function following the contract validation pattern from existing A0/A2 contracts.

### Tests

```
- accepts valid GovernanceDecision
- rejects missing decisionId
- rejects invalid confidence range
- rejects invalid targetState
- rejects missing evidenceId
- DEFAULT_GOVERNANCE_POLICY has conservative defaults
```

---

## Task 2: InMemoryGovernanceDecisionStore

**Files:**
- Create: `src/evolution/governance/decision-store.ts`
- Create: `tests/evolution/governance/decision-store.test.ts`

**Interfaces:**
- Implements: `GovernanceDecisionStore`
- Pattern: Follows `InMemoryVerificationEvidenceLedger` from `src/evolution/verification/evidence/evidence-ledger.ts`
- Consumes: `GovernanceDecision`

### Key Behavior

```typescript
export class InMemoryGovernanceDecisionStore implements GovernanceDecisionStore {
  // store(): append-only — throws on duplicate decisionId
  //   Performs structuredClone for deep copy
  // get(): returns deep copy, throws not-found
  // listByProposal(): filters entries, returns deep copies
  // listByEvolution(): filters entries, returns deep copies
}
```

### Tests

```
- stores and retrieves decision by ID
- throws on duplicate decisionId (append-only)
- throws on unknown decisionId
- listByProposal returns correct decisions
- listByEvolution returns correct decisions
- deep copy prevents external mutation
```

---

## Task 3: Pure Decision Engine

**Files:**
- Create: `src/evolution/governance/decision-engine.ts`
- Create: `tests/evolution/governance/decision-engine.test.ts`

**Interfaces:**
- Consumes: `VerificationEvidence` (from A2), `GovernanceRecommendation` (from A2.5, optional), `GovernancePolicyConfig`
- Produces: `GovernanceDecision`
- Pure — no side effects, no I/O, no store access

### Decision Flow

```
1. Evidence freshness check → fail-closed: expired = REJECT
2. Resolve policy thresholds (with risk-class overrides)
3. Confidence < rejectConfidenceThreshold → REJECT
4. Regressions > maxAllowedRegressions → REJECT
5. reproducibilityLevel < minReproducibilityLevel → REQUEST_MORE_EVIDENCE
6. confidence >= minApproveConfidence + no regressions → APPROVE
7. confidence >= minMonitorConfidence → MONITOR
8. A2.5 ESCALATE → per escalateBehavior: REJECT or REQUEST_MORE_EVIDENCE
9. Fallback → REQUEST_MORE_EVIDENCE
```

### Key Export

```typescript
export function generateDecision(
  evidence: VerificationEvidence,
  recommendation?: GovernanceRecommendation,
  options?: DecisionConfig,
): GovernanceDecision

export function decisionKindToTargetState(kind: GovernanceDecisionKind): string
```

### Tests

```
FRESHNESS:
  - expired evidence + fail-closed → REJECT (decisionId, risks populated)
  - expired evidence + non-fail-closed → MONITOR
  - fresh evidence → proceeds to confidence checks

CONFIDENCE:
  - confidence >= minApproveConfidence + no regressions → APPROVE
  - confidence >= minMonitorConfidence + regressions → MONITOR
  - confidence < rejectConfidenceThreshold → REJECT

REGRESSIONS:
  - maxAllowedRegressions=0 + 1 regression → REJECT
  - maxAllowedRegressions=1 + 1 regression → APPROVE if else passes

REPRODUCIBILITY:
  - reproducibilityLevel < minReproducibilityLevel → REQUEST_MORE_EVIDENCE

RECOMMENDATION:
  - A2.5 APPROVE + A3 APPROVE → followedRecommendation=true
  - A2.5 APPROVE + A3 REJECT → followedRecommendation=false + overrideReason
  - A2.5 ESCALATE + escalateBehavior="reject" → REJECT
  - A2.5 ESCALATE + escalateBehavior="request_evidence" → REQUEST_MORE_EVIDENCE
  - No recommendation → recommendationAvailable=false

DETERMINISM:
  - same inputs → identical deep-equal decision

STATE MAPPING:
  - APPROVE → APPROVED
  - REJECT → REJECTED
  - MONITOR → UNDER_REVIEW
  - REQUEST_MORE_EVIDENCE → UNDER_REVIEW
```

---

## Task 4: Governance Decision Bridge

**Files:**
- Create: `src/evolution/governance/governance-decision-bridge.ts`
- Create: `tests/evolution/governance/governance-decision-bridge.test.ts`

**Interfaces:**
- Consumes: `EvolutionStateMachine`, `GovernanceDecisionStore`, `EvolutionEvidenceBridge`
- Produces: `GovernanceDecisionBridgeResult`

### Key Export

```typescript
export class GovernanceDecisionBridge {
  constructor(
    stateMachine: EvolutionStateMachine,
    decisionStore: GovernanceDecisionStore,
    evidenceBridge?: EvolutionEvidenceBridge,
  ) {}

  async execute(decision: GovernanceDecision): Promise<GovernanceDecisionBridgeResult>
  // Returns: { decision, lifecycleTransitioned, transition?, error? }
}
```

### Bridge Flow

```
1. decisionStore.store(decision)   // persist first (append-only)
2. Map decision kind to target state via decisionKindToTargetState()
3. stateMachine.transition(evolutionId, targetState)  // lifecycle transition
4. evidenceBridge.emitTransitionEvent()  // audit evidence (if available)
5. Return result with transition details
```

### Tests

```
- APPROVE → stateMachine.transition() called with APPROVED
- REJECT → stateMachine.transition() called with REJECTED
- MONITOR → stateMachine.transition() NOT called (same state)
- REQUEST_MORE_EVIDENCE → stateMachine.transition() NOT called
- stateMachine.transition() throws → error captured in result
- Decision stored before transition attempted
- evidenceBridge emission when available
```

---

## Task 5: CLI Command + Wiring

**Files:**
- Create: `src/evolution/governance/governance-decision-cli.ts`
- Modify: `src/governance/evolution-cli.ts`
- Modify: `src/cli/commands/governance.ts` (dependency wiring)

### CLI Interface

```
alix governance evolution decide <evolution-id> [--policy <name>] [--json]
```

### Command Flow

```
1. Validate evolution exists and is in UNDER_REVIEW state
2. Retrieve latest VerificationEvidence from A2 ledger for this proposal
3. Optionally generate A2.5 GovernanceRecommendation
4. Call generateDecision(evidence, recommendation, policyConfig) → GovernanceDecision
5. Call decisionBridge.execute(decision) → persist + transition + emit
6. Output result
```

### CLI Wire in `src/governance/evolution-cli.ts`

```typescript
// Add to handleEvolutionCommand switch:
case "decide":
  return runDecide({ stateMachine, evidenceStore: deps.evidenceStore }, id, jsonMode, args);
```

The `runDecide` helper imports A3 modules and wires dependencies from existing infrastructure.

---

## Task 6: Integration Test

**Files:**
- Create: `tests/evolution/governance/integration/a3-integration.test.ts`

### End-to-End Scenario

```
1. Create EvolutionStateMachine with an evolution in UNDER_REVIEW state
2. Store VerificationEvidence in InMemoryVerificationEvidenceLedger
3. Generate A2.5 GovernanceRecommendation from evidence
4. Call generateDecision() → APPROVE decision with high confidence
5. Execute via GovernanceDecisionBridge
6. Assert:
   - decision stored in decisionStore
   - evolution state changed to APPROVED
   - decision.evidenceId matches evidence.evidenceId
   - decision.policySnapshot reflects config
```

### Edge Cases

```
- Evolution in wrong state → CLI error, no transition
- No evidence found → CLI error
- Expired evidence → REJECT with fail-closed
```

---

## Verification

```bash
# Unit tests (A3)
npx tsx --test tests/evolution/governance/*.test.ts

# Integration tests
npx tsx --test tests/evolution/governance/integration/*.test.ts

# Full A-series regression (A0+A1+A2+A3)
npx tsx --test tests/evolution/*.test.ts tests/evolution/**/*.test.ts

# TypeScript
npx tsc --noEmit
```

---

## Implementation Sequence

| Order | Task | Files | Pure? |
|-------|------|-------|-------|
| 1 | A3 Contract Types | `decision-contract.ts`, `decision-store-contract.ts`, `index.ts`, contract test | ✅ Pure types |
| 2 | InMemoryGovernanceDecisionStore | `decision-store.ts`, store test | ✅ Side-effect isolated |
| 3 | Decision Engine | `decision-engine.ts`, engine test | ✅ Pure function |
| 4 | Governance Decision Bridge | `governance-decision-bridge.ts`, bridge test | ⚡ Has side effects |
| 5 | CLI | `governance-decision-cli.ts`, wire `evolution-cli.ts` | ⚡ CLI handler |
| 6 | Integration Test | `a3-integration.test.ts` | ⚡ End-to-end |
