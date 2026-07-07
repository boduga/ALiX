# P14.7 — Governance Audit Hardening / Coverage Closure

**Date:** 2026-07-06
**Status:** Plan
**Depends on:** P14.6c (CLI Migration to Store-Level Audit Decorators)
**Spec:** `docs/architecture/specs/2026-07-06-p14-7-audit-hardening.md`
**Closes:** GitHub Issue #241

## Overview

Coverage-only hardening slice. Closes the one gap surfaced in P14.6c's review (the indirect `refreshProposals` write path), adds full-matrix end-to-end proof that every governance mutation emits exactly one audit event, and strengthens the regression sentinels so the P14.6a dual-emission path cannot silently return.

**No source changes.** If a test reveals a real defect, it is fixed in a separate slice.

## Tasks

### Task 1 — refreshProposals integration test (closes Issue #241)

**File:** `tests/governance/audit-migration.test.ts`

Add a `describe("refreshProposals via audited action queue store")` block. Seed real `FileSignalStore` + `FileDecisionStore` in a temp dir (pattern from `action-queue.test.ts:69`), wrap the action queue with `auditActionQueueStore` + a **spy audit store** (in-memory array capturing appends, or a mock whose `append` pushes to an array). Then:

| # | Test | Assertion |
|---|------|-----------|
| 1 | One eligible escalate decision + its signal → `refreshProposals` | Spy received exactly **1** `action_escalated` event; `created.length === 1` |
| 2 | Two eligible decisions (one escalate, one convert_to_issue) | Spy received exactly **2** events |
| 3 | Re-run `refreshProposals` over the same seeded data (dedup) | Spy received **0** new events; `created.length === 0` |
| 4 | Decision whose signal is missing → skipped | Spy received **0** events |

Use the existing `mkdtempSync`/`rmSync` helpers. Cleanup with `cleanupTempDir` per test.

### Task 2 — Full-matrix end-to-end single-emission

**File:** `tests/governance/audit-migration.test.ts`

Add a `describe("full-matrix single audit emission")` block. For each mutation path, drive the **real** audited store (real `File*Store` wrapped, spy audit store) through the same write the CLI performs, and assert exactly one event of the correct type:

| # | Operation | Drive | Expected event type |
|---|-----------|-------|---------------------|
| 1 | `inbox refresh` | `auditSignalStore(...).append(signal)` | `policy_evaluated` |
| 2 | `review create` | `auditReviewStore(...).append(review)` | `human_approval_requested` |
| 3 | `decide accept` | `auditDecisionStore(...).append(decision)` | `action_allowed` |
| 4 | `decide dismiss` | `auditDecisionStore(...).append(decision)` | `action_denied` |
| 5 | `decide escalate` | `auditDecisionStore(...).append(decision)` | `action_escalated` |
| 6 | `actions mark-executed` | `auditActionQueueStore(...).appendStatusTransition(transition)` | `override_applied` |
| 7 | `actions dismiss` | `auditActionQueueStore(...).appendStatusTransition(transition)` | `override_applied` |

Each test asserts: spy length === 1 **and** `spy[0].eventType === <expected>`.

> Path #4 (`actions refresh`) is covered by Task 1, not duplicated here.

### Task 3 — Read-only silence matrix

**File:** `tests/governance/audit-migration.test.ts`

Add a `describe("read-only operations remain audit-silent")` block asserting **0** events across every read method of every audited store:

- `auditSignalStore`: `list`, `getById`, `query`
- `auditDecisionStore`: `list`, `getById`, `getBySignalId`, `getByKind`
- `auditActionQueueStore`: `list`, `getById`, `getByDecisionId`, `getTransitions`
- `auditReviewStore`: `list`, `getById`, `getBySignalId`

This already exists per-store in the current file (sections 1–4). Task 3 consolidates/strengthens into one explicit matrix assertion so a new read method added later is a visible gap.

### Task 4 — Strengthen regression sentinels

**File:** `tests/governance/audit-migration.test.ts`

Extend the existing `governance.ts migration sentinel` block:

| # | New sentinel test | Assertion |
|---|-------------------|-----------|
| 1 | No `audit-emitters` module import at all | `source.includes("audit-emitters")` is `false` — stronger than the per-symbol checks; the CLI must never touch emitters directly, only via decorators |
| 2 | No `FileAuditStore(...).append(` inline construction+append | Regex `/new\s+FileAuditStore\([^)]*\)\.append\(/` matches 0 lines |
| 3 | Every `FileSignalStore`/`FileDecisionStore`/`FileReviewStore`/`FileActionQueueStore` instantiation that feeds a `.append(`/`.appendStatusTransition(` is wrapped by an `audit*Store(...)` call | Heuristic text assertion; document the heuristic in a comment so future maintainers know its limits |

Keep the existing per-symbol sentinels (signalEvaluatedEvent, decisionRecordedEvent, actionOverriddenEvent, inline `.append(` + `FileAuditStore`/`auditStore`).

## Estimated additions

| File | Lines | Change type |
|------|-------|-------------|
| `tests/governance/audit-migration.test.ts` | ~+220 | Extend |
| **Total new** | ~220 | |

## Dependencies

- `src/governance/audit-decorators.ts` — audited store factories
- `src/governance/action-queue.ts` — `refreshProposals`
- `src/governance/{governance-signal,decision-capture,operator-review,action-queue}.js` — real `File*Store` classes for seeding
- `src/cli/commands/governance.ts` — sentinel scan target

## Acceptance gate

P14.7 is complete when:
1. Issue #241 is closed (Task 1 ships the `refreshProposals` integration test)
2. Every mutation path has a passing single-emission assertion (Tasks 1 + 2)
3. Each emitted event carries the correct `eventType`
4. Every read method is proven audit-silent (Task 3)
5. Strengthened sentinels pass, including "no `audit-emitters` import in governance.ts" (Task 4)
6. Full governance suite stays green (584+ → higher)
7. TypeScript has 0 errors
8. GitNexus detect_changes: LOW risk (coverage-only; should report 0 affected processes)
9. No source files changed (pure coverage addition)
