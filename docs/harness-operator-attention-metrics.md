# Autonomous-review metrics (deliverable 7, PRE-R015)

**Status:** DEFINITIONS ONLY. **Every measure is `not measured`.**
**Artifact:** branch `main`, commit `63532d7594f8f806c04571a4ac49d5fe8258c9ce`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §12.1 (PRE-R015), §12.3.
**Publication / simplification:** HOLD (Q13).

The PRD now requires autonomous review effort to be measured **alongside** cost, tokens, verified outcomes and latency — as a separate dimension and never a substitute for correctness. This retained filename is historical; the contract below defines verifier/critic metrics for the agent-driven Harness closeout.

**Nothing here is instrumented.** No event type is added, no metric is emitted, and
no number in this document comes from a measurement.

---

## 1. Primary definition — autonomous review effort per independently verified success

| Element | Definition | Why |
|---|---|---|
| `autonomousReviewCost` | Model/tool/resource cost consumed by independent verifier/critic passes | Separate from executor task cost |
| `autonomousReviewLatencyMs` | Wall-clock latency attributable to verifier/critic work | Separate from task execution and queue wait |
| `reviewInvocations` | Count of independent verifier/critic calls | Includes retries; configuration/version recorded |
| `independentlyVerifiedSuccesses` | Count of tasks where independent verification confirmed objective and status honesty | Reuses `harness-benchmark-spec.md` §2.1; never executor self-claim |
| Ratios | Defined only when numerator and denominator are observed | Otherwise `null` with coverage — never imputed |

This mirrors the existing `CostCompleteness` discipline in
`src/operations/observability/cost-attribution.ts` (`complete` / `partial` /
`non_billable` / `none`), so an unmeasured dimension cannot be mistaken for a
measured zero. The same rule that governs cost governs autonomous review metrics.

---

## 2. Required measures (PRE-R015, verbatim scope)

| ID | Measure | Definition | Status |
|---|---|---|---|
| M-1 | Review cost per verified success | Verifier/critic model/tool/resource cost divided by independently verified successes | **not measured** |
| M-2 | Review latency | Verifier/critic elapsed latency, separate from executor and queue wait | **not measured** |
| M-3 | Review disagreement rate / retry | **Disagreement rate = decision-bearing review items with at least two eligible independent verdicts whose normalized verdicts conflict / decision-bearing review items with at least two eligible independent verdicts observed.** An eligible verdict is one produced under the run's recorded verifier/critic configuration before seeing the other verdict; retries/arbitration passes are counted separately. Items with fewer than two eligible verdicts are excluded from the denominator and reported as uncovered, never agreement. | **not measured** |
| M-4 | Seeded-risk miss / missed-evidence event | Independent review fails to catch a seeded or known critical issue | **not measured** |
| M-5 | BLOCKED/reversal event | Durable authority/qualification block or later reversal caused by failed evidence | **not measured** |

### 2.1 Deliberate separations

These distinctions are part of the metric definition, not analysis choices:

- **Review ≠ execution or waiting.** Verifier/critic effort is measured separately from executor work and queue time.
- **Disagreement ≠ failure.** It is a quality/cost signal that may trigger deterministic arbitration or durable `BLOCKED`.
- **Faster ≠ better.** Per §12.3, a workflow that reduces review cost/latency while increasing missed-risk events **fails**. M-4/M-5 are disqualifying measures, not tiebreakers.

---

## 3. What already exists to build on (verified, not assumed)

| Capability | Location | Reusable for |
|---|---|---|
| Model/tool invocation and usage events | runtime/session/eval events | M-1/M-2/M-3 cost, latency, invocation and retry projection |
| Approval lifecycle events (`approval.created` / `reused` / `resolved` / `consumed` / `expired` / `revoked` / `invalidated`) | `src/runtime-state/events/types.ts` (`APPROVAL_EVENT_TYPES`) | M-5 approval-boundary/BLOCKED context only; not a human-review metric |
| Wait measurement | `approvalWaitMs` in `src/operations/evals/event-metrics-projection.ts` | Elapsed wait only; never relabel as review effort |
| Cost attribution + completeness | `src/operations/observability/cost-attribution.ts` | The companion dimension and the `null`-not-zero discipline |
| Metric registry / store / trend analyzer | `src/operations/observability/{metric-registry,metrics-store,trend-analyzer}.ts` | Emitting and trending new measures once defined |
| Trace/projection pipeline | `src/interfaces/tui/runtime/*` projections | A read-only attention projection without a new authority |

**Important:** `approvalWaitMs` measures **wall-clock** wait and returns `absent`
when there is no resolution — that is the correct behaviour and it is what the
cost baseline already reports. Autonomous review effort is a different quantity that is not yet projected as a first-class metric.

---

## 4. Instrumentation contract a future implementation must satisfy

Not implemented. Recorded so the shape is constrained before code exists.

1. **No new authority.** Review metrics are a **projection** over existing evidence, in
   the same sense as the TUI runtime projections. It must not write to the
   authoritative ledger or the approval store.
2. **No telemetry flooding.** Per PRE-R009, instrumentation must not flood the
   authoritative event log. Review-effort sampling belongs in the metrics store, not
   as high-frequency durable events.
3. **Provenance per measure.** Each number carries its source event ids, so an independent verifier can audit how each metric was derived.
4. **`null` over imputation.** An unobserved interval is `null` with coverage,
   never a zero and never an estimate from elapsed time.
5. **Redaction.** Review content may contain secrets; any projection reuses the
   existing redaction path rather than rendering raw evidence.

---

## 5. Baseline reporting contract

When a run reports cost per verified success, it must also report:

- **Coverage:** how many scored tasks had verifier/critic metrics observed.
- **`null` count:** how many measures were unobservable and why.
- **n:** how many review observations per measure (today: zero).
- **Configuration provenance:** verifier/critic model, version, rubric, tool surface and policy revision.

A report that shows executor cost but omits autonomous-review coverage reproduces the gap §12 is meant to close.

---

## 6. Verdict

**PRE-R015: definition requirement satisfied; measurements NOT started.** All five measures remain `not measured`. PRE-R015 requires versioned definitions, including the disagreement-rate population and denominator above; observing those measures is downstream benchmark evidence, not a second half of this definition requirement.

**Measurement status:** unstarted, not blocked. Instrumenting M-1..M-5 over scored runs with independent verifier/critic agents and deterministic seeded-risk cases would produce PRE-R031/benchmark evidence; no human observation is required.
