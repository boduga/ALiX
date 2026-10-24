# Gate B collection — third ceiling amendment (2026-10-24)

**Status: CEILING AMENDED `$9.50` → `$15.00`. Operator-authorized.**
**Supersedes** both earlier amendments for the coverage pass that follows.
**Reason:** GB-08 cannot reach `met` without strata 6, 8 and 9, and the estimated
cost (~`$1.61`) exceeds the `$0.28` remaining under the previous ceiling.

## 1. Measured spend to date (not estimated)

| Item | Notional (proxy-priced) |
|---|---|
| Collection 1 (45 runs) | `$2.9520` |
| Collection 2 (45 runs, evidenced) | `$2.8483` |
| Collection 3 (45 runs, final) | `$2.8987` |
| **Collections subtotal** | **`$8.6990`** |
| Probes + debug (13 retained artifacts) | `$1.0845` |
| **Total measured** | **`$9.78`** |

`$9.78` is a **lower bound**: two early hive-wiring probes predate artifact
retention and cannot be recovered. Earlier figures in the session (`$9.28`,
`$9.65`, `$9.87`) were not tallied from artifacts and are superseded by this table.

All amounts are **proxy-priced** at the operator-declared gpt-4o rate. The actual
`hive` vendor bill remains unknown and is never inferred from these numbers.

## 2. What the authorization covers

| Scope | Runs | Estimate |
|---|---|---|
| Stratum 6 four-worker coordination | 3 | ~`$0.91` |
| Stratum 8 kill/resume | 3 | ~`$0.70` |
| Stratum 9 local CPU | 1 | `$0.00` (non-billable) |
| **Coverage pass** | **7** | **~`$1.61`** |

Projected total after the pass: **~`$11.39` of `$15.00`**, leaving ~`$3.61`.

The remaining headroom is explicitly **not** authorization to also run the
n=5→n=10 repetition expansion (~`$2.90`). That is a separate decision, because at
n=5 the nearest-rank p95 *is* the maximum and only more repetitions make a tail
estimate meaningful.

## 3. Conditions carried forward

- Hard stop at `$15.00`. Reaching it ends the pass and reports partial coverage.
- A run without `evidence` is not admitted to the denominator.
- `verification-repair` runs as-is. Its 0/5 is a real guard catch across three
  independent collections.
- Inadmissible runs are excluded from outcomes; their spend still counts.
- Partial coverage is reported as partial.

## 4. What this pass will and will not change

| Item | Effect |
|---|---|
| GB-08 | **Can move to `met`** — all ten strata measured at one model/rate |
| GB-06 | Unaffected; already `partial` with a floor reading |
| GB-11 | **Unchanged — `missing`.** Human observation only |
| GB-14 | **Unchanged — unsigned** |

**Gate B stays HOLD.** This pass closes a coverage gap. It does not supply operator
attention, and it does not sign a baseline.
