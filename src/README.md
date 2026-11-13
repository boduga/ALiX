# Source Root

## Overview

The top of the ALiX source tree. Four direct modules form the process entry surface and the shared task taxonomy; everything else is a subsystem package under its own contract. `src/cli.ts` is the executable entry, `src/index.ts` carries the version constant, `src/run.ts` is a compatibility re-export shim, and `src/task-classifier.ts` is the shared vocabulary for task type, research depth, shell detection, and read-only classification used by the agent loop, context assembly, and planning.

## Interface

- `ALIX_VERSION = "0.6.0"` — the single version constant, imported by the CLI for `--version` and help `[index.ts:ALIX_VERSION]`.
- `runTask` — the agent-loop entry point, re-exported last in the shim to avoid circular imports `[run.ts:runTask]`.
- Shim re-exports: `shouldAutoDisableStreaming`, `StreamHandler`, `buildErrorMessage`, `buildToolsForProvider`, `buildContextBundleEventPayload`, `buildModelUsageEventPayload`, `renderContextBundleForPrompt`, `extractMutationPaths`, `validMutationPaths`, `recordMutationInSessionState`, `MutationSessionState`, `EXIT_CODES`, `SharedSession`, `RunResult`, `ContextPressure`, `RunOpts` `[run.ts:runTask]`.
- `TaskType` — closed union `bugfix | feature | refactor | docs | research | unknown` `[task-classifier.ts:TaskType]`.
- `classifyTask(prompt)` — pattern-based classification with precedence bugfix → feature → refactor → docs → research → unknown `[task-classifier.ts:classifyTask]`.
- `detectResearchDepth(prompt)` and `ResearchDepth` — `quick` or `deep` from deep-research signal patterns `[task-classifier.ts:detectResearchDepth]` `[task-classifier.ts:ResearchDepth]`.
- `hasNaturalLanguageTail(prompt)` — shape-based prose detection over the tokens after the first `[task-classifier.ts:hasNaturalLanguageTail]`.
- `isShellTask(prompt)` — true for a bare shell command with no prose tail `[task-classifier.ts:isShellTask]`.
- `isClaimVerificationTask(prompt)` — inline claim/evidence judgment asks; deliberately separate from read-only classification `[task-classifier.ts:isClaimVerificationTask]`.
- `isReadOnlyTask(prompt)` — read-signal or docs/research classification `[task-classifier.ts:isReadOnlyTask]`.
- `COMMAND_ROUTER` — lazy-loading handler map in the executable entry `[cli.ts:COMMAND_ROUTER]`.
- Child subsystem contracts: [./agents/README.md](./agents/README.md), [./capabilities/README.md](./capabilities/README.md), [./context/README.md](./context/README.md), [./coordination/README.md](./coordination/README.md), [./execution/README.md](./execution/README.md), [./governance/README.md](./governance/README.md), [./interfaces/README.md](./interfaces/README.md), [./models/README.md](./models/README.md), [./operations/README.md](./operations/README.md), [./planning/README.md](./planning/README.md), [./runtime-state/README.md](./runtime-state/README.md), [./session/README.md](./session/README.md).

## Invariants

- `classifyTask` evaluates its pattern groups in a fixed order and returns the first match, so a prompt containing both bugfix and feature language classifies as `bugfix` `[task-classifier.ts:classifyTask]`.
- `hasNaturalLanguageTail` counts consecutive plain-word tokens after the first token and reports prose at the threshold; a non-plain token resets the run, so `cat the file` is still accepted as a shell command `[task-classifier.ts:hasNaturalLanguageTail]`.
- `isShellTask` requires both a matching shell pattern and the absence of a natural-language tail, after stripping surrounding quotes `[task-classifier.ts:isShellTask]`.
- `isClaimVerificationTask` does not feed the read-only tool filter; that predicate only exempts plan generation, so `verify.claim` remains available and follow-up edits are not forbidden `[task-classifier.ts:isClaimVerificationTask]`.
- `isReadOnlyTask` treats `research` and `docs` tasks as read-only regardless of write signals `[task-classifier.ts:isReadOnlyTask]`.
- `ALIX_VERSION` is the only literal version string; help and `--version` both print it `[cli.ts:COMMAND_ROUTER]` `[index.ts:ALIX_VERSION]`.
- `COMMAND_ROUTER` resolves handler modules lazily through dynamic `import`, so a command's dependencies load only when that command runs `[cli.ts:COMMAND_ROUTER]`.
- An unknown command prints `Unknown command: <name>` to stderr and exits with status 1 `[cli.ts:COMMAND_ROUTER]`.
- The shim re-exports `runTask` last, because exporting it earlier reintroduces a circular import with the agent loop `[run.ts:runTask]`.

## Side Effects

- `src/cli.ts` reads `process.argv`, writes help, version, and error text to the console, and terminates the process through `process.exit`, with derived handlers returning the exit code `[cli.ts:COMMAND_ROUTER]`.
- `src/index.ts`, `src/run.ts`, and `src/task-classifier.ts` declare values and pure functions only; they perform no I/O `[index.ts:ALIX_VERSION]` `[run.ts:runTask]` `[task-classifier.ts:classifyTask]`.
- Importing a command through `COMMAND_ROUTER` loads that module and its transitive imports into the process `[cli.ts:COMMAND_ROUTER]`.

## Verification

- Run: `pnpm test`
