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

## 2b. Stratum 6 at FOUR workers — measured (2026-10-24, same session)

The three-worker gap above was closed rather than argued around. The harness accepts
`--objective` and derives the worker count from the objective's file list, so a
four-file objective produces four workers:

| Run | Workers | Artifacts | Exit | Cost |
|---|---|---|---|---|
| 1 | **4** | 4/4 correct | 0 | `$0.4282` |
| 2 | **4** | 4/4 correct | 0 | `$0.4666` |
| 3 | **4** | 4/4 correct | 0 | `$0.4929` |

`$1.3878` for the four-worker set. All four markers (`A-MARKER`…`D-MARKER`) were
written to the correct paths.

**So the PRD's four-worker coordination contract IS now measured.** The earlier
three-worker runs are retained as artifacts but are not what the stratum requires.

## 3. Stratum 6 — the three-worker runs (superseded by §2b)

The first three runs produced **three** worker markers, not four, because the
harness's default objective names three files:

> *Create docs/a.md, docs/b.md, docs/c.md containing exactly their respective
> markers: A-MARKER, B-MARKER, C-MARKER*

`--concurrency 4` bounds the scheduler; it does not create a fourth worker, and
`workerCount: 3` was the accurate reading.

**Superseded by §2b**, which runs the four-worker form explicitly. Kept here because
the mistake is instructive: the run looked compliant against a three-file objective,
which is exactly the shape of error this audit keeps finding.

## 3b. Stratum 9 — NOT MEASURABLE ON THIS HARDWARE

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

Attempted and blocked by tooling, not by cost:

1. The §3 pricing pin initially refused `ollama` because it had no rate. Fixed: a
   non-billable provider now records `provenance: "non-billable"` with `$0`, because
   zero is *measured* for local CPU, not unknown. That is the distinction
   `cost-attribution` already makes.
2. The revision pin then refused `llama3.2:3b` as a plain alias. `--provider-revision`
   resolved it with the model digest (`a80c4f17acd5`), and the pin passed.
3. **The sweep has no `--timeout-ms` option.** A local 3B model on this hardware
   exceeds the 300s provider default, so the run aborts at
   `provider.complete:ollama timed out after 300000ms`. The eval CLI supports
   `--timeout-ms`; the sweep harness does not.

The timeout flag was then added to the sweep. The run still could not complete.

**Final determination: stratum 9 is not measurable on this hardware, and this is a
hardware limit rather than a model, configuration or harness defect.** Direct
checks, outside ALiX entirely:

```
ollama run llama3.2:3b "2+2="     -> 60s, no output
ollama run llama3.2:3b "Say OK"   -> 240s of spinner, no output
```

Hardware: 4 logical CPUs, 11 GB RAM. A 3B model at Q4 needs ~2 GB resident plus
context; on this box it does not produce a token in a usable time. Loading it also
evicts working memory, which is why the earlier agent-case attempt aborted at
`provider.complete:ollama timed out` after 300s.

**Consequence:** stratum 9 needs different hardware (or a much smaller model, or
more RAM). It cannot be bought with ceiling headroom, and no amount of retrying
changes it. Recorded so the gap is not mistaken for an unfinished task.

**Two real deliverables did come out of the attempt**, both kept:

1. Non-billable providers now pin `provenance: "non-billable"` with `$0` instead of
   blocking on a missing rate — zero is *measured* for local CPU, matching the
   distinction `cost-attribution` already draws.
2. `eval-case-sweep.mjs` accepts `--timeout-ms`, which it lacked; a local model
   needs a bound sized for the hardware or it aborts on transport and measures
   nothing about the model.

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
