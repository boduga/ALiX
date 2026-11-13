# Evolution Lifecycle

## Overview
Owns the evolution lifecycle vocabulary and the deterministic A0 state machine that governs transitions from draft through activation or terminal rejection. The local `evolution-evidence-bridge.ts` translates validated transition events into standard `ExecutionEvidence` and emits them through the existing runtime evidence emitter. This package decides lifecycle transitions and translates their evidence; child subsystems supply contracts, observation, learning, forecasting, and verification surfaces.

## Interface
- `EvolutionStateMachine`: in-memory registry of evolution state, transition history, and optional metadata; exposes `createEvolution`, `transition`, `getStatus`, `getHistory`, `listEvolutions`, and `getMetadata` [evolution-state-machine.ts:EvolutionStateMachine].
- `EvolutionTransitionEvent`, `EvolutionTransitionResult`, and `EvolutionMetadata`: typed transition output, previous/current result, and creation metadata [evolution-state-machine.ts:EvolutionTransitionEvent], [evolution-state-machine.ts:EvolutionTransitionResult], [evolution-state-machine.ts:EvolutionMetadata].
- `EvolutionSummary`: list projection containing id, state, target kind, and creation time [evolution-state-machine.ts:EvolutionSummary].
- `IllegalEvolutionTransitionError`, `UnknownEvolutionError`, and `DuplicateEvolutionError`: typed rejection errors carrying the evolution id and, for illegal transitions, both states [evolution-state-machine.ts:IllegalEvolutionTransitionError], [evolution-state-machine.ts:UnknownEvolutionError], [evolution-state-machine.ts:DuplicateEvolutionError].
- `evolutionStateToOutcome`: maps `ACTIVE` to `SUCCESS`, terminal failures (`REJECTED`, `WITHDRAWN`, `ROLLED_BACK`, `FAILED_VALIDATION`) to `FAILED`, and all other or unknown states to `PARTIAL` [evolution-evidence-bridge.ts:evolutionStateToOutcome].
- `evolutionEventToEvidence`: translates a transition event into `ExecutionEvidence`, marking verification passed only for `ACTIVE` [evolution-evidence-bridge.ts:evolutionEventToEvidence].
- `EvolutionEvidenceBridge.emitTransitionEvent`: translates and emits one event as `ExecutionCompleted` through the injected `ExecutionEvidenceEmitter` [evolution-evidence-bridge.ts:EvolutionEvidenceBridge].
- Observation engine: [./observation/README.md](./observation/README.md) - provider registration, observed-evidence aggregation, capability measurement, and the observe CLI.
- `contracts/`: [./contracts/README.md](./contracts/README.md) - pure A-series evolution vocabulary, validation boundaries, and lineage rules [contracts/evolution-contract.ts:EvolutionState].
- `execution/`: [./execution/README.md](./execution/README.md) - governed execution of an approved evolution proposal [execution/execution-runtime.ts:GovernedExecutionRuntime].
- `forecast/`: [./forecast/README.md](./forecast/README.md) - deterministic pre-execution governance risk forecasts [forecast/forecast-builder.ts:buildForecast].
- `governance/`: [./governance/README.md](./governance/README.md) - hash-sealed A3 governance decisions and lifecycle transitions [governance/decision-engine.ts:generateDecision].
- `knowledge/`: [./knowledge/README.md](./knowledge/README.md) - knowledge evolution curation [knowledge/curation-engine.ts:CurationEngine].
- `learning/`: [./learning/README.md](./learning/README.md) - read-only A8 diagnostic learning pipeline [learning/learning-engine.ts:LearningEngine].
- `verification/`: [./verification/README.md](./verification/README.md) - A2 evolution verification framework [verification/confidence/confidence-calculator.ts:computeOverallConfidence].
- `pattern-discovery/` — child subsystem without a local contract file.

## Invariants
- Transitions must follow the fixed `ALLOWED_TRANSITIONS` table; terminal states in `EVOLUTION_TERMINAL_STATES` have no outgoing transitions [evolution-state-machine.ts:ALLOWED_TRANSITIONS], [evolution-state-machine.ts:isTransitionAllowed].
- `createEvolution` defaults to `DRAFT`, rejects a duplicate id with `DuplicateEvolutionError`, and records an initial same-state creation event [evolution-state-machine.ts:createEvolution].
- A failed transition leaves state and history unmodified because validation occurs before mutation [evolution-state-machine.ts:transition].
- `getHistory` returns a copy in chronological order, and unknown ids throw `UnknownEvolutionError` from every query or transition that requires an existing evolution [evolution-state-machine.ts:getHistory], [evolution-state-machine.ts:requireEvolution].
- `listEvolutions` sorts summaries by `createdAt` ascending, treating missing timestamps as empty strings [evolution-state-machine.ts:listEvolutions].
- The evidence bridge is pure translation: it does not mutate the supplied event, persists and audits nothing, and produces a new `ExecutionEvidence` for every call [evolution-evidence-bridge.ts:evolutionEventToEvidence].
- `evolutionEventToEvidence` returns empty `artifacts` and an empty `evidenceHash`, and preserves the event timestamp as both `startedAt` and `completedAt` [evolution-evidence-bridge.ts:evolutionEventToEvidence].
- A generated evidence id uses the `evoe-` prefix plus the first eight characters of a random UUID; an injected `evidenceId` override suppresses generation [evolution-evidence-bridge.ts:generateEvidenceId], [evolution-evidence-bridge.ts:evolutionEventToEvidence].

## Side Effects
- `EvolutionStateMachine` holds all state and history in memory; it performs no persistence, file, or network I/O [evolution-state-machine.ts:EvolutionStateMachine].
- Transition and creation events call `new Date().toISOString()` to stamp `timestamp` [evolution-state-machine.ts:buildTransitionEvent].
- Evidence ids call `randomUUID()` from `node:crypto` unless the caller supplies an explicit id [evolution-evidence-bridge.ts:generateEvidenceId].
- `EvolutionEvidenceBridge.emitTransitionEvent` invokes the injected emitter with `ExecutionCompleted` [evolution-evidence-bridge.ts:emitTransitionEvent].

## Verification
- Run: `pnpm test`
