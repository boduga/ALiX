# Positive baseline qualification follow-up

Gate B and publication remain HOLD.

**Update 2026-10-22:** the qualification rules below held; the coverage they
blocked is now measured. Qualified measured coverage is **9/10**. See the last
section.

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

## Update — 2026-10-22

The rules in this record were the reason coverage stayed low; they were kept and
the missing evidence was produced.

| Stratum | Cost | Verified successes | Evidence |
|---|---|---|---|
| 1 read-only | $0.045990 | 1 | `benchmark/evidence/cost/readonly-navigation.json` |
| 2 code-navigation | $0.044678 | 1 | same record |
| 4 multi-file fix | $0.063220 | 1 | `benchmark/evidence/cost/positive-strata-4-7.json` |
| 7 capability mix | $0.081847 | 1 | same record |
| 8 crash/restart | $0.211623 | 1 | `benchmark/evidence/cost/stratum8-restart.json` |

- **Strata 1/2 needed a stronger oracle, not a retry.** The `unchanged`
  objective compared existence only, so it could "verify" a file the agent had
  rewritten. It now compares source equality, the seeded neighbour values and
  the reported answer; the seeded values were made distinctive so a wrong answer
  cannot satisfy them. Both strata were re-run on a real model and re-priced.
- **Strata 4/7 needed a case a real model can pass.** The positive fixtures
  deliver an exact output and an honest completion; both now carry an explicit
  positive `verifiedSuccesses` count.
- **Stratum 8 needed an authorization fix.** The owned-path rule was
  unreachable behind the tool-permission allow, so a worker scoped to one file
  wrote all three and its siblings had no mutation evidence. Fixed in
  `bf29449b`; the crash/restart run now completes 3/3 workers.

All five runs used an explicit `openai/gpt-4o` one-off: the operator's current
default model (`intern/deepseek-v4-flash-0731`) refuses every full agent request
with `API error 429: quota exceeded`. No default was changed and no offline
mock was substituted.

Stratum 9 stays `null`: local CPU inference is non-billable, and `null` is not
zero. A measured 10/10 is unreachable as stated. Gate B and publication remain
HOLD.
