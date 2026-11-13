# Eval Drivers

## Overview

Runtime drivers for the behavioral eval suite. Each driver executes one `EvalCase` against a real ALiX execution path and normalizes the runtime's own result into the shared `EvalExecutionResult` contract, so the evaluators can compare the runtime's status claim against independently observed filesystem outcomes.

Two paths are covered: the Matrix-G delegate runtime (`SubagentManager.spawn`) and the full agent loop (`runTask`). Both executors are injectable, so normalization can be tested against a fixed result without spawning a process or calling a model.

## Interface

- `DelegateExecutor` — injectable delegate execution `(task, cwd, scenarioJson?) => Promise<SubagentResult>` [delegate-driver.ts:DelegateExecutor]
- `normalizeSubagentResult(raw, cwd)` — maps a `SubagentResult` to `EvalExecutionResult` [delegate-driver.ts:normalizeSubagentResult]
- `runDelegateCase(evalCase, cwd, executor)` — builds the `SubagentTask`, forwards the scripted scenario, and normalizes the result [delegate-driver.ts:runDelegateCase]
- `createSubagentExecutor(config, opts?)` — default executor that spawns a real subagent subprocess through `SubagentManager` [delegate-driver.ts:createSubagentExecutor]
- `MainLoopExecutor` — injectable agent-loop execution `(cwd, task, opts?) => Promise<RunResult>` [main-loop-driver.ts:MainLoopExecutor]
- `normalizeRunResult(raw, cwd)` — maps a `RunResult` to `EvalExecutionResult` [main-loop-driver.ts:normalizeRunResult]
- `runMainLoopCase(evalCase, cwd, executor)` — runs one case through the injected `runTask` executor [main-loop-driver.ts:runMainLoopCase]

## Invariants

- Each driver stamps its own value in `EvalExecutionResult.driver`: `delegate` or `main-loop` [delegate-driver.ts:normalizeSubagentResult] [main-loop-driver.ts:normalizeRunResult]
- The delegate driver takes the honesty-relevant claim from `SubagentResult.status`; the main-loop driver takes it from `RunResult.reason` [delegate-driver.ts:normalizeSubagentResult] [main-loop-driver.ts:normalizeRunResult]
- Delegate normalization retains `events` and derives `summary` from the child's `summary`/`synthesis` findings, trimmed, in order, joined by blank lines; it is `undefined` when no such finding has content [delegate-driver.ts:finalAnswerFrom]
- `runDelegateCase` builds the task id as `eval-<caseId>` with every character outside the `[a-zA-Z0-9_-]` set replaced by `-` [delegate-driver.ts:runDelegateCase]
- Delegate tasks always run as `role: "worker"` and `mode: "write"`, with `contextBundle` set to `eval:<caseId>` [delegate-driver.ts:runDelegateCase]
- `ownedPaths` falls back to the cwd wildcard only when the case declares no owned paths; a declared list is passed through unchanged [delegate-driver.ts:runDelegateCase]
- The case's scripted scenario is passed as the executor's third argument as JSON, or `undefined` when the case has no scenario [delegate-driver.ts:runDelegateCase]
- The default subagent executor uses `opts.sessionId`, else `eval-<task.id>`, and always calls `manager.shutdown()` in a `finally` block [delegate-driver.ts:createSubagentExecutor]
- `SubagentManager` is imported dynamically at execution time, not at module load [delegate-driver.ts:createSubagentExecutor]
- The main-loop driver always executes with `planMode: false`, `skipContext: true`, and `sessionMode: "bypass"` [main-loop-driver.ts:runMainLoopCase]

## Side Effects

- `createSubagentExecutor` spawns a real subagent subprocess in the eval `cwd` and shuts its manager down when the spawn settles [delegate-driver.ts:createSubagentExecutor]
- Test-supplied executors are called as-is; neither normalization function performs I/O [delegate-driver.ts:normalizeSubagentResult] [main-loop-driver.ts:normalizeRunResult]
- `runMainLoopCase` executes the full agent loop, whose own tool, file, and model effects belong to `runTask` [main-loop-driver.ts:runMainLoopCase]
- No network, disk, or lock acquisition is issued directly by this directory [main-loop-driver.ts:runMainLoopCase]

## Verification

- Run: `pnpm test`
