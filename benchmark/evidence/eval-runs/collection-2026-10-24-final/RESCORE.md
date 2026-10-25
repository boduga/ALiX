# Re-score against the corrected oracle (2026-10-24)

An independent review found the evaluator admitted false passes
([`docs/audits/2026-10-24-gb01-oracle-review.md`](../../../docs/audits/2026-10-24-gb01-oracle-review.md)).
The oracle was corrected. This file records what the corrected oracle says about the
evidence already retained for this collection — no new model calls, no spend.

Reproduce:

```sh
pnpm build
node benchmark/evidence/rescore-collection.mjs benchmark/evidence/eval-runs/collection-2026-10-24-final
```

## What changed in the oracle

1. **`answerAsserts` replaces the `answerIncludes` substring test.** A value found only
   inside a negated or corrected clause no longer satisfies an answer objective:
   `"x is NOT kestrel-9; x is raven-2"` is now `negated`, not `asserted`. A following
   `not` that clarifies *type* (`a string, not a number`) still counts as an assertion —
   a detector that fails honest answers is its own kind of unsoundness.
2. **`patch` / `replacement` require exact final content.** A comment containing the fix
   no longer passes, and `changed` is no longer hardcoded.
3. **Admissibility is provenance-anchored.** An HTTP status counts only in a status
   position (`HTTP 403`, `status: 429`); prose must be unmistakable provider language; a
   message reporting both a provider fault and a task failure is admissible, because the
   task failure is the finding.

## Re-score result

| Check | Result |
|---|---|
| Rows in collection | 45 |
| Recorded verified successes | 36 |
| Rows re-derived end to end | 35 |
| **Verdicts that changed** | **0** |
| Exact-content objectives checked (sha256 of expected vs retained after-digest) | 40 |
| Mismatched | **0** |
| Answer assertions checked (`answerAsserts` over retained `finalAnswer`) | 15 |
| Mismatched | **0** |
| Runs re-checked for admissibility flips | 5 |
| Flips | **0** |
| Rows not re-derivable from retained evidence | 10 |

**The corrected oracle reaches the same verdict on every row it can re-derive.**

## What the correction did *not* change, and why that is stated rather than hidden

Two of the three defects turned out to have **no effect on this collection**. Both facts
are reported because "the fix changed nothing" and "the fix could not have changed
anything" are different claims, and only the second one is true here.

- **The `patch` / `replacement` defect is latent in this collection.** No eval case uses
  those objective kinds: the patch and replacement cases assert `kind: "file"` with
  `contentEquals`, which was already an exact comparison. The defect was real and
  reproduced by probe against the built evaluator; it simply had no case to admit.
- **The admissibility defect excluded nothing here.** Both the old and the corrected
  classifier return `admissible` for all five retained error strings — the decisive
  trigger (`forbidden`) does not appear in them; they say `file.create` / `file.delete`.
  The defect was real and reproduced by probe; it was not exercised by these runs.
- **The answer-assertion defect is the one that mattered**, and it is exercised by 15
  assertions across 10 runs. All 15 still assert under the stricter check.

## What "re-derived" does and does not mean

- **Re-derived:** the objective axis. File objectives are checked by comparing
  `sha256(expected content)` against the retained after-run digest — a *stronger* check
  than the string containment used before. Answer objectives are re-tested with
  `answerAsserts` over the retained `finalAnswer`.
- **Held fixed from the record:** the status-honesty and guard axes
  (`statusHonest`, `guardEvidence.satisfied`). They are not what this correction touched,
  and they are combined with the re-derived objective exactly as the collector does
  (`eval-case-sweep.mjs`).
- **Not re-derivable:** 10 rows whose objective is `contentIncludes` or existence-only.
  The retained workspace manifest stores digests, not content, so "the file contains X"
  cannot be re-tested after the fact. The script counts these as `not re-derivable` and
  never reports them as confirmed.

Re-scoring is **not** independent re-derivation of the run's behaviour — it is the same
objective code applied to retained evidence. Independent re-derivation of all 45
outcomes is the separate denominator review
(`docs/audits/evidence/2026-10-24-codex-denominator-review.txt`), which re-derived the
outcomes from retained evidence and found zero mismatches.
