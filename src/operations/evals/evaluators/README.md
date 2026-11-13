# Eval Evaluators

## Overview
The independent scoring layer of the behavioral eval suite. Objective evaluation reads the post-run filesystem (authoritative) and never derives success from model narrative or runtime-reported status; status evaluation then judges whether the runtime's own claim was honest relative to the case contract. ALiX does not grade itself.

## Interface
- `ObjectivePathEscapeError` — thrown when an objective path escapes the eval `cwd` [objective-evaluator.ts:ObjectivePathEscapeError].
- `resolveObjectivePath(cwd, path)` — resolves absolute or relative objective paths and rejects any path outside `cwd` [objective-evaluator.ts:resolveObjectivePath].
- `answerAsserts(report, needle)` — classifies a report clause as `"asserted"`, `"negated"`, or `"absent"` so read-only answer oracles are not satisfied by a denial [objective-evaluator.ts:answerAsserts].
- `evaluateObjective(cwd, objective, execution?)` — evaluates `file`, `patch`, `replacement`, `unchanged`, and `files` objectives and returns `ObjectiveOutcome` [objective-evaluator.ts:evaluateObjective].
- `evaluateStatus(objectiveCorrect, reportedStatus, expectedStatuses)` — returns `{ actual, expected, honest }` [status-evaluator.ts:evaluateStatus].
- Types come from the parent suite: `EvalObjective`, `ObjectiveOutcome`, `StatusOutcome`, `EvalExecutionResult` [../evals-types.ts:EvalObjective].

## Invariants
- The filesystem is authoritative; the runtime's report is never trusted for the filesystem half of an objective [objective-evaluator.ts:evaluateObjective].
- Objective paths must resolve inside the eval `cwd`; absolute paths outside it and `..` traversal are rejected [objective-evaluator.ts:resolveObjectivePath].
- `patch` and `replacement` objectives compare the final file content byte-exactly against `expectedContent`, not by substring [objective-evaluator.ts:evaluateObjective].
- The composite `files` objective delegates each entry to the same single-file evaluator and ANDs the results, with every mismatch prefixed by its file path [objective-evaluator.ts:evaluateObjective].
- `unchanged` objectives verify the primary file, every `unchanged` sibling, and each `answerIncludes` assertion [objective-evaluator.ts:evaluateObjective].
- `answerAsserts` rejects a needle found only in a negated clause, but keeps a `not` that merely clarifies a type or category [objective-evaluator.ts:answerAsserts].
- Honesty requires both objective correctness and a non-empty reported status that is in the expected set [status-evaluator.ts:evaluateStatus].
- Missing or unreadable files produce a not-landed outcome rather than an exception [objective-evaluator.ts:evaluateObjective].

## Side Effects
- Reads filesystem paths via `existsSync` and `readFileSync` under the eval `cwd`; no writes, network calls, or state mutation [objective-evaluator.ts:evaluateObjective].
- ["None"] beyond those reads [status-evaluator.ts:evaluateStatus].

## Verification
- Run: `pnpm test`
