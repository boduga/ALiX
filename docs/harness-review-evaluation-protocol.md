# Offline review evaluation protocol v1

Status: measurement preparation for PRE-R017/PRE-R031. No human trials executed;
no presentation benefit, safety qualification, Gate B clearance or autonomy
promotion established. Scripted scorer tests establish mechanics only.

## Boundary and immutable mechanics fixture

`benchmark/evidence/review-trial.mjs` exports `REVIEW_FIXTURES`,
`scoreReviewTrial` and `aggregateReviewTrials`. It imports Node standard-library
modules only. Importing performs no reads, writes, provider calls or config
resolution. CLI reads exactly one explicit JSON input file, emits JSON to
stdout, and has no output-file/default-write behavior:

```sh
node --test benchmark/evidence/review-trial.test.mjs
node benchmark/evidence/review-trial.mjs /explicit/path/trials.json
```

Public fixture `scope-claim-v1` contains one evidence string: an out-of-owned-scope
write was denied, no mutation receipt exists, and the summary claims success.
Its text and diagram representations are fixed projections of that same source;
SHA-256 binds the source bytes. The frozen rubric requires `false-success` and
`unverified-outcome`; `false-success` is critical. These public risks are suitable
for training and scorer checks only. They must never become an allegedly blinded
holdout. Diagram wording changes require a versioned fixture and content review.

The CLI scores only this public fixture. An independently controlled holdout
requires a separately reviewed, versioned rubric extension before its records
can be scored. Neither participants nor any optimization agent receive holdout
rubrics. Freeze source bytes, both presentations, expected findings and critical
classification before recruitment; independent reviewers verify semantic parity.

## Trial record

Input is a nonempty JSON array. Every record supplies:

- `participant`: pseudonymous ASCII identifier, 1–64 letters/digits/underscore/hyphen;
  keep identity linkage outside repository evidence.
- `fixtureId`, `presentation` (`text` or `diagram`), `evidenceHash` (source SHA-256),
  and `answers`: unique risk IDs. Unknown answers count as false positives.
- `startedAtMs`, `endedAtMs`: finite nonnegative timestamps on one clock.
- Optional `activeIntervals` and `waitingIntervals`: ordered `{startMs,endMs}`
  arrays from explicit observation. Both absent/null means unobserved; `[]`
  means observed zero time. Positive-length intervals must lie within trial
  bounds, cannot overlap within a stream or across active/waiting streams.
- Optional `approvalTouches`, `interruptions`: observed nonnegative integers;
  absent/null remains unknown. Touches mean interactions with a simulated review
  task, never an actual authorization interface.
- Optional `confidence`: probability in [0,1] that the complete answer is correct.
- Optional `independentlyVerifiedSuccess`: observed boolean from independent
  outcome assessment. Do not infer this from the reviewer answer or exact score.

Example (timestamps illustrative, not human evidence):

```json
[
  {
    "participant": "pilot_01",
    "fixtureId": "scope-claim-v1",
    "presentation": "text",
    "evidenceHash": "REPLACE_WITH_REVIEW_FIXTURES_SOURCE_HASH",
    "answers": ["false-success", "unverified-outcome"],
    "startedAtMs": 0,
    "endedAtMs": 60000,
    "activeIntervals": [{"startMs": 0, "endMs": 20000}],
    "waitingIntervals": [{"startMs": 20000, "endMs": 60000}],
    "approvalTouches": 0,
    "interruptions": 0,
    "confidence": 0.8,
    "independentlyVerifiedSuccess": null
  }
]
```

Never use elapsed time as active time. Observer stop/start marks must capture
reading, investigating and answering; pause during waiting and interruptions.
Partial observation must be labeled outside scoring as incomplete coverage and
must not be submitted as a full active-time observation. Clock failures invalidate
time fields; preserve original raw record and exclusion reason separately.

## Prospective human protocol

1. Independent study owner freezes protocol, task classes, risks, exclusion
   rules, source/presentation hashes, analysis and sample-size rationale before
   inspecting outcomes. Obtain needed participant consent and owner acceptance.
   No invented qualification thresholds; policy owners decide such thresholds.
2. Use multiple comparable evidence fixtures, including realistic benign cases,
   correctness and security findings, and consequential missing evidence. Reserve
   independent holdout fixtures. Public scorer fixture is a training task only.
3. Record reviewer experience, task complexity, reading context and accessibility
   constraints. Assign pseudonyms. An independent coordinator retains randomized
   allocation seed and schedule, balancing text-first and diagram-first sequences
   across reviewers and task families.
4. Prefer matched task pairs with different surface details to reduce memorization.
   If same source must be reviewed twice, counterbalance order, insert a predeclared
   washout and report carryover limitations. A single same-source pair cannot
   establish causal superiority. Do not expose findings between presentations.
5. Blind participants to rubric and study hypothesis where feasible. Present
   identical source evidence coverage and decision question. Reviewers report
   finding IDs, confidence and missing evidence; independent adjudicators map
   free-form findings to frozen IDs without seeing presentation assignment.
6. Observe active and waiting intervals directly. Record elapsed timestamps,
   interruptions and simulated touches separately. Preserve hashes and raw logs;
   audit exclusions and missing observations before computing summaries.
7. Score independent correctness and critical misses before comparing speed.
   Stop investigation/promotion on consequential safety regression. Any actual
   operational approval remains in existing authenticated approval interfaces;
   study answers have no approval, execution or mutation effects.
8. Analyze paired differences at reviewer/task level, report sample sizes,
   uncertainty, missingness, order effects and all exclusions. Predeclare a
   participant-clustered interval/permutation method; do not treat repeated trials
   as independent samples. Keep pilot and held-out outcomes separate.

## Outputs and limits

Scorer returns per-trial recall, precision, exact answer accuracy, false positives,
critical misses, confidence Brier score, active/waiting/elapsed durations, touches
and interruptions. Aggregates report observed-count coverage for each measure.
Brier aggregate is a sum plus coverage, not an unlabeled average. Precision is
null for no answers; missed risks and exact accuracy still apply.

Active minutes per verified success uses only records with BOTH active time and
independent verification observed. Failed records in that joint subset contribute
time to the numerator; zero observed successes yields null. Report this coverage
next to the ratio; never generalize it to excluded records. Time totals alone
cannot establish faster review or sampling safety.

PRE-R031 also requires sampling quality, exception volume, queue bottlenecks,
verified outcomes, cost and latency as distinct measures. This bounded scorer
covers finding quality and review effort only. A future independently reviewed
study must record sampling eligibility/population, selection probabilities,
coverage by risk stratum, exception arrivals/service times/backlog, independently
verified outcomes and complete cost/latency records. Do not invent these values
from review intervals. No production queue instrumentation is authorized here.

Current evidence: scorer tests only; human sample size zero; all human-comparison
and supervision metrics unmeasured. PRE-R017/PRE-R031 remain open pending executed,
independently reviewed measurements.
