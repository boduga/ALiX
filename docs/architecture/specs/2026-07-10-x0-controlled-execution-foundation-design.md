# X0 — Controlled Execution Foundation Design Spec

**Date:** 2026-07-10
**Status:** Design
**Phase:** X0 — Controlled Execution Foundation
**Depends on:** M1 Runtime Contracts, P11.9 Issue-to-PR Proposal Loop, P14–P30 Governance
**Checkpoint target:** `alix-x0-controlled-execution-foundation-complete`

---

## 1. Primary Invariant

X-Series does not grant ALiX autonomy. It creates a governed execution boundary where any action must carry explicit intent, pass validation, produce evidence, and remain reviewable.

**No execution occurs unless there is an approved execution intent with immutable provenance.**

---

## 2. Purpose

ALiX can observe governance evidence (P14–P30), propose engineering changes (P11.9), and formalize runtime contracts (M1). What it cannot yet do is execute actions under a **controlled, auditable intent** — where every operation is bound to an explicit authorization, produces verifiable evidence, and can be traced back through the governance pipeline.

X-Series introduces the Execution Intent — the unit of governed execution. Every action (agent tool call, file change, shell command, MCP invocation) must be authorized by an intent before execution, and the result becomes evidence in the governance pipeline.

X-Series keeps three layers architecturally separated:

```text
Observation Layer (P14–P30)
    |   observes and explains what happened
    v
Execution Control Layer (X-Series)
    |   ensures execution happened under explicit, auditable intent
    v
Runtime Layer (src/agent/, src/tools/, src/mcp/)
    |   performs the actual work
```

No layer collapses into another. Observation ≠ Permission. Prediction ≠ Decision. Execution ≠ Governance.

---

## 3. Position in the Architecture

```text
M0  Existing Runtime (agents, providers, tools, MCP, memory, events)
M1  Runtime Contract Standardization ✅
    ↓
P5–P10   Intelligence Layer ✅
P11.9    Issue-to-PR Proposal Loop ✅
P14–P30  Governance Evidence Layer ✅
    ↓
X-Series Controlled Execution Platform ← DESIGNING
    ↓
A-Series Autonomous Evolution (future)
```

---

## 4. Core Boundary

X-Series is explicitly prohibited from:

- autonomous approval or execution without human intent
- autonomous remediation or self-healing
- policy mutation or threshold changes
- self-authorizing agents or tool execution
- granting permissions without governance review
- hidden execution paths or unlogged operations
- collapsing observation into permission
- making optimization decisions automatically
- executing without an immutable ExecutionIntent record
- bypassing P14–P30 governance evidence pipeline

---

## 5. Execution Lifecycle

```text
Proposal (P11.9)
    ↓
Review Decision (human)
    ↓
ExecutionIntent (created, immutable)
    ↓
Intent Validated (X2 Governor)
    ↓
Execution Authorized
    ↓
Runtime executes (agents, tools, MCP)
    ↓
Execution Evidence captured
    ↓
Governance observes outcome (P14–P30)
```

Key rule: **ExecutionIntent is immutable after creation.** If something changes, a new intent must be created. No mutation of intents in flight.

---

## 6. Proposed Milestone Plan

### X0 — Design Spec (this document)

### X1 — Execution Intent Contract

Create the unit of governed execution:

```typescript
interface ExecutionIntent {
  intentId: string;
  actor: string;
  action: string;
  target: string;
  justification: string;
  constraints: ExecutionConstraints;
  riskClass: "low" | "medium" | "high";
  expectedEffect: string;
  expiration: string;
  approvalReference: string;
  status: "CREATED" | "APPROVED" | "RUNNING" | "COMPLETED" | "FAILED" | "REVOKED";
}
```

ExecutionIntent is immutable after creation. Mutation is not allowed — a rejected or changed intent requires a new proposal.

### X2 — Execution Governor

A gate, not an executor. Responsibilities:

- **Before execution:** validate intent exists, actor identity is valid, target is defined, constraints satisfied, approval requirements met, risk boundary satisfied
- **During execution:** capture start time, heartbeat, deviation detection, failure
- **After execution:** emit outcome, evidence reference, execution summary

The Governor does not know how agents work, how tools execute, or how optimization works. It only enforces the contract.

### X3–X5 (Future Milestones)

- X3 — Evidence Capture → Governance Bridge (connects execution results to P14–P30)
- X4 — Governed Agent Runtime (agents as execution consumers under intent)
- X5 — Governed Optimization Loop (P27 + execution outcomes → human review → improvement)

---

## 7. X1 — Execution Intent Contract (Detailed)

### 7.1 Intent Structure

```typescript
export interface ExecutionConstraints {
  maxFilesChanged: number;
  allowedPaths: string[];
  blockedPaths: string[];
  verificationRequired: boolean;
  allowedTools: string[];
}

export interface ExecutionIntent {
  intentId: string;
  proposalId: string;
  actor: string;
  action: string;
  target: string;
  justification: string;
  constraints: ExecutionConstraints;
  riskClass: "low" | "medium" | "high";
  expectedEffect: string;
  expiration: string;
  approvalReference: string;
  approvedBy: string;
  approvedAt: string;
  status: ExecutionIntentStatus;
}
```

### 7.2 Intent Lifecycle

```typescript
export type ExecutionIntentStatus =
  | "CREATED"
  | "APPROVED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "REVOKED";
```

### 7.3 Contract Rules

- Immutable after creation — no field mutation post-creation
- Status transitions are append-only (event log)
- New intent required for changed parameters
- intentId is deterministic (SHA-256 over proposalId + actor + action)

---

## 8. X2 — Execution Governor (Detailed)

### 8.1 Governor Interface

```typescript
export interface ExecutionGovernor {
  validate(intent: ExecutionIntent): Promise<ValidationResult>;
  authorize(intentId: string): Promise<AuthorizationResult>;
  start(intentId: string): Promise<ExecutionSession>;
  heartbeat(intentId: string, sessionId: string): Promise<void>;
  complete(intentId: string, outcome: ExecutionOutcome): Promise<ExecutionEvidence>;
  fail(intentId: string, reason: string): Promise<ExecutionEvidence>;
  revoke(intentId: string, reason: string): Promise<void>;
}
```

### 8.2 Governor Rules

- Validates before execution — never during
- Does not execute actions — only gates them
- Produces ExecutionEvidence on completion/failure
- All state transitions logged to event system
- No knowledge of agent internals, tool implementations, or optimization logic

---

## 9. Module Boundaries (X1–X2)

### Created Files

| Slice | File | Purpose |
|-------|------|---------|
| X1 | `src/runtime/contracts/execution-intent-contract.ts` | ExecutionIntent types, constraints, lifecycle |
| X1 | `src/runtime/contracts/execution-governor-contract.ts` | Governor interface, validation types |
| X2 | `src/runtime/execution-governor.ts` | Governor implementation |

### Untouched Files

- All files in `src/runtime/contracts/` (M1 contracts remain stable)
- All files in `src/agent/`, `src/providers/`, `src/tools/`, `src/mcp/`, `src/events/`
- All P5–P30 modules
- P11.9 issue run handler and guardrails

---

## 10. Testing Plan

### X1 — Execution Intent Contract (4 tests)

1. ExecutionIntent has all required fields with correct types
2. Intent lifecycle status transitions are valid
3. Deterministic intentId from proposalId + actor + action
4. Immutability assertion — no mutation paths exist in the type

### X2 — Execution Governor (6 tests)

1. validate rejects null/empty intent
2. validate accepts well-formed intent with valid constraints
3. authorize creates authorization event
4. complete produces ExecutionEvidence with correct fields
5. fail produces ExecutionEvidence with failure reason
6. revoke transitions intent to REVOKED status

**Total: 10 tests.**

---

## 11. X-Seal Criteria

X0 may be sealed when:

- X1 ExecutionIntent contract types defined
- X2 Governor interface defined and implemented
- All 10 tests pass
- No existing runtime code modified
- No agent autonomy introduced
- No policy mutation paths created
- All execution produces evidence
- tsc clean

---

## 12. Next Steps

```text
X0 — Controlled Execution Foundation Design Spec
X1 — Execution Intent Contract
X2 — Execution Governor
```
