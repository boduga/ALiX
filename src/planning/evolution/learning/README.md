# Organizational Learning Engine

## Overview
The A8 diagnostic learning pipeline: four read-only adapters normalize governance proposal events, capability measurements, enriched proposals, and verification recommendations; three pure detectors derive organizational findings; the engine aggregates them into a `LearningProposal`; and the governance bridge converts that proposal into a `MONITOR`-only recommendation. Findings describe patterns, not individual blame, and cannot authorize mutations directly.

## Interface
- `LearningEngine(proposalEvents, measurementEvents, enrichedProposals, recommendations, options?)` with `learn(now)` returning `LearningProposal | null` [learning-engine.ts:LearningEngine].
- `LearningFindingKind` (`underperformer`, `outcome-contradiction`, `repeated-pattern-failure`), `LearningFinding`, `LearningProposal`, `LearningAdapter<T>` [contracts/learning-contract.ts:LearningFinding].
- Adapter record types: `ProposalGovernanceRecord`, `MeasurementOutcomeRecord`, `EnrichedProposalRecord`, `RecommendationRecord` [contracts/learning-contract.ts:LearningAdapter].
- `LearningEngineOptions`, `DEFAULT_LEARNING_ENGINE_OPTIONS`, `DEFAULT_MIN_CARDINALITY = 3`, `DEFAULT_EVIDENCE_WINDOW_DAYS = 30` [contracts/learning-contract.ts:DEFAULT_LEARNING_ENGINE_OPTIONS].
- `buildLearningProposal(findings, now)` — sorts findings and derives a deterministic `proposalId` [learning-proposal-builder.ts:buildLearningProposal].
- `buildGovernanceRecommendation(proposal)` — emits an A2.5 `GovernanceRecommendation` with `kind: "MONITOR"` [governance-bridge.ts:buildGovernanceRecommendation].
- `runLearnCli(opts, now)` — constructs all four adapters and returns `{ output, exitCode }` for text or JSON output [learning-cli.ts:runLearnCli].
- `index.ts` re-exports the contract, adapters, three detectors, proposal builder, engine, and governance bridge [index.ts:index].
- `adapters/` — the four read-only source adapters [./adapters/README.md](./adapters/README.md).
- `detectors/` — the three pure pattern detectors [./detectors/README.md](./detectors/README.md).
- `contracts/` — the learning contract types [./contracts/README.md](./contracts/README.md) [contracts/learning-contract.ts:LearningProposal].

## Invariants
- The engine always takes four adapters; the `enrichedProposals` adapter is read but currently void-discarded to keep the seam live for a future detector [learning-engine.ts:LearningEngine].
- "No trigger → no proposal": zero findings returns `null`, never an empty proposal [learning-engine.ts:LearningEngine].
- The engine is pure orchestration: no I/O beyond adapter `list()` calls and no implicit clock — the caller passes `now` [learning-engine.ts:LearningEngine].
- `proposalId` is `a8:${now}:${sortedFindingIds.join("|")}`, so identical findings at the same time yield an identical ID and a later `now` yields a distinct proposal [learning-proposal-builder.ts:buildLearningProposal].
- Findings are sorted by `findingId` before the proposal is built [learning-proposal-builder.ts:buildLearningProposal].
- `recommendationId` is `a8-rec:${proposalId}`, and `evidenceId` is the SHA-256 hex digest of the sorted finding IDs, making both deterministic and deduplication-friendly [governance-bridge.ts:hashFindingIds].
- The governance bridge always emits `kind: "MONITOR"`; A8 proposals are diagnostic only and cannot authorize mutations [governance-bridge.ts:buildGovernanceRecommendation].
- `risks` is always `[]` because A8 surfaces organizational patterns, not per-proposal risk judgments [governance-bridge.ts:buildGovernanceRecommendation].
- Default detectors require `minCardinality: 3` occurrences within a 30-day evidence window [contracts/learning-contract.ts:DEFAULT_LEARNING_ENGINE_OPTIONS].
- `--dimension` is accepted by the CLI but has no effect in v1 [learning-cli.ts:runLearnCli].

## Side Effects
- Adapters read their sources (`EventLog`, `RecommendationStore`, and the supplied `EnrichedProposal[]`) but never write [../learning/adapters/README.md](./adapters/README.md).
- `runLearnCli` calls the four adapters, builds the proposal and recommendation in memory, and returns rendered text or JSON; it performs no I/O itself [learning-cli.ts:runLearnCli].

## Verification
- Run: `pnpm test`
