# Decision Calibration

## Overview

Calibration converts journaled decisions and independently recorded outcome
labels into evidence about decision accuracy. It provides label validation and
storage, a labeled dataset builder, reliability metrics for engines with native
scores, an accuracy sweep for threshold-parameter decisions, and versioned
threshold profiles that require both provenance and governance approval before
they can become active.

## Interface

- `OUTCOME_LABELS`, `DecisionOutcomeLabel`, `createOutcomeLabel`, and `isDecisionOutcomeLabel` define and validate the `correct | incorrect | unknown` label contract [labels.ts:OUTCOME_LABELS] [labels.ts:createOutcomeLabel] [labels.ts:isDecisionOutcomeLabel]
- `indexLabelsByDecisionId` groups labels by decision and selects the latest label by `observedAt` [labels.ts:indexLabelsByDecisionId]
- `OutcomeLabelStore` appends and reads labels through `JsonlStore<...>` and exposes `LabelWriteError` for failed writes [label-store.ts:OutcomeLabelStore] [label-store.ts:LabelWriteError]
- `buildCalibrationDataset` joins journal records to labels and reports skip counts; `exportCalibrationDataset` writes a dataset artifact [dataset.ts:buildCalibrationDataset] [dataset.ts:exportCalibrationDataset]
- `CalibrationDataset`, `CalibrationSample`, and `CalibrationSkipReasons` define the dataset and skip-accounting shape [dataset.ts:CalibrationDataset] [dataset.ts:CalibrationSample] [dataset.ts:CalibrationSkipReasons]
- `sweepAccuracy` evaluates `i / bins` thresholds and returns the selected threshold, accuracy, sample count, and points [accuracy-sweep.ts:sweepAccuracy] [accuracy-sweep.ts:AccuracySweepPoint]
- `computeReliability` returns binned evidence plus expected calibration error and Brier score; `hasNativeScore` reports whether a sample has the native score for its kind [reliability.ts:computeReliability] [reliability.ts:hasNativeScore]
- `ReliabilityReport` and `ReliabilityBin` define the report output [reliability.ts:ReliabilityReport] [reliability.ts:ReliabilityBin]
- `createCalibrationProvenance`, `provenanceFromReliability`, `suggestThreshold`, and `deriveThresholdProfile` derive a shadow profile from reliability evidence [profiles.ts:createCalibrationProvenance] [profiles.ts:provenanceFromReliability] [profiles.ts:suggestThreshold] [profiles.ts:deriveThresholdProfile]
- `deriveThresholdProfileFromAccuracySweep` derives a shadow profile from sweep evidence [profiles.ts:deriveThresholdProfileFromAccuracySweep]
- `createProfileRegistry`, `activeProfile`, `promoteProfile`, `rollbackProfile`, `saveProfileRegistry`, and `loadProfileRegistry` manage scoped profile lifecycle and persistence [profiles.ts:createProfileRegistry] [profiles.ts:activeProfile] [profiles.ts:promoteProfile] [profiles.ts:rollbackProfile] [profiles.ts:saveProfileRegistry] [profiles.ts:loadProfileRegistry]

## Invariants

- `unknown` labels are excluded from calibration rather than counted as failures [dataset.ts:buildCalibrationDataset]
- `errorType` is rejected unless the outcome is `incorrect` [labels.ts:createOutcomeLabel]
- A valid persisted label requires a finite `observedAt`; `createOutcomeLabel` defaults it to `Date.now()` when omitted [labels.ts:createOutcomeLabel] [labels.ts:isDecisionOutcomeLabel]
- The latest label for a decision wins when multiple labels exist [labels.ts:indexLabelsByDecisionId]
- Labels are validated before append, and malformed stored lines are counted rather than accepted as labels [label-store.ts:OutcomeLabelStore.append] [label-store.ts:OutcomeLabelStore.readAll]
- Dataset skip reasons are exactly `unlabeled`, `unknownLabel`, `failureOutcome`, and `duplicateDecisionId` [dataset.ts:CalibrationSkipReasons]
- Reliability refuses empty samples, mixed decisions, mixed engines, mixed kinds, invalid bins, out-of-range scores, and a set with no scorable samples [reliability.ts:computeReliability]
- Missing native scores are counted in `excludedUnscored` and are not treated as zero [reliability.ts:computeReliability] [reliability.ts:hasNativeScore]
- Expected calibration error and Brier score are computed only over scorable samples [reliability.ts:computeReliability]
- A sweep grid includes both 0 and 1 at `i / bins`; the first point meeting the target is selected, otherwise the result is threshold 1 measured at 1 [accuracy-sweep.ts:sweepAccuracy]
- The sweep refuses empty cases, non-positive or non-integer bins, and a target outside `(0, 1]` [accuracy-sweep.ts:sweepAccuracy]
- A derived threshold profile is `shadow`, and written provenance records metric `accuracy` [profiles.ts:deriveThresholdProfile] [profiles.ts:deriveThresholdProfileFromAccuracySweep]
- A profile's threshold must remain within `0..1`; an active profile must have provenance [profiles.ts:assertValidProfile]
- Promotion requires affirmative approval and provenance, and retires only an incumbent of the same exact decision, engine, and risk scope [profiles.ts:promoteProfile]
- `activeProfile` never selects a shadow profile, prefers an exact risk match, and permits an all-risk profile only as the fallback [profiles.ts:activeProfile]
- Rollback requires an active profile and restores the most recently retired profile of the same exact scope [profiles.ts:rollbackProfile]
- Profile ids are unique within a registry [profiles.ts:createProfileRegistry]
- A missing registry file loads as an empty registry, while an invalid registry throws [profiles.ts:loadProfileRegistry]

## Side Effects

- `OutcomeLabelStore.append` appends label records to `labels.jsonl` and wraps write failures in `LabelWriteError` [label-store.ts:OutcomeLabelStore.append]
- `exportCalibrationDataset` optionally creates the output parent directory and writes the dataset as JSON [dataset.ts:exportCalibrationDataset]
- `saveProfileRegistry` validates every profile and atomically writes the registry JSON [profiles.ts:saveProfileRegistry]
- `loadProfileRegistry` reads the registry JSON from disk [profiles.ts:loadProfileRegistry]

## Verification

- Run: `pnpm test`
