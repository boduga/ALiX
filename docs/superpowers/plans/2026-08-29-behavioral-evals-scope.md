# Behavioral / Agentic Eval Suite — Scoping Plan

**Date:** 2026-08-29
**Status:** SCOPING (for review) — not yet approved for implementation.
**Issue:** [#571](https://github.com/boduga/ALiX/issues/571), direction 2.
**Purpose:** Define the design and decision points for a first behavioral eval suite that scores "did ALiX do the right thing" — the unmeasured feedback leg of the A-series governing loop. Grounded in verified code; the checkpoint `2026-08-29-behavioral-evals-gap.md` recorded the gap.

---

## 1. Goal

A repeatable harness that runs **N delegated task cases** and scores each on **objective-landing**:
- did the worker's objective actually land (file written with expected content / patch applied / replacement verified), and
- was the reported **status honest** (the Matrix-G invariant).

Producing the first independent "did it work?" signal, and a regression safety net for delegate-runtime behavior changes (Matrix-G, #565–#570).

## 2. Verified building blocks (from live source)

| Need | Existing anchor | Notes |
|------|-----------------|-------|
| In-process headless run | `runTask(cwd, task, opts)` → `RunResult` — `src/run.ts` re-export of `src/agent/agent-loop.ts:473` | No daemon; `RunResult { sessionId, summary, reason, runId? }`; `reason` incl. `completed \| completed_unverified \| max_repairs \| ...` |
| Temp-cwd fixture | `src/benchmark/cases/no-tool-task.ts` | `tmpdir()/bench-task-<uuid>` + `.alix/config.json` w/ `provider:"mock"`, `permissions.default:"allow"`, then `runTask`, `rmSync`. Exact template. |
| Delegate runtime (Matrix-G) | `src/agents/subagent-cli.ts` | `computeSubagentStatus` (line 191), `isObjectiveComplete` (184), `buildResult` (227). Status matrix: write-worker unmet objective + no attempts → `failed` (never `success`) — #570. |
| Subprocess delegate | `SubagentManager.spawn` (`subagent-manager.ts:42`) | Fork + `SubagentResult { id, role, status, findings, events, error? }`; status `success\|failed\|partial\|rejected`. |
| Outcome on disk | `<cwd>/.alix/sessions/<id>/events.jsonl`, `session.ended.reason`; `<cwd>/.alix/governance/` evidence `outcome`/`verificationPassed` | Read via `src/inspector/session-reader.ts` `readSessionEvents`. |
| Mutation ledger | `MutationSessionState { created, deleted, changed, fatalErrors }` — `src/run/helpers.ts`, built in `agent-loop.ts:277` | Plus direct filesystem assert (most robust for objective-landing). |
| Latency benchmark harness | `src/benchmark/**` | `BenchmarkSuite = "quick"\|"runtime"\|"daemon"`; `BenchmarkResult` is **latency-only** — NOT reusable for pass/fail scoring. |

**Key missing piece:** the stock `MockProvider` (`src/providers/mock-provider.ts`) emits **no tool calls**. Deterministic write/patch/objective-landing evals need either (a) a real configured provider, or (b) a **scriptable mock provider** (a `ModelAdapter` that emits defined `file.create` / `patch.apply` / `file.delete` tool calls per scenario).

## 3. Recommended shape

Keep the harness **sibling to**, not inside, the latency benchmark runner (its `BenchmarkResult` schema is incompatible).

```
src/evals/
  evals-types.ts      // EvalCase, EvalResult { case, status, honest, evidence }, EvalRun, EvalSuite
  evals-runner.ts     // run evals, aggregate pass/fail + honesty, save .alix/evals/<runId>.json
  cases/              // one file per scenario
    ...
  providers/
    scripted-mock-provider.ts   // ModelAdapter emitting scripted tool calls
cli wiring: alix evals run  → src/cli/commands/evals.ts (mirrors benchmark.ts)
```

**Scoring model (per case):**
- **Objective:** `cwd`-scoped expectation, e.g. `{ contains: "report.md", contentIncludes: ["# Q3", "revenue: 42"] }` or `{ changed: "src/util.ts", to: "<replacement>" }`.
- **Landed:** assert filesystem reality (file exists / content matches / patch applied) — **not** the model's narrative.
- **Honest:** assert `SubagentResult.status` / `RunResult.reason` against expected per case (write-worker unmet objective → must be `failed`/`completed_unverified`, never `success`).
- **Verdict:** `pass` = objective landed **and** report was honest; otherwise `fail` with evidence diff.

**Two independent drivers (choose one, or tier both):**
1. **Main-loop evals** via `runTask` (deterministic, mirrors `no-tool-task`) — scores the full agent loop + status honesty (`completed` vs `completed_unverified`).
2. **Delegate evals** via `SubagentManager.spawn` — scores the actual Matrix-G runtime end-to-end: `SubagentResult.status` vs filesystem reality per owned path.

**Cases (suggested first slice):** write-a-file-then-report, apply-a-patch, replace-a-block, read-only-reports-success, unmet-write-objective-zero-attempts-reports-failed (#570), forbidden-path-write-reports-failed, partial-objective-reports-partial.

## 4. Decision points (need human sign-off)

1. **Driver(s):** main-loop (`runTask`), delegate (`SubagentManager`), or both? (Recommend both, tiered.)
2. **Live model vs scripted mock:** scripted mock (deterministic, CI-safe, no cost) vs configured live provider (real behavior, cost+flake). (Recommend scripted mock for the first slice; it requires the new `scripted-mock-provider`.)
3. **CI gating:** hard gate on `pnpm test` (like sentinels) vs opt-in `alix evals run` only. (Recommend opt-in CLI first; promote to gate once stable.)
4. **Storage:** `.alix/evals/<runId>.json` mirroring benchmark storage; `compare` subcommand can come later.

## 5. Out of scope (this slice)

- Latency benchmarking (already covered).
- Formal eval *program* / continuous measurement dashboard (future, per #571 scope note).
- The A2 counterfactual-evaluator is a governance input, not a quality eval — no changes to it.
- "Self-Directed Engineering" (aspirational, not A9's shipped focus).

## 6. References

- Issue: [#571](https://github.com/boduga/ALiX/issues/571)
- Checkpoint: `docs/architecture/checkpoints/2026-08-29-behavioral-evals-gap.md` (gap + direction 1).
- Roadmaps: `docs/roadmap/a-series-autonomous-evolution.md`, `docs/architecture/ALiX_MASTER_ROADMAP.md`.
- Delegate runtime hardening plans: `docs/superpowers/plans/2026-08-17-delegate-runtime-hardening.md`, `docs/superpowers/plans/2026-08-17-partial-status.md`.
- Matrix-G commits: `f3da76a7` (#567), `86947ed2` (#570).
