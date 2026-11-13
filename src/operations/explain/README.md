# Proposal Explanation Assembler

## Overview

Read-only aggregation that explains a single evolution proposal end-to-end. It walks the four persisted decision-lifecycle stores (outcome, recommendation, risk, governance) plus the evidence-chain graph and the learning/calibration stores, and assembles an ephemeral `ProposalExplanation` view model. Explain reads state; it never becomes a store and never edits a chain, adapter, or proposal surface.

Layer resolution follows one locked priority ladder — evidence-chain traversal, then direct id from the outcome record, then a proposal-scoped fallback, and finally a string heuristic that is confined to the learning and calibration layers. Each resolved layer records which rung produced it through `joinPath`, so a consumer can distinguish a graph-backed join from a heuristic guess.

## Interface

- `assembleProposalExplanation(opts)` — walks the stores and returns a `ProposalExplanation` [proposal-explanation-assembler.ts:assembleProposalExplanation]
- `AssembleProposalExplanationOptions` — `proposalId`, `cwd`, `windowDays`, `executionEvidence`, `executionLineageRefs`, and an optional deterministic `generatedAt` anchor [proposal-explanation-assembler.ts:AssembleProposalExplanationOptions]
- `ProposalExplanation` — the assembled view model with `outcome`, `recommendation`, `risk`, `governance`, `execution`, `learning`, `calibration`, `explanationIntegrity`, and `learningRefreshHint` [proposal-explanation-types.ts:ProposalExplanation]
- `JoinPath` — `evidence_chain | direct_id | proposal_fallback | string_heuristic` [proposal-explanation-types.ts:JoinPath]
- Layer shapes: `OutcomeLayer`, `RecommendationLayer`, `RiskLayer`, `GovernanceLayer`, `ExecutionLayer`, `LearningLayer`, `CalibrationLayer`, and the `UnavailableLayer` union member every non-execution layer can degrade to [proposal-explanation-types.ts:OutcomeLayer] [proposal-explanation-types.ts:RecommendationLayer] [proposal-explanation-types.ts:RiskLayer] [proposal-explanation-types.ts:GovernanceLayer] [proposal-explanation-types.ts:ExecutionLayer] [proposal-explanation-types.ts:LearningLayer] [proposal-explanation-types.ts:CalibrationLayer] [proposal-explanation-types.ts:UnavailableLayer]
- `ExplanationIntegrity` — per-layer found flags, `evidenceChainUsed`, `fallbackJoinsUsed`, `incompleteChainLayers`, `totalLayers`, `layersAvailable`, `completenessPercent` [proposal-explanation-types.ts:ExplanationIntegrity]

## Invariants

- Layer resolution is locked to four rungs in descending order: evidence-chain traversal, direct id (`recommendationId` / `riskScoreId` / `governanceReviewId`), proposal-scoped fallback, then string heuristic [proposal-explanation-assembler.ts:assembleProposalExplanation]
- The string heuristic is permitted only in the learning and calibration layers; the outcome, recommendation, risk, and governance layers never resolve by substring match [proposal-explanation-assembler.ts:assembleProposalExplanation]
- The outcome layer is always proposal-scoped (`queryBySubject(proposalId)`) and therefore always reports `joinPath: "proposal_fallback"` [proposal-explanation-assembler.ts:assembleProposalExplanation]
- Chain traversal is bounded by `EXPLAIN_MAX_DEPTH` hops per chain and never follows links past that bound [proposal-explanation-assembler.ts:resolveChainReachable]
- A direct-id miss counts toward `incompleteChainLayers` only when `evidenceChainUsed` is already true; without a chain it is a stale foreign key, not a chain failure [proposal-explanation-assembler.ts:assembleProposalExplanation]
- Orphaned chain targets are held in a `Set`, so one broken edge repeated across the recommendation, risk, and governance loops reports as a single incomplete chain layer [proposal-explanation-assembler.ts:assembleProposalExplanation]
- `RiskScore` carries no `proposalId`; a chain-reachable risk target is accepted only when its id equals `risk-${proposalId}` to prevent cross-proposal leakage [proposal-explanation-assembler.ts:assembleProposalExplanation]
- Governance fallback must use `queryByProposal(proposalId)` and never a list-and-take-latest scan (cross-proposal isolation) [proposal-explanation-assembler.ts:assembleProposalExplanation]
- The execution layer is not read from a store: it is joined from the supplied `executionLineageRefs` by `candidateId === proposalId` and then matched to `executionEvidence` by `evidenceId` [proposal-explanation-assembler.ts:assembleProposalExplanation]
- `totalLayers` is fixed at 7, and `completenessPercent` is `round(layersAvailable / 7 * 1000) / 10` [proposal-explanation-types.ts:ExplanationIntegrity]
- `generatedAt` defaults to wall-clock `new Date().toISOString()` but threads through every windowed outcome, risk, learning, and calibration read so fixture data does not silently drift past the cutoff [proposal-explanation-assembler.ts:AssembleProposalExplanationOptions]
- `learningRefreshHint` is `null` whenever the learning layer has at least one signal, and the fixed refresh hint otherwise [proposal-explanation-assembler.ts:assembleProposalExplanation]
- `adapterForReport` classifies by `sourceReportId` prefix and defaults unknown prefixes to `"recommendation"` so a signal is never silently dropped [proposal-explanation-assembler.ts:adapterForReport]

## Side Effects

- Read-only disk access to `.alix/adaptation/outcomes`, `.alix/recommendations`, `.alix/risk-scores`, `.alix/governance-reviews`, and `.alix/learning` under `cwd` [proposal-explanation-assembler.ts:assembleProposalExplanation]
- Store reads are individually failure-tolerant: every query is wrapped in `.catch()` and degrades to an empty result or an unavailable layer [proposal-explanation-assembler.ts:assembleProposalExplanation]
- Wall-clock read when `generatedAt` is omitted [proposal-explanation-assembler.ts:AssembleProposalExplanationOptions]
- No writes to any store, evidence chain, adapter, or proposal surface; no network calls and no locks [proposal-explanation-assembler.ts:assembleProposalExplanation]

## Verification

- Run: `pnpm test`
