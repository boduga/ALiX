# GB-11 — operator-attention measurement: full instructions

**Status: READY TO RUN. Requires a human observer. Nothing here has been executed.**
**Nothing in this document is a measurement. n = 0.**

---

## 0. The one-sentence version

A person sits with a stopwatch-driven record sheet, reviews a set of task outcomes,
and the numbers go into a JSON file that the **existing scorer** already knows how to
read. No code needs writing.

---

## 1. What GB-11 actually requires

From `docs/harness-operator-attention-metrics.md` §1–2, the PRD (§12.1, §12.3) requires
five measures:

| ID | Measure | Meaning |
|---|---|---|
| **M-1** | Active review minutes per verified success | The headline number |
| **M-2** | Interruptions | Review preempted and resumed |
| **M-3** | Approval touches | Interactions with an approval record |
| **M-4** | Missed-evidence events | Decision made while a known gap was unacknowledged |
| **M-5** | Reversal events | Consequence reversed afterwards |

**GB-11 is satisfied by M-1 only.** M-2/M-3 are cheap to capture alongside; M-4/M-5
need a longer longitudinal window and are *disqualifying* measures, not tiebreakers —
per §12.3, a workflow that saves minutes while raising missed-risk **fails**.

**The definition that matters most:** active review is *reading, comparing, deciding*.
It is **not** waiting for an agent to run. A timer that includes agent wall-clock is
wrong and will be rejected.

---

## 2. What already exists (verified, so you don't rebuild it)

| Piece | Location | State |
|---|---|---|
| Metric definitions | `docs/harness-operator-attention-metrics.md` | written |
| Trial-record schema + protocol | `docs/harness-review-evaluation-protocol.md` | written |
| Scorer (computes M-1) | `benchmark/evidence/review-trial.mjs` | works |
| Scorer tests | `benchmark/evidence/review-trial.test.mjs` | passing |
| `activeMinutesPerVerifiedSuccess` | `review-trial.mjs` aggregate output | already emitted |

**The entire chain exists. It has zero rows.**

**One real constraint found while verifying this:** the scorer validates against a
frozen registry and rejects unregistered fixtures. See §3.1 — this decides which of the
two routes you take.

---

## 3. Prerequisites — settle these before observing anything

Do these in order. Each is a decision that must be frozen **before** you see results,
so it cannot be chosen after the fact.

### 3.1 Fixtures — READ THIS FIRST, it constrains everything

**The scorer only accepts registered fixtures.** `REVIEW_FIXTURES` in
`benchmark/evidence/review-trial.mjs` currently contains exactly one:

```
scope-claim-v1
  evidenceHash: 6184f3620599ae932a22ffae989be236cd4c39171cbac9115d1c20bc660e4f56
  risks:         false-success, unverified-outcome
  critical:      false-success
  presentations: text, diagram
```

An unregistered `fixtureId` is rejected with `unknown fixture`, and a mismatched
`evidenceHash` is rejected too. **Verified by attempting it.**

So there are two honest routes, and no third:

**Route A — score against `scope-claim-v1` (works today, weak evidence).**
Record real observations against the one registered fixture. You get a genuine M-1
number. Limitation you must state: `scope-claim-v1` is **published training material**,
not a holdout, and n is however many observers × presentations you run. It proves the
measurement works; it does not characterise review effort in general.

**Route B — register the real collection artifacts as fixtures first (stronger, ~1 day).**
Add entries to `REVIEW_FIXTURES` for the cases in
`benchmark/evidence/eval-runs/collection-2026-10-24-final/`, each with its evidence
text, SHA-256, risk list and critical risk. This is a **code change to the scorer**, so
it needs the usual review — and per the protocol, the fixture must be frozen and
reviewed *before* any observer sees it.

Route B is what makes GB-11 meaningful for this baseline. Route A is what you can do
this afternoon. Do A first to validate the procedure, then B.

**Minimum useful set:** 5 fixtures on Route B. On Route A, report it as a pilot.

### 3.2 Freeze the risk rubric (15 minutes)

Write down, before reviewing, which findings count:

- correctness defects (wrong output, unmet objective)
- security findings (unauthorized write, containment)
- governance gaps (missing approval, dishonest status claim)

Record the rubric file path and its SHA-256. `docs/harness-review-evaluation-protocol.md`
already defines the `scope-claim-v1` rubric; extend it only by a **versioned** addition,
never by editing after seeing results.

### 3.3 Decide who observes (2 minutes)

- The observer must not be the person who produced the runs.
- Record the observer as a pseudonym (`observer_01`), not a real name. Keep identity
  linkage outside repository evidence.

### 3.4 Declare n and the analysis method (5 minutes)

State up front: how many fixtures, how many observers, and that the statistic will be
the **sum of active minutes ÷ count of independently verified successes**, with the
coverage count reported beside it. Do not plan a mean-of-means.

---

## 4. Observation procedure — one trial

Do this per fixture, per observer. **One clock.** Use a single stopwatch app that
records intervals, not a single timer you start and stop by feel.

### 4.1 Set up

1. Open the fixture's evidence: task prompt, final files, guard output.
2. Start the trial clock. Record `startedAtMs` (epoch ms).
3. **Do not** open the approval store or any live agent during review.

### 4.2 Mark active intervals

- Press **start** when you begin reading or comparing.
- Press **stop** when you pause to think without the screen, take a call, or wait.
- Press **start** again when you resume.

Each press pair becomes `{startMs, endMs}` in `activeIntervals`.

**Rules:**
- Intervals are ordered, non-overlapping, and inside the trial bounds.
- Waiting on a tool or an agent is `waitingIntervals`, **not** active.
- If you forget to press, the honest answer is to mark that fixture's active time
  **unobserved** (`null`), not to estimate it.

### 4.3 Record the decision

Write the risk IDs you found: `false-success`, `unverified-outcome`, etc. Anything not
on the frozen rubric is a **false positive** and counts against precision — so be
disciplined rather than generous.

### 4.4 Record the counters

- `approvalTouches`: how many times you interacted with an approval record. **0 if
  none.** This is a simulated review, never an actual authorization.
- `interruptions`: how many times review was preempted and you resumed later.
- `confidence` (optional): 0–1 that your complete answer is correct.

### 4.5 Independent verification — **the part people get wrong**

`independentlyVerifiedSuccess` must come from **checking the artifact**, not from
whether you liked the answer and **not** from the evaluator's own verdict.

Procedure:
1. After the review is closed, independently run the case's objective check against
   the retained evidence (the oracle is in `src/operations/evals/evaluators/`).
2. Record `true` only if the objective genuinely landed.
3. If you cannot check it, record `null`. **Never infer it from your answer or from
   the row's `verifiedSuccess` field** — that would make the metric circular.

---

## 5. Fill the record

One JSON array, one object per trial. Schema is fixed by
`docs/harness-review-evaluation-protocol.md`:

```json
{
  "participant": "observer_01",
  "fixtureId": "collection-2026-10-24-final/read-only",
  "presentation": "text",
  "evidenceHash": "<sha256 of the evidence you reviewed>",
  "answers": ["unverified-outcome"],
  "startedAtMs": 1761300000000,
  "endedAtMs": 1761300420000,
  "activeIntervals": [
    { "startMs": 1761300000000, "endMs": 1761300150000 },
    { "startMs": 1761300300000, "endMs": 1761300400000 }
  ],
  "waitingIntervals": [
    { "startMs": 1761300150000, "endMs": 1761300300000 }
  ],
  "approvalTouches": 1,
  "interruptions": 0,
  "confidence": 0.8,
  "independentlyVerifiedSuccess": true
}
```

Timestamps above are **illustrative**. Do not copy them.

**Validation the scorer enforces** (it will reject these):
- intervals must be ordered and inside `[startedAtMs, endedAtMs]`
- active and waiting streams may not overlap each other
- `approvalTouches` / `interruptions` must be nonnegative integers
- unknown `answers` count as false positives
- absent interval arrays mean **unobserved**, `[]` means **observed zero**

---

## 6. Score it

```sh
node --test benchmark/evidence/review-trial.test.mjs     # confirm the scorer is sane
node benchmark/evidence/review-trial.mjs /path/to/trials.json
```

The output includes:

| Field | Meaning |
|---|---|
| `activeMinutesPerVerifiedSuccess` | **M-1** — sum of active minutes ÷ verified successes |
| `jointActiveAndVerificationCoverage` | how many trials had BOTH active time and independent verification |
| `verifiedSuccessesInJointCoverage` | the denominator actually used |
| per-trial recall, precision, exact accuracy, critical misses | quality, separate from effort |
| Brier sum + coverage | calibration, if you recorded confidence |

**Read the coverage numbers before the headline.** If
`jointActiveAndVerificationCoverage` is less than your n, the M-1 figure covers only
that subset. Report it as such; never generalise it to excluded trials.

---

## 7. Write it down

Create `docs/audits/<date>-gb11-operator-attention.md` recording:

1. Fixture set + rubric hash + who declared them, frozen **before** results.
2. Observer pseudonym(s), n, and the analysis method.
3. The scorer output, verbatim.
4. **Coverage and `null` counts** next to every aggregate — per
   `harness-operator-attention-metrics.md` §5.
5. What the number does **not** establish: it is one observer on a small fixture set,
   not a general rate.

Then update the GB-11 row in
`docs/audits/2026-10-23-gate-b-acceptance-packet.md` from `missing` to `met`, citing
that file.

---

## 8. Effort and cost

**Route A (`scope-claim-v1` only):**

| Step | Time |
|---|---|
| Prerequisites (§3.2–3.4) | ~25 min |
| 5 trials × ~10 min active + setup | ~90 min |
| Independent verification | ~30 min |
| Scoring + write-up | ~30 min |
| **Total** | **~3 hours, `$0`** |

**Route B (register real fixtures first, then the above):**

| Step | Time |
|---|---|
| Add + review `REVIEW_FIXTURES` entries | ~4–6 hours (code change, reviewed) |
| Then Route A's work | ~3 hours |
| **Total** | **~1 day, `$0`** |

No model calls. No spend. One person, one afternoon.

---

## 9. What would make this invalid

Recorded so it is not discovered afterwards:

- **Including agent wait time as active review.** Inflates M-1; the metric's whole
  point is to separate them.
- **Inferring `independentlyVerifiedSuccess` from the row's own verdict.** Makes the
  quotient circular.
- **Choosing fixtures or rubric after seeing outcomes.** Contamination.
- **Using `scope-claim-v1` as holdout evidence.** It is published training material.
- **Reporting M-1 without its coverage count.** A number over 2 of 5 trials presented
  as if over 5.
- **Editing the rubric mid-review.** Any change means a versioned restart.

---

## 10. Honest note on what GB-11 will and will not prove

It will produce **a real measured number** for `operatorActiveReviewMinutes /
independentlyVerifiedSuccesses`, on a stated fixture set, with stated coverage.

It will **not** establish a general operator-attention rate, will not qualify
PRE-R031 (sampling quality, missed-risk rates, exception volume), and will not on its
own make GB-14 signable — GB-14 also wants the rest of the baseline accepted as an
artifact set.

It does remove the last measurement-shaped blocker on Gate B, and it is the only one
that a human can clear in an afternoon without spending anything.
