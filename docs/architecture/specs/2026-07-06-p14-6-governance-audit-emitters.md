# P14.6 — Governance Audit Emitters / Integration Design

**Date:** 2026-07-06
**Status:** Design
**Parent:** P14.0 — Governance Operator Workflow Design
**Depends on:** P14.5a (AuditStore), P14.5b (CLI/Export)

## Purpose

Wire the shipped P14.5 audit trail into live governance boundaries. P14.5 gave ALiX the **ledger** — P14.6 makes it **write in it**. Every governance-relevant decision during operator workflow execution emits a structured audit event.

## Non-goals

- **No new store patterns** — reuses P14.5a `FileAuditStore`
- **No new CLI commands** — P14.5b already covers query/export
- **No runtime action auditing** — only governance-boundary events
- **No changes to P14.5 core types** — `GovernanceAuditEvent` unchanged

## Architecture

```
P14.1 Signal Store ──→ auditor.signalCreated()
P14.2 Review Session ──→ auditor.reviewSubmitted()
P14.3 Decision Capture ──→ auditor.decisionRecorded()
P14.4 Action Queue ──→ auditor.actionProposed()
                          auditor.actionResolved()
Approval Workflow ──→ auditor.approvalRequested()
                       auditor.approvalGranted()
                       auditor.approvalDenied()
Override Detection ──→ auditor.overrideDetected()
```

Each integration point follows the same pattern:

```typescript
// In existing function, after successful operation:
const auditEvent: GovernanceAuditEventInput = { ... };
await auditStore.append(auditEvent);
```

## Integration Design

Rather than threading an `AuditStore` through every function signature, each store module gets a public `auditEventCreators` module — a set of pure factory functions that produce `GovernanceAuditEventInput` objects from existing domain types. The actual `append()` call happens at the highest appropriate level (CLI handler or store method), keeping pure domain functions testable without store dependencies.

### Event factories (pure functions)

```
src/governance/audit-emitters.ts

function signalCreatedEvent(signal, ctx?)          → GovernanceAuditEventInput
function reviewSessionEvent(review, decision?)      → GovernanceAuditEventInput
function decisionRecordedEvent(decision, signal?)   → GovernanceAuditEventInput
function actionProposedEvent(proposal, decision?)   → GovernanceAuditEventInput
function actionResolvedEvent(transition, proposal?) → GovernanceAuditEventInput
function approvalEvent(approval, result?)           → GovernanceAuditEventInput
function overrideEvent(override, ctx?)              → GovernanceAuditEventInput
```

### CLI handler integration

The `append()` calls go in the CLI handler functions in `src/cli/commands/governance.ts`, after the successful store operation. This keeps the domain modules pure (no audit dependency) while still capturing every governance action at the operator boundary.

### Store method integration (alternative)

For operations that happen outside the CLI (e.g., programmatic API calls, future automation), attach audit directly at the store layer via a wrapper/decorator pattern. Deferred to P14.6b if needed.

## Integration points

| Area | Trigger point | Event type(s) | Priority |
|------|--------------|---------------|----------|
| Signal creation | After `FileSignalStore.append()` in CLI `runInboxRefresh` | `POLICY_EVALUATED` | Medium |
| Review submitted | After `FileReviewStore.append()` in CLI `runReviewSubmit` | `HUMAN_APPROVAL_REQUESTED` | High |
| Decision recorded | After `FileDecisionStore.append()` in CLI `runDecision` | `ACTION_ALLOWED` / `ACTION_DENIED` / `ACTION_ESCALATED` | High |
| Action proposed | After `FileActionQueueStore.append()` in `refreshProposals` | `ACTION_ESCALATED` | High |
| Action dismissed | After `FileActionQueueStore.appendStatusTransition()` in CLI `runActionsDismiss` | `OVERRIDE_APPLIED` | High |
| Action executed | After `FileActionQueueStore.appendStatusTransition()` in CLI `runActionsMarkExecuted` | `OVERRIDE_APPLIED` | Medium |
| Approval gate | In `approval-workflow.ts` gate functions | `HUMAN_APPROVAL_REQUESTED` / `GRANTED` / `DENIED` | High |

## Files

| File | Purpose |
|------|---------|
| `src/governance/audit-emitters.ts` | Pure event factory functions |
| `src/cli/commands/governance.ts` | Integration calls in handler functions |
| `tests/governance/audit-emitters.test.ts` | Event factory tests |

## Dependencies

- P14.5a audit types, store, query
- P14.1–P14.4 domain types
