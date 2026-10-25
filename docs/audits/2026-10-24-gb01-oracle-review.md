# GB-01 — independent oracle review: NOT FIT as reviewed, fixed and re-scored

**Date:** 2026-10-24
**Reviewer:** Codex CLI `0.164.0` / `gpt-6.1-sol`, read-only sandbox
**Evidence:** `docs/audits/evidence/2026-10-24-codex-gb01-oracle-review.txt`
(SHA-256 `c3b312d1ed2258d5…`), prompt `…-prompt.md` (`de39b80670cfcc51…`)
**Review verdict: `NO`. The oracle was not fit to independently verify baseline outcomes.**

## 0. Resolution (added after the review)

The review was acted on rather than filed. Sections 1–7 below are the review record
as it stood; this section is what happened to it.

| Review finding | Status | Where |
|---|---|---|
| 1. A negated answer passes | **fixed** — `answerAsserts` replaces the substring test; a value found in a negated or corrective clause fails, a type-clarifying `not` ("a string, not a number") still passes | `src/operations/evals/evaluators/objective-evaluator.ts` |
| 2. Ordinary task failures classified as provider faults | **fixed** — status-position anchoring for HTTP codes, unmistakable transport prose, and a mixed-signal rule that keeps a task failure scoreable | `src/operations/evals/eval-admissibility.ts` |
| 3. Broken code passes a `patch`/`replacement` objective | **fixed** — exact final content, and `changed` is derived rather than hardcoded | same evaluator |
| 4. `verification-repair` args bind no target | **open, recorded** — see §8 | — |
| 5. `malformed-tool-call` is not malformed; stratum-9 accepts `results: []` | **open, recorded** — see §8 | — |

**Re-score (no spend).** `benchmark/evidence/rescore-collection.mjs` re-derives the
retained collection against the corrected oracle:
35 of 45 rows re-derivable end to end, **0 verdicts changed**; 40 exact-content
objectives checked by digest, **0 mismatches**; 15 answer assertions, **0 mismatches**;
5 retained error strings re-classified, **0 flips**. Full record:
`benchmark/evidence/eval-runs/collection-2026-10-24-final/RESCORE.md`.

**Two of the three defects were latent in this collection**, and that is stated rather
than dropped: no eval case uses `kind: "patch"`/`"replacement"`, and both the old and the
new classifier return `admissible` for all five retained error strings. The defect that
was exercised — answer assertions, 15 checks across 10 runs — survives the stricter check
intact. "The fix changed nothing" and "the fix could not have changed anything" are
different claims; only the second is true for defects 2 and 3.

**Consequence:** GB-01 is `met` on a model-independent review plus reproduced, fixed
defects and a parity table wider than the implementation
(`tests/evals/oracle-parity.vitest.ts`, 26 cases including the must-stay-accepted rows);
GB-06 is `met` again because the corrected oracle re-derives its denominator unchanged.
Model-independent is still weaker than human independence and grants no Gate E clearance.

## 1. GB-01 stays `partial` — and the reason is now stronger than before

GB-01 required an independent oracle review. **It has now happened, and the oracle
failed it.** That is a different situation from "not yet reviewed": the review exists
and says the oracle admits false passes.

## 2. Defects I reproduced directly, not just accepted

Each of these was re-run against the built evaluator before being recorded.

### 2.1 A negated answer passes (major)

`objective-evaluator.ts:155` — `answerIncludes` is a **substring** test on the run's
final report. It does not check that the answer is asserted rather than denied.

```
Probe: source untouched, report = "x is NOT kestrel-9; x is raven-2"
Result: landed = true
```

The read-only and navigation cases use exactly this mechanism. **A model can state the
opposite of the truth and pass.**

### 2.2 Ordinary task failures are classified as provider faults (major)

`eval-admissibility.ts:62` — unscoped regexes over error text.

| Error text | Classified as |
|---|---|
| `Non-retryable write failures: forbidden.md` | **inadmissible** (provider-auth) |
| `Command exited with code 1: expected 500, received 3000` | **inadmissible** (provider-server) |
| `Command exited with code 1: assertion failed: timeoutMs should be 3000` | **inadmissible** (timeout) |
| `TLS certificate has expired` | admissible |

The first three are **normal agent failures** — the exact behaviour the benchmark exists
to measure. They are silently removed from both numerator and denominator. The fourth is
a real transport fault, and it is scored.

This inverts the admissibility rule: genuine failures get excluded, a genuine fault does
not.

### 2.3 Broken code passes a patch objective (major)

`objective-evaluator.ts:118` — `patch`/`replacement` accept `expectedContent` **anywhere**
in the file, and `changed: true` is hardcoded.

```
Probe: const x = 1;\n// export const x = 2;\n  -> landed=true, changed=true
```

The bug is unfixed; a comment containing the fixed line satisfies the checker.

## 3. This invalidates a number I reported

The collection's **36/45 verified** rests on this oracle. With 2.1 in place, a
read-only or navigation case could pass on a denied answer; with 2.3, a broken patch
could pass on a comment.

**I am not withdrawing the 36/45 figure outright** — the retained evidence exists, and
re-scoring it against a corrected oracle is possible without new spend. But the figure
must no longer be cited as independently verified until that re-score happens. GB-06's
`met` was contingent on the oracle being sound; it is not.

## 4. Other defects recorded without individual reproduction

From the same review, accepted as reported: verification-repair's `args: {}` binds no
target or replacement; `toolSequence` is an ordered subsequence, not a first-operation
constraint; malformed-tool-call raises a provider Error instead of submitting a malformed
call; stratum-9's classifier accepts `results: []`; synthetic fixtures are admissible
under real-provider options.

## 5. What a fix would have to do

Ordered by what unblocks the most:

1. **Bind answers to assertions.** `answerIncludes` must reject negation — require
   structured answer fields, or at minimum assert the token with no negation marker in
   its clause.
2. **Narrow admissibility to typed provenance.** Classify provider faults from
   retained provider diagnostics, never from arbitrary task-error text.
3. **Verify exact final content for patch/replacement**, and derive `changed` from a
   baseline comparison rather than hardcoding it.
4. **Bind verification-repair's patch** to its target and requested repair.
5. **Make malformed-tool-call actually malformed**, and stratum-9 reject empty results.

Items 1–3 are what make a re-score meaningful. 4–5 tighten cases that currently pass for
the wrong reason.

## 6. What this means for the gate

| Req | Before | Now |
|---|---|---|
| GB-01 | partial — "needs independent review" | **partial — review done, oracle rejected** |
| GB-06 | met, `$0.080520`/success | **reopened** — its denominator rests on a rejected oracle |

**Gate B: HOLD**, and the hold is now substantive rather than procedural: the measuring
instrument is known to admit false passes, so no figure it produced can be called
independently verified.

## 7. The honest summary

GB-01 asked for an independent oracle review, and it worked exactly as intended — it
found the oracle broken. Approving the review while keeping the numbers would be the
error; the review's value is that it stopped a baseline being signed on measurements
that can be faked.

Fixing items 1–3 is code work, no spend. Re-scoring the retained collection against a
fixed oracle is also no spend, because the evidence is retained. That is the path back
to a defensible GB-06.

## 8. Items 4–5: open case-design debt, recorded not waived

These are **not fixed**, and they are not claimed as fixed. Neither one creates a false
pass inside the 45-run collection, and that is the reason they do not hold GB-01/GB-06:

- **`verification-repair` binds no patch target** (`args: {}`). The case's objective is
  an exact-content check on `src/config.ts` plus a post-mutation verification guard, so a
  run still has to produce that exact file state and a successful verification. What is
  unbound is the *task prompt's* concrete edit, which makes the case harder to satisfy
  for the right reason than it should be — it does not make it easier to fake. Measured
  result: **0/5**, a real failure, not a false pass.
- **`malformed-tool-call` is not in this collection.** The case is absent from all nine
  artifacts, so its defect cannot inflate the denominator. It must be corrected before
  the case is ever collected.
- **Stratum 9's classifier accepts `results: []`.** Stratum 9 is GB-05 coverage
  (`benchmark/evidence/eval-runs/stratum9-attempts/`), not part of the GB-06
  denominator. It is recorded there as a 0/3 measured failure, so accepting an empty
  result list does not manufacture a success.

Both remaining items are therefore **case-design debt against future collections**, not
measurement evidence for this one. They stay visible here rather than being closed by a
verdict change.

