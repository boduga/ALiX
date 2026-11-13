# Verification Confidence Calculator

## Overview
Computes the overall confidence profile for an evolution verification projection from replay fidelity, coverage, determinism, and historical similarity. Confidence here is epistemic trust in the projection, not the probability that a proposal succeeds.

## Interface
- `ConfidenceInput` — the four normalized input dimensions (`replayFidelity`, `coverage`, `determinism`, `historicalSimilarity`) [confidence-calculator.ts:ConfidenceInput].
- `computeOverallConfidence(input)` — returns a fully populated `ConfidenceProfile` [confidence-calculator.ts:computeOverallConfidence].
- `computeOverallSimilarity(assessment)` — derives an overall similarity from the individual comparison dimensions [confidence-calculator.ts:computeOverallSimilarity].
- Consumes `ConfidenceProfile` and `HistoricalSimilarityAssessment` from the parent verification contracts [../contracts/confidence-contract.ts:ConfidenceProfile].

## Invariants
- Overall confidence is non-compensatory: `min(replayFidelity, coverage, determinism) × historicalSimilarity`; a low score in any of the first three cannot be offset by the others [confidence-calculator.ts:computeOverallConfidence].
- Every input is clamped to `[0, 1]`; non-finite values are treated as `0` [confidence-calculator.ts:computeOverallConfidence].
- Similarity is the mean of comparable dimensions only; a dimension named by a matching `coverageGaps` prefix is excluded [confidence-calculator.ts:GAP_TO_FIELD].
- If no dimension remains comparable, `computeOverallSimilarity` returns `0` rather than a neutral or default score [confidence-calculator.ts:computeOverallSimilarity].
- Non-finite or out-of-range similarity dimensions are filtered out before averaging [confidence-calculator.ts:computeOverallSimilarity].

## Side Effects
- ["None"] — both functions are pure and perform no I/O, store access, or mutation [confidence-calculator.ts:computeOverallConfidence].

## Verification
- Run: `pnpm test`
