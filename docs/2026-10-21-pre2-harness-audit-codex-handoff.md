# Pre-2.0 harness audit — Codex handoff

Updated: 2026-10-21
Baseline: `main` @ **`cd029a27`**, tree clean, **79 commits ahead of `origin/main`** (nothing pushed; Q13 publication HOLD stands)
Tag: `pre-2.0-consolidated` (local only)

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

**HOLD. Measured cost 6/10 strata.**

> **Caveat on the 6.** The matrix's zero-success guard only fires on an explicit
> `verifiedSuccesses: 0`. Strata **1 and 2** were recorded by the earlier main-loop
> sweep *before* that field existed, so they carry `verifiedSuccesses: null/absent`
> and are counted as measured without a positive assertion. Their underlying runs
> did pass 2/2, but the record does not state it. Tighten
> `benchmark/evidence/cost/eval-mainloop-metered.json` to carry
> `verifiedSuccesses: 1` per stratum if you want the count to be defensible
> without this footnote. 6 is the number the generator prints; **5 is the number
> with an explicitly asserted success.**

| # | Stratum | Cost | Notes |
|---|---|---|---|
| 1 | Read-only | $0.041675 | — |
| 2 | Navigation | $0.044698 | — |
| 3 | Single-file edit | $0.108968 | F1-E `run-79feb4e0` |
| 4 | Multi-file | $0.112300 | **0 verified successes** — needs cases a real model can pass |
| 5 | Verification/repair | $0.112278 | — |
| 6 | Coordination (3 workers) | $0.194740 | — |
| 7 | Capability mix | $0.076410 | **0 verified successes** — 3 cases all expect failure |
| 8 | Crash/restart | $0.228135 | **0 verified successes** — blocked by §2.1 |
| 9 | Local CPU-only | `null` | non-billable by definition; never zero |
| 10 | Tool failure | $0.041967 | — |

Reproduce: `node benchmark/evidence/gate7/baseline-coverage-matrix.mjs` (no args).

**10/10 is not reachable as stated.** Stratum 9 is non-billable forever; strata 4
and 7 need positive-case design, not spend.

## 2. Open bug (the one to fix first)

### 2.1 Objective review sees a sibling worker's evidence

`docs/harness-objective-review-sibling-evidence.md` has the full record. Summary:

Workers in a coordination run **share one session event log**, so
`deriveCoordinationChangedFiles(events)` in
`src/coordination/kernel/default-worker-review.ts` includes every sibling's
`file.created`. A worker owning `docs/b.md` is reviewed with evidence containing
`docs/a.md` and `docs/c.md`, then rejected for *"Missing docs/a.md"* — a file it
never owned. It retries 3× and the run reports `failed` with all artifacts correct
on disk.

**Scoping to owned paths fixes it and breaks a test.** Four variants tried; only
unscoped passes:

| Variant | Result |
|---|---|
| scoped + existence fallback | fail |
| scoped + owned-path fallback | fail |
| scoped + `file.read: allow` on the review executor | fail |
| **unscoped (shipped)** | **pass** |

Failure mode with scoping: the worker's file-**mutation** approval is never created
(`pending=0` after the write), so
`tests/tui/workbench/coordination-runtime-integration.vitest.ts` ("resumes an
approved worker…") times out in `waitForPendingApproval()`.

**Leading hypothesis, UNVERIFIED:** the review's own `file.read` claims the
worker's pending write approval — `approval.consumed` appears exactly once in that
trace. Confirm by instrumenting `ApprovalStore.consumeApproved` and logging which
approval id each caller claims.

**Do not ship a fifth variant by guesswork.** Instrument first. Once fixed,
re-run stratum 8 (`benchmark/evidence/coordination/run-restart-metered.mjs`) to
confirm 3/3 workers **and** the integration test together.

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
node benchmark/evidence/gate7/baseline-coverage-matrix.mjs   # 6/10 measured
node scripts/check-dox-claims.mjs                            # docs claims resolve
```

`tests/tui/workbench/coordination-runtime-integration.vitest.ts` and
`tests/kernel/default-worker-review.vitest.ts` are the two suites coupled to
§2.1. Run both after any change there.

## 6. Constraints — do not violate

- **Nothing pushed.** 77 commits are local-only. Q13 publication HOLD is
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

1. Fix §2.1 via instrumentation, not guesswork. Re-run stratum 8 → 7/10.
2. Design one positive case for strata 4 and 7 (currently all-negative) → 9/10.
3. Stratum 9 stays `null` permanently.
4. Only then: ablation work, which Gate B gates.

## 8. Documents

| File | Content |
|---|---|
| `docs/harness-objective-review-sibling-evidence.md` | **The open bug** — reproducer, variants tried, hypothesis |
| `docs/harness-baseline-report.md` | Coverage matrix + Gate B verdict |
| `docs/harness-delegate-cost-gap.md` | Subagent cost history; three corrections of itself |
| `docs/harness-subagent-status-semantics.md` | Ownership-vs-task verdict; two corrections |
| `docs/harness-prd-divergence-finding.md` | Two documents both labelled v1.1 |
| `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` | PRD at v1.2 (filename unchanged; 12+ refs) |
| `benchmark/evidence/` | Recorded evidence + generator, reproduces with no args |
