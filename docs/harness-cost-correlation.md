# Cost correlation (P0-D4)

**Status:** IMPLEMENTED — additive correlation layer. Production untouched.
**Branch:** `docs/pre-2.0-harness-audit`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` (root worktree; see `harness-prd-divergence-finding.md`) §7, §9 Gate B.
**Gate B: HOLD.**

---

## 1. What was built

`src/operations/evals/cost-correlation.ts` — a **pure** correlation layer over
existing primitives. It does not price models and does not add a second cost
authority: it consumes `PricingCatalog` and the `model.usage` events the runtime
already emits.

Correlation chain, each hop checked:

```
runId → model invocation(s) → usage → pricing → cost
```

A break at any hop yields `null` **with the reason**, never a shorter chain
returning a smaller number.

### Gap taxonomy

| Gap | Meaning |
|---|---|
| `no-run-id` | usage events carry no runId to correlate against |
| `no-invocations` | no usage for this run (distinguishes "session has none" from "none match this run") |
| `unknown-pricing` | at least one invocation has no pricing entry |
| `non-billable` | scripted/mock provider — cost is not applicable, **not** zero |
| `missing-usage` | an invocation lacks numeric token counts |

---

## 2. The defect this layer exists to prevent

The existing `CostAttribution.summary()` accumulates `totalCost` from **priced
providers only** (`cost-attribution.ts:196-199`). A run using one priced and one
unpriced model therefore reports a total that looks complete and is silently too
low.

Verified with a probe against the built code:

```
unknownPricingModels: [ 'intern/deepseek-v4-flash-0731' ]
byWorkflow run-1 cost: -1   (correctly unknown)
byWorkflow run-2 cost: 2.5  (correctly priced)
totalCost: 5                (SILENTLY EXCLUDES the unpriced run)
```

`byWorkflow` and `byProvider` handle unknown correctly by propagating `-1`. Only
`totalCost` drops it. This layer never repeats that: if any invocation is
unpriced, the figure is `null` and `unpricedModels` names the blocker.

**The existing `summary()` behaviour is not changed here** — it is a production
reporting surface, and changing it belongs in P0-F alongside D2-01.

---

## 3. Tests (13)

| Test | Pins |
|---|---|
| Independent recomputation | `observedCostUsd === 12.5` for 1M in @ $2.5 + 1M out @ $10, with the price in the evidence string |
| Concurrent workers | two invocations on one run sum **once**: 2 × $2.5 = $5 |
| Cross-run isolation | another run's usage is not charged |
| **Unpriced ⇒ null** | partial sum withheld, blocker named |
| Scripted provider | `gap: non-billable`, evidence says "not applicable, not zero" |
| Missing usage | `gap: missing-usage`, cost and tokens both null |
| No usage | `gap: no-invocations`, with session-vs-run distinction |
| Empty runId | rejected rather than correlating everything |
| Rounding parity | identical to the existing calculator |
| Malformed invocation | kept visible, not silently dropped |

Suite: **13/13**.

---

## 4. Acceptance criteria — assessment

| # | Criterion | Status |
|---|---|---|
| 1 | Trace a real recorded invocation from runId → usage → pricing → recomputable cost | **NOT SATISFIED — two independent gaps** |
| 2 | Concurrent worker costs aggregated exactly once | **PASS** (test, by construction: each event visited once) |
| 3 | Missing/ambiguous correlations remain unmeasured | **PASS** (five gap classes) |
| 4 | Scripted executions cannot look like $0 real-model runs | **PASS** (`non-billable` class) |
| 5 | No production scheduler/approval/policy/pricing authority modified | **PASS** (new file only) |

### Criterion 1 — documented gap, not fabricated

Two independent blockers, both verified against a real recorded session
(`f8b-final`):

**Gap A — `model.usage` events carry no `runId`.**

```
model.usage events: 5
with runId: 0
```

The emit site spreads `...session` and never adds a run identity:

```ts
await log.append({ ...session, actor: "agent", type: "model.usage",
  payload: buildModelUsageEventPayload(...) });
```

`EventLog.append` accepts an optional `runId` (`types.ts:17`), so the schema
supports it — the emit site simply does not supply it. **Correlation is
impossible from recorded events today.**

**Gap B — the active model has no pricing entry.**

```
intern/deepseek-v4-flash-0731: pricing ABSENT
```

`defaultPricingCatalog()` covers openai/anthropic only. Even with a runId, this
model would correctly produce `unknown-pricing`.

**Result: `observedCostUsd: null`, `gap: "no-run-id"`.** No backfill attempted —
per instruction, insufficient evidence yields a documented gap.

---

## 5. What would unblock cost measurement

In dependency order:

1. **Emit `runId` on `model.usage`.** One line at the emit site
   (`task-loop/main.ts:951`). This is a production telemetry change and needs its
   own review — it touches the same event-emission surface as D2-01.
2. **Add pricing entries** for models actually in use (including `intern`),
   effective-dated. A data change, not a code change.
3. **Re-run representative scenarios** so usage events carry run identity.

Note that (1) and D2-01 are both production event-emission fixes. Doing them
together in P0-F is more sensible than two passes over the same surface.

**Important:** even with cost correlation working, **verified success remains the
denominator**. A cheaper run that fails verification is not an efficiency
improvement — the aggregate already charges failed-run cost into the numerator
(P0-D, pinned by test).

---

## 6. Findings

| # | Finding | Severity | Disposition |
|---|---|---|---|
| D4-01 | `CostAttribution.summary().totalCost` silently omits unpriced models, understating cost while appearing complete | **Medium** | P0-F — production reporting surface, not changed here |
| D4-02 | `model.usage` carries no `runId`; run→usage correlation is impossible from recorded events | **Medium** | P0-F — same emission surface as D2-01 |
| D4-03 | `intern` and other in-use models absent from `defaultPricingCatalog` | Low (data) | P0-F — pricing data, effective-dated |
| D4-04 | Delegate transport flake (from P0-D3) retained as a separate reliability finding | Low | Kept with original failing evidence; not attributed to measurement work |

---

## 7. Explicit non-decisions

- No second cost calculator — `computeFromPricing` mirrors the existing rounding
  so figures stay comparable, and parity is pinned by test.
- No production change: `cost-attribution.ts` is untouched.
- No fabricated backfill of historical sessions.
- No pricing invented for `intern` — an invented rate would be worse than a null.

---

## 8. Files

| File | Change |
|---|---|
| `src/operations/evals/cost-correlation.ts` | new, pure correlation |
| `tests/evals/cost-correlation.vitest.ts` | new, 13 tests |

No existing file modified. Simplification HOLD. Publication HOLD (Q13).
