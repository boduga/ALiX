# Gate C — retain disposition (HC-01, HC-03)

**Date:** 2026-10-23
**Decision:** **RETAIN.** No candidate is retired. No ablation was run.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §9 (Gate C), §5 PRE-R007/R008
**Companion:** [Ablation report](harness-ablation-report.md), [acceptance matrix](audits/2026-10-23-harness-acceptance-matrix.md)

## 1. What this disposes, and what it does not

Gate C reads: *"demonstrable efficiency gain with no unaccepted correctness
regression; otherwise retain."* Retain is the **default branch**, not a
conclusion drawn from measurement. This document exercises that branch.

It disposes the Gate C *decision* for the two M2 candidates. It does not:

- claim the candidates are worthless — that would be `measured absence of
  benefit`, which requires the very runs that were not performed;
- close PRE-R007/R008 as measured work — they remain unexecuted comparisons;
- claim the harness is efficient;
- authorize any production change.

The distinction is the whole point. "We have no admissible evidence of gain, so
we keep what is protected" is honest. "We measured no gain, so we may delete"
would be a fabrication, and no such claim appears here.

## 2. Disposition

| ID | Candidate | Class | Decision | Basis |
|---|---|---|---|---|
| HC-01 | `src/agents/agent/system-prompt.ts` — "Parallel Execution", "Thorough Context Gathering" | M2 | **RETAIN** | No admissible paired run. Removing prompt guidance on an unmeasured basis trades a real behaviour for an unmeasured saving. |
| HC-03 | `src/execution/patch/edit-format-policy.ts` — provider-based preferred patch format | M2 | **RETAIN** | No admissible paired run, and the format choice is provider-specific behaviour with a structured-output contract behind it. |
| HC-02 | tool-name/format guidance | S1/M1 | **RETAIN** (unchanged) | Not an ablation target; tool-call parity would be its precondition, and it has not been established. |
| HC-05 | `src/context/repomap/context-compiler.ts` | M1 | **RETAIN** (unchanged) | PRE-R008 comparison candidate, not a removal candidate. |

No candidate in this document is deleted, simplified, or flagged for removal.

## 3. Why no ablation was admissible

Unchanged from [ablation report](harness-ablation-report.md) §1: conditions 1, 2,
4, 5 and 6 of the admissibility contract were unmet, the most decisive being that
no Gate B baseline is signed. Thresholds frozen before a baseline invert the
required order.

## 4. What would reopen this disposition

Any one of:

1. A signed Gate B baseline with per-stratum n≥3 and reported uncertainty.
2. An admissible paired design meeting all six contract conditions, with S0
   negatives re-run per arm and a failure taxonomy applied.
3. Independent evidence that a candidate is actively harmful (not merely
   unprofitable) — that would be a separate defect argument, judged on its own
   evidence, not on this disposition.

Reopening requires a new dated disposition document. This one does not silently
lapse.

## 5. Effect on the gates

- **Gate C: RETAIN DISPOSITION RECORDED** under §9. It is not "MET" in the sense
  of a demonstrated efficiency gain, and it must never be reported as one. What is
  closed is the *decision* — the harness is retained rather than simplified on
  unmeasured grounds.
- **PRE-R007 / PRE-R008**: remain unexecuted comparisons. The retain decision is
  the §9 alternative to executing them; it does not convert either into a
  measured result.
- **Gate B, Gate E, Gate F/Q13: unaffected.** This disposition clears nothing
  else.
