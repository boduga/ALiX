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
- **An observed model choice is a trace fact; comparing it is a separate
  question.** `actual-vs-Jev` agreement requires a *complete, preserved*
  alternative ordering (`candidateSetPreserved: true`). When the scorer fails
  mid-set the row keeps the observed choice but is not comparison-eligible — see
  the 2026-09-28 amendment. This is a clarification of comparability, not a
  loosening of the experiment: `partial` rankings still never count.
- A row carries one chosen `reason` plus `diagnostics`: every other code that
  fired, kept as metadata. Two defects on one run must both stay visible, and
  only the highest-precedence code may be the reason.

### Per-scope statuses (T3-d)

Every scope records four independent statuses, because "the run happened" and
"the comparison is usable" are different facts:

```text
trace complete?                 (a model choice was observed)
candidate set preserved?        (the alternative covered the offered set)
selection comparison eligible?  (agreement/disagreement may be computed)
outcome comparison eligible?    (execution dimensions may be counted)
```

Scorer failures are therefore measurable experiment data, not rows that silently
disappear: a selector with good judgements that frequently cannot finish a
20-25 candidate scope is still unsuitable for T4.

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
| 2026-09-28 | Clarification: selection comparison requires a complete alternative ordering with `candidateSetPreserved: true`. The actual model choice remains a trace fact but is not comparison-eligible when the Jev replay is incomplete. Threshold impact: none. Label policy impact: none. | Pilot `8a0de18b` showed a scorer timeout/fetch failure can leave `ranking=[]`; in that state agreement cannot be computed | none — the clarification matches how the derivation already behaved; `8a0de18b` stays excluded from selector comparison and its drift becomes diagnostic metadata |

## Appendix — T3-d collection plan

**Planned size: 40–50 eligible scopes.** The formal checkpoint stays 30 eligible
scopes / 10 labelled disagreements; the pilot's disagreement density (1 in 4
eligible) suggests 30 may not be enough to reach 10 labels, so collect past the
checkpoint rather than stopping exactly on it.

| Workload family | Target scopes | What it exercises |
|---|---:|---|
| Read/search | 8 | file read, grep, glob, directory search |
| Verification | 8 | tests, claim verification, shell verification |
| Mutation | 8 | create/patch/delete + read-back verification |
| Coordination | 8 | multi-agent planning/execution, requirement candidates |
| MCP/external | 8 | sanitized MCP candidates, external-tool availability |

**Multi-iteration:** at least 12–15 of the 40 must be multi-iteration, spread
across the families rather than collected as a separate artificial category.

**Run controls — locked before collection.** Any change means a new cohort, not
a silent mix:

```text
same ALiX revision
same tool-selection/v1 projector
same Jev model and config
same candidate-freeze schema
fresh scopeIds
no reuse of failed scorer results
```

**Report footer (facts, no verdict):**

```text
attemptedScopes                     scopes the run started
status.traceComplete                model choice observed
status.candidateSetPreserved        alternative ordering complete
status.selectionComparisonEligible  usable for agreement/disagreement
status.outcomeComparisonEligible    usable for execution dimensions
eligibility.byReason                exclusions, by chosen code
eligibility.diagnostics             secondary codes that also fired
preservation.rate                   candidate_set_preservation_rate
jevCompletion.fullScopeSuccessRate  jev_full_scope_success_rate
jevCompletion.candidateFailureRate  jev_candidate_failure_rate
agreement.rate                      agreement_rate
labelledDisagreements.labelled      labelled_disagreements
labelledDisagreements.unlabelled    unlabelled_disagreements
scoring.medianScopeLatencyMs        median_scope_latency
scoring.p95ScopeLatencyMs           p95_scope_latency
```
