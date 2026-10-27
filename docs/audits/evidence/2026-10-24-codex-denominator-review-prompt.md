You are independently verifying whether a benchmark collection can serve as an
independently verified denominator for cost-per-verified-success. You did not produce
these artifacts and must not trust their summary fields.

Repository: /home/babasola/Projects/ALiX
Artifacts: benchmark/evidence/eval-runs/collection-2026-10-24-evidenced/*.json (9 files, 45 runs)
Each run now carries an `evidence` object with: `objectiveTargets` (the objective files'
bytes and sha256), `workspace` (a hash manifest), `outsideSentinel`, and `runtime`.

Task 1 — RE-DERIVE, do not trust. For each of the 45 runs, independently recompute the
outcome using ONLY `evidence` plus the case definition in src/operations/evals/cases/*.ts:
- Does the objective file content in `evidence.objectiveTargets` actually satisfy the
  case's objective contract (contentEquals / contentIncludes / exists / answerIncludes)?
- Does `evidence.runtime.status` fall within the case's expected statuses?
- For guard-configured cases, can you verify workspace preservation / sentinel
  preservation from `evidence.workspace` and `evidence.outsideSentinel`?
Report every run where YOUR derivation disagrees with the row's `verifiedSuccess`.

Task 2 — SUBSTANTIATION. Judge specifically whether each of these is now satisfied:
a) final answers and actual file contents are retained (was the prior gap)
b) before/after workspace manifests are retained
c) original sentinel bytes are retained
d) runtime status/error records are retained per repetition

Task 3 — ARITHMETIC. Recompute per-file and total costUsd. Confirm rateSource is
pinned-rate on all 45. Report any mismatch.

Task 4 — DENOMINATOR VERDICT. Answer exactly one of:
  YES  — these 45 runs can serve as an independently verified denominator
  NO   — they cannot, and name precisely what is still missing
Be strict. If `inadmissible: false` still cannot be independently excluded, or any
run's outcome cannot be re-derived from retained evidence, answer NO.

Constraints: read-only. Do NOT write, stage, commit or modify any repository file.
Do NOT call any provider API. Do NOT run the eval suite. Shell reads and computation only.

Output (plain text):
- `RE-DERIVATION MISMATCHES` — case, run index, your verdict vs recorded, and why
- `SUBSTANTIATION` — a/b/c/d each as SATISFIED or NOT SATISFIED with evidence
- `ARITHMETIC` — per-file and total, plus rateSource check
- `DENOMINATOR VERDICT` — YES or NO, with reasoning and any remaining gap named precisely
