# Gate B review by an independent model reviewer (Codex / gpt-6.1-sol)

**Date:** 2026-10-23
**Reviewer:** Codex CLI 0.164.0, model `gpt-6.1-sol`, in a read-only sandbox.
**Repository state reviewed:** `ba8b8064` (clean tree).
**Prompt:** `/tmp/opencode/codex-scorer-prompt.md` (reproduced in §6).
**Raw output:** `/tmp/opencode/codex-review.txt` (transcribed in §3).

## 1. What this is, and what it is not

This is **model-independent review**, not human independence. Codex is a different
model family, a different harness, and did not author this repository. It wrote its
own verdicts from its own reading; the prompt asked it to verify claims rather than
trust them, and it did.

It is **not**:

- GB-14 operator acceptance. A signature is authority, and a model holds none.
- Gate E security clearance. Codex can analyse; it cannot authorize.
- GB-11 operator attention. No synthetic process produces observed human review time.
- A human review. PRE-R017/PRE-R031 count humans, and this is not a human.

Whether model-independent review satisfies GB-12 is an **operator policy decision**,
not one this document can make. The PRD does not require a human by name; the
authorization record says independence means "the qualifier is not the author".
Codex is not the author. The operator must decide if that suffices, and should say
so in writing before it is cited as GB-12 evidence.

## 2. Result

**Codex verdict: HOLD.** 3 met (GB-02, GB-03, GB-10), 8 partial, 5 missing
(GB-06, GB-08, GB-11, GB-12, GB-14).

That differs from my author-only scoring in three places, and Codex was right in two
of them:

| Requirement | My record | Codex | Adjudication |
|---|---|---|---|
| GB-08 latency | partial | **missing** | **Codex is right.** My "partial" was generous. Two paid cases have per-case durations; that is not a p50/p95 baseline. |
| GB-13 provenance | partial | partial | Agree. |
| GB-01 corpus | partial | partial | Agree, same hash-drift finding. |

## 3. Adopted findings — errors in my own work

Each was verified independently before. These are corrections, not opinions.

### 3.1 False provenance claim (packet §5.3)

> *"There is no retained raw session event stream for any paid run"*

**False.** `benchmark/evidence/cost/positive-openai-gpt4o.json` retains 84 and 78
events for its two paid cases, including 4 and 5 `model.usage` records.

### 3.2 False claim in my author-only scoring record (GB-13)

> *"benchmark/evidence has no deletion history"*

**False.** Commit `15f89a64` deleted
`benchmark/evidence/coordination/workspace/docs/{a,b,c}.md`. Confirmed with
`git show --stat 15f89a64`. The claim that missing run logs are unrecoverable may
still hold; the reason I gave for it does not.

### 3.3 Wrong artifact counts (my GB-08 note)

I claimed 26 cost/coordination artifacts and timing in 2. Actual: **40** artifacts,
**6** with `finishedAt`, **6** with a numeric duration field. My figures came from a
glob that missed the coordination directory and from a substring test that missed
`observability.metric` name/value pairs.

### 3.4 Latency characterised wrongly

I wrote that the two duration-bearing artifacts hold "whole-run wall time" only.
`positive-openai-gpt4o.json` records **per-case** `workflow_duration_ms` values of
`7229` and `609933` via `observability.metric`/timer. The GB-08 conclusion (no
qualified latency distribution) survives; my description of the evidence did not.

## 4. Findings I checked and could not confirm

Recorded because a reviewer's errors matter as much as its catches.

| Codex claim | Check | Result |
|---|---|---|
| Duplicate usage rows in restart artifacts (2/6/11/5 duplicates) | Parsed `usage` arrays: `stratum8-restart-metered` 4 rows/4 unique, `restart-fixed2` 4/4, `debug` 4/4 | **Not reproduced.** Duplicates may be inside a nested field I did not test; unconfirmed rather than refuted. |
| Stratum 3 "12/12 across 4 cases" is overstated | Rows: 5 cases × 3 = 15 rows, 12 passing | **Partly confirmed.** The document's "4 cases" is wrong (5), and `patch-application` rows read `fail`; but 12 passing of 15 is arithmetically 12/12 of the *passing* subset only if patch rows are excluded from the denominator, which the doc does not say. Overstated. |
| `readonly-navigation.json` dated 2026-10-21 but timestamps say 2026-10-22 | Not independently re-run | **Unverified**, retained as reported. |

## 5. What the operator must decide

1. **Does model-independent review satisfy GB-12?** Record the answer in writing.
   If yes, GB-12 can be scored off a properly-run Codex pass, and the scoring record
   must name Codex as reviewer with its model and commit — never a human name.
2. **Fix the two false claims** (§3.1, §3.2) before the packet is shown to anyone
   else. A packet that asserts a false provenance fact undermines every other row in
   it, including the true ones.
3. **GB-11 and GB-14 remain unavailable in principle.** No model produces observed
   human attention or a signature.

## 6. Reproduction

```sh
codex exec --sandbox read-only -m gpt-6.1-sol < /tmp/opencode/codex-scorer-prompt.md
```

The prompt instructs read-only operation, forbids file writes, staging, committing,
paid calls and the eval suite, and requires per-requirement verdicts plus explicit
`MISMATCHES` and `UNSUPPORTED CLAIMS` sections. No repository file was modified by
the review; the tree was clean before and after.
