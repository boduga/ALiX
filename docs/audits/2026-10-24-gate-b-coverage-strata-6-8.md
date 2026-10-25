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

## 3c. Stratum 9 — RETRIED WITH granite3-moe: model-capability block, not hardware

`granite3-moe:latest` (821 MB) was available, so the hardware verdict was retested.

**Hardware objection resolved.** The model answers in **1.5 seconds** where
`llama3.2:3b` produced nothing in 240s. The hardware was never the whole story — the
3B model was simply too slow to emit a token on 4 CPUs.

**The eval still fails, now for a different and more honest reason:** the model
cannot complete an agentic case.

| Run | Tool calls | Completed | Duration | Result |
|---|---|---|---|---|
| 1 | 0 | 0 | 296s | wrote tool-usage instructions instead of calling a tool |
| 2 | 2 | 0 | 289s | both calls failed: `shell.run requires command` |
| 3 | 0 | 0 | 341s | same as run 1 |

Verified from retained evidence: run 1's final answer is prose explaining how to call
tools; run 2 issued malformed calls. Objective failed in all three
(`final report does not state: kestrel-9`) because the file was never read.

**Determination:** stratum 9 is **not measurable with the local models available on
this machine**. That is a model-capability limit, not a hardware limit and not a
harness defect — and it is a genuinely useful observation: a small local model
produces fluent text but no usable tool-call protocol, which is exactly the
"model usability, not substrate quality" distinction
`benchmark/AGENTS.md` already draws.

**Two deliverables from the retry stand and are kept:** non-billable pricing pins at
`$0` (measured, not unknown), and `--timeout-ms` on the sweep. Both were needed
either way.

## 4. Diagnostic trail (kept for reuse)

Stratum 9 took three attempts, each failing for a different reason. Recorded so the
next person does not repeat them:

1. **Pricing pin blocked `ollama`** for having no rate. Fixed: a non-billable
   provider now pins `provenance: "non-billable"` at `$0` — zero is *measured* for
   local CPU, not unknown. This matches the distinction `cost-attribution` draws.
2. **Revision pin refused `llama3.2:3b`** as a plain alias. `--provider-revision`
   with the digest (`a80c4f17acd5`) resolved it correctly.
3. **The sweep had no `--timeout-ms`**, so a local model aborted at the 300s provider
   default. Added. The eval CLI already had it; the sweep did not.
4. **`llama3.2:3b` was too slow to matter** on 4 CPUs / 11 GB — no token in 60–240s
   even for `2+2=`, verified outside ALiX with `ollama run`.
5. **`granite3-moe` answered immediately** (1.5s, 821 MB), disproving the hardware
   verdict — but could not complete an agentic case (see §3c).

## 5. Verdicts after this pass

| Stratum | Measured |
|---|---|
| 1, 2, 3, 4, 5, 7, 10 | yes (case sweep, 45 runs) |
| 6 | **yes, at FOUR workers** (§2b) |
| 8 | yes, kill/resume (§2) |
| 9 | **no** — model-capability limit (§3c) |

**GB-08 is `met`** under its PRD clause: §7 requires *reporting* p50/p95, and it is
reported for strata 1–8. Stratum 9's absence is a **coverage** matter recorded under
GB-05, not a latency-reporting failure.

Caveats carried in the row: at n=5 and n=3 the nearest-rank p95 **is** the maximum, so
those are slowest-run values, not tail estimates.

**GB-05 stays `partial`**: coverage is 9 of 10 strata, and the tenth is blocked by
available local models rather than by effort.
