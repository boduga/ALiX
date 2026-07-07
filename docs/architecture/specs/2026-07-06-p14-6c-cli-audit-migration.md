# P14.6c — CLI Migration to Store-Level Audit Decorators

**Date:** 2026-07-06
**Status:** Design
**Parent:** P14.0 — Governance Operator Workflow Design
**Depends on:** P14.6b (Store-Level Audit Decorators), P14.6a (CLI Audit Emitters)

## Purpose

Remove direct CLI-level audit appends and make audited stores the single audit emission boundary. P14.6a added CLI-level emission as a first pass. P14.6b added store-level decorators without rewiring to avoid duplicate audit records. P14.6c completes the transition: it wires CLI handlers to decorated stores and removes the P14.6a direct append calls.

## Current state (transitional)

```
CLI Handler (governance.ts)
  ├── FileSignalStore.append(signal)
  │     └── (no audit — must emit inline)
  ├── direct auditStore.append(event)   ← P14.6a explicit call
  └── output
```

## Target state

```
CLI Handler (governance.ts)
  └── AuditedSignalStore.append(signal)
        ├── FileSignalStore.append(signal)
        └── AuditStore.append(event)    ← P14.6b decorator handles this
```

## P14.6a direct audit appends to remove (4 sites)

All in `src/cli/commands/governance.ts`:

| # | Handler | Lines | Emitter | Event type |
|---|---------|-------|---------|------------|
| 1 | `runInboxRefresh` | 1842–1846 | `signalEvaluatedEvent(signal)` | `policy_evaluated` |
| 2 | `runDecide` | 2065–2068 | `decisionRecordedEvent(decision, signal)` | `action_allowed/denied/escalated` |
| 3 | `runActionsMarkExecuted` | 2279–2282 | `actionOverriddenEvent(transition, proposal)` | `override_applied` |
| 4 | `runActionsDismiss` | 2341–2344 | `actionOverriddenEvent(transition, proposal)` | `override_applied` |

## Raw stores to replace with audited stores (6 sites)

| # | Handler | Raw store | Audited wrapper | Write method |
|---|---------|-----------|-----------------|-------------|
| 1 | `runInboxRefresh` | `FileSignalStore` | `auditSignalStore` | `append(signal)` |
| 2 | `runReview` (create) | `FileReviewStore` | `auditReviewStore` | `append(review)` |
| 3 | `runDecide` | `FileDecisionStore` | `auditDecisionStore` | `append(decision)` |
| 4 | `runActionsRefresh` | `FileActionQueueStore` | `auditActionQueueStore` | `append(proposal)` (indirect via `refreshProposals`) |
| 5 | `runActionsMarkExecuted` | `FileActionQueueStore` | `auditActionQueueStore` | `appendStatusTransition(transition)` |
| 6 | `runActionsDismiss` | `FileActionQueueStore` | `auditActionQueueStore` | `appendStatusTransition(transition)` |

Stores used **only for reads** (no wrapping needed): `runInboxList`, `runReview` show-mode, `runActionsList`, signal store in `runDecide` (read-only getById), review store in `runDecide` (read-only validation).

## Audit emission mapping after migration

| CLI operation | Write path | Emitter | Event type |
|---------------|-----------|---------|------------|
| `inbox refresh` | `AuditedSignalStore.append` | `signalEvaluatedEvent` | `policy_evaluated` |
| `review --notes/--classification` | `AuditedReviewStore.append` | `reviewSubmittedEvent` | `human_approval_requested` |
| `decide --accept/dismiss/...` | `AuditedDecisionStore.append` | `decisionRecordedEvent` | `action_allowed/denied/escalated` |
| `actions refresh` | `AuditedActionQueueStore.append` | `actionProposedEvent` | `action_escalated` |
| `actions mark-executed` | `AuditedActionQueueStore.appendStatusTransition` | `actionOverriddenEvent` | `override_applied` |
| `actions dismiss` | `AuditedActionQueueStore.appendStatusTransition` | `actionOverriddenEvent` | `override_applied` |

## Non-goals

- No new audit event types
- No changes to GovernanceAuditEvent core types
- No new CLI commands
- No changes to export/redaction behavior
- No API endpoints
- No new store patterns
- No changes to read-only CLI operations
- No changes to non-governance CLI handlers

## Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Replace 6 raw stores with audited wrappers; remove 4 direct audit append blocks |
| `tests/governance/audit-migration.test.ts` | New: integration tests proving each operation emits exactly one audit event |

## Dependencies

- P14.6b: `auditSignalStore`, `auditDecisionStore`, `auditActionQueueStore`, `auditReviewStore` from `audit-decorators.js`
- P14.5a: `FileAuditStore` from `audit-store.js`
- P14.1–P14.4: Raw store classes

## Invariant

Each successful governance CLI mutation emits exactly **one** audit event, through the decorated store layer. Duplicate audit events are impossible in normal CLI flows.
