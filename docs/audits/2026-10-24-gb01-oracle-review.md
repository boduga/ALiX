# GB-01 — independent oracle review result: NOT FIT

**Date:** 2026-10-24
**Reviewer:** Codex CLI `0.164.0` / `gpt-6.1-sol`, read-only sandbox
**Evidence:** `docs/audits/evidence/2026-10-24-codex-gb01-oracle-review.txt`
(SHA-256 `c3b312d1ed2258d5…`), prompt `…-prompt.md` (`de39b80670cfcc51…`)
**Verdict: `NO`. The oracle is not fit to independently verify baseline outcomes.**

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
