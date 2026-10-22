# Positive baseline qualification follow-up

Gate B and publication remain HOLD.

## Strata 1/2: unknown success evidence

The original main-loop sweep recorded two real evaluator passes and correlated
paid usage. Audit found that the `unchanged` objective checked only existence,
then assigned `changed: false`. It did not compare seeded contents or validate the
answer. Case workspaces were deleted, so unchanged-source success cannot be
reconstructed retrospectively.

`benchmark/evidence/cost/eval-mainloop-metered.json` retains the original usage,
prices, and pass counts, but now explicitly records `verifiedSuccesses: null`.
The matrix requires a positive integer success count for both aggregate and
single-stratum cost records. The existing F1-E 8/8 artifact qualification supports
one explicit success for stratum 3. Qualified measured coverage is now **4/10**.

Regression table exercises missing, null, zero, negative, fractional, string, and
positive integer counts in both cost-record shapes, plus missing/null/incomplete
completeness records (20 cases).

## Positive cases and real execution

`benchmark/evidence/cost/run-positive-cases.mjs` now drives a positive two-file
repair and a successful deliverable under allow/ask/deny policy. Both require
exact output contents and honest runtime completion; the policy case additionally
requires actual read, denied shell probe, consumed fixture write approval, and
successful write. Scripted execution validates the real loop mechanics, contributes
zero billable successes, and never fills missing pricing with zero.

A tiny current-default provider probe (`intern/deepseek-v4-flash-0731`) succeeded
with 37 input / 13 output tokens. Larger runtime requests still failed 429 quota:

- Restart retry `coord_c5bcdfde-7bd7-4241-9838-a94440a0c861` reclaimed one orphan,
  then all three workers failed. No worker was falsely completed at kill.
  `benchmark/evidence/coordination/restart-review-quota-recheck.json` preserves it.
- Both real positive cases failed before executing tools, with no observed usage.
  `benchmark/evidence/cost/positive-real-quota-blocked.json` preserves them.

No new billable baseline has been promoted. Costs stay unknown. Restore sufficient
quota for full runtime prompts, rerun strata 4/7/8, then independently price observed
usage. Strata 1/2 need stronger read-only oracles and fresh runs; historical success
counts must not be guessed. CPU-only stratum 9 remains non-billable `null`.

## Verification

Combined fixture and cost-qualification tests: **22 pass**. Build, JavaScript
syntax checks, and diff checks pass. Spec-compliance review followed by code-quality
review found no remaining blockers. Benchmark DOX records qualification and fixture
approval rules; root and eval subsystem contracts are unchanged because production
code and evaluator behavior were not modified.
