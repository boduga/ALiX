# Evolution Core Contracts

## Overview
Pure vocabulary, validation boundaries, and lineage rules for the A-series evolution pipeline: evolution state and targets, intents, proposals, reviews, approvals, implementations, validations, activations, plus pattern-discovery observations and confidence scoring. These modules are contract-only — no stores, no state machine, no CLI — and evolution references evidence through `EvidenceReference` rather than redefining evidence transport.

## Interface
- `EvolutionState`, `EVOLUTION_TERMINAL_STATES`, `EVOLUTION_ALL_STATES` — the eleven-state evolution lifecycle [evolution-contract.ts:EvolutionState].
- `EvolutionOrigin`, `VALID_EVOLUTION_ORIGINS`, `EvolutionTargetKind`, `VALID_EVOLUTION_TARGET_KINDS`, `EvolutionTarget`, `validateEvolutionTarget` [evolution-contract.ts:validateEvolutionTarget].
- `EvolutionRiskClass`, `VALID_EVOLUTION_RISK_CLASSES`, `EvidenceReference`, `EvolutionConstraint`, `EvolutionIntent` [evolution-contract.ts:EvolutionIntent].
- `EvolutionProposal`, `EvolutionReview`, `EvolutionApproval`, `EvolutionImplementation`, `EvolutionValidation`, `EvolutionActivation` [evolution-contract.ts:EvolutionProposal].
- Per-artifact validators: `validateEvolutionIntent`, `validateEvolutionProposal`, `validateEvolutionReview`, `validateEvolutionApproval`, `validateEvolutionImplementation`, `validateEvolutionValidation`, `validateEvolutionActivation` [evolution-contract.ts:validateEvolutionProposal].
- `EvolutionArtifactSet`, `validateEvolutionLineage(artifacts)` — cross-artifact lineage check [evolution-contract.ts:validateEvolutionLineage].
- `sortReviews(reviews)`, `sortProposals(proposals)` — deterministic ordering helpers [evolution-contract.ts:sortReviews].
- `ValidationResult` — the shared `{ valid, errors }` result type [evolution-contract.ts:ValidationResult].
- `PatternCategory`, `VALID_PATTERN_CATEGORIES`, `PatternObservation`, `EvolutionCandidate`, `EvolutionProposalDraft`, `DiscoveryResult` [pattern-discovery-contract.ts:PatternObservation].
- `ConfidenceInput`, `computeConfidence(input)` plus `validatePatternObservation`, `validateEvolutionCandidate`, `validateEvolutionProposalDraft` [pattern-discovery-contract.ts:computeConfidence].
- `DiscoveryContext` — immutable run-scoped evidence and governance event view shared by all detection strategies [discovery-context.ts:DiscoveryContext].

## Invariants
- Terminal evolution states are `ACTIVE`, `REJECTED`, `WITHDRAWN`, and `ROLLED_BACK`; `EVOLUTION_ALL_STATES` enumerates all eleven states exactly [evolution-contract.ts:EVOLUTION_TERMINAL_STATES].
- `validateEvolutionTarget` requires a valid `kind` and non-empty `id` [evolution-contract.ts:validateEvolutionTarget].
- A capability target with a present `version` must be full SemVer `MAJOR.MINOR.PATCH`; ranges (`^`, `~`, `>=`, `*`) and malformed versions are rejected rather than normalized [evolution-contract.ts:validateEvolutionTarget].
- Non-capability target kinds ignore `version` entirely [evolution-contract.ts:EvolutionTarget].
- `validateEvolutionLineage` requires every present artifact's `evolutionId` to equal the intent's; if no intent is supplied, any other present artifact is an error [evolution-contract.ts:validateEvolutionLineage].
- `sortReviews` and `sortProposals` sort by `createdAt` ascending, breaking ties by ID ascending, and return new arrays without mutating the input [evolution-contract.ts:sortProposals].
- `computeConfidence` returns `min(1, evidenceDensity × patternStrength × recencyFactor)` with `evidenceDensity = min(1, evidenceCount / baselineCount)`; a zero baseline yields density 0 instead of dividing by zero [pattern-discovery-contract.ts:computeConfidence].
- `computeConfidence` clamps inputs: counts floor at 0, strength and recency clamp to `[0, 1]`, and non-finite values become 0 [pattern-discovery-contract.ts:computeConfidence].
- Confidence is informational only; governance determines acceptance [pattern-discovery-contract.ts:computeConfidence].
- `PatternCategory` is the closed set `execution_failure`, `approval_friction`, `performance_degradation`, `policy_ineffectiveness`, `governance_gap`, `agent_misbehavior` [pattern-discovery-contract.ts:VALID_PATTERN_CATEGORIES].
- `DiscoveryContext` fields are `readonly` and must not be mutated during a discovery run [discovery-context.ts:DiscoveryContext].
- All validators are pure and return `ValidationResult`; they never throw for malformed shapes [evolution-contract.ts:ValidationResult].

## Side Effects
- ["None"] — contract types, pure validators, and pure sort/scoring helpers with no I/O or store access [evolution-contract.ts:validateEvolutionLineage].

## Verification
- Run: `pnpm test`
