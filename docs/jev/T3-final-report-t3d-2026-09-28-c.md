# T3 Final Report — cohort `t3d-2026-09-28-c`

Supersedes `T3-checkpoint-report-t3d-2026-09-28-c.md` by adding the outcome-level
gap-closure labels. Both label sets are complete; the preregistered checkpoint is
met (32 eligible scopes ≥ 30, 14 labelled disagreements ≥ 10).

**Call: Jev tool selection stays experiment-only.** The evidence supports
continuing measurement, not promotion. Jev has proven the experiment machinery
works; it has not shown that adding ranking to the runtime path is worth its cost.

## Frozen inputs

```text
corpus   docs/jev/cohorts/t3d-2026-09-28-c.corpus.json
         sha256 169e5cf79bfaa639423612aea6e56e61bd1b4bcf0e6411832da2bd8f54671bae
labels   docs/jev/cohorts/t3d-2026-09-28-c.labels.jsonl
         14 disagreement records + 32 gap-closure records
revision 8d30294a (canonical; runtime drift since pin: none)
model    jev-latest · projector tool-selection/v1
```

Both label sets were produced against the frozen corpus. No Jev re-score, corpus
regeneration, or candidate reorder happened during labelling — re-scoring is not
idempotent (19/32 vs 18/32 agreement across two builds).

## 1. Selection-time appropriateness (blind, 14 disagreements)

| Category | Count |
|---|---:|
| both appropriate | 0 |
| actual (model) only appropriate | 4 |
| Jev top only appropriate | 5 |
| neither appropriate | 5 |
| unclear | 0 |

The split is balanced. Five of the fourteen were not clean selector contests at
all: neither candidate could accomplish the objective because the frozen offer
surface lacked the required tool (no `shell.run` under read-only for "run X"
verification tasks; no `coordination_run` in three compared pairs).

## 2. Outcome-level gap closure (offline, all 32 scopes)

Judged from the observed outcome only — objective, executed action, execution
status, evidence contribution, produced artifacts, session terminal. Selector
identity and the appropriateness labels were not used.

| Label | Count |
|---|---:|
| closed | 18 |
| not_closed | 14 |
| unknown | 0 |

By represented family:

| Family | closed | not_closed |
|---|---:|---:|
| read/search | 3 | 5 |
| verification | 2 | 6 |
| mutation | 6 | 2 |
| coordination | 7 | 1 |

The families that had the tools they needed closed their gaps (mutation 6/8,
coordination 7/8); the families whose surface lacked the required tool did not
(verification 2/8, read/search 3/8). Four of the fourteen `not_closed` scopes
ended `max_iterations` and three ended with a progress-only or
`[no output]` summary despite `execution: success`.

Note this is outcome quality, not selector quality: a `not_closed` scope can
still contain an appropriate selection, and vice versa.

## 3. Jev completion and reliability

```text
scopes attempted            32        candidate calls          577
full-scope success          32 (1.0)  candidate failures       0
scorer failures             0         candidate sets preserved 32/32
trace-complete              32/32     selection eligible       32/32
```

Jev completed every scope, including five with 23–26 candidates. The pilot's one
failed scope (`8a0de18b`) was transient, not systematic.

## 4. Latency and economics

```text
median scope latency 1666 ms     p95 scope latency 3385 ms
median candidate      100 ms     p95 candidate      228 ms
total scorer time  68149 ms      calls 577
```

Ranking one scope costs ~1.7 s median / 3.4 s p95. A live selector would add that
to every tool decision. With a balanced 4/5/5 label split and weakly favourable
gap-closure evidence, that cost is not justified today.

## 5. Coverage limitation

The MCP/external family contributed **zero** selection scopes (F4: eight tasks,
no `tool.selection.observed`). Results therefore apply to:

```text
read/search · verification · mutation · coordination
```

and say nothing about tool-selection quality for external/MCP selection. This is
a coverage gap, not grounds to discard the 32-scope cohort.

## 6. Findings carried out of T3

1. Verification requirement detection is silent (0/8) while mutation (7/8) and
   coordination (7/8) fire.
2. `verify.claim` and `shell.run` are absent from the read-only offer surface.
3. Coordination completion is overloaded: 7 runs closed `status: completed`, but
   **4 of 7 carry `outcome: null`** with no aggregate. Run success ≠ aggregate
   present ≠ session verified.
4. The MCP/external family produced zero scopes (two mechanisms: the
   `mcp_search_tools` short-circuit, and single-tool external turns outside the
   loop).
5. Jev re-scoring is not idempotent.
6. No-op mutation (`changed=false`) is unobservable.
7. Iteration accounting differs across emitters.
8. The deterministic scoper is not task-conditioned (diagnostic only).
9. `done` is approval-gated interactively but auto-allowed headless.

## 7. Ordered next work

```text
1. T3-c gap closure                     DONE (this report)
2. Coordination completion semantics    next — highest correctness risk
3. F4 external-selection observability  then — new external-focused cohort
4. Verification detection + read-only surface gaps
5. Work queue (non-blocking): changed=false observability, iteration
   accounting, task-conditioned scoper, done-approval asymmetry
```

Only after step 3's cohort is collected and analysed is a T4 experiment worth
reconsidering. Nothing in this report authorises a runtime route, a
`DecisionType`, or a shadow→active change for tool selection.
