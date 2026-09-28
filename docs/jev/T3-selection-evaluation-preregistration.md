# T3 Selection Evaluation — Pre-registration

**Status:** FROZEN before corpus #2 is collected. Changing a code, a label
value, or the checkpoint requires an amendment at the bottom of this file, and
an amendment makes the affected rows non-comparable with earlier ones.

## Purpose

T3 asks one question: **did Jev's tool selection beat the actual model choice**
on the same frozen selection-time context? It is an offline measurement. It adds
no route, no policy authority, and no runtime influence.

The pilot corpus (5 scopes, 5 sessions) exists to find measurement defects. It is
not a tuning set: the definition of a usable scope and of success is fixed here,
before more disagreements are seen, so the answer cannot be fitted to the result.

## Roles in every statistic

| Role | Identity | May appear in |
|------|----------|---------------|
| Primary baseline | the actual model choice recorded in the trace | agreement, disagreement, labelled comparisons |
| Experimental alternative | `jev:tool-selection-replay` | agreement, disagreement, labelled comparisons |
| Diagnostic context | deterministic scoper ranking, MCP selector | reported context only — **never** a quality statistic |

Comparing against a diagnostic selector instead of the model choice would answer
a different question. Keep the two apart in every report.

## Eligibility — two independent tracks

A corpus row carries `{ selection, outcome, reason? }`. The tracks are
independent because a factual selection can still have an unusable execution
result, and the reverse.

| Code | Meaning |
|------|---------|
| `execution-context-drift` | the run left its prompt and its result describes work it was not asked to do |
| `incomplete-trace` | the trace has no executed choice for the scope |
| `projection-invalid` | the scope cannot be projected: empty candidate set, empty offer, or an unresolved handle |
| `candidate-set-not-preserved` | the alternative ranking does not cover the offered set, so agreement is not computable |
| `replay-invalid` | the recorded-response replay was rejected for a reason other than set preservation |
| `fixture-ambiguous` | the recorded fixture matches more than one candidate meaningfully |
| `operator-aborted` | the operator stopped the run |

Rules:

- The vocabulary is closed. There is no generic `bad-run`; an exclusion must name
  what actually went wrong, and new codes enter only through an amendment.
- Derivation order is fixed: `projection-invalid` → `incomplete-trace` →
  `candidate-set-not-preserved` → `replay-invalid`, then an analyst override.
- An override names one track and never silently widens to both. A drift note on
  a row keeps the selection factual while excluding its execution result.
- An ineligible track is excluded from that track's statistics and stays in the
  corpus. Failures are preserved, not deleted, so the reason is auditable.

## Track A — selection-time appropriateness (blind, offline)

For each scope where the model choice and the alternative top differ, present the
frozen selection-time context to an operator and label **each candidate
independently**:

```text
appropriate | inappropriate | unclear
```

Rules:

- The card says nothing about which candidate came from the model and which from
  Jev. Identity is carried only in the committed record, revealed after the
  labels are written.
- Slots A and B are assigned by a deterministic rotation derived from the scope
  key, never by operator choice, so the presentation is reproducible and
  provably not chosen to favour a side.
- Multiple next actions may be reasonable. The operator judges each candidate on
  its own; no winner is forced and `unclear` is a legitimate answer.
- Judge against the frozen context only. `objectiveHash` pins the objective the
  labels were written against, and a record whose order does not match the row is
  ignored rather than guessed at.

Derivation for reporting:

```text
both appropriate | actual only | alternative only | neither | unclear
```

## Track B — outcome evidence (separate from Track A)

A counterfactual may be evaluated when it was **observed, replayed, or
explicitly labelled** — never inferred.

```text
evidence:   observed | replayed | unknown
execution:  success  | repaired | failed
selection:  novel    | redundant
evidence:   contributed | none | unknown
gapClosure: closed | not_closed | unknown
```

`gapClosure` is an offline analyst label on a scope. It is never derived from the
live loop's own evidence signal, and a scope with an ineligible outcome track
cannot carry one.

## Checkpoint — the first evaluation, not a promotion threshold

```text
30 eligible scopes
AND
10 labelled disagreements
```

Reaching 30 scopes without 10 labelled disagreements means there is not enough
discriminating data yet; that is a finding, not a pass. Diversity is required
rather than thirty variants of the same read-only prompt: read/search,
verification, mutation, coordination, MCP/external-tool availability, and
multi-iteration runs.

## Economics, recorded but not optimized

```text
calls per scope
total scorer latency per scope
p50 / p95 candidate latency
remote failures
estimated cost, when the provider reports usage
```

Selection quality and runtime value are separate questions: Jev can win the
first and still fail T4 if each tool decision costs seconds.

## Requirement-detection context (reported, never blamed on the selector)

Report the prompt/task category and the detected requirements alongside the
selection statistics, and keep them out of the quality verdict — the trace does
not record a task category today (`taskCategory: "not-recorded"`). A
verification-shaped prompt with no requirement candidates is a requirement
detection observation, not evidence about Jev.

## Out of scope until the checkpoint is met

T4 (tool selection as a `DecisionType` with a route and fallback) and T5 (shadow
→ active) are discussed only after the checkpoint **and** the labelled
disagreement record exist. Until then tool selection stays an experiment:
`tool.selection.observed` telemetry, no route entry, no policy authority.

## Amendments

| Date | Change | Why | Effect on existing rows |
|------|--------|-----|-------------------------|
| 2026-09-28 | Initial freeze (this document) | Stop the definition of success moving after corpus #2 | none |
