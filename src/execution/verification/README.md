# Verification Command Pipeline

## Overview
Discovers probable test commands in a project, executes them with bounded timeouts, and aggregates results into a reporter. The pipeline supports stop-on-first-failure and reports both fully successful and partial outcomes.

## Interface
- `DiscoveredCommand` and `CommandDiscovery.findTestCommands()` — priority-sorted discovery from package scripts, Make targets, and Python test configuration `[command-discovery.ts:DiscoveredCommand]` `[command-discovery.ts:CommandDiscovery]`.
- `RunResult`, `RunOptions`, `CommandRunner.run()`, and `runWithStreaming()` — bounded command execution with captured output and streamed output callbacks `[command-runner.ts:RunResult]` `[command-runner.ts:CommandRunner]`.
- `VerificationPipeline` and `PipelineResult` — orchestration across discovery, execution, and reporting `[verification-pipeline.ts:VerificationPipeline]` `[verification-pipeline.ts:PipelineResult]`.
- `VerificationReporter` — result collection, summaries, output analysis, and Markdown/JSON reports `[verification-reporter.ts:VerificationReporter]`.
- `VerificationSummary`, `VerificationResult`, and `TestAnalysis` — report-facing result shapes `[verification-reporter.ts:VerificationSummary]` `[verification-reporter.ts:VerificationResult]` `[verification-reporter.ts:TestAnalysis]`.

## Invariants
- Discovery priority is CRITICAL, HIGH, MEDIUM, LOW, DEFAULT, and results are sorted ascending by priority `[command-discovery.ts:Priority]` `[command-discovery.ts:findTestCommands]`.
- Discovery failures for missing or unreadable project files are swallowed and return an empty command list for that ecosystem `[command-discovery.ts:discoverNpmCommands]` `[command-discovery.ts:discoverMakeTargets]` `[command-discovery.ts:discoverPythonCommands]`.
- The default command timeout is 30 seconds for `CommandRunner` and 60 seconds for `VerificationPipeline` `[command-runner.ts:CommandRunner]` `[verification-pipeline.ts:VerificationPipeline]`.
- `CommandRunner.run()` reports a killed/timeout process as `success: false` with `error: "timeout"`, while `runWithStreaming()` sends `SIGTERM` at the timeout and reports the process exit status `[command-runner.ts:run]` `[command-runner.ts:runWithStreaming]`.
- Pipeline success requires `summary.failed === 0`; partial is true after stop-on-failure or when both passed and failed commands exist `[verification-pipeline.ts:run]`.
- A skipped command after an earlier failure is recorded as unsuccessful with `error: "skipped"`, while the reporter's `skipped` count is derived from that error marker `[verification-pipeline.ts:run]` `[verification-reporter.ts:getSummary]`.
- Reporter `passRate` is zero for an empty result set `[verification-reporter.ts:getSummary]`.

## Side Effects
- Reads project manifests and configuration files from `cwd` `[command-discovery.ts:discoverNpmCommands]` `[command-discovery.ts:discoverMakeTargets]` `[command-discovery.ts:discoverPythonCommands]`.
- Spawns child processes through `exec` and `spawn`, inheriting a child environment built with `buildChildEnv` `[command-runner.ts:run]` `[command-runner.ts:runWithStreaming]`.
- Executed verification commands may themselves read/write files or use the network; this package only controls their process invocation.
- Writes verbose command lines to stdout when the pipeline is verbose `[verification-pipeline.ts:run]`.

## Verification
- Run: `pnpm test`
