# Event-derived measurements (P0-D2)

**Status:** IMPLEMENTED — additive measurement layer. No production runtime change.
**Baseline:** `4ac6df14` + P0-D integration. Branch `docs/pre-2.0-harness-audit`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD.md` §5 (PRE-R006), §9 Gate B.
**Decision context:** operator-approved P0-D2 scope — additive event-derived
measurement only.

---

## 1. What was built

`src/operations/evals/event-metrics-projection.ts` — a **pure** projection from
recorded events to measurements. It appends nothing, mutates nothing, and does
not touch the scheduler or approval machinery. Measurement must never change the
thing it measures.

| Metric | Status | Boundary |
|---|---|---|
| Approval wait | **Derivable** | `approval.created` → matching `approval.resolved`, correlated on `approvalId` |
| Approval consumption delay | **Derivable** | `approval.resolved` → `approval.consumed`, same id |
| Worker execution span | **Derivable** | first `coordination.worker.dispatched` → last terminal worker event, correlated on run+worker |
| Token usage | **Derivable** | sum of `model.usage` input/output across the session |
| Worker dispatch latency | **NOT derivable** | no eligibility event exists |
| Coordination overhead | **NOT derivable** | no orchestration interval exists |

### The two deliberate absences

**Dispatch latency.** The scheduler computes `readyWorkers` inside `tick()` and
never emits an eligibility event (`coordination-scheduler.ts:441`). There is no
start boundary in the record. Substituting a tick timestamp would silently
include unrelated reconcile/dispatch work in the number.

**Coordination overhead.** Encoded exactly as the operator constrained it:
deriving overhead by subtracting worker time from wall clock would attribute
parallel execution, approval waits and idle ticks to the scheduler. The function
returns absence and says so in its reason string, and a test asserts the reason
mentions the subtraction shortcut.

Both return `null` **with a reason**, never a guess.

---

## 2. Correlation and integrity

- **Correlation** is by `approvalId` for approvals and `runId + workerId` for
  workers. `workerAttempt` is **not** available in the dispatch payload, so a
  retry sequence is reported as one **execution span**, explicitly labelled as
  such rather than pretending to be a single attempt.
- **Integrity** (`checkEventIntegrity`) reports duplicates, out-of-order `seq`,
  and unparseable timestamps. It never repairs them.
- **Contradictory histories** are rejected, not averaged: resolution before
  creation, or terminal before dispatch, both yield absence with a reason.
- **A pending approval never yields a duration.** Reporting elapsed-so-far would
  convert an unfinished wait into a completed measurement.

---

## 3. Validation on a real recorded session

`tui-e2e/validate-event-metrics.mjs` reads a real Gate 7 session
(`f8b-final`, session `1792475990072`) and independently recomputes each derived
value from the raw file.

```
approval waits measured: 13/13
approval waits absent:   0/13
verification mismatches: 0
RESULT: PASS — projections verified against source events
```

Sample derived values (all `VERIFIED` against independent recomputation):

| Approval | Wait | Consumption delay |
|---|---|---|
| `_fnvm2` | 1 839 ms | 127 ms |
| `_7umqu` | 2 467 ms | 589 ms |
| `_wg31u` | 6 943 ms | 1 145 ms |
| `_l053l` | 2 325 ms | absent — not consumed |
| `_x35wk` | 3 971 ms | absent — not consumed |

Worker spans: `bcf2eceb` 69 757 ms, `d63f3991` 236 901 ms.
Tokens: 46 982 prompt / 1 585 completion across 5 `model.usage` events.

**Coverage reporting is explicit:** each absent metric prints its reason, so a
reader can tell "not measured" from "zero".

---

## 4. Finding: duplicate `approval.created` emission (D2-01)

**Severity: Medium.** Discovered while validating, not introduced here.

Every approval in the recorded session carries **two** `approval.created`
events for one id — 26 events across 13 ids, systematically.

Mechanism (verified in source):

1. `ApprovalStore.createApprovalRecord` emits `approval.created` with the full
   payload including `capabilities` (`approval-store.ts:518`).
2. The policy gate's capability path *also* emits a lifecycle event for the same
   decision (`policy-gate.ts:468-478`); when the decision was **created** rather
   than reused it emits `approval.created`, with `capabilities` absent but a
   `reason` of `Pending approval: <id>`.

The projection is unaffected — it takes the first matching event, and the test
suite pins that. But the duplicate is real: any consumer counting
`approval.created` events as "approvals requested" will double-count.

**Not fixed here.** Correcting it means changing production policy/approval
emission, which is outside P0-D2's additive-measurement scope. Recorded so P0-F
can decide whether the gate should emit `reused` semantics or stop emitting at
all when the store already did.

---

## 5. Design constraint honoured

> Do not expand the failure taxonomy because telemetry is incomplete.

Measurement completeness is tracked **only** in the `coverage` map, never in
`failureClass`. A test pins this: a passing scenario with `promptTokens: null`
stays `verdict: "pass"`, `failureClass: null`. The seven-class taxonomy is
unchanged.

---

## 6. Exit-condition assessment

| P0-D2 exit requirement | Status |
|---|---|
| Independently verifiable measurements for emitted metrics | **PASS** — 13/13 verified, 0 mismatches |
| Explicit coverage reporting for underivable metrics | **PASS** — reason strings per field |
| Pure projection, no scheduler/approval modification | **PASS** — new file only |
| Event correlation enforced | **PASS** — id-based, with contradiction rejection |
| Clock/integrity handling | **PASS** — duplicates/order/unparseable reported |
| Tokens/cost derived separately | **PASS** — tokens from usage events; cost left `null` with reason |
| Validated on real recorded sessions | **PASS** |
| A fresh production-default Gate 7 run with telemetry | **NOT DONE** — see gap |

**Gap G1:** validation used an existing recorded session. The operator asked for
"at least one fresh production-default Gate 7 scenario with the required
telemetry". That requires re-running the TUI harness, which is a separate
execution step and was not performed in this commit.

**Gate B remains HOLD** regardless: P0-D2 supplies measurement, not the
multi-stratum baseline.

---

## 7. Files

| File | Change |
|---|---|
| `src/operations/evals/event-metrics-projection.ts` | new, pure projection |
| `tests/evals/event-metrics-projection.vitest.ts` | new, 23 tests |
| `tui-e2e/validate-event-metrics.mjs` (evidence repo) | new, real-session validation |

No existing file modified. No production runtime change.
Simplification HOLD. Publication HOLD (Q13).
