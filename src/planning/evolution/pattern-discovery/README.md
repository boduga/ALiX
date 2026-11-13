# Pattern Discovery

## Overview

Pattern discovery runs stateless detection strategies over execution evidence
and governance audit events, converts observations into evolution candidates,
and intakes generated proposals into the evolution state machine at the
`PROPOSED` state. It is proposal-only: discovery can register a proposal, but
it never transitions, approves, or applies an evolution.

## Interface

- `DetectionStrategy` defines the stateless strategy contract: a `name`, a target `category`, and one `run(context)` method [detection-strategy.ts:DetectionStrategy]
- `PatternDiscoveryEngine` accepts injected `evidenceStore`, `auditStore`, ordered `strategies`, and an optional proposal `generator`, and exposes `run()` [pattern-discovery-engine.ts:PatternDiscoveryEngine] [pattern-discovery-engine.ts:PatternDiscoveryEngineConfig]
- `PatternDiscoveryEngineConfig` requires injected stores and strategies rather than constructing them internally [pattern-discovery-engine.ts:PatternDiscoveryEngineConfig]
- `generateCandidates` maps each pattern to an `EvolutionCandidate`; `EvolutionProposalGenerator` defines proposal generation [evolution-proposal-generator.ts:generateCandidates] [evolution-proposal-generator.ts:EvolutionProposalGenerator]
- `DefaultEvolutionProposalGenerator.generate` returns both an `EvolutionProposal` and an `EvolutionProposalDraft`, with configurable id prefixes [evolution-proposal-generator.ts:DefaultEvolutionProposalGenerator.generate] [evolution-proposal-generator.ts:EvolutionProposalGeneratorConfig]
- `GovernanceIntakeAdapter` and `DefaultGovernanceIntakeAdapter` convert candidates into registered proposals and return `IntakeResult` with `registered` and `failed` lists [governance-intake-adapter.ts:GovernanceIntakeAdapter] [governance-intake-adapter.ts:DefaultGovernanceIntakeAdapter.intake] [governance-intake-adapter.ts:IntakeResult]
- `runDiscoverCli` builds the default engine and strategies, runs discovery, performs intake, and returns `{ output, exitCode }` for text or `--json` output [discovery-cli.ts:runDiscoverCli] [discovery-cli.ts:RunDiscoverCliOpts]
- Detection strategies are re-exported from their child contract [strategies/README.md](./strategies/README.md)

## Invariants

- Strategies are stateless between runs and emit only `PatternObservation` values [detection-strategy.ts:DetectionStrategy]
- The engine loads evidence with `evidenceStore.list()` and governance events with `auditStore.listChronological()` in parallel [pattern-discovery-engine.ts:PatternDiscoveryEngine.run]
- Strategies execute sequentially in configured order, not concurrently [pattern-discovery-engine.ts:PatternDiscoveryEngine.run]
- A strategy failure is isolated: the engine records its name and continues with subsequent strategies [pattern-discovery-engine.ts:PatternDiscoveryEngine.run]
- `strategiesRun` excludes failed strategies, while `strategiesFailed` is present only when failures occurred [pattern-discovery-engine.ts:PatternDiscoveryEngine.run]
- `candidates` are always generated from detected patterns; `drafts` are populated only when a generator is configured [pattern-discovery-engine.ts:PatternDiscoveryEngine.run]
- Category maps provide deterministic default risk class, expected effect, and target kind for every `PatternCategory` [evolution-proposal-generator.ts:CATEGORY_RISK_MAP] [evolution-proposal-generator.ts:CATEGORY_EFFECT_MAP] [evolution-proposal-generator.ts:CATEGORY_TARGET_KIND_MAP]
- Proposal generation performs no store access and never calls `EvolutionStateMachine.transition()` [evolution-proposal-generator.ts:EvolutionProposalGenerator]
- Generated proposal titles use a sentence boundary when available and otherwise truncate at a word boundary near 80 characters [evolution-proposal-generator.ts:DefaultEvolutionProposalGenerator.deriveTitle]
- Intake calls `createEvolution()` with `EvolutionState.PROPOSED`, never `transition()` [governance-intake-adapter.ts:DefaultGovernanceIntakeAdapter.intake]
- Intake isolates per-candidate failures and reports them in `failed` without aborting other candidates [governance-intake-adapter.ts:DefaultGovernanceIntakeAdapter.intake]
- Intake metadata records `origin: "system_observation"` and the candidate's target, risk class, creation time, and expected effect [governance-intake-adapter.ts:DefaultGovernanceIntakeAdapter.intake]
- The CLI reports registered proposal ids and failed candidate reasons; the state machine is in-memory per invocation and registered proposals are not persisted by this CLI [discovery-cli.ts:runDiscoverCli]

## Side Effects

- The engine reads the injected execution-evidence and governance-audit stores [pattern-discovery-engine.ts:PatternDiscoveryEngine.run]
- The engine writes a strategy failure warning to the console [pattern-discovery-engine.ts:PatternDiscoveryEngine.run]
- Intake mutates the supplied in-memory `EvolutionStateMachine` by creating proposals [governance-intake-adapter.ts:DefaultGovernanceIntakeAdapter.intake]
- `runDiscoverCli` returns output for the caller to print and exit; it does not write the state machine to disk [discovery-cli.ts:runDiscoverCli]

## Verification

- Run: `pnpm test`
