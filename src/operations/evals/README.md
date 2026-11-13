# Evals Harness

## Overview
An independent behavioral-evaluation harness. A case runs in an isolated fixture directory, a driver executes the task, and the evaluator compares filesystem reality against the runtime's reported status. The harness does not score from model prose alone: objective outcome, status honesty, and explicit positive guards all contribute to a verdict. Execution can use the deterministic scripted provider or a real provider model.

## Interface
- `runEvalCase(evalCase, opts)` runs one case and returns its `EvalResult` [evals-runner.ts:runEvalCase]
- `runEvalSuite(cases, opts)` filters by driver, runs selected cases, catches per-case throws, and aggregates an `EvalRun` [evals-runner.ts:runEvalSuite]
- `buildEvalConfig(provider, model, timeoutMs?)`, `installEvalConfig(cwd, ...)`, and `installSeed(cwd, seed?)` construct and install the case's runtime inputs [evals-runner.ts:buildEvalConfig] [evals-runner.ts:installEvalConfig] [evals-runner.ts:installSeed]
- `saveRun(targetDir, run)` and `loadPreviousRuns(targetDir)` persist and reload prior runs [evals-runner.ts:saveRun] [evals-runner.ts:loadPreviousRuns]
- `classifyInadmissible(error)` separates provider/transport faults from scoreable agent outcomes [eval-admissibility.ts:classifyInadmissible]
- `prepareEvalGuards(cwd, guards)` captures baselines and `evaluateEvalGuards(cwd, guards, baseline)` checks workspace, file, sentinel, partial-output, and ordered tool-outcome guards [eval-guards.ts:prepareEvalGuards] [eval-guards.ts:evaluateEvalGuards]
- `captureEvalRunEvidence`, `captureWorkspaceManifest`, and `readSentinelBefore` retain fixture evidence before cleanup [eval-evidence.ts:captureEvalRunEvidence] [eval-evidence.ts:captureWorkspaceManifest] [eval-evidence.ts:readSentinelBefore]
- `captureFrozenInputs(root, provider, model, options)` pins config, offered tools, corpus files, environment, and pricing; missing corpus or pricing data becomes blocking [eval-frozen-inputs.ts:captureFrozenInputs]
- `verifyObservation(row)` enforces verdict/failure-class coherence, and `aggregateStratum(rows)` aggregates one stratum [eval-observation.ts:verifyObservation] [eval-observation.ts:aggregateStratum]
- `captureEvalUsage(cwd)` and `captureEvalExecutionMetrics(cwd)` read session logs before the fixture is deleted [eval-usage.ts:captureEvalUsage] [eval-execution-metrics.ts:captureEvalExecutionMetrics]
- `correlateRunCost` and `invocationsForRun` correlate usage with effective-dated pricing [cost-correlation.ts:correlateRunCost] [cost-correlation.ts:invocationsForRun]
- `classifyFailure(evidence)` classifies a failed observation into a `FailureClass` [eval-failure-classifier.ts:classifyFailure]
- `runDatasetEval(opts)` scores corpus incidents with an LLM judge, and `gateDatasetEval(...)` applies the run/delta/win-rate gate with defaults `20`, `0.1`, and `0.8` [dataset-eval.ts:runDatasetEval] [dataset-eval.ts:gateDatasetEval] [dataset-eval.ts:GATE_DEFAULT_MIN_RUNS]
- `observationFromGate7(input)` and `observationFromEvents(input)` adapt Gate-7 summaries and event streams into observation rows [gate7-observation-adapter.ts:observationFromGate7] [event-metrics-projection.ts:observationFromEvents]
- Case definitions: [./cases/README.md](./cases/README.md)
- Evaluators: [./evaluators/README.md](./evaluators/README.md)
- Drivers: [./drivers/README.md](./drivers/README.md)
- Providers: [./providers/README.md](./providers/README.md)

## Invariants
- Each case executes in its own temporary cwd, and cleanup runs in `finally` so a failed case cannot contaminate the next [evals-runner.ts:runEvalCase]
- A case passes only when the objective landed, the reported status is honest, and every declared guard is satisfied [evals-runner.ts:runEvalCase]
- Inadmissible runs are excluded from both passed and failed counts and are reported separately; classification happens before scoring [evals-runner.ts:runEvalSuite] [eval-admissibility.ts:classifyInadmissible]
- A case that throws yields an explicit failed result instead of aborting the suite [evals-runner.ts:runEvalSuite]
- Real-provider suites skip `scriptedExpectationOnly` cases and warn about the skipped ids [evals-runner.ts:runEvalSuite]
- Scripted scenarios map typed fixture labels to exact `alix_*` tool names; scripted verdicts qualify deterministic behavior only [evals-runner.ts:runEvalSuite]
- Unmeasured metrics remain `null` rather than becoming a measured zero [eval-observation.ts:verifyObservation] [eval-execution-metrics.ts:captureEvalExecutionMetrics]
- A missing or unpriced invocation returns a `null` cost instead of a partial total [cost-correlation.ts:correlateRunCost]
- Stratum 9 is an environment axis, not a task case; a CPU-only claim requires every executing provider to be local [cases/stratum-9-local.ts:canLabelCpuOnly] [cases/stratum-9-local.ts:classifyCpuOnlyRun]
- The behavioral suite is opt-in via `pnpm test:evals` and is not part of the default `pnpm test` gate [evals-runner.ts:runEvalSuite]

## Side Effects
- Creates an isolated temporary fixture root and workspace per case [evals-runner.ts:runEvalCase]
- Writes `.alix/config.json` and seed files into the fixture cwd [evals-runner.ts:installEvalConfig] [evals-runner.ts:installSeed]
- Reads fixture session logs before recursively deleting the fixture root [evals-runner.ts:runEvalCase]
- Persists a run to `<targetDir>/.alix/evals/<runId>.json` and creates that directory when absent [evals-runner.ts:saveRun]
- Emits a console warning when real-provider runs skip scripted-only cases [evals-runner.ts:runEvalSuite]
- Issues real provider calls when a non-scripted provider is selected [evals-runner.ts:runEvalSuite]

## Verification
- Run: `pnpm test`
