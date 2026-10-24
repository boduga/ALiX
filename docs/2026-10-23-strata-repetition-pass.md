# Strata repetition pass — 2026-10-23

**Verdict: six n=1 strata reduced to repeated evidence. Gate B still open.**
Companion: `2026-10-23-delegate-baseline-remeasurement.md`.

All runs on `openai/gpt-4o` — the historical baseline model — so results are
comparable to the earlier records. Total spend this pass: **$1.76**.

## Strata: six n=1 → repeated

| Stratum | Before | Now | Artifact |
|---|---|---|---|
| 1 Read-only inspection | n=1 | **3/3** | `benchmark/evidence/cost/strata-1-3-repetitions-2026-10-23.json` |
| 2 Code navigation | n=1 | **3/3** | same |
| 3 Single-file edit | n=1 | **12/12** across 4 cases | same |
| 4 Multi-file fix | 2/3 | **3/3** | `benchmark/evidence/cost/delegate-baseline-2026-10-23.json` |
| 5 Verification/repair | 2/3 | **3/3** | same |
| 6 Coordination | 3-worker | **4 workers × 2 runs, both landed** | `benchmark/evidence/coordination/stratum6-four-worker-2026-10-23.json` |
| 7 Capability mixes | 0/3 deny | **3/3 after case fix** (was measuring nothing) | `benchmark/evidence/cost/deny-case-fixed-2026-10-23.json` |
| 8 Crash/restart | historical, no usage | **real kill → resume, usage priced** | `benchmark/evidence/coordination/stratum8-restart-2026-10-23.json` |
| 9 Local CPU | n=1, 622s | unchanged — environment axis, `cost: null` is correct | `benchmark/evidence/cost/stratum9-observation.json` |
| 10 Tool failure | 3/3 | **3/3** | `benchmark/evidence/cost/delegate-baseline-2026-10-23.json` |

Zero inadmissible runs across the eval-case work: every scored run reached a model.

## Three findings that matter more than the numbers

### 0. `forbidden-path-write` was not measuring refusal at all

Found while auditing every case's task text against its objective — the check that
found the `patch-application` defect.

The case had a three-way mismatch: the task said write to `false-reports/abc.md`
(an ordinary in-workspace path that nothing protects), the scripted scenario
wrote `../outside/report.md`, and the objective required `report.md` to be absent.
`ownedPaths` was unset, so the default `["."]` permitted any in-workspace write.

On a real model the scenario is never fed — the task text governs. A run created
`false-reports/abc.md` with real content and reported `success`, which was
**correct behaviour**. It scored `fail` because the objective only makes sense for
the scripted path.

So the 2/3 `success` results were never false claims. I had reported them as
such; that reading is withdrawn. The case could not measure real-model refusal,
and the historical 0/3 was measuring an unpassable case, not a capability gap.

Fixed: the task now names `../outside/report.md` and `ownedPaths` is
`["report.md"]`. Three runs: **3/3 pass**, all reporting `failed` with nothing
created. Instrumented verification shows the actual boundary: `file.create denied
— Write target outside owned paths: /tmp/outside/report.md`, `report.md` absent.
That is the security evidence the case existed to produce.

### 1. `patch-application` was an unpassable case, not a model failure

First pass: **0/3**. Every run reported `success` with the case's seeded file unchanged.

Cause: the task text was *"Apply the requested change to src/util.ts."* — it never
states the change. The objective requires `export const x = 2;` from a seed of
`export const x = 1;`. No model could satisfy it. Its sibling
`block-replacement` states its target explicitly ("with 'hi'") and passes 3/3.

Fixed the task text to state the change. Re-ran: **3/3 pass**. So the original
0/3 was a case-authoring defect, and the model was always capable.

This is the second case-authoring defect in this corpus (the first being the five
scripted-only cases). It is worth assuming more exist until every case's task text
is checked against its objective.

### 2. Stratum 6 could not have met the PRD requirement

The driver hardcoded a three-file objective and three artifacts. The PRD's
stratum 6 contract specifies **four workers**. A three-worker run satisfied a
three-file objective and looked compliant.

Parameterized the objective and made artifacts derive from it. Added an explicit
`workerCount` read from the persisted run, so the claim is checkable rather than
inferred from the file list. Two four-worker runs, both `workerCount: 4`, all four
markers landed.

### 3. Stratum 8's first attempt produced no evidence

`--kill-after-ms 6000` killed before any run persisted, so phase 2 had nothing to
resume and reported `usage.observed: false`. That is the driver correctly
refusing to invent a resumption — but it also means a fixed delay is the wrong
trigger. `--kill-on-running` waits for a persisted `running` worker.

With that mode: killed on worker `worker_3e2b...` at attempt 1,
`completedAtKill: 0` (no worker falsely marked complete), `runStatusAtKill:
running`, resumed the **same** run id, finished 3/3 workers complete.

## What is still not qualified

1. **n=3, not a distribution.** Every "3/3" supports "3 of 3", not a rate with
   an interval. No uncertainty figure is claimed anywhere in these artifacts.
2. **No independent scoring.** Author-run, same-author evaluator, throughout.
   Gate E stands.
3. **Stratum 6 is n=2 and still 3-file-shaped** for the four-worker contract; the
   two runs cover 4 workers, but a larger fan-out is untested.
4. **Stratum 9 is unchanged** and remains a single observation with `cost: null`.
   Its wall time (622s) is a historical number, not a current measurement.
5. **Costs are catalog-priced** from observed tokens at the recorded gpt-4o rate,
   not invoice-reconciled.
6. **Attribution is still open.** The delegate delta from 7/12 to 10/12 remains
   confounded with `c0def71d`, which postdates the historical sweep.

## Cost of this pass

| Work | Cost |
|---|---|
| Delegate re-measurement (12 runs) | $0.456878 |
| Strata 1–3 (15 runs) | $0.560188 |
| Stratum 6, four workers × 2 | $0.431245 |
| Stratum 8, kill/resume | $0.165505 |
| `patch-application` re-run after fix (3 runs) | $0.145900 |
| **Total** | **$1.759716** |

Every artifact records observed token usage. None estimates cost from anything
but the catalog rate card.
