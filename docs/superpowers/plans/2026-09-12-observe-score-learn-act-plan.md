# Observe → Score → Learn → Act — Buildable Plan

**Date:** 2026-09-12
**Status:** Spec ready, unstarted
**Base:** `main` post-#660 (narrow skill, tiered hook, bounds, nightly digest all shipped)
**Goal:** every agent run makes the next one cheaper and better — the skill
lifecycle (`observe → score → promote/evict`) generalized to runs, prompts, models.

## Live-grounded constraints (do not redesign around)

1. **v2 rows carry no `usage`, no I/O payloads** (proven live 2026-09-11).
   Cost/latency governance MUST aggregate ALiX-side, never from Langfuse rows.
2. **Trace names come from root spans; `traceId` filter + time windows work.**
   Score writeback keys on `traceId`; session grouping keys on `sessionId`.
3. **`pollution.ts` is NOT on `main`** (TUI-branch work). Any phase needing
   collision/duplicate-body gates either waits for it or re-specifies gates.
4. **Scores/datasets write APIs on the v4 `events_only` gateway are UNVERIFIED.**
   Every write phase starts with a curl probe; on 404/4xx the phase falls back
   to a local JSONL corpus under `~/.alix/` with identical shape.
5. **Write creds never enter the loop.** Score/dataset/promotion writers run in
   the nightly context (digest pattern) with write creds; hot loop stays read-only.

## Reuse vs new

| Need | Reuse | New |
|------|-------|-----|
| Run identity | `runId`/`sessionId`/`workflowId` (authoritative) | nothing |
| Capture | `src/tracing/` spans + capture policy | nothing |
| Cost numbers | metrics JSONL contract (stable per `metrics-store.ts`: newest-first, corrupt lines skipped) — not TS imports, because hook/cron scripts run without a repo build | per-model rollup + digest section |
| Quality signals | `successCount` (promotion.ts), task completion | score writer; `--session-id` stamps the join key into the record comment (agent-side signals carry no trace keys) |
| Skill mining input | `runSkillFactory` (factory.ts), `dispatcher.ts` | trace-evidence adapter (tool sequences + per-trace scores; prompt text unavailable from gateway rows) — candidate bar ≥5 runs, all ≥0.8, enforced factory-side |
| Promotion gates | `promoteIfEligible` shape (success-gated, versioned) | prompt-variant application of the shape |
| Pollution gates | — (absent on main, see constraint 3) | exact-duplicate rejection until it lands |
| Regression corpus | digest.mjs pattern (nightly, aggregate, fail-open) | dataset writer + local JSONL mirror (`~/.alix/corpus/`) — the mirror is the eval-readable record because no dataset-list read path exists on `events_only` gateways; incident `task` is root-span heuristic, labelled `taskSource` |
| Eval gate | nightly digest cadence | eval runner + block/promote verdict (verdicts exactly promote\|block\|insufficient — below-bar deltas block); CLI `alix evals run-dataset` with shared arg parser; Act = gate verdict + promotion command hint (prompt.mjs carries the write; CLI never writes prompts) |

Accepted bounds (not scope creep — point-4 bounds discipline): `--limit`
caps per script, `mine.mjs` 50-obs/trace cap, `corpus.mjs` 2000-row cap,
`suggestedName` + `source:"alix-probe"` as downstream join keys,
`prompt.mjs` arbitrary `--label` (labels observed on the object; champion
is convention, not enforcement). Model-running eval loop deferred (needs
provider wiring).

## Phase 0 — Gateway write probes (gate for all write phases)

Probe, in order: scores write, dataset create/append, prompt object write.
Record endpoint + auth result per probe in this file's appendix.
- Pass → phases use the API.
- Fail → phases use local JSONL (`~/.alix/scores.jsonl`, `~/.alix/datasets/`).
- No code until probes complete. No phase may assume writes work.

## Phase 1 — Cost governance (ALiX-side rollup)

Roll up `cost-attribution` + `metrics-store` per (agent, task-class):
- Budget alert threshold (tunable default): single run > 3× trailing median
  for its task-class → digest warning.
- Routing evidence threshold: ≥ 20 runs per (agent, task-class) before a
  cheap-vs-strong recommendation is emitted.
- Output lands in `digest.mjs` (one section), never per-turn.
- Reuse only; new code = rollup query + digest section.

## Phase 2 — Quality ledger (score writeback)

Write one quality record per run, keyed by `traceId`:
- Inputs: user thumbs/ratings (when present), LLM-judge evals (Phase 4 feeds
  back here), `successCount` increments, task completion status.
- Single ledger (API scores object or `~/.alix/scores.jsonl`), replacing the
  three scattered signals.
- Threshold: a run is "high-score" at quality ≥ 0.8 (tunable).

## Phase 3 — Learn: trace-fed factory + regression corpus

- **Mine:** `runSkillFactory` gains a trace-evidence adapter: real prompts,
  real tool sequences (from observations), real outcomes — instead of
  session-summary prose. Candidate threshold: ≥ 5 high-score runs sharing a
  tool-sequence shape.
- **Corpus:** failures + edge cases append to datasets (or JSONL fallback),
  one entry per incident with traceId backlink. Growth is production-fed,
  not hand-written fixtures.
- **Gates:** promotion reuses the `promoteIfEligible` shape
  (usage-gated install, versioning on same-name change). Pollution-grade
  dedup waits on constraint 3; until then, exact-duplicate rejection only.

## Phase 4 — Act: prompt versioning + eval-gated CI

- Candidate prompts A/B against the corpus; winner promotes on win-rate
  delta ≥ +10pp over ≥ 20 eval runs (tunables).
- Nightly eval run over the dataset (digest cadence); regressions block,
  improvements auto-promote.
- Prompt objects versioned like skills (same-name change → new version,
  never silent overwrite).

## Phase 5 — Govern (continuous, not last)

- Retention windows on trace I/O reads (windowed queries only — already the
  query.mjs contract); redaction audit on digest/score outputs
  (aggregates only, error strings ≤ 300 chars — already the digest.mjs contract).
- Cred split enforced: loop paths hold read-only; writers (scores, datasets,
  promotions) run nightly-gated with write creds.
- Review trigger: any phase introducing a new credential surface stops for
  explicit approval.

## Build order

```
P0 probes (no code)
 ↓ pass → API path / fail → JSONL path (shape-identical)
P1 cost rollup + digest section
 ↓
P2 score writer + ledger
 ↓
P3 factory adapter + corpus writer
 ↓
P4 prompt versioning + eval runner + CI gate
P5 govern audit (each phase checks its own row before landing)
```

Each phase: spec delta → implement → focused tests → digest-surface proof →
commit. No phase edits hot-loop capture; the loop stays read-only throughout.

## Appendix — probe log

| Date | Endpoint | Result |
|------|----------|--------|
| 2026-09-12 | scores write (`POST /api/public/scores`, `{traceId,name,value}`) | PASS — id returned |
| 2026-09-12 | dataset create (`POST /api/public/datasets`, `{name,description}`) | PASS — full object returned |
| 2026-09-12 | prompt create (`POST /api/public/prompts`, chat variant) | PASS — requires `{type:"chat", prompt:[{role,content}], isActive:false, labels}`; text variant and missing `isActive` 400 |
| 2026-09-12 | dataset item append (`POST /api/public/dataset-items`) | PASS after fix — key is `datasetName` (name, not id); first attempt with `datasetId` 400 |
| 2026-09-12 | prompt re-create same name | PASS — returned `version: 2`; versioning proven, not assumed |

P0 gate: PASS on all three. Loop phases take the API path; JSONL fallback
dropped (kept only as contingency). Probe artifacts namespaced
`alix-probe-*`, safe to delete from the gateway UI.
