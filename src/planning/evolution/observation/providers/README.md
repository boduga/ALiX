# Observation Providers

## Overview

Concrete `ObservationProvider` implementations for the A5 Observation Engine. Each provider measures one kind of system reality (shell exit status, filesystem state, git state, repository health, evidence-ledger contents, test-suite outcomes) and returns a standardized `ObservationResult`. Observation is read-only by construction: providers capture reality and never drive mutations.

Shared result construction lives in `shared.ts`; every provider except `cli-provider.ts` delegates to `buildObservationResult`.

## Interface

- `buildObservationResult(observation, observed, evidence)` — standard success/reality-capture result builder; compares `observed === expected` when `expected` is defined, otherwise always passes with `confidence: 1.0` [shared.ts:buildObservationResult]
- `CliObservationProvider` — `name = "cli"`, `capabilities = ["cli"]`; runs a `command`/`args` pair via `execFile` and reports the exit code as `observed` [cli-provider.ts:CliObservationProvider]
- `FilesystemObservationProvider` — `name = "filesystem"`; checks `exists`, `hash` (SHA-256), or `stat` for a required `params.path` [filesystem-provider.ts:FilesystemObservationProvider]
- `GitObservationProvider` — `name = "git"`; checks `branch`, `diff`, `files`, or `clean` through read-only git subcommands in `params.cwd` [git-provider.ts:GitObservationProvider]
- `LedgerObservationProvider` — `name = "ledger"`; queries an injected `ExecutionEvidenceStore` for `evidence_count` or `has_evidence` by `proposalId` [ledger-provider.ts:LedgerObservationProvider]
- `RepositoryObservationProvider` — `name = "repository"`, `capabilities = ["repository", "code"]`; emits a file/line/dependency/git snapshot [repository-provider.ts:RepositoryObservationProvider]
- `TestSuiteObservationProvider` — `name = "test_suite"`, `capabilities = ["test", "test_suite"]`; runs a test command and parses pass/fail counts [test-suite-provider.ts:TestSuiteObservationProvider]
- `parseTestOutput(output, durationMs)` — parses Node test-runner, Jest, or mocha output into `TestSuiteMetrics` [test-suite-provider.ts:parseTestOutput]
- `TestSuiteMetrics` — `{ total, passed, failed, skipped, durationMs, framework }` [test-suite-provider.ts:TestSuiteMetrics]
- Contract types `Observation`, `ObservationResult`, and `ObservationProvider` are owned by the parent observation contract and imported from `../contracts/observation-contract.ts` `[../contracts/observation-contract.ts:Observation]` `[../contracts/observation-contract.ts:ObservationResult]` `[../contracts/observation-contract.ts:ObservationProvider]`.

## Invariants

- Every provider implements the shared `ObservationProvider` contract: a `name` routing key plus `observe(observation)` returning one `ObservationResult` [../contracts/observation-contract.ts:ObservationProvider]
- `buildObservationResult` defines pass/fail semantics for all shared-path providers: `expected` present → equality comparison, `expected` absent → reality capture that always passes [shared.ts:buildObservationResult]
- `CliObservationProvider` downgrades confidence to `0.9` when stderr is non-empty and never treats a non-zero exit as a thrown error [cli-provider.ts:CliObservationProvider]
- `CliObservationProvider` bounds each command with a 30s timeout and a 1 MiB output buffer [cli-provider.ts:CliObservationProvider]
- `FilesystemObservationProvider` requires `params.path` and returns `status: "error"` when it is missing; `exists` distinguishes "missing" from "parent inaccessible" [filesystem-provider.ts:FilesystemObservationProvider]
- `LedgerObservationProvider.has_evidence` matches `intentId === proposalId` because execution evidence stores the proposal id as `intentId` [ledger-provider.ts:LedgerObservationProvider]
- `RepositoryObservationProvider` counts at most the first 500 source files for line totals and skips dot-directories plus `node_modules` [repository-provider.ts:RepositoryObservationProvider]
- `TestSuiteObservationProvider` treats `failed === 0` as `observed: "pass"`, otherwise `"fail"`, and falls back to `framework: "unknown"` when no pattern matches [test-suite-provider.ts:parseTestOutput]
- Unknown `check` values return `status: "error"` rather than a silent pass [filesystem-provider.ts:FilesystemObservationProvider] [git-provider.ts:GitObservationProvider] [ledger-provider.ts:LedgerObservationProvider]

## Side Effects

- `CliObservationProvider` spawns processes via `execFile` with a 30s timeout and a 1 MiB max buffer [cli-provider.ts:CliObservationProvider]
- `GitObservationProvider` spawns read-only `git` subprocesses (`rev-parse`, `diff --name-only`, `ls-files`, `status --porcelain`) with a 10s timeout [git-provider.ts:GitObservationProvider]
- `RepositoryObservationProvider` recursively reads the workspace, executes `git rev-parse`/`git status` (5s timeouts), and reads `package.json`; failures are swallowed so a non-git or malformed tree still yields a health snapshot [repository-provider.ts:RepositoryObservationProvider]
- `TestSuiteObservationProvider` executes the caller-supplied test command with a 120s timeout and 5 MiB max buffer, so provider side effects are exactly those of the invoked test process [test-suite-provider.ts:TestSuiteObservationProvider]
- `FilesystemObservationProvider` reads file contents for hashing and stats metadata; it does not write [filesystem-provider.ts:FilesystemObservationProvider]
- `LedgerObservationProvider` performs read-only `EvidenceStore.list()` calls through its injected store [ledger-provider.ts:LedgerObservationProvider]
- `buildObservationResult` stamps `observedAt` with the current wall-clock time [shared.ts:buildObservationResult]

## Verification

- Run: `pnpm test`
