# T3 Checkpoint Report — cohort `t3d-2026-09-28-c`

The preregistered checkpoint is **met**: 32 eligible scopes (≥30) and 14 labelled
disagreements (≥10). This report records what the cohort measured. It makes no
promotion recommendation — T4 is a separate decision with its own gate.

## 1. What was measured

| Input | Value |
|---|---|
| Frozen corpus | `docs/jev/cohorts/t3d-2026-09-28-c.corpus.json`, sha256 `169e5cf79bfaa639423612aea6e56e61bd1b4bcf0e6411832da2bd8f54671bae` |
| Labels | `docs/jev/cohorts/t3d-2026-09-28-c.labels.jsonl` (14 records, committed before reveal) |
| Canonical revision | `8d30294a` (runtime drift since pin: none) |
| Projector / model | `tool-selection/v1`, `jev-latest` |

All labels were produced blind: the operator saw only the objective and the two
candidate descriptions as A/B, and every record was appended before the tool
printed the reveal. No Jev re-score, corpus regeneration, or candidate reorder
occurred during labelling. The frozen JSON is the artifact — re-scoring the same
scopes has already produced different numbers (19/32 vs 18/32 agreement).

## 2. Label outcomes (the preregistered categories)

| Category | Count |
|---|---:|
| both appropriate | 0 |
| **actual (model) only appropriate** | 4 |
| **Jev top only appropriate** | 5 |
| neither appropriate | 5 |
| unclear | 0 |
| unlabelled / unmatched | 0 / 0 |

Reading: across the 14 frozen disagreements, the model's choice was the
independently-judged appropriate action 4 times, Jev's top candidate 5 times, and
in 5 cases neither candidate could accomplish the objective. The split is
balanced; nothing in this cohort separates the two selectors on selection
quality.

The five `neither appropriate` cases cluster where the frozen surface lacked the
tool the objective required — the read-only offer set has no `shell.run`
(verification "run X" tasks) and, in three coordination scopes, no
`coordination_run` in the compared pair. That is a property of the offer surface,
recorded here, not a selector verdict.

## 3. Jev completion and reliability

```text
scopes attempted            32        candidate calls          577
full-scope success          32 (1.0)  candidate failures       0
candidate failure rate      0.0       scorer failures          0
trace-complete              32/32     candidate sets preserved 32/32
```

Jev completed every scope it was asked to score in this cohort, including the
five scopes with 23–26 candidates. This supersedes the pilot's single failed
attempt (`8a0de18b`, a timeout plus an MCP fetch failure) — which was transient,
not systematic, as the closeout records.

## 4. Latency and economics

```text
median scope latency        1666 ms        p95 scope latency      3385 ms
median candidate latency     100 ms        p95 candidate latency   228 ms
total scorer time          68149 ms        calls                    577
```

Ranking one scope costs roughly 1.7 s at the median and 3.4 s at p95. Quality
aside, that is the operational number T4 would have to justify: a live selector
that adds seconds to every tool decision needs a demonstrated quality gain, and
this cohort does not show one.

## 5. Coverage limitation — read this before citing any T3 result

The cohort met its quantitative checkpoint with 32 eligible scopes, but the
**MCP/external family contributed zero selection scopes** (F4): eight tasks were
run, none produced a `tool.selection.observed` event. Therefore:

```text
T3 results apply to:   read/search, verification, mutation, coordination
T3 results do NOT establish: tool-selection quality for external/MCP selection
```

This is a coverage limitation, not a reason to discard the 32-scope cohort.

## 6. Findings carried out of collection

All nine were recorded during collection and deliberately **not** fixed inside
the cohort, to avoid moving the measured revision:

1. Verification requirement detection is silent (0/8 verification scopes) while
   mutation (7/8) and coordination (7/8) fire.
2. `verify.claim` and `shell.run` are absent from the read-only offer surface, so
   two verification tasks were answered by reading rather than executing.
3. Coordination completion is not verification: 7 runs closed `status: completed`,
   but **4 of 7 carry `outcome: null`** with no aggregate. `coordination.run`
   success ≠ aggregate outcome present ≠ session verified.
4. The MCP/external family produced zero scopes by two mechanisms — the
   `alix_mcp_search_tools` short-circuit before `handleToolResult`
   (`src/run/task-loop/main.ts:1341`) and single-tool external turns that never
   enter the loop.
5. Jev re-scoring is not idempotent (19/32 → 18/32 agreement across rebuilds).
6. No-op mutation is unobservable (`changed` never recorded; no `file.updated`
   events).
7. Pattern/iteration accounting differs across emitters (`pattern_evaluated` 2 vs
   `contextPressure.totalIterations` 5; `agent.decision` iterations 0, 1, 3).
8. The deterministic scoper is not task-conditioned (ranked `create_hook` 9 above
   `file_read` 6 for a read-and-summarize prompt; scored connectives as symbols).
   Diagnostic context only, never a T3 quality statistic.
9. `done` is approval-gated interactively but auto-allowed headless
   (`policy-gate.ts:493`), costing one out-of-cohort session a 300 s idle wait.

Containment escapes (coordination workers writing outside their namespace) are
recorded with hashes in the cohort closeout; the two root-level artifacts were
removed after their hashes were committed.

## 7. Not done here

- **Gap-closure labels (`gapClosure`)** remain empty. Gap closure is a separate
  offline outcome label and was not inferred from appropriateness.
- **T4 promotion is not discussed.** Any T4 conversation must start from this
  report and carry: label outcomes (§2), Jev completion/reliability (§3),
  latency/economics (§4), the represented-family limitation (§5), and all nine
  findings (§6). A balanced 4/5/5 label split and a 1.7 s median ranking cost do
  not by themselves argue for putting tool selection on the runtime path.
