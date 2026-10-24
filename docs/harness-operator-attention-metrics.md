# Operator-attention metrics (deliverable 7, PRE-R015)

**Status:** DEFINITIONS ONLY. **Every measure is `not measured`.**
**Artifact:** branch `main`, commit `63532d7594f8f806c04571a4ac49d5fe8258c9ce`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §12.1 (PRE-R015), §12.3.
**Publication / simplification:** HOLD (Q13).

The PRD is explicit that operator attention is measured **alongside** cost, tokens,
verified outcomes and latency — as a separate dimension, never converted to a
guessed dollar figure and never a substitute for correctness. This document fixes
the definitions so a future implementation cannot redefine them after seeing
results.

**Nothing here is instrumented.** No event type is added, no metric is emitted, and
no number in this document comes from a measurement.

---

## 1. Primary definition — `operatorActiveReviewMinutes / independentlyVerifiedSuccesses`

| Element | Definition | Why |
|---|---|---|
| `operatorActiveReviewMinutes` | Sum of intervals in which a human is **actively reviewing** decision-bearing evidence — reading, comparing, deciding | Excludes waiting, idle time, and elapsed wall-clock |
| `independentlyVerifiedSuccesses` | Count of tasks where the **evaluator** confirmed the objective landed **and** the reported status was honest | Reuses `harness-benchmark-spec.md` §2.1; never ALiX's own claim |
| Quotient | Defined **only** when both terms are observed | Otherwise `null` with a coverage count — never zero, never imputed |

This mirrors the existing `CostCompleteness` discipline in
`src/operations/observability/cost-attribution.ts` (`complete` / `partial` /
`non_billable` / `none`), so an unmeasured dimension cannot be mistaken for a
measured zero. The same rule that governs cost governs attention.

---

## 2. Required measures (PRE-R015, verbatim scope)

| ID | Measure | Definition | Status |
|---|---|---|---|
| M-1 | Active review minutes per verified success | §1 | **not measured** |
| M-2 | Interruptions | Events where a review in progress was preempted and resumed, counted per decision | **not measured** |
| M-3 | Approval touches | Interactions with an approval record through the **existing** governed path (`ApprovalStore.resolve`/`resolveWithEvidence` via CLI or the SRAP-1 remote-decision route) | **not measured** |
| M-4 | Missed-evidence events | A decision made while a known-missing-evidence marker was present and unacknowledged | **not measured** |
| M-5 | Reversal events | A consequence of the decision reversed after the fact (re-run, revert, re-approval) | **not measured** |

### 2.1 Deliberate separations

These distinctions are part of the metric definition, not analysis choices:

- **Active review ≠ waiting.** Time spent blocked on an agent run is not review.
- **Interruptions ≠ approval touches.** One review may contain several touches;
  one touch may require no review.
- **Faster ≠ better.** Per §12.3, a workflow that saves review minutes while
  increasing missed-risk events **fails**. M-4/M-5 are disqualifying measures, not
  tiebreakers.

---

## 3. What already exists to build on (verified, not assumed)

| Capability | Location | Reusable for |
|---|---|---|
| Approval lifecycle events (`approval.created` / `reused` / `resolved` / `consumed` / `expired` / `revoked` / `invalidated`) | `src/runtime-state/events/types.ts` (`APPROVAL_EVENT_TYPES`) | M-3 approval touches, and the timestamps for review intervals |
| Wait measurement | `approvalWaitMs` in `src/operations/evals/event-metrics-projection.ts` | **Elapsed** wait only — this is *not* active review, and must not be relabelled as such |
| Cost attribution + completeness | `src/operations/observability/cost-attribution.ts` | The companion dimension and the `null`-not-zero discipline |
| Metric registry / store / trend analyzer | `src/operations/observability/{metric-registry,metrics-store,trend-analyzer}.ts` | Emitting and trending new measures once defined |
| Trace/projection pipeline | `src/interfaces/tui/runtime/*` projections | A read-only attention projection without a new authority |

**Important:** `approvalWaitMs` measures **wall-clock** wait and returns `absent`
when there is no resolution — that is the correct behaviour and it is what the
cost baseline already reports. Active review minutes are a **different** quantity
that does not exist yet.

---

## 4. Instrumentation contract a future implementation must satisfy

Not implemented. Recorded so the shape is constrained before code exists.

1. **No new authority.** Attention is a **projection** over existing evidence, in
   the same sense as the TUI runtime projections. It must not write to the
   authoritative ledger or the approval store.
2. **No telemetry flooding.** Per PRE-R009, instrumentation must not flood the
   authoritative event log. Attention sampling belongs in the metrics store, not
   as high-frequency durable events.
3. **Provenance per measure.** Each number carries its source event ids, so a
   reviewer can audit how a review-minute total was derived.
4. **`null` over imputation.** An unobserved interval is `null` with coverage,
   never a zero and never an estimate from elapsed time.
5. **Redaction.** Review content may contain secrets; any projection reuses the
   existing redaction path rather than rendering raw evidence.

---

## 5. Baseline reporting contract

When a run reports cost per verified success, it must also report:

- **Coverage:** how many of the scored tasks had attention observed at all.
- **`null` count:** how many measures were unobservable and why.
- **n:** how many observations per measure (today: zero).

A report that shows only the cost quotient and omits attention coverage would
reproduce exactly the gap §12 was written to close.

---

## 6. Verdict

**PRE-R015: definitions published; measurement NOT started.** All five measures
are `not measured`. This satisfies the "define" half of the acceptance criterion
("versioned metric definitions") and none of the measurement half.

**Blocked by:** nothing technical — this is unstarted work, not blocked work. It is
not scheduled because it is P1 and downstream of a Gate B baseline that is HOLD.

**What would change this:** instrumenting M-1..M-3 over an existing scored run. That
requires an operator, so it is an operator-scheduled task, not an autonomous one.
