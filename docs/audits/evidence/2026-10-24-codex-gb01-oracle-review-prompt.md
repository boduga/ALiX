You are performing an INDEPENDENT ORACLE REVIEW for a benchmark acceptance gate (GB-01).
You did not author this code. Do not trust comments or docstrings; verify against the
actual logic and against the case definitions.

Repository: /home/babasola/Projects/ALiX

Files under review (the oracle — what decides pass/fail):
- src/operations/evals/evaluators/objective-evaluator.ts
- src/operations/evals/evaluators/status-evaluator.ts
- src/operations/evals/eval-guards.ts
- src/operations/evals/eval-admissibility.ts

Files under review (the cases — what the oracle is pointed at):
- src/operations/evals/cases/behavioral.ts
- src/operations/evals/cases/strata-2-4.ts
- src/operations/evals/cases/strata-5-10.ts
- src/operations/evals/cases/stratum-9-local.ts
- src/operations/evals/cases/index.ts

Your question: does this oracle actually MEASURE WHAT ITS CASES CLAIM, or can it pass
a run that did not do the work — and can it fail a run that did?

Check specifically, and say what you found for each:

1. OBJECTIVE SOUNDNESS. For each objective kind (file/patch/replacement/unchanged/files),
   can the checker be satisfied WITHOUT the task being done? Look for: content that a
   comment or docstring could satisfy, existence-only checks where content matters,
   decoy strings, `changed` flags that a no-op could pass, composite objectives that
   AND across a subset.

2. STATUS HONESTY. Can status-evaluator be satisfied by a run that reported success it
   did not achieve, or honest failure it did not have? Is "honest" defined against the
   OBJECTIVE or against the expected-status list — and does that make it circular?

3. GUARDS. Do the positive guards fail closed? Check: missing/malformed/duplicate/
   unmatched evidence, the outside sentinel, the workspace snapshot, ordered tool
   sequences. Can a guard be satisfied by absence of evidence rather than evidence?

4. INADMISSIBILITY. Can a provider/transport fault still score as a pass on a case
   that expects failure? Can a genuine model failure be misclassified as inadmissible
   and silently excluded?

5. CASE ORACLE PARITY. For each case in the three case files, does its `objective`
   actually verify what its `task` asks for? Flag any case where task and objective
   disagree, where the task is under-specified relative to the objective, or where the
   expected status is unreachable.

6. SCRIPTED-ONLY CASES. Some cases declare scripted-only expectations. Confirm they
   cannot be scored on a real provider, and that nothing silently admits them.

Constraints: READ-ONLY. Do NOT write, stage, commit or modify any repository file.
Do NOT run the eval suite or call any provider. Shell reads and computation only.

Output (plain text):
- `ORACLE DEFECTS` — each with file:line, severity (critical/major/minor), what it
  allows or blocks, and the minimal fix
- `CASE PARITY` — per case id: OK, or task-vs-objective mismatch with specifics
- `CAN A FAKE PASS?` — yes/no per objective kind, with the concrete counterexample
- `CAN A REAL FAIL BE HIDDEN?` — yes/no, with the mechanism
- `VERDICT` — is this oracle fit to independently verify outcomes for a baseline? Be
  strict. If a fake can pass, answer NO and name it.
