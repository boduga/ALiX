# Behavioral / Agentic Evals Gap — Checkpoint Finding

**Date:** 2026-08-29
**Purpose:** Formally record the confirmed gap that **ALiX has no behavioral/agentic eval suite.** Captures the audit trail and the two candidate directions for closing it. No source files modified.

Source: GitHub issue [#571](https://github.com/boduga/ALiX/issues/571) (`needs-human`, `type:feature`).

---

## 1. Executive summary

- **No task-performance suite exists** that scores "did ALiX do the right thing." There is no behavior/quality eval signal.
- The A-series governing loop (A0–A9) is architecturally complete, but its measurement-feedback leg ("did it actually get better?") is **unmeasured**.
- Benchmark suite is **latency-only**; the single eval doc is a stalled one-time routing spike.
- Recommended first step (this checkpoint): the gap is now officially documented. A scoped first behavioral eval suite is left as the unchosen follow-up.

---

## 2. Verified state (re-checked 2026-08-29 against live source)

- `src/benchmark/` measures **latency only** — `cases/{cli-startup,context-compile,daemon-submit,models-doctor,no-tool-task,runtime-index}.ts` (ms / p95). No behavior/quality scoring.
- `docs/evals/model_routing_eval.md` (June) is the **only** eval doc — a one-time routing-accuracy spike, stalled on CPU-only hardware (~90 min needed for 45 inferences), never completed.
- A2 `counterfactual-evaluator` at `src/evolution/verification/evaluation/counterfactual-evaluator.ts` is a **governance input** (baseline-vs-candidate projection), not an agent-quality eval.
- A5 measurement lives at `src/evolution/observation/` (ADR-0014 domain rename) — measures capability outcomes, not agent behavior.
- The self-evolution loop has **no independent signal** for whether agent behavior is correct.

## 3. Impact

- The governing loop can *detect* underperformance (A5, A8 detectors, A9 risk forecast) but cannot *judge* whether agent behavior itself is correct.
- No regression safety net for behavior: delegate-runtime / status-honesty changes (Matrix-G, #565–#570) are verified by unit tests only — nothing scores end-to-end task outcomes.
- "Next numbered architectural item" is genuinely uncharted; the evals gap is the strongest candidate.

## 4. Candidate directions (unchosen — requires human decision, per `needs-human` label)

1. **Document the gap** — _DONE via this checkpoint_ (cheap audit-trail capture).
2. **Scope a first behavioral eval suite** — natural extension of Matrix-G / status-honesty work: N delegated-task cases scored on **objective-landing** (did the worker's objective actually land: file written, patch applied, status honest). Produces the first real "did it work?" signal. **Out of scope for this checkpoint; open to pursuing separately.**

## 5. References

- Issue: [#571](https://github.com/boduga/ALiX/issues/571)
- `docs/roadmap/a-series-autonomous-evolution.md`, `docs/architecture/ALiX_MASTER_ROADMAP.md` (A0–A9 marked complete, commit `e953a111`, tags `alix-a8-*` / `alix-a9-*`)
- Aspirational "Self-Directed Engineering" remains unbuilt — not A9's shipped focus.
