# PRE-R006 baseline-metrics acceptance — 2026-10-28

**Requirement:** collect baseline verified success, token usage, cost, latency, retries, tool calls and intervention.  
**Acceptance:** results tied to model version, config, commit and sample size.  
**Verdict:** **SUPPORTED at baseline-record scope.**

## Evidence reconciled

Machine-readable reconciliation: `benchmark/evidence/pre-r006-baseline-reconciliation-2026-10-28.json`.

The final nine-case collection contributes **45 runs / 36 verified successes (0.80)** with:

- 1,039,889 input tokens and 29,899 output tokens;
- `$2.8987125` proxy-priced cost;
- per-run duration plus committed per-case p50/p95 latency blocks;
- 182 tool calls, 157 completed, 25 failed, 37 repeated calls and 1 tool retry;
- 0 measured interventions and 0 cancellations.

All nine artifacts use model revision `deepseek-ai/deepseek-v4.1-flash-1017`, one config hash (`4e4a10ef…`), pinned corpus/tool/environment hashes, explicit `n=5` per case, and were introduced by Git commit `bc4e0f7a290b2b91efd0a2fe88aea76f4040ca36`.

Additional executed strata remain separately attributable rather than being blended into the 45-run denominator:

- stratum 6: `n=3`, producer commit `336900a394377a3fe8510c91c7ba2b340cb8e3f8`;
- stratum 8: `n=3`, producer commit `aa927cf6547b822cf478219da1ab90f6433429f0`;
- stratum 9: `n=3`, provider-reported model revision `d84e1e38ee39`, producer commit `6142ef406d169610a530164d7a9223993f0cde9a`.

The existing model-independent re-score records zero verdict changes for the final collection under its documented limits.

## Null provider-retry field

`providerRetries` is `null` in the historical 45-run rows because provider-attempt telemetry had not yet been emitted. This remains **unobserved**, not zero. PRE-R006 asks for baseline retry measurement, and the record still contains tool-level retry/repeat metrics while preserving the unavailable provider-level field honestly. A later collection may improve this dimension; absence of that later telemetry does not erase the versioned baseline already collected.

## Independent verifier

A separate local `granite3-moe:latest` verifier reviewed only the frozen reconciliation facts and concluded PRE-R006 is supported at baseline-record scope; it treated `providerRetries: null` as a documented observation limit rather than a blocker. This is an independent model review of the acceptance framing, not a security qualification.

## Boundaries

This acceptance does **not**:

- turn proxy pricing into provider-invoice pricing;
- claim every metric dimension is fully observed (`providerRetries` remains null historically);
- establish an attributable improvement over older mixed historical runs;
- clear Gate E / D9 security qualification;
- grant release or publication authority.

No human approval, signature or operator-attention step is required for this PRE-R006 determination under the current agent-driven Harness closeout contract.
