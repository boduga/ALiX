# P14.6b — Store-Level Audit Decorators Design

**Date:** 2026-07-06
**Status:** Design
**Parent:** P14.0 — Governance Operator Workflow Design
**Depends on:** P14.6a (Audit Emitters), P14.5a (AuditStore), P14.1–P14.4 (Store interfaces)

## Purpose

Extend audit coverage to **all** governance store write paths, not just the CLI handler layer. P14.6a added audit emission in CLI handler functions — but programmatic callers, API layers, and future automation that call store `.append()` methods directly bypass those CLI handlers.

P14.6b closes this gap with **decorator classes** that wrap each store interface and add audit emission at the method level. This ensures every write to a governance store is captured regardless of the caller.

## Non-goals

- **No changes to existing store implementations** — decorators wrap, never modify
- **No changes to P14.6a emitter factories** — reuse as-is, except adding `actionProposedEvent()` as a new dedicated factory
- **No changes to P14.5 audit types or store**
- **No CLI rewiring** — P14.6b implements decorators only; P14.6c will migrate CLI-level emission to use decorated stores
- **No new CLI commands**
- **No new event types**

## Architecture

```
Caller (CLI / API / Automation)
        │
        ▼
┌──────────────────────────────┐
│   AuditDecoratedStore        │  ← Implements SignalStore/DecisionStore/etc.
│   - append()                 │
│     1. delegate to realStore │
│     2. call emitter factory  │
│     3. auditStore.append()   │
│   - list() / getById()   → pass through to realStore
└──────────────────────────────┘
        │
        ├──► RealStore (FileSignalStore, etc.)
        └──► FileAuditStore
```

## Decorator classes

### AuditedSignalStore

Wraps `SignalStore`:

| Method | Behavior |
|--------|----------|
| `append(signal)` | Delegate, then emit `POLICY_EVALUATED` via `signalEvaluatedEvent()` |
| `list()` | Pass-through |
| `getById()` | Pass-through |
| `query()` | Pass-through |

### AuditedDecisionStore

Wraps `DecisionStore`:

| Method | Behavior |
|--------|----------|
| `append(decision)` | Delegate, then emit via `decisionRecordedEvent()` |
| `list()` | Pass-through |
| `getById()` | Pass-through |
| `getBySignalId()` | Pass-through |
| `getByKind()` | Pass-through |

### AuditedActionQueueStore

Wraps `ActionQueueStore`:

| Method | Behavior |
|--------|----------|
| `append(proposal)` | Delegate, then emit `ACTION_ESCALATED` via `actionProposedEvent()` (dedicated factory — NOT `decisionRecordedEvent()`; proposal escalation is distinct from operator decision recording) |
| `appendStatusTransition(transition)` | Delegate, then emit `OVERRIDE_APPLIED` via `actionOverriddenEvent()` |
| `list()` | Pass-through |
| `getById()` | Pass-through |
| `getByDecisionId()` | Pass-through |
| `getTransitions()` | Pass-through |

### AuditedReviewStore

Wraps `ReviewStore`:

| Method | Behavior |
|--------|----------|
| `append(review)` | Delegate, then emit `HUMAN_APPROVAL_REQUESTED` |
| Others | Pass-through |

## Audit failure handling

Same pattern as P14.6a — audit failures are **non-fatal**:

```typescript
async append(signal: GovernanceSignal): Promise<void> {
  await this.inner.append(signal); // must throw if real governance write fails

  try {
    await this.auditStore.append(signalEvaluatedEvent(signal));
  } catch {
    // Non-fatal — audit failure does not block governance
  }
}
```

## Factory functions

Rather than requiring callers to construct decorators manually, provide factory functions that wrap stores in a single call:

```typescript
function auditSignalStore(inner: SignalStore, auditStore: AuditStore): SignalStore
function auditDecisionStore(inner: DecisionStore, auditStore: AuditStore): DecisionStore
function auditActionQueueStore(inner: ActionQueueStore, auditStore: AuditStore): ActionQueueStore
function auditReviewStore(inner: ReviewStore, auditStore: AuditStore): ReviewStore
```

## Files

| File | Purpose |
|------|---------|
| `src/governance/audit-decorators.ts` | All 4 decorator classes + factory functions |
| `tests/governance/audit-decorators.test.ts` | Tests |

## Dependencies

- P14.1: `SignalStore`, `GovernanceSignal`
- P14.2: `ReviewStore`, `OperatorReview`
- P14.3: `DecisionStore`, `OperatorDecision`
- P14.4: `ActionQueueStore`, `GovernanceActionProposal`, `ActionProposalStatusTransition`
- P14.5a: `AuditStore`, `GovernanceAuditEventInput`
- P14.6a: `signalEvaluatedEvent`, `decisionRecordedEvent`, `actionOverriddenEvent`
