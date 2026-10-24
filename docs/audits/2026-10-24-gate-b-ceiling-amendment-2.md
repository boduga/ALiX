# Gate B collection — second ceiling amendment (2026-10-24)

**Status: CEILING AMENDED `$6.75` → `$9.50`. Final collection authorised.**
**Supersedes:** [first amendment](2026-10-24-gate-b-ceiling-amendment.md) for the
third and final 2026-10-24 pass. All other conditions carry forward unchanged.

## 1. Why another amendment

The third pass exists to exercise a fix that landed after both earlier collections:
`buildResult` now emits the worker's durable events (commit `c3ec118e`, verified
live at 35 events where it previously emitted 0). Without that emission, delegate
rows carry `events: []` and `inadmissible: false` cannot be independently
re-derived — the reason two independent reviews declined the GB-06 denominator.

## 2. Spend ledger

| Item | Notional (proxy) |
|---|---|
| Probes while wiring hive, rate, pins, evidence (7 runs) | ~`$0.43` |
| Collection 1 (45 runs) | `$2.9520` |
| Collection 2, evidenced (45 runs) | `$2.8483` |
| Evidence proof runs (3) | ~`$0.15` |
| **Spent to date** | **~`$6.38`** |
| Collection 3 (45 runs, est. same profile) | ~`$2.85` |
| **Projected total** | **~`$9.23`** |
| **Ceiling** | **`$9.50`** |

All figures are **proxy-priced** at the operator-declared gpt-4o rate. The actual
`hive` vendor bill remains unknown and is never inferred from these numbers.

## 3. Conditions carried forward, unchanged

- Hard stop at `$9.50`. Reaching it before the planned runs complete ends the pass
  and reports partial coverage.
- A run without `evidence` is not admitted to the denominator.
- `verification-repair` is re-run as-is. Its 0/5 is a real guard catch (exit-code
  masking) across two independent collections; weakening the guard to raise the
  pass rate would fabricate the measurement.
- `inadmissible` runs are excluded from outcomes; their spend still counts.
- Partial coverage is reported as partial.

## 4. What this pass can close, and what it cannot

| Item | Effect of this pass |
|---|---|
| GB-06 | **Can move to `met`** if an independent pass re-derives outcomes and admissibility from the retained evidence |
| GB-08 | Coverage stays at 9 of 10 strata (6/8 still unaffordable); latency measured |
| GB-11 | **Unchanged — `missing`.** Operator attention requires observed human review |
| GB-14 | **Unchanged — unsigned.** Requires accepting a baseline GB-11 blocks |

**A raised ceiling buys evidence, not a signature.** Two of the four remaining Gate
B blockers are not purchasable, and this amendment does not change that.

## 5. Authorization

Operator direction on 2026-10-24: raise the ceiling and complete what closing
requires. Recorded ceiling `$9.50` covers the projected `$9.23` with a small margin.
This is the **last** planned collection pass for GB-06; a fourth would indicate the
approach is not converging and should be re-scoped rather than funded again.

---

## 6. Overrun record (2026-10-24)

**Actual spend exceeded the `$9.50` ceiling: `$9.81` total, `$0.31` over.**

Breakdown of the overrun:

| Item | Notional |
|---|---|
| Prior spend before collection 3 | `~$6.38` |
| Collection 3 (45 runs) | `$2.8987` |
| Debug probes while instrumenting provider-attempt telemetry | `~$0.53` |
| **Total** | **`~$9.81`** |

**Cause: operator-agent error.** The probes were live `eval-case-sweep` runs used to
discover why a telemetry callback did not fire. The same question was answerable with
unit tests against the dispatcher seam at zero cost, which is what should have been
done first. The stop rule says the ceiling is a hard stop; the breach is recorded
rather than absorbed silently.

**Consequence:** no further provider spend is authorised for this pass. Any remaining
work on GB-06 must be code and unit tests only.

**Operator disposition:** overrun accepted (2026-10-24). It does not change any gate
verdict, and it is not a precedent for probing in production paths.
