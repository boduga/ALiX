# P14.6a — Governance Audit Emitters Plan

**Date:** 2026-07-06
**Status:** Plan
**Depends on:** P14.5a (AuditStore), P14.5b (CLI/Export)
**Spec:** `docs/architecture/specs/2026-07-06-p14-6-governance-audit-emitters.md`

## Overview

Wire the P14.5 audit trail into live governance CLI boundaries. Pure event factory functions produce `GovernanceAuditEventInput` objects from existing domain types; the actual `append()` happens at the CLI handler level after successful store persistence.

## Tasks

### Task 1 — Event factory module

**File:** `src/governance/audit-emitters.ts`

Pure functions that produce `GovernanceAuditEventInput` from existing domain types:

- `signalEvaluatedEvent(signal, ctx?)` — `POLICY_EVALUATED` from a `GovernanceSignal`
- `decisionRecordedEvent(decision, signal?)` — maps `DecisionKind` → event type (`accept`→`action_allowed`, `dismiss`→`action_denied`, `escalate`/`convert_to_issue`→`action_escalated`, `defer`→`action_allowed`)
- `actionOverriddenEvent(transition, proposal?)` — `OVERRIDE_APPLIED` from `ActionProposalStatusTransition`
- `reviewSubmittedEvent(review, signal?)` — `HUMAN_APPROVAL_REQUESTED` from `OperatorReview`

Each factory is a pure function — no store access, no side effects.

### Task 2 — CLI integration

**File:** `src/cli/commands/governance.ts`

Add audit `append()` calls at 5 emission points in existing CLI handlers:

1. `runInboxRefresh` (after signalStore.append at ~line 1839) — one `POLICY_EVALUATED` per signal
2. `runDecide` (after decisionStore.append at ~line 2056) — event per DecisionKind
3. `runActionsMarkExecuted` (after store.appendStatusTransition at ~line 2259) — `OVERRIDE_APPLIED`
4. `runActionsDismiss` (after store.appendStatusTransition at ~line 2317) — `OVERRIDE_APPLIED`
5. `runAuditExport` (after file export) — no event needed (read-only operation)

Instantiate `FileAuditStore` with `cwd` (same as all other stores) and call `auditStore.append(eventInput)`.

Audit failures are non-fatal — logged but do not block the governance operation.

### Task 3 — Tests

**File:** `tests/governance/audit-emitters.test.ts`

| # | Test | What it covers |
|---|---|---|
| 1 | signalEvaluatedEvent produces POLICY_EVALUATED | Event type mapping |
| 2 | signalEvaluatedEvent includes signal fields | Context preservation |
| 3 | decisionRecordedEvent maps accept → action_allowed | Kind mapping |
| 4 | decisionRecordedEvent maps dismiss → action_denied | Kind mapping |
| 5 | decisionRecordedEvent maps escalate → action_escalated | Kind mapping |
| 6 | decisionRecordedEvent maps convert_to_issue → action_escalated | Kind mapping |
| 7 | decisionRecordedEvent maps defer → action_allowed | Kind mapping |
| 8 | decisionRecordedEvent includes decision fields | Context preservation |
| 9 | actionOverriddenEvent marks executed | Transition factory |
| 10 | actionOverriddenEvent dismissed | Transition factory |
| 11 | actionOverriddenEvent includes proposal context | Context preservation |

## Estimated additions

| File | Lines |
|------|-------|
| `src/governance/audit-emitters.ts` | ~120 |
| `tests/governance/audit-emitters.test.ts` | ~200 |
| `src/cli/commands/governance.ts` (amended) | ~+60 |
| **Total new** | ~380 |

## Dependencies

- P14.5a: `FileAuditStore`, `GovernanceAuditEventInput`, `GovernanceEventType`
- P14.1: `GovernanceSignal` type
- P14.3: `OperatorDecision`, `DecisionKind`
- P14.4: `GovernanceActionProposal`, `ActionProposalStatusTransition`
- P14.2: `OperatorReview` type
