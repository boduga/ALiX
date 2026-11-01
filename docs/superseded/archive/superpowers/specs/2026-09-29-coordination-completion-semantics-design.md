# Coordination Completion Semantics — Impact Analysis & Design

**Status:** analysis complete, **implementation deliberately not started**. The
analysis shows `completed` is persisted and consumed in multiple incompatible
meanings, which is the condition for surfacing before changing code.

**Evidence for the problem (cohort `t3d-2026-09-28-c`):** 7 coordination runs
closed with run-store `status: "completed"`; only **3** carry an aggregate
outcome, **4** have `outcome: undefined` and no `aggregateResultRef`. All 7
parent sessions ended `session.ended.reason: "completed"`. One fact —
"completed" — currently means three different things in the same corpus.

---

## 1. Where each fact is defined today (contract ownership)

| Fact | Owner today | Written by | Read by |
|---|---|---|---|
| `coordination.run` returned success | `coordination-tools.ts` `handleCoordinationRun` → tool result | the tool handler | the task loop only, as `toolResult.error` (`main.ts:1181`) |
| `run.status === "completed"` | `coordination-types.ts` — `CoordinationRunStatus` (union) + `recomputeRunStatus()` (`:411`) | `transitionCoordinationRunStatus` (`:396`) and `patchWorker`-driven recompute, via `CoordinationStore` | scheduler, CLI, tools, TUI, health snapshot, resume, collaboration context |
| aggregate generated | `coordination-completion-service.ts` `finalize()` → `ResultAggregator.aggregate()` → `CoordinationAggregateStore.persist()` | `CoordinationCompletionService` | CLI results, `coordination.results`, TUI panel, collaboration context |
| `run.outcome` exists | same service: `store.attachAggregate()` (`coordination-store.ts:299-308`, the **only** writer) | derived by `ResultAggregator.computeOutcome()` (`coordination-result-aggregator.ts:158`) | view, tools, TUI, collaboration context |
| session verified / unverified | `run/task-loop/main.ts` — `session.ended.reason` (`:1584`), `coordinationRunFailed` (`:476`, set at `:1181`) | the loop | evidence gates (`:955`, `:1494`), durability contract |

### The seam: aggregation is on-demand, not terminal-triggered

`CoordinationScheduler.maybeFinalizeRun()` (`coordination-scheduler.ts:810`)
finalizes a terminal run **only if `deps.completionService` is injected**. No
scheduler construction site injects one:

```text
src/interfaces/cli/commands/coordination.ts:173,223,251,336
src/operations/daemon/daemon-server.ts:82
src/coordination/kernel/coordination-tools.ts:187
src/interfaces/server/coordination-routes.ts:422,595   → none pass completionService
```

The only callers of `finalize()` are `alix coordination results`
(`coordination.ts:386`) and the `coordination.results` tool
(`coordination-tools.ts:355`). **Aggregation happens when someone reads the
results, not when the run ends** — which is exactly cohort C's 3-with /
4-without split.

### Recommended ownership after the change

- `coordination-types.ts` — owns the four dimension types and the pure
  derivation functions (no I/O).
- `coordination-completion-service.ts` — stays the only writer of aggregate +
  outcome; gains an explicit "finalize on terminal" entry point.
- `coordination-scheduler.ts` — either injects the service at every construction
  site (making terminal → finalize real), or stops implying it; today it
  contains a dead branch that reads as a guarantee.
- `run/task-loop/main.ts` — the session gate consumes a *derived* verification
  state instead of the tool-call error flag.

## 2. Consumers that branch on these facts

| Consumer | File:line | Depends on | Risk |
|---|---|---|---|
| CLI status | `cli/commands/coordination.ts:479` | waits for terminal `completed\|failed` | treats terminal as done-and-good |
| CLI results | `cli/commands/coordination.ts:340-388` | finalizes on demand | the trigger that makes 3/7 look different from 4/7 |
| `coordination.status` tool | `kernel/coordination-tools.ts:230` | prints `Aggregate:` only if present | absent aggregate is invisible, not `pending` |
| `coordination.results` tool | `kernel/coordination-tools.ts:326-356` | finalizes on demand | same |
| `coordination.run` tool | `kernel/coordination-tools.ts:222-245` | `finalStatus`; `changedFiles` from workers with `status === "completed"` | worker completion is treated as workspace evidence |
| Kernel view | `kernel/coordination-view.ts:118,139` | `status`, `outcome`, per-worker derived outcome | renders `Outcome: -` with no explanation |
| TUI panel | `tui/coordination-panel.ts:43,120-127` | `Status / Outcome / Freshness` | already three fields — the UI is ahead of the contract |
| Health snapshot | `observability/health-snapshot.ts:172-185` | active = running/planning; failed workers | counts no completed-run health |
| Collaboration context | `kernel/collaboration-context-builder.ts:386,413-414,537` | completed/failed workers; aggregate if ref | other agents see a run as complete with no outcome |
| Scheduler gates | `kernel/coordination-scheduler.ts:227,254` | terminal set; `completedIds` for deps | correct at worker level, silent at run level |
| Resume / reclaim | `kernel/coordination-resume.ts`, `recovery/recovery-scanner.ts:358` | worker + run status | correct; must not start treating `pending` aggregation as non-terminal |
| Session gate | `run/task-loop/main.ts:1584` | `coordinationRunFailed` = last tool call errored | **weakest signal in the system** |
| Attribution | `coordination-tools.ts:241`, `main.ts:955` | completed workers as executed evidence | see risk above |

## 3. Compatibility — interpret, do not migrate

Persisted artifacts:

- `.alix/coordination/coord_<id>.json` — `RunResult` shape with **optional**
  `outcome`, `aggregateResultRef`, `aggregateGeneratedAt`,
  `aggregateSourceFingerprint`. Legacy rows are `status: "completed"` with those
  fields absent (cohort C: 4 of 7; cohorts A/B likewise).
- Event log — `coordination.aggregate.completed` exists only when aggregation
  ran, so it is positive evidence but not a guarantee.
- Session events — `session.ended.reason: completed | completed_unverified`,
  derived from the tool-call flag.

**No migration and no rewrite of history.** The four dimensions are derivable
from today's fields:

```text
execution   = status ∈ {planning,replanning,running,blocked} → running
              status = completed → completed
              status = failed    → failed
              status = cancelled → cancelled
aggregation = aggregateResultRef present            → generated
              terminal execution                    → pending
              otherwise                             → not_required
outcome     = run.outcome ?? unknown
verification= derived (see §4)
```

Write the dimensions as an additive, optional block for **new** runs only;
existing readers keep working, and the legacy `status`/`outcome` fields keep
being written. Do **not** rename `completed`.

## 4. Proposed state model

**Amendments (2026-09-29, recorded during C1):**

1. `verification = "verified"` now requires `outcome === "success"` exactly.
   §4 originally allowed `partial_success`; a run that completed with failures is
   not a verified success, and its label already reads "completed with
   failures".
2. `verification = "unverified"` means **no verification evidence exists**, not
   "verification passed". A failed execution whose aggregate was never generated
   is `aggregation: pending, outcome: unknown, verification: unverified`; the
   user-facing label still reads "failed" from execution alone. `"failed"` is
   reserved for evidence that contradicts success (`aggregation: failed`, or an
   outcome of `failure`/`blocked`/`cancelled`).

```ts
type ExecutionState  = "running" | "completed" | "failed" | "cancelled";
type AggregationState = "not_required" | "pending" | "generated" | "failed";
type OutcomeState    = "unknown" | "success" | "partial_success" | "failure"
                     | "blocked" | "cancelled" | "incomplete";
type VerificationState = "unverified" | "verified" | "failed";

type CoordinationCompletion = {
  execution: ExecutionState;
  aggregation: AggregationState;
  outcome: OutcomeState;
  verification: VerificationState;
};
```

Derivation:

```text
verification = verified   iff aggregateResultRef present
                           AND outcome ∈ {success, partial_success}
                           AND the completing session's terminal is not
                               completed_unverified
             = failed     iff aggregation = failed
                           OR outcome ∈ {failure, blocked, cancelled}
             = unverified otherwise
```

User-facing labels are **derived**, never a new boolean:

```text
execution=completed, aggregation=pending     → "workers finished; results not aggregated"
execution=completed, aggregation=generated,
  outcome=success,   verification=verified   → "verified completion"
execution=completed, aggregation=generated,
  outcome=partial_success                    → "completed with failures"
execution=failed,    outcome=failure         → "failed"
```

### Invariants to pin

```text
status === "completed"  ⇏  aggregation = generated
status === "completed"  ⇏  outcome = success
status === "completed"  ⇏  verification = verified
verification = verified   requires explicit aggregate + outcome evidence,
                          never coordination.run success alone
```

## 5. Tests that encode the current (conflated) reading

These are the ones that would show whether this is local or systemic. None of
them asserts a run-level outcome or aggregate, so the change is a **local
contract extension** in `src/kernel` plus one loop gate — not a repo-wide state
machine rewrite.

| Test | Line | What it pins |
|---|---|---|
| `tests/kernel/coordination-scheduler.test.ts` | 172-178 | a `completed` run is terminal; `tick` returns `completed`, nothing dispatched |
| `tests/kernel/coordination-scheduler.test.ts` | 694 | terminal worker set includes `completed` |
| `tests/kernel/coordination-scheduler-replan.test.ts` | 384-396 | `run.status = "completed"` round-trips as terminal |
| `tests/kernel/coordination-resume.test.ts` | 103-112 | a `completed` run is never reclaimed |
| `tests/kernel/coordination-tools.test.ts` | 191-233 | workers `completed` + `run.status = "completed"`; status rendering prints `status completed` |
| `tests/kernel/coordination-store-concurrency.test.ts` | 24-29 | concurrent `patchWorker(completed)` is safe |
| `tests/kernel/collaboration-context-builder-replan.test.ts` | 588-601 | aggregate is surfaced only when `aggregateResultRef` is set |

New tests the change needs: the four invariants above, a derivation table test
(legacy `completed` with no aggregate → `aggregation: pending`,
`verification: unverified`), and a scheduler test proving terminal → finalize
actually runs (the branch that is dead today).

## 6. Scope estimate and recommendation

```text
src/coordination/kernel/coordination-types.ts          + dimension types + derivation (pure)
src/coordination/kernel/coordination-completion-service.ts  + finalize-on-terminal entry
src/coordination/kernel/coordination-scheduler.ts       inject the service (or drop the dead branch)
src/coordination/kernel/coordination-view.ts            expose the dimensions + derived label
src/coordination/kernel/coordination-tools.ts           status/results render the derivation
src/interfaces/cli/commands/coordination.ts           results/status render the derivation
src/interfaces/tui/coordination-panel.ts              label from the derivation
src/execution/run/task-loop/main.ts                  session gate consumes verification
tests/kernel/coordination-*                invariants + derivation table
```

No persisted migration; no rename; additive optional fields only.

**Recommendation:** proceed with this shape as a kernel-local change, starting
with the pure derivation + invariant tests, then wiring the scheduler's terminal
finalization, then the session gate. The session gate last — it is the one that
changes user-visible outcomes.
