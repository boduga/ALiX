# Verification Recommendation Engine (A2.5)

## Overview

Turns A2 `VerificationEvidence` into advisory `GovernanceRecommendation`
artifacts. The engine's module header fixes its boundary: it must not transition
`EvolutionState`, invoke deployment, or bypass A3 validation — governance owns
the decision and this module only produces inputs
[recommendation-engine.ts:RecommendationEngine].

## Interface

- `RecommendationConfig` and `DEFAULT_RECOMMENDATION_CONFIG` — approve 0.8, monitor 0.5, insufficient 0.3, insufficient metric fraction 0.5 [recommendation-engine.ts:RecommendationConfig]
- `RecommendationEngine` with `generate(evidence, metricsByClassification?)` [recommendation-engine.ts:RecommendationEngine]
- `RecommendationStore` — append-only JSONL at `.alix/verification/recommendations.jsonl` [recommendation-store.ts:RecommendationStore]
- `recommendationContentOf(rec)` — canonical content minus `recommendationId` [recommendation-store.ts:recommendationContentOf]
- Consumes `VerificationEvidence` / `GovernanceRecommendation` from `../contracts/` [../contracts/recommendation-contract.ts:GovernanceRecommendation]

## Invariants

- Advisory only: the engine never transitions state, never invokes deployment, and never bypasses A3 validation [recommendation-engine.ts:RecommendationEngine].
- Deterministic classification: same evidence plus same config produces the same recommendation kind [recommendation-engine.ts:RecommendationEngine].
- Ordered decision ladder — insufficient confidence, then insufficient metric fraction, then regression-with-low-confidence `REJECT`, then `APPROVE` (zero regressions at/above the approve threshold), then `MONITOR`, else `ESCALATE` [recommendation-engine.ts:RecommendationEngine].
- Every recommendation carries numeric `confidence` copied from `evidence.confidenceProfile.overallConfidence`, references its `evidenceId`, and is stamped with `evidence.verifiedAt`; no recommendation exists without supporting evidence [recommendation-engine.ts:RecommendationEngine].
- Supporting evidence is always the evidence id plus one `sourceType:sourceId` reference per lineage record [recommendation-engine.ts:RecommendationEngine].
- When classification counts are omitted, regressions are inferred from behavioral-change text matching `" regression: "` [../shared.ts:inferRegressionsFromChanges].
- The store is append-only: stored records are never modified or deleted, an identical-content duplicate append is a no-op, and a same-id different-content append is a fatal identity collision [recommendation-store.ts:RecommendationStore].
- Persistence failure must surface to the caller rather than yielding a silent empty surface [recommendation-store.ts:RecommendationStore].
- This is a dedicated A2.5 path, deliberately distinct from the P9.x `GovernanceStore` recommendations file [recommendation-store.ts:RecommendationStore].

## Side Effects

- `RecommendationEngine.generate` is pure — it performs no I/O and writes nothing [recommendation-engine.ts:RecommendationEngine].
- `RecommendationStore` appends JSONL to `.alix/verification/recommendations.jsonl` under the supplied or `process.cwd()` store directory; the pure engine itself never persists [recommendation-store.ts:RecommendationStore].
- Writing happens at the composition root where the engine output is consumed, not inside the engine [recommendation-store.ts:RecommendationStore].

## Verification

- Run: `pnpm test`
