# Gate B coverage pass — strata 6 and 8 (2026-10-24)

**Status: strata 6 and 8 measured. Stratum 9 not run. GB-08 stays `partial`.**
**Rate:** operator-declared `gpt-4o` proxy for `hive` (not a vendor price)
**Model:** `hive` / `deepseek-ai/deepseek-v4.1-flash-1017`
**Artifacts:** `benchmark/evidence/coordination/collection-2026-10-24/`

## 1. Results

| Stratum | Runs | Success | Cost |
|---|---|---|---|
| 6 — coordination | 3 | 3/3 produced all three artifacts | `$1.1859` |
| 8 — kill/resume | 3 | 3/3 killed mid-flight, resumed, artifacts complete | `$0.9849` |
| **Pass total** | **6** | **6/6** | **`$2.1707`** |

Cumulative proxy-priced spend: **`$11.95` of `$15.00`**.

## 2. Stratum 8 — the contract was actually exercised

Each run killed the process while a worker was durably `running`, then resumed:

| Run | Phase 1 kill state | Phase 2 |
|---|---|---|
| 1 | killed, `runStatus: running`, worker `running/attempt 1` | resumed, exit 0, 14 usage records, artifacts complete |
| 2 | killed, `runStatus: running`, worker `running/attempt 1` | resumed, exit 0, 14 usage records, artifacts complete |
| 3 | killed, `runStatus: running`, worker `running/attempt 1` | resumed, exit 0, 18 usage records, artifacts complete |

This is the stratum-8 shape the PRD asks for: a persisted running worker killed
mid-flight, reclaimed through the resume path, run completed with its artifacts
intact. It is not a graceful restart dressed up as a crash.

## 3. Stratum 6 — measured, but NOT the four-worker contract

**Three worker markers were produced, not four.** The harness objective is:

> *Create docs/a.md, docs/b.md, docs/c.md containing exactly their respective
> markers: A-MARKER, B-MARKER, C-MARKER*

That is a three-worker scenario. `--concurrency 4` bounds the scheduler; it does not
create a fourth worker, and `workerCount: 3` is the accurate reading.

Recorded honestly because the PRD stratum is **four-worker coordination**, and
previous artifacts carried the same mismatch
(`coordination-metered.json` was already noted as "three workers, not the PRD's
four"). So:

- Coordination cost and completion at **three** workers: measured, 3/3.
- Coordination at **four** workers: **still unmeasured.**

Calling this "stratum 6 covered" without that caveat would repeat the exact error
this audit keeps catching — a label that survives because nobody re-read the
objective.

## 4. Why stratum 9 was not run

`just 8 for now` — operator instruction. Local CPU inference is non-billable but
requires a local model server; it was not attempted.

## 5. GB-08 verdict: stays `partial`

Coverage after this pass:

| Stratum | Measured |
|---|---|
| 1, 2, 3, 4, 5, 7, 10 | yes (case sweep, 45 runs) |
| 6 | **three-worker only** — four-worker unmeasured |
| 8 | yes (3 runs) |
| 9 | **not run** |

Two gaps remain: the four-worker form of stratum 6, and stratum 9. GB-08 requires
p50/p95 across the full stratum set, so it cannot be `met`.

**Also unchanged from the results doc:** at n=5 the nearest-rank p95 *is* the
maximum, so the case-sweep percentiles are the slowest run of five rather than a
tail estimate. Strata 6 and 8 have n=3, where the same is true more strongly. A
meaningful p95 needs more repetitions, which this pass did not buy.
