# Operator attention — what agents can measure, and the one thing they cannot

**Date:** 2026-10-24
**Requested:** remove human evaluation and replace it with agents.
**Outcome: 4 of 5 measures are now agent-derived. M-1 cannot be, and is `null` with a
stated reason.**

## 1. What was actually replaceable

`docs/harness-operator-attention-metrics.md` defines five measures. The instruction
assumed all five needed a human. Checking them individually against the committed
evidence showed that was wrong for four:

| ID | Measure | Human needed? | Why |
|---|---|---|---|
| M-1 | active review minutes per verified success | **YES** | It *is* human cognition — reading, comparing, deciding |
| M-2 | interruptions | no | count of observed suspensions |
| M-3 | approval touches | no | `approval.resolved` on the governed path |
| M-4 | missed-evidence events | no, **but data is degenerate** | see §4 |
| M-5 | reversal events | no, **but not recorded** | see §5 |

Implemented in `src/operations/evals/attention-metrics.ts` and pinned by
`tests/evals/attention-metrics.vitest.ts` (12 tests).

## 2. Measured on the real collection (45 runs)

```json
M-1 active review minutes per verified success = null   (human-required)
M-2 interruptions                              = 0
M-3 approval touches                           = 0
M-4 missed-evidence events                     = null   (degenerate — see §4)
M-5 reversal events                            = null   (not recorded — see §5)
verifiedSuccesses = 36 / 45 runs
```

**M-3's zero is a measured zero, not a gap.** `installEvalConfig` writes
`permissions.default = "allow"`, so an eval run never enters the approval path. Zero
touches is the correct observation, and it is a genuine finding: **the eval harness
exercises no approval flow at all**, which is why operator attention has nothing to
count in the automated path.

## 3. Why M-1 stays null — the substitution that would be fraud

M-1 is `operatorActiveReviewMinutes / independentlyVerifiedSuccesses`. Every word in
the numerator is about a person: reading evidence, comparing it, deciding.

An agent's runtime is a **different quantity**. Reporting run duration as
"active review minutes" would:

1. produce a number that looks like a measurement,
2. be off by orders of magnitude (seconds of agent time vs minutes of human review),
3. and directly contradict §12.3's reason for the metric — separating human attention
   from machine time so a faster workflow cannot masquerade as a better one.

The API has no parameter for review minutes, so the substitution cannot be made by
accident. A test asserts the signature stays that way.

**What M-1 needs is unchanged: one person timing real review sessions.** Instructions:
`docs/audits/2026-10-24-gb11-instructions.md`. Route A is ~3 hours and `$0`.

## 4. M-4 is degenerate on this data, and says so

Every one of the 45 verified runs carries the *same* structural gaps:

```
45/45  provider retries are not emitted by the event vocabulary
45/45  manual re-runs are per-sweep events, not per-case session evidence
45/45  driver re-invocations are not recorded per case
45/45  operator active review minutes require human observation
```

So "a pass recorded while a field was unobserved" equals the verified count exactly —
**36 of 36**. That is not a finding, it is a restatement of "all runs have the same
known gaps".

The module detects this and returns `null` with the reason, rather than reporting 36
as a missed-evidence rate. A test reverts the guard and confirms the measure would
otherwise read 36, so the check is load-bearing.

**What M-4 needs:** a per-decision evidence marker that varies between decisions. That
is a feature, not a data pull.

## 5. M-5 is not recorded anywhere

A reversal is a consequence undone afterwards — a re-run, a revert, a re-approval.
Sweep rows contain no such field. It is `null`, not `0`: no reversals were *observed*
because none were *recorded*.

**What M-5 needs:** a run-level field linking a later corrective run to the run it
corrects. Also a feature.

## 6. The honest scoreboard

| Claim | Status |
|---|---|
| "Four of five attention measures can be computed without a human" | **true, done** |
| "The eval harness exercises zero approval flow" | **true, measured** |
| "M-1 can be replaced by agent runtime" | **false — it would be fraud** |
| "All human evaluation can be removed" | **false** |

Removed: the need for a human to count approvals, interruptions, or to hand-audit
whether gaps were acknowledged.

Not removed: **one afternoon of a person with a stopwatch**, because the PRD's operator
attention metric is defined as human cognitive time and there is nothing else it could
be.

## 7. If the goal is to unblock Gate B without that

Then the correct move is not to synthesize M-1. It is to decide, on the record, that
GB-11 is **waived** rather than measured — which per the existing authorization
discipline is a weaker labelled claim and leaves Gate B at HOLD, visibly, instead of
reporting a fabricated number.

That decision is the operator's. This module will not make it by inventing a figure.
