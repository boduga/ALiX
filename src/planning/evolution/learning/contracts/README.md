# Organizational Learning Contracts (A8)

## Overview
Pure type contracts for the A8 organizational-learning pipeline. Adapters read governance, measurement, enrichment, and recommendation records; detectors turn them into `LearningFinding[]`; a `LearningProposal` aggregates findings for the A2.5 bridge. The proposal type is deliberately non-executable: it carries no mutation or execution fields.

## Interface
- Finding vocabulary: `LearningFindingKind` (`underperformer`, `outcome-contradiction`, `repeated-pattern-failure`) in [learning-contract.ts:LearningFindingKind]
- Calibration defaults: `DEFAULT_MIN_CARDINALITY`, `DEFAULT_EVIDENCE_WINDOW_DAYS` in [learning-contract.ts:DEFAULT_MIN_CARDINALITY]
- Finding and proposal types: `LearningFinding`, `LearningProposal` in [learning-contract.ts:LearningFinding]
- Read-only adapter port: `LearningAdapter<T>` with `name` and `list()` in [learning-contract.ts:LearningAdapter]
- Adapter record shapes: `ProposalGovernanceRecord`, `MeasurementOutcomeRecord`, `EnrichedProposalRecord`, `RecommendationRecord` in [learning-contract.ts:ProposalGovernanceRecord]
- Engine configuration: `LearningEngineOptions`, `DEFAULT_LEARNING_ENGINE_OPTIONS` in [learning-contract.ts:LearningEngineOptions]

## Invariants
- `LearningProposal` is structurally non-executable: it has only `proposalId`, `generatedAt`, and `findings`, so it cannot be converted into a capability mutation ([learning-contract.ts:LearningProposal]).
- Every finding field is `readonly`; `evidenceRefs` is a readonly array preserved exactly for auditability ([learning-contract.ts:LearningFinding]).
- Adapters are read-only: `LearningAdapter` exposes only `list(): Promise<ReadonlyArray<T>>` and no write path ([learning-contract.ts:LearningAdapter]).
- `RecommendationRecord.proposalId` is required and non-empty; `confidence` is constrained to 0..1 by contract ([learning-contract.ts:RecommendationRecord]).
- `RecommendationRecord.kind` is a closed six-value union (`APPROVE`, `MONITOR`, `REQUEST_ADDITIONAL_EVIDENCE`, `REJECT`, `ESCALATE`, `RISK_GATED_REVIEW`) ([learning-contract.ts:RecommendationRecord]).
- `ProposalGovernanceRecord.capabilityId` is populated only for `proposal.submitted` and is the empty string for the other four event kinds ([learning-contract.ts:ProposalGovernanceRecord]).
- Measurement outcome is the closed three-value union `effective` / `ineffective` / `inconclusive` ([learning-contract.ts:MeasurementOutcomeRecord]).
- `DEFAULT_LEARNING_ENGINE_OPTIONS` binds `minCardinality` to `DEFAULT_MIN_CARDINALITY` (3) and `evidenceWindowDays` to `DEFAULT_EVIDENCE_WINDOW_DAYS` (30) ([learning-contract.ts:DEFAULT_LEARNING_ENGINE_OPTIONS]).

## Side Effects
- ["None"] — this module exports types and constants only; it performs no reads, writes, network calls, or logging.

## Verification
- Run: `pnpm test`
