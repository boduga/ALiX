# Verification Evaluation

## Overview
Pure evaluation primitives for replay-based verification. `counterfactual-evaluator.ts` compares baseline and candidate metric sets and classifies each metric as improved, regressed, neutral, or insufficient without deciding policy acceptability. `historical-similarity.ts` scores seven dimensions between a historical replay dataset and current production conditions, records coverage gaps, and delegates the overall score to `computeOverallSimilarity`.

## Interface
- `CounterfactualEvaluatorConfig` configures significance, minimum confidence, per-metric directions, and per-metric thresholds `[counterfactual-evaluator.ts:CounterfactualEvaluatorConfig]`.
- `DEFAULT_COUNTERFACTUAL_CONFIG` sets `significanceThreshold` to `0.05` and `minimumConfidence` to `0.3` `[counterfactual-evaluator.ts:DEFAULT_COUNTERFACTUAL_CONFIG]`.
- `CounterfactualEvaluator.evaluate(baselineMetrics, candidateMetrics, confidenceProfile)` returns a `CounterfactualEvaluation` with copied metrics, deltas, behavioral changes, classifications, and the supplied confidence profile `[counterfactual-evaluator.ts:CounterfactualEvaluator.evaluate]`.
- `CounterfactualEvaluator.classifyMetric(baselineValue, candidateValue, threshold, direction, statisticalConfidence)` classifies one metric `[counterfactual-evaluator.ts:CounterfactualEvaluator.classifyMetric]`.
- `HistoricalSimilarityInput` pairs a `historicalSnapshot` and `currentSnapshot` `[historical-similarity.ts:HistoricalSimilarityInput]`.
- `computeHistoricalSimilarity(input)` returns a `HistoricalSimilarityAssessment` with workload, topology, policy, resource, agent-composition, traffic, and failure-pattern similarities plus `overallSimilarity` and `coverageGaps` `[historical-similarity.ts:computeHistoricalSimilarity]`.
- No child contract directories exist.

## Invariants
- `evaluate()` classifies every key in the union of baseline and candidate metric names `[counterfactual-evaluator.ts:CounterfactualEvaluator.evaluate]`.
- A metric present on only one side is recorded with delta `0`, confidence `0`, direction from configuration, and classification `insufficient` `[counterfactual-evaluator.ts:CounterfactualEvaluator.evaluate]`.
- Non-finite confidence or confidence below `minimumConfidence` yields `insufficient` regardless of delta magnitude `[counterfactual-evaluator.ts:CounterfactualEvaluator.classifyMetric]`.
- A zero baseline with a zero candidate is `neutral`; a nonzero candidate is classified by direction as `improvement` or `regression` `[counterfactual-evaluator.ts:CounterfactualEvaluator.classifyMetric]`.
- Relative change below the threshold is `neutral`; at or above it, direction determines `improvement` versus `regression` `[counterfactual-evaluator.ts:CounterfactualEvaluator.classifyMetric]`.
- An omitted metric direction defaults to `higher_is_better` `[counterfactual-evaluator.ts:CounterfactualEvaluator.getDirection]`.
- A metric threshold override is used only when finite and non-negative; otherwise the global significance threshold applies `[counterfactual-evaluator.ts:CounterfactualEvaluator.getThreshold]`.
- Every similarity dimension is produced through a comparator that clamps its result to the inclusive range `[0,1]` `[historical-similarity.ts:compareEvidenceProfiles]` `[historical-similarity.ts:compareTopologies]` `[historical-similarity.ts:compareTelemetry]` `[historical-similarity.ts:compareAgentConfigs]` `[historical-similarity.ts:compareFailurePatterns]`.
- `overallSimilarity` is computed by `computeOverallSimilarity(assessment)`, not by local weighting `[historical-similarity.ts:computeHistoricalSimilarity]`.
- Missing evidence counts or a zero side on a comparable dimension produce zero similarity and a named `coverageGaps` entry where the comparator defines one `[historical-similarity.ts:compareEvidenceProfiles]` `[historical-similarity.ts:compareFailurePatterns]`.
- Runtime-version, policy-version, metric, agent, and strategy mismatches are recorded in `coverageGaps` `[historical-similarity.ts:compareTopologies]` `[historical-similarity.ts:comparePolicies]` `[historical-similarity.ts:compareTelemetry]` `[historical-similarity.ts:compareAgentConfigs]` `[historical-similarity.ts:compareConstructionStrategies]`.

## Side Effects
- ["None"]

## Verification
- Run: `pnpm test`
