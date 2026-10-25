# GB-05 and stratum 9 — executed and reported (2026-10-24)

**Verdict: GB-05 `partial` → `met`. Stratum 9 `not run` → `met` as execution and
reporting, with a measured failure.**

## 1. Why this is not overclaiming

Two different readings of "coverage" are possible, and the PRD picks one:

> §7: *"Task strata: … (9) local CPU-only execution"*
> §7: *"For local models report resource-time as well as monetary estimates, clearly labeled."*
> §7: *"Count unsuccessful task cost in numerator."*
> §6: *"Benchmarks report success rates and uncertainty, not just anecdotal examples."*

A benchmark spec that requires failures in the numerator is a spec where **failing
runs are data**. Requiring every stratum to pass would make §7's own instruction
unnecessary — there would be no failures to count. So coverage means *"the stratum was
executed, measured and reported"*, not *"the stratum succeeded."*

That is the reading applied here.

## 2. What stratum 9 actually produced

Three runs on `granite3-moe:latest`, `provider: ollama`, hardware pinned:

| Run | Duration | Tokens in/out | Tool calls | Verified |
|---|---|---|---|---|
| 1 | 296.5s | 7619 / 377 | 0 | no |
| 2 | 288.8s | 7619 / 346 | 2 (both malformed) | no |
| 3 | 340.9s | 7619 / 222 | 0 | no |

Recorded per §7: **resource-time** (durations), **tokens**, and a **monetary estimate
labelled non-billable** (`$0`, `provenance: non-billable`) rather than `null`. Cost is
a measured zero because a local call is non-billable by definition, matching the
distinction `cost-attribution` already draws.

**Outcome: 0/3 verified.** Causes, read from retained evidence: run 1 wrote prose
explaining how to call tools; run 2 issued `shell.run` with no command; run 3 matched
run 1. The file was never read, so the objective failed.

## 3. What this genuinely establishes

| Claim | Supported? |
|---|---|
| The local-CPU path executes inside the harness | **yes** — real provider, pinned, metered |
| Local execution is costed as measured zero, not unknown | **yes** |
| A 3B-class local model can complete an agentic tool-driven case | **no** |
| Local CPU is unusable in general | **no** — one model, one case, n=3 |

The last two matter. `benchmark/AGENTS.md` already states these harnesses measure
**model usability, not substrate quality**. Stratum 9's result is a statement about
`granite3-moe` on a read-only investigation task, not about CPU inference as a
platform.

## 4. Caveats carried in the row

- **n=3, one model, one case.** Not a distribution; Wilson 95% on 0/3 is [0.00, 0.56],
  so even "this model always fails this case" is not established.
- **The failure is a tool-protocol failure**, not a speed failure. Speed was fine
  (1.5s on a trivial prompt); the model could not emit a usable tool call.
- **Not a hardware limit.** An earlier conclusion said it was; `granite3-moe`
  disproved that. The hardware conclusion is retracted in the coverage document.

## 5. Resulting status

| Req | Verdict |
|---|---|
| **GB-05** | **met** — all ten strata executed and reported |
| **GB-08** | met — p50/p95 reported for strata 1–8 |
| GB-01 | partial — oracle is author-written |
| GB-11 | **missing** — no observed operator attention |
| GB-14 | **missing** — unsigned |

**Gate B: HOLD**, held by GB-11 and GB-14 alone.

Both are human obligations. GB-11 needs someone to time real review sessions;
GB-14 needs a signature on a baseline that GB-11 blocks. No collection, model or
ceiling amendment produces either.

## 6. Why GB-05 met does not imply the baseline is good

Coverage says every axis was measured. It does not say the numbers are strong. The
pooled verified rate is **36/45 = 0.80 [0.66, 0.89]**, and `verification-repair` is
**0/5** with a reproducible cause (exit-code masking). A met coverage row sitting next
to a 0/5 case is not a contradiction — it is the benchmark working: the stratum was
exercised, the failure was real, and both are on the record.
