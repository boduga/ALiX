# P14.6b — Store-Level Audit Decorators Plan

**Date:** 2026-07-06
**Status:** Plan
**Depends on:** P14.6a (Audit Emitters), P14.5 (Audit Store)
**Spec:** `docs/architecture/specs/2026-07-06-p14-6b-store-level-audit-decorators.md`

## Overview

Add audit decorators for each governance store interface, ensuring every write path captures an audit event regardless of caller. Four decorator classes wrapping `SignalStore`, `DecisionStore`, `ActionQueueStore`, and `ReviewStore`. Two new emitter factories: `actionProposedEvent` and `reviewSubmittedEvent`. No new event types, CLI commands, or export formats.

**Strategy: Option A** — decorators only, no CLI rewiring in P14.6b. P14.6a CLI appends remain in place for now. A future P14.6c will migrate CLI-level emission to use decorated stores and remove the explicit P14.6a CLI appends, ensuring exactly one audit event per operation.

## Tasks

### Task 1 — AuditedSignalStore

**File:** `src/governance/audit-decorators.ts`

Decorates `SignalStore.append()`:
1. Delegate to inner store
2. Call `signalEvaluatedEvent(signal)` to create audit input
3. Call `auditStore.append(auditInput)`
4. Inner store write failures must propagate (decorator does not catch)
5. Only audit append failures are non-fatal (catch silently)
6. Read methods (`list`, `getById`, `query`) pass through directly

### Task 2 — AuditedDecisionStore

**File:** `src/governance/audit-decorators.ts`

Decorates `DecisionStore.append()`:
1. Delegate to inner store
2. Call `decisionRecordedEvent(decision)` to create audit input
3. Call `auditStore.append(auditInput)`
4. Read methods (`list`, `getById`, `getBySignalId`, `getByKind`) pass through

### Task 3 — AuditedActionQueueStore

**File:** `src/governance/audit-decorators.ts`

Decorates both write methods:
- `append(proposal)` — delegate, then call `auditStore.append(actionProposedEvent(proposal))`
  - Uses a dedicated `actionProposedEvent()` factory (NOT `decisionRecordedEvent()`).
    Proposal escalation is a distinct governance event from operator decision recording.
    See Task 5a.
- `appendStatusTransition(transition)` — delegate, then call `auditStore.append(actionOverriddenEvent(transition))`
  - Maps to `OVERRIDE_APPLIED` via `actionOverriddenEvent()`.
- Read methods (`list`, `getById`, `getByDecisionId`, `getTransitions`) pass through

### Task 4 — AuditedReviewStore (naming: use full `AuditedReviewStore`, not bare `ReviewStore`)

**File:** `src/governance/audit-decorators.ts`

Decorates `ReviewStore.append()`:
1. Delegate to inner store
2. Call `reviewSubmittedEvent(review)` to create audit input
3. Call `auditStore.append(auditInput)`
4. Read methods (`list`, `getById`, `getBySignalId`) pass through

### Task 5a — actionProposedEvent factory

**File:** `src/governance/audit-emitters.ts`

Add a new pure factory function:

```typescript
export function actionProposedEvent(
  proposal: GovernanceActionProposal,
  traceId?: string,
): GovernanceAuditEventInput
```

Maps to `ACTION_ESCALATED` event type with:
- `actorType: "system"`, `actorId: "governance"` (the system proposed the action)
- `subjectType: "proposal"`, `subjectId: proposal.proposalId`
- `action: "escalate"`, `decision: "escalated"`
- `riskLevel: proposal.impact` (preserves the proposal's assessed impact)
- `requiresHumanReview: true` (an escalated action always needs human review)
- `metadata: { proposalKind, sourceDecisionId, targetRef }`

This is a distinct factory from `decisionRecordedEvent()` — proposal action escalation
is a separate governance event from operator decisions. Using a dedicated factory
ensures correct event shape and prevents confusion in the audit trail.

### Task 5b — reviewSubmittedEvent factory

**File:** `src/governance/audit-emitters.ts`

Add a new pure factory function:

```typescript
export function reviewSubmittedEvent(
  review: OperatorReview,
  traceId?: string,
): GovernanceAuditEventInput
```

Maps to `HUMAN_APPROVAL_REQUESTED` event type with:
- `actorType: "human"`, `actorId: review.reviewer`
- `subjectType: "signal"`, `subjectId: review.signalId`
- `action: "submit_review"`
- `riskLevel: "medium"` (review is always a human check step)
- `requiresHumanReview: false` (the review itself is the human review)
- `metadata: { reviewId, hasNotes: notes !== null, hasClassification: classification !== null }`

### Task 6 — Factory functions and exports

**File:** `src/governance/audit-decorators.ts`

Export factory functions that wrap stores in a single call:

```typescript
export function auditSignalStore(inner: SignalStore, auditStore: AuditStore): SignalStore
export function auditDecisionStore(inner: DecisionStore, auditStore: AuditStore): DecisionStore
export function auditActionQueueStore(inner: ActionQueueStore, auditStore: AuditStore): ActionQueueStore
export function auditReviewStore(inner: ReviewStore, auditStore: AuditStore): ReviewStore
```

Factory naming uses `audit{StoreName}` (lowercase "audit" prefix) to match JavaScript
convention, while the underlying class uses `Audited{StoreName}` (full adjective prefix).

Each factory constructs the decorator class and returns it typed to the store interface.

### Task 7 — Tests

**File:** `tests/governance/audit-decorators.test.ts`

| # | Test | What it covers |
|---|---|---|
| 1 | AuditedSignalStore.append delegates to inner store | Inner.append called |
| 2 | AuditedSignalStore.append emits audit event via emitter | signalEvaluatedEvent wiring |
| 3 | AuditedSignalStore.list passes through | Read method not decorated |
| 4 | AuditedSignalStore.query passes through | Second read method not decorated |
| 5 | AuditedDecisionStore.append delegates + emits | decisionRecordedEvent wiring |
| 6 | AuditedDecisionStore.list passes through | Read method not decorated |
| 7 | AuditedActionQueueStore.append delegates + emits | proposal → actionProposedEvent |
| 8 | AuditedActionQueueStore.appendStatusTransition delegates + emits | transition → actionOverriddenEvent |
| 9 | AuditedActionQueueStore.getById passes through | Read method not decorated |
| 10 | AuditedReviewStore.append delegates + emits | reviewSubmittedEvent wiring |
| 11 | Audit failure is non-fatal — inner store append succeeds | try/catch invariant |
| 12 | Factory functions return properly typed stores | Factory correctness |
| 13 | actionProposedEvent factory produces correct event shape | Event fields match spec |
| 14 | actionProposedEvent preserves proposal impact as riskLevel | riskLevel linkage |

## Estimated additions

| File | Lines | Change type |
|------|-------|-------------|
| `src/governance/audit-decorators.ts` | ~150 | New file |
| `src/governance/audit-emitters.ts` | ~+55 | Amend (add actionProposedEvent + reviewSubmittedEvent) |
| `tests/governance/audit-decorators.test.ts` | ~250 | New file |
| **Total new** | ~455 | |

## Dependencies

- P14.1: `SignalStore`, `GovernanceSignal`
- P14.2: `ReviewStore`, `OperatorReview`
- P14.3: `DecisionStore`, `OperatorDecision`
- P14.4: `ActionQueueStore`, `GovernanceActionProposal`, `ActionProposalStatusTransition`
- P14.5a: `AuditStore`, `GovernanceAuditEventInput`, `GovernanceEventType`
- P14.6a: `signalEvaluatedEvent`, `decisionRecordedEvent`, `actionOverriddenEvent`

## Deliberate design decisions (added during refinement)

1. **Option A strategy — decorators only, no CLI rewiring in P14.6b.** P14.6a CLI appends remain in place. A future P14.6c migration step will wire CLI handlers to decorated stores and remove the explicit P14.6a appends. This prevents double audit emission during the transition.

2. **`AuditedActionQueueStore.append` uses a dedicated `actionProposedEvent()`**, NOT `decisionRecordedEvent()`. Proposal action escalation is conceptually distinct from operator decision recording. Using a dedicated factory ensures correct event fields (actorType "system", proposal impact as riskLevel) and prevents audit trail confusion.

3. **`AuditedReviewStore.append` uses a new `reviewSubmittedEvent()`**, not an existing emitter. Rationale: review submission has no counterpart in P14.6a's emitter set. It maps to `HUMAN_APPROVAL_REQUESTED`, which is a distinct event type.

4. **All four decorators follow identical non-fatal failure policy** — audit append failure is caught silently, the inner store write already succeeded.

5. **Naming convention**: class names use `Audited{StoreName}` (e.g., `AuditedReviewStore`), factory functions use `audit{StoreName}` (e.g., `auditReviewStore`). Maintains consistency across all four decorators.
