# Pre-2.0 harness audit — Codex handoff

Updated: 2026-10-22
Baseline: `main` @ **`bf29449b`**, **85 commits ahead of `origin/main`** (nothing pushed; Q13 publication HOLD stands)
Tag: `pre-2.0-consolidated` (local only)

**Current state: 9/10 strata have a verified run AND a catalog-priced cost per
verified success.** Only stratum 9 is unmeasured — local CPU inference is
non-billable, so its cost stays `null`, and a measured 10/10 is unreachable as
stated.

What closed the gap since the 2026-10-21 state recorded below:

- **Strata 1/2** were re-measured with a strengthened `unchanged` oracle
  (`$0.045990`, `$0.044678`; two verified successes). The old oracle compared
  existence only, so it could "verify" a file the agent had rewritten.
- **Strata 4/7** gained positive deliverable cases a real model can pass
  (`$0.063220`, `$0.081847`).
- **Stratum 8** was blocked by a real authorization bug, not by a flaky reviewer:
  `PolicyGate` returned the tool-permission allow before the owned-path rule, so
  a worker scoped to one file could write anywhere. Fixed in `bf29449b`; the
  re-run completes 3/3 workers after a kill on a persisted running worker
  (`$0.211623`).

Real runs used an explicit `openai/gpt-4o` one-off: the operator's current
default model (`intern/deepseek-v4-flash-0731`) refuses every full agent request
with `API error 429: quota exceeded`. No default was changed, no offline mock was
substituted, and nothing was pushed.

See `docs/2026-10-21-harness-positive-baselines.md` for the qualification rules
and `docs/harness-objective-review-sibling-evidence.md` for the diagnosis that
led to the owned-scope fix.

## Mission

The pre-2.0 harness audit is **substantially complete as an audit**, and **Gate B
is still HOLD**. This document exists so the next session can close the one open
bug and finish coverage without re-deriving a long session's findings — several of
which cost real money and several of which are corrections of my own earlier
mistakes.

**Read §2 and §3 before touching anything.** §2 lists four defects I introduced
and fixed; §3 lists claims I made that were wrong and are now corrected. Both are
in the tree; neither should be re-litigated from scratch.

## 1. Gate B status

**HOLD (operator decision). Measured cost-per-verified-success 9/10 strata.**

The caveat that used to sit here is gone: every stratum with a cost now carries
an explicit positive `verifiedSuccesses` count, so the generator's number and
the defensible number are the same.

| # | Stratum | Cost | Notes |
|---|---|---|---|
| 1 | Read-only | $0.045990 | strengthened oracle, 1 verified success |
| 2 | Navigation | $0.044678 | strengthened oracle, 1 verified success |
| 3 | Single-file edit | $0.108968 | F1-E `run-79feb4e0` |
| 4 | Multi-file | $0.063220 | positive case, 1 verified success |
| 5 | Verification/repair | $0.112278 | — |
| 6 | Coordination (3 workers) | $0.194740 | — |
| 7 | Capability mix | $0.081847 | positive case, 1 verified success |
| 8 | Crash/restart | $0.211623 | 3/3 workers completed after the kill/resume |
| 9 | Local CPU-only | `null` | non-billable by definition; never zero |
| 10 | Tool failure | $0.041967 | — |

Reproduce: `node benchmark/evidence/gate7/baseline-coverage-matrix.mjs` (no args).

**10/10 is not reachable as stated.** Stratum 9 is non-billable forever.

## 2. The open bug — CLOSED (the root cause was not the review)

### 2.1 Objective review sees a sibling worker's evidence

`docs/harness-objective-review-sibling-evidence.md` has the full record.

**Root cause: the owned-scope rule was unreachable, so one worker wrote every
sibling's file.** `PolicyGate.evaluateToolCall` returned the tool-permission
allow at step 5; the owned-path rule only ran at step 5.5. The write
capability's permission resolves to "allow" under auto/bypass session modes —
the default for a coordination run — so the rule never ran. A worker scoped to
`docs/a.md` created `docs/a.md`, `docs/b.md` AND `docs/c.md` with 26 tool calls
and zero denials. Its siblings then found their deliverables already present,
produced no mutation evidence in their own attempt, and were rejected for work
they never owned.

Fixed in `bf29449b`: an allowed capability falls through to the owned-path rule
when the request declares owned paths for a write tool (an explicit capability
deny still wins), and `FileToolRouter.file.create` applies the same backstop to
NEW files — previously only overwrites consulted the scope. The gate decides;
the router is the second net.

The four review variants in the original table are superseded by that
diagnosis. The evidence-isolation work was correct and is still in the tree.
One contract gap remains open and is **not** fixed: the review's mutation
evidence is scoped to the CURRENT attempt, so a retry whose deliverable already
exists from an earlier attempt still has no persisted-output evidence. Root
AGENTS.md ("Durable progress survives failed retries") is not yet honoured there.

Re-run result: `benchmark/evidence/coordination/stratum8-gpt4o.json` — killed on
a persisted running worker, resume recovered one orphan, final run `completed` /
`success` with all three workers completed and each artifact holding exactly its
marker. Cost `$0.211623` (`benchmark/evidence/cost/stratum8-restart.json`).

## 3. Corrections — do not re-derive, do not repeat

I got these wrong mid-session and corrected them. Repeating them wastes money.

1. **"Subagents skip independent review" — WRONG, twice.** I rated it High, then
   found `subagent-cli.ts:704` calls `reviewCoordinationResult` whenever
   `coordinationRunId` is set — which every coordination worker has. Severity
   High → Low. The reachable gap is plain delegate only. Both errors came from
   reading one call site and generalising to the path.
2. **"No local provider available" — WRONG.** Ollama was installed and serving
   the whole time; I never checked. Stratum 9 closed on `run-a0b682d5`.
3. **"C-03 CLOSED" — overstated.** Only the matrix + 7 `summary.json` were
   promoted; the scenario **drivers** never were. Now marked PARTIALLY CLOSED.
4. **Hardcoded `openai`/`gpt-4o` in the metered runners** violated an AGENTS.md
   rule the same diff added. Both now resolve `models.default`.

## 4. What shipped and is verified

Real defects fixed, each with a regression test:

- **Subagent token usage was never recorded.** `subagent-cli.ts` consumed only
  `resp.text`/`resp.toolCalls`; no `model.usage` event existed. Silent cost
  undercount for all delegated work. Now emits via
  `buildModelUsageEventPayload`, `runId` omitted rather than guessed.
- **Provider cache key** omitted `timeoutMs`/`streamIdleTimeoutMs`/
  `localModelPath`, making a configured timeout unenforceable.
- **Metered eval usage was deleted** before correlation — `runEvalCase` removed
  the case cwd holding the only usage record. `eval-usage.ts` now captures first.
- **`recomputeRunStatus`**: a `pending` worker was not counted as outstanding, so
  a failed worker plus an undispatched one produced terminal `failed`, abandoning
  work.
- **Reconciliation** marked dead-owner workers `failed` (terminal) instead of
  resetting to `pending` + attempt, contradicting the AGENTS contract.
- **Objective review judged the rendered prompt** (root goal across all workers)
  instead of `worker.goalPrompt`.
- **`satisfied: true` + non-empty gaps** passed validation then hard-rejected
  with no retry; now retryable.
- **`subagent-cli` wrote its structured failed result to stderr**, which the
  parent never parses — every clean failure surfaced as a bare crash.
- **Streaming never sent `stream_options.include_usage`** — the root cause of all
  missing cost data. And o-series rejects `max_tokens` (model-aware rename).

## 5. Verification commands

```bash
pnpm build                # tsc, must be clean
pnpm typecheck:unused     # must be zero
pnpm test                 # 7471 pass / 7 skip / 689 files at time of writing
node benchmark/evidence/gate7/baseline-coverage-matrix.mjs   # 9/10 measured
node scripts/check-dox-claims.mjs                            # docs claims resolve
```

`tests/tui/workbench/coordination-runtime-integration.vitest.ts` and
`tests/kernel/default-worker-review.vitest.ts` are the two suites coupled to
§2.1. Run both after any change there.

## 6. Constraints — do not violate

- **Nothing pushed.** 85 commits are local-only. Q13 publication HOLD is
  operator-controlled; `boduga/ALiX` is public. Pushing is a disclosure decision,
  not a backup decision.
- **No offline mock may stand in for a real billable call** in cost evidence.
- **Unmeasured values stay `null`/unknown, never `0`.** A stratum with cost but
  zero verified successes is *undefined*, not cheap — the matrix enforces this.
- **Real-model harnesses resolve `models.default`**; never hardcode a provider.
  Explicit `--provider/--model` is for a deliberate one-off only.
- **D4-04 is bounded, not fixed** (42 passes, zero reproduction). Do not use a
  delegate case as sole evidence for a comparison baseline.

## 7. Suggested order

1. Ablation work — 9/10 strata now have a verified run and a cost per verified
   success. Gate B and publication stay HOLD by operator decision (Q13).
2. Fix the cross-attempt review evidence gap before a retry needs it: a retry
   whose deliverable already exists must still be able to prove the deliverable.
3. Stratum 9 stays `null` permanently; the local suite evidence gap stays open.

## 8. Documents

| File | Content |
|---|---|
| `docs/harness-objective-review-sibling-evidence.md` | **The closed bug** — reproducer, approval diagnosis, owned-scope root cause |
| `docs/harness-baseline-report.md` | Coverage matrix + Gate B verdict |
| `docs/harness-delegate-cost-gap.md` | Subagent cost history; three corrections of itself |
| `docs/harness-subagent-status-semantics.md` | Ownership-vs-task verdict; two corrections |
| `docs/harness-prd-divergence-finding.md` | Two documents both labelled v1.1 |
| `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` | PRD at v1.2 (filename unchanged; 12+ refs) |
| `benchmark/evidence/` | Recorded evidence + generator, reproduces with no args |

Evidence added since: `benchmark/evidence/cost/stratum8-restart.json`,
`benchmark/evidence/cost/readonly-navigation.json`,
`benchmark/evidence/cost/positive-strata-4-7.json`,
`benchmark/evidence/coordination/stratum8-gpt4o.json`.
