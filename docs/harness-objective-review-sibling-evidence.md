# OPEN BUG — objective review can see a sibling worker's evidence

**Status:** OPEN — scoping fix built and reverted; not shipped.
**Recorded:** 2026-10-21
**Severity:** Medium. It falsely **fails** correct workers, never falsely passes one.

---

## 1. The bug

`reviewDefaultWorkerResult` derives the evidence set from
`deriveCoordinationChangedFiles(events)`. Workers in one coordination run **share a
single session event log**, so that capture includes every sibling's
`file.created` too.

Observed on real gpt-4o runs: a worker owning `docs/b.md` was reviewed with
evidence containing `docs/a.md`, `docs/b.md` and `docs/c.md`, and was then
rejected for *"Missing docs/a.md"* — a file it was never assigned.

Consequence: correct workers fail 3 attempts and the run reports
`failed`/`incomplete` with every artifact correct on disk.

## 2. Why it is not fixed

Scoping the evidence set to the worker's owned paths fixes the bug, and was
implemented and validated on stratum 8 (3/3 workers completed). It **also**
broke `tests/tui/workbench/coordination-runtime-integration.vitest.ts`
("resumes an approved worker…"):

```
run=completed:phase9-worker-0:completed:-
pending=0
events: ... approval.created, approval.resolved, approval.consumed,
         coordination.worker.dispatched, ...
```

The worker completes and **no second (file-mutation) approval is ever created**,
so the test's `waitForPendingApproval()` times out. Four variants were tried
(scoped + existence fallback, scoped + owned-path fallback, scoped with a
`file.read` allowance on the review executor, unscoped). Only **unscoped** passes.

The mechanism connecting evidence scoping to suppression of the write approval is
**not understood**. Shipping a fix whose effect is unexplained would be worse than
a documented bug.

## 3. Most likely cause, unverified

`approval.consumed` appears once. The hypothesis is that the review's own
`file.read` claims the worker's pending write approval when the review runs
against a narrower path set. That would make the gate believe the write was
authorised. **Not confirmed** — confirming it is the first step for whoever picks
this up.

## 4. What to do next

1. Instrument `ApprovalStore.consumeApproved` during that test and log which
   approval id each caller claims (the review's `file.read` vs the worker's
   `file.create`).
2. If the review is claiming it: make the review read strictly non-claiming.
   A verification read must never consume an approval — that is a correctness
   rule independent of this bug.
3. Re-run stratum 8 to confirm 3/3 **and** the integration test together.

## 5. What is NOT affected

- The objective now correctly uses `worker.goalPrompt` (not the rendered prompt
  with the root goal).
- A self-contradictory `satisfied: true` + non-empty `gaps` verdict is retryable
  instead of a hard rejection.
- Empty evidence no longer produces a bare "not verified".

Those three are shipped and tested. The bug is isolated to evidence **scoping**.
