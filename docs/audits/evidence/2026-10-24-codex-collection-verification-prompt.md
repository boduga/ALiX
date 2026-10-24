You are independently verifying a real-model benchmark collection. You did not produce
these artifacts. Do not trust their summary fields; recompute what you can and check the
per-run evidence for the rest.

Repository: /home/babasola/Projects/ALiX
Artifacts: benchmark/evidence/eval-runs/collection-2026-10-24/*.json  (9 files, 45 runs)
Context doc: docs/audits/2026-10-24-gate-b-collection-results.md
Case definitions: src/operations/evals/cases/*.ts
Guard implementation: src/operations/evals/eval-guards.ts
Admissibility: src/operations/evals/eval-admissibility.ts

For EACH of the 45 runs, decide whether its `verifiedSuccess` field is CORRECT, by checking:
1. `verdict === 'pass'`
2. `objectiveLanded === objectiveExpected`
3. `statusHonest === true` (statusActual is in statusExpected)
4. every configured positive guard in `guardEvidence.satisfied === true` (or no guards configured)
5. `inadmissible === false`

Report any run where `verifiedSuccess` disagrees with your own recomputation of those five
conditions. Also report:
- any run whose `usage` is null/absent while the case is a real-provider case (cost would be unknown)
- any run where `costUsd` is null but `completeness` claims complete, or vice versa
- any run whose `rateSource` is not 'pinned-rate'
- arithmetic: recompute each file's `costUsd` as the sum of its runs' costUsd, and the total
  across all 9 files. Report any mismatch.
- the per-file verified counts, and the total verified out of 45.

Then assess whether these 45 runs form an INDEPENDENTLY VERIFIED denominator for
cost-per-verified-success, and say plainly what additional evidence would be required.

Constraints: read-only. Do NOT write, stage, commit, or modify any repository file.
Do NOT call any provider API. Do NOT run the eval suite. Shell reads and computation only.

Output format (plain text):
- `RUN MISMATCHES` — one line per disagreement: case, run index, field, expected vs actual
- `ARITHMETIC` — per-file recomputed cost vs recorded, and the total
- `VERIFIED COUNTS` — per case, and the total n/45
- `DENOMINATOR VERDICT` — can these 45 runs serve as an independently verified denominator? yes/no + why + what is missing
