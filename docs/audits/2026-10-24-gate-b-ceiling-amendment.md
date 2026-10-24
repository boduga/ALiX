# Gate B collection — ceiling amendment and spend ledger (2026-10-24)

**Status: CEILING AMENDED to `$6.75`. Re-run authorised at proposal scope.**
**Supersedes:** the `$4.50` ceiling in
[the collection proposal](2026-10-23-gate-b-collection-proposal.md) §9 for the
2026-10-24 pass **only**. The proposal's own conditions are unchanged.

## 1. Why a new ceiling

The `$4.50` ceiling was set before any measurement of this provider. Observed
actual/estimate ratio was **1.41×**, which consumed the ceiling at 45 of 52 planned
runs. A second pass is required because the first pass predates raw-evidence
capture (`eval-evidence.ts`, commit `486360ba`): its rows carry evaluator
conclusions but not the bytes behind them, so they cannot supply the GB-06
denominator that an independent verification declined.

## 2. Spend to date (proxy-priced, corrected)

Earlier reports under-counted the probe calls. Corrected ledger:

| Item | Notional |
|---|---|
| Probe calls while wiring hive/rate/pins/evidence (6 runs) | ~`$0.39` |
| 2026-10-24 collection (45 runs) | `$2.9520` |
| **Subtotal spent** | **~`$3.34`** |
| Re-run 45 runs with evidence capture (est. same profile) | ~`$2.95` |
| **Projected total** | **~`$6.29`** |

Ceiling set to **`$6.75`** to cover the projected total with a small margin.

**Every figure here is proxy-priced** at the operator-declared gpt-4o rate. The
actual `hive` bill remains unknown and is not inferred from these numbers.

## 3. Conditions carried forward, unchanged

- Hard stop at `$6.75`. Reaching it before the planned runs complete ends the pass
  and reports partial coverage. No padding.
- Inadmissible runs are excluded from outcomes but their spend counts.
- A partial pass is reported as partial; it never becomes a pass by attrition.
- The re-run must carry §3 pins and the new `evidence` field; a run without
  `evidence` is not admitted to the denominator.
- `verification-repair` is re-run as-is. The 0/5 result was a real guard catch
  (exit-code masking), not a case defect, and weakening the guard to raise the
  pass rate would be fabricating the measurement.

## 4. What this pass can and cannot close

| Item | Effect |
|---|---|
| GB-06 | **Can move to `met`** if the retained evidence lets an independent checker re-derive each outcome |
| GB-08 | Coverage improves; strata 6/8/9 still excluded on cost unless stated |
| GB-11 | **Unchanged — `missing`.** No human observation exists and none is produced here |
| GB-14 | **Unchanged — unsigned.** Requires accepting a baseline that GB-11 blocks |

An amended ceiling buys evidence. It does not buy an operator attention
measurement or a signature.

## 5. Authorization

Authorized by the operator on 2026-10-24 as selection "1" from a stated option set:
raise the ceiling to ~`$6.10` and re-run with evidence retained. The recorded
ceiling is `$6.75`, above the quoted `$6.10`, because the quoted figure omitted the
corrected probe subtotal and the margin.
