# CLI Interface

## Overview
The top-level command-line interface layer. It provides parsing for `alix run` arguments and the only bridge from learning data into the adaptation-proposal lifecycle, while child directories own command handlers, shared CLI helpers, and terminal renderers.

## Interface
- `RunArgs` and `parseRunArgs(rawArgs)` for `alix run`; known flags are consumed regardless of position and the remaining tokens form `task` [run-args.ts:RunArgs] [run-args.ts:parseRunArgs]
- Boolean switches `--no-stream`, `--no-plan`, `--intent`, `--propose`, `--chat`, and `--read-only` [run-args.ts:BOOLEAN_FLAGS]
- Value switches `--mode`, `--session-mode`, `--resume`, and `--plan-file`, accepting either `--flag value` or `--flag=value` [run-args.ts:VALUE_FLAGS] [run-args.ts:parseRunArgs]
- Supported session modes are exactly `auto`, `ask`, and `bypass` [run-args.ts:VALID_MODES]
- `ProposalFactory.toAdaptationProposal(learning)` maps a `LearningProposal` into an `AdaptationProposal` [learning-proposal-factory.ts:ProposalFactory]
- `areaFromProposalType(proposalType)` maps calibration types to `recommendation`, `risk`, `governance`, or `routing` learning areas [learning-proposal-factory.ts:areaFromProposalType]
- `buildLearningProposal(proposalType, profiles, generatedAt)` builds the learning proposal consumed by the factory [learning-proposal-factory.ts:buildLearningProposal]
- `commands/`: [./commands/README.md](./commands/README.md) - command entry points and command-family dispatch for the `alix` CLI
- `helpers/`: [./helpers/README.md](./helpers/README.md) - shared argument parsing, approval-store access, and provider/model selection helpers
- `renderers/`: readline REPL for `alix run --chat`, with `/exit`, `/quit`, `/save`, `/resume`, `/sessions`, and `/status` [./renderers/README.md](./renderers/README.md) [renderers/repl.ts:createReplRenderer]

## Invariants
- Known flags and their values are removed from the task text; unrecognized tokens are preserved and joined with spaces [run-args.ts:parseRunArgs]
- A value switch consumes its following token only when the resulting value is valid; an invalid mode leaves the switch and value unconsumed [run-args.ts:parseRunArgs]
- Every factory-produced proposal is `status: "pending"`, uses `action: "learning_adjustment"`, targets the mapped learning area, and has `sourceRecommendationType: "learning_calibration"` [learning-proposal-factory.ts:ProposalFactory]
- `buildLearningProposal` de-duplicates `sourceSignalIds`, averages profile confidence (or returns `0` for no profiles), and always sets `requiresApproval: true` [learning-proposal-factory.ts:buildLearningProposal]
- `/resume` accepts exactly one session id; missing or multiple ids produce a usage message [renderers/repl.ts:handleResumeCommand]
- `/sessions` prints a hint and performs no listing when no `SessionStore` is wired [renderers/repl.ts:handleSessionsCommand]

## Side Effects
- None at this directory's direct source level; argument parsing and proposal construction are in-memory operations [run-args.ts:parseRunArgs] [learning-proposal-factory.ts:buildLearningProposal]

## Verification
- Run: `pnpm test`
