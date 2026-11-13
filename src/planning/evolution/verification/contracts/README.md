# Evolution Verification Contracts (A2)

## Overview

Pure type-and-validator module set for the A2 Evolution Verification Framework.
It defines the three distinct verification artifacts (Run, Report, Evidence), the
evidence-class hierarchy, reproducibility levels, the confidence model, the
counterfactual evaluation shape, the replay dataset, the environment snapshot,
and the governance recommendation vocabulary. Every module here is contract-only:
the module header of `verification-contract.ts` states it carries "no stores, no
state machine, no CLI", and A2 artifact types are independent of A0 evolution
lifecycle types [verification-contract.ts:VerificationRun].

## Interface

- `EvidenceClass` (`observed` | `derived` | `projected` | `executed`) plus `VALID_EVIDENCE_CLASSES` [verification-contract.ts:EvidenceClass]
- `VerificationStatus`, `VERIFICATION_TERMINAL_STATUSES`, `VERIFICATION_ALL_STATUSES`, `isValidVerificationStatus` [verification-contract.ts:VerificationStatus]
- `VerificationFailureKind`, `VERIFICATION_FAILURE_KINDS`, `isValidVerificationFailureKind` — ten distinct failure modes [verification-contract.ts:VerificationFailureKind]
- `ReproducibilityLevel` (0–3) and `isValidReproducibilityLevel` [verification-contract.ts:ReproducibilityLevel]
- `VerificationRun`, `VerificationReport`, `MetricResult`, `LineageRecord`, `VerificationEvidence` [verification-contract.ts:VerificationEvidence]
- `validateVerificationRun`, `validateVerificationReport`, `validateVerificationEvidence` [verification-contract.ts:validateVerificationRun]
- `ConfidenceProfile`, `HistoricalSimilarityAssessment`, `validateConfidenceProfile`, `validateHistoricalSimilarityAssessment` [confidence-contract.ts:ConfidenceProfile]
- `OutcomeClassification`, `OUTCOME_CLASSIFICATIONS`, `MetricDirection`, `CounterfactualMetricEvaluation`, `CounterfactualEvaluation`, `validateCounterfactualMetricEvaluation` [counterfactual-contract.ts:CounterfactualEvaluation]
- `ReplayDataset`, `HistoricalWindow`, `EvidenceSource`, `PolicySnapshot`, `TopologySnapshot`, `TelemetrySnapshot`, `AgentConfigurationSnapshot`, `ConstructionStrategy`, `ConstructionMetadata`, `computeDatasetHash`, `validateReplayDataset`, `validateHistoricalWindow` [replay-contract.ts:ReplayDataset]
- `VerificationEnvironment`, `validateVerificationEnvironment` [environment-contract.ts:VerificationEnvironment]
- `GovernanceRecommendationKind`, `GOVERNANCE_RECOMMENDATION_KINDS`, `GovernanceRecommendation`, `isValidGovernanceRecommendationKind`, `validateGovernanceRecommendation` [recommendation-contract.ts:GovernanceRecommendation]

## Invariants

- Evidence-class precedence is downstream law: consumers must respect `observed > derived > projected > executed`, and projected evidence must not override observed evidence for the same metric [verification-contract.ts:EvidenceClass].
- A2-generated reports and evidence are always `evidenceClass: "projected"`; both validators reject any other class [verification-contract.ts:validateVerificationReport].
- Verification failures always carry a typed kind; the taxonomy must never be collapsed into a generic failure string [verification-contract.ts:VerificationFailureKind].
- A verification run's lifecycle is `pending → running → completed | failed | cancelled`, distinct from the A0 proposal lifecycle [verification-contract.ts:VerificationStatus].
- `overallConfidence = min(replayFidelity, coverage, determinism) × historicalSimilarity`: non-compensatory, and every numeric field stays in `[0, 1]` [confidence-contract.ts:ConfidenceProfile].
- `computeDatasetHash` is deterministic and excludes `datasetHash` from its own input so the hash never includes itself [replay-contract.ts:computeDatasetHash].
- A `ReplayDataset` is first-class and immutable and is referenced by ID/hash, never embedded in verification results [replay-contract.ts:ReplayDataset].
- Counterfactual classification is policy-independent: A2 determines what changed, A3 decides whether that is acceptable [counterfactual-contract.ts:OutcomeClassification].
- Recommendations are advisory only — governance (A3) owns the decision — yet each must carry numeric confidence, reference its source evidence, and be deterministic for the same evidence plus config [recommendation-contract.ts:GovernanceRecommendation].
- `confidenceProfile` is part of the evidence artifact, and `statisticalConfidence` is validated to `[0, 1]` [counterfactual-contract.ts:validateCounterfactualMetricEvaluation].
- All validators return `ValidationResult` and are pure — no store access or I/O in any rejection path [verification-contract.ts:validateVerificationEvidence].

## Side Effects

- ["None"] These modules only declare types, constants, and pure validators; `computeDatasetHash` performs an in-memory SHA-256 over `canonicalStringify` output and writes nothing [replay-contract.ts:computeDatasetHash].
- No filesystem, network, clock, or store access appears in any exported function; each validator is documented as "Pure — no side effects, no I/O, no store access" [confidence-contract.ts:validateConfidenceProfile].

## Verification

- Run: `pnpm test`
