# P14.7 — Governance Audit Hardening / Coverage Closure

**Date:** 2026-07-06
**Status:** Design
**Parent:** P14.0 — Governance Operator Workflow Design
**Depends on:** P14.6c (CLI Migration to Store-Level Audit Decorators)
**Closes:** GitHub Issue #241

## Purpose

P14.6 established audited store decorators as the single governance audit emission boundary and migrated all CLI mutation paths to use them. P14.6c's code review surfaced one coverage gap (Issue #241): the indirect `actions refresh` → `refreshProposals` → audited append path is proven correct only by reasoning, not by a test that runs `refreshProposals` against an audited store.

P14.7 closes that gap and hardens the audit spine with full-matrix coverage: a direct assertion that **every** governance mutation path emits exactly one audit event, and stronger sentinel tests that prevent the P14.6a dual-emission path from silently returning.

## Governance mutation paths (the matrix)

All in `src/cli/commands/governance.ts`. After P14.6c, each routes through an audited store decorator:

| # | CLI operation | Handler | Decorated write | Emitter | Event type |
|---|---------------|---------|-----------------|---------|------------|
| 1 | `inbox refresh` | `runInboxRefresh` | `AuditedSignalStore.append` | `signalEvaluatedEvent` | `policy_evaluated` |
| 2 | `review --notes/--classification` | `runReview` (create) | `AuditedReviewStore.append` | `reviewSubmittedEvent` | `human_approval_requested` |
| 3 | `decide --accept/...` | `runDecide` | `AuditedDecisionStore.append` | `decisionRecordedEvent` | `action_allowed/denied/escalated` |
| 4 | `actions refresh` | `runActionsRefresh` | `AuditedActionQueueStore.append` *(indirect, via `refreshProposals`)* | `actionProposedEvent` | `action_escalated` |
| 5 | `actions mark-executed` | `runActionsMarkExecuted` | `AuditedActionQueueStore.appendStatusTransition` | `actionOverriddenEvent` | `override_applied` |
| 6 | `actions dismiss` | `runActionsDismiss` | `AuditedActionQueueStore.appendStatusTransition` | `actionOverriddenEvent` | `override_applied` |

Read-only operations (no audit, must stay silent): `inbox list`, `review` show-mode, `actions list`, signal/review lookups in `runDecide`, all `list`/`getById`/`query`/`getBySignalId`/`getByKind`/`getByDecisionId`/`getTransitions` reads.

## Gaps P14.7 closes

| Gap | Current state | P14.7 deliverable |
|-----|---------------|-------------------|
| Indirect `refreshProposals` path (Issue #241) | Proven sound by reasoning only | Integration test: seed stores, run `refreshProposals` with an audited action queue, assert one `action_escalated` per created proposal; re-run asserts 0 new (dedup) |
| Full-matrix single-emission | Decorator unit tests cover each store in isolation; no test proves the *real* write path end-to-end | One end-to-end test per mutation path using real `File*Store` + spy audit store, asserting exactly one event with the correct event type |
| Sentinel strength | Catches direct emitter *call sites* | Add sentinel: `governance.ts` does not import the `audit-emitters` module at all (stronger than per-symbol checks) |
| Read-only silence | Covered per-store in unit tests | Explicit matrix test: every read method on every audited store emits 0 events |

## Non-goals

- No new audit event types
- No changes to GovernanceAuditEvent core types
- No changes to decorator behavior (P14.6b is final)
- No changes to store interfaces
- No new CLI commands
- No changes to export/redaction behavior
- No API endpoints
- No changes to non-governance handlers (executive/diagnostics `store.append("health", ...)` etc. are a different store, out of scope)

## Files

| File | Change |
|------|--------|
| `tests/governance/audit-migration.test.ts` | Extend: refreshProposals integration test, full-matrix end-to-end tests, strengthened sentinels, read-only silence matrix |

No source changes. P14.7 is coverage-only — if any test surfaces a real emission bug, that is a defect to fix in a separate slice, not within P14.7's coverage-only scope (unless trivial).

## Dependencies

- P14.6b: audited store factories + emitters
- P14.6c: CLI migration (the paths under test)
- P14.1–P14.4: real `File*Store` classes for end-to-end seeding

## Invariants to prove

1. Each successful governance CLI mutation emits exactly **one** audit event (per created record)
2. Each audit event carries the correct `eventType` for its operation
3. Read-only operations emit **zero** audit events
4. `governance.ts` contains no direct import of `audit-emitters` and no direct emitter calls
5. `refreshProposals` deduplication emits zero new events on re-run
