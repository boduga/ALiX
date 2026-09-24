# DOX — Calibration (J4)

**Purpose:** Turn journaled decisions into calibration evidence. Labels supply ground truth, the dataset joins them to observations, reliability scores the native result; an accuracy sweep measures threshold accuracy for engines that have no native score to bin. Evidence only — nothing here changes decision behavior or grants authority.

**Ownership:**
- `labels.ts` — `DecisionOutcomeLabel` (`correct|incorrect|unknown`) with an optional `errorType` (`false_positive|false_negative|other`, only on `incorrect`), `createOutcomeLabel` validator, `isDecisionOutcomeLabel` structural guard, `indexLabelsByDecisionId` (latest wins).
- `label-store.ts` — append-only `labels.jsonl` built on the shared `JsonlStore` primitive; validates before persisting, counts malformed lines (storage contract), explicit write errors.
- `dataset.ts` — `buildCalibrationDataset(records, labels, filters)` joining journal × labels, `exportCalibrationDataset(stores, { outPath })` for a portable artifact; counts every skip (`unlabeled`/`unknownLabel`/`failureOutcome`/`duplicateDecisionId`).
- `reliability.ts` — `computeReliability(samples, { bins })`: binned accuracy vs mean score, ECE, Brier; `hasNativeScore(sample)` — whether the sample carries its kind's native score (never treats missing as 0).
- `accuracy-sweep.ts` — `sweepAccuracy(cases, { targetAccuracy, bins? })`: decision-neutral threshold grid (`i/bins`, inclusive of 0 and 1) over cases whose `verdictAt(threshold)` is re-evaluated per point; selects the lowest point meeting the target, else the fully-closed threshold (1) with the accuracy measured at 1. Refuses empty cases, non-positive-integer `bins`, and a target outside (0, 1]. Must not import any decision folder (a back-edge would cycle).
- `profiles.ts` — versioned `ThresholdProfile` registry (decision/engine/optional risk), `CalibrationProvenance`, `suggestThreshold`/`deriveThresholdProfile` (reliability path) and `deriveThresholdProfileFromAccuracySweep` (sweep path — structural sweep input, no accuracy-sweep import), `promoteProfile` (approval- + provenance-gated)/`rollbackProfile`, `provenanceFromReliability`, atomic JSON persistence.
- `index.ts` — barrel.

**Local Contracts:**
- A label is ground truth recorded after the fact; it is never inferred from the engine's own output.
- Labels live in their own store, so the journal stays an observation record and calibration evidence stays attributable and revocable.
- **Risk context is not a label.** It is captured at decision time on the journal record (`DecisionJournalRecord.risk`) and flows into samples from there — a per-risk threshold profile cannot be reconstructed from an optional, revisable, possibly-absent label.
- `unknown` means "not judged" and is excluded, never counted as incorrect.
- The reliability metric follows the native primitive: `noul` → probability, `score` → the rubric score, `choice` → confidence. A report refuses to mix kinds.
- Reliability refuses invalid semantics rather than guessing: empty samples, mixed kinds, and cross-engine or cross-decision sets all throw (`CalibrationValidationError`). Cross-engine refusal is the JEV-9 "calibration is not transferable" rule.
- Samples with no native score for their kind are counted in `excludedUnscored`, never treated as 0.
- **Accuracy sweep vs reliability.** When an engine's samples carry no native score at all, `computeReliability` still refuses — the sweep is the alternate derive path, not a relaxation of reliability. The sweep's fully-closed fallback returns threshold 1 with the accuracy measured at 1 (not `suggestThreshold`'s fabricated 0): every sweep point is a real measurement. Sweep provenance records metric `accuracy`; promotion stays approval-gated identically.
- **Simplex assumption:** probabilities are treated as a proper simplex over ONE question. The vendor guarantees no structural invariant across complementary questions (its own example sums P and 1-P to 1.19), so this is only sound because each ALiX decision asks exactly one question per call. Do not reuse for a multi-question payload.
- Store I/O is async and built on `src/storage/jsonl-store.ts` (#712) — no bespoke JSONL parsing.
- **Thresholds are versioned, never edited.** A new value is a new profile id (`…/v2`); the old profile is retired, not mutated.
- **Promotion requires provenance AND governance.** `promoteProfile` refuses a profile with no `CalibrationProvenance` and one without an affirmative `approved` flag — promotion changes behavior (arch §10), so it goes through normal governance. The approver is recorded on `approvedBy`. Rollback restores a known-good state and needs no approval (fail-safe), but it is a decision like any other and is logged by its caller.
- **No automation without a calibrated threshold.** An uncalibrated profile is seeded `shadow`; `activeProfile` never returns a shadow profile, so a decision cannot gate on a number nobody measured.
- **Scope rules.** An all-risk profile (no `risk`) covers every risk context; a risk-specific profile covers only its own and is never borrowed for another (or an absent) risk. Promotion retires the incumbent of the exact same scope only.
- **Rollback** restores the most recently retired profile of the same exact scope; it fails closed when nothing is active or nothing is retired.
- Profiles persist as atomic JSON (`saveProfileRegistry`/`loadProfileRegistry`); a missing file is an empty registry, an invalid one throws.

**Work Guidance:**
- Label a decision by its `decisionId`; re-labelling is allowed and the latest `observedAt` wins.
- Calibrate one engine at a time — a report spanning engines is a bug, not a bigger dataset.
- Scored engine: compute reliability → `suggestThreshold` (lowest threshold meeting the target accuracy, else fully closed) → `deriveThresholdProfile` (report → versioned, provenance-bearing profile) → approved `promoteProfile`.
- Scoreless engine with a threshold-parameter decision: `sweepAccuracy` over a labeled case set → `deriveThresholdProfileFromAccuracySweep` → approved `promoteProfile`. Do not tune by eye.

**Verification:**
- `tests/decision/calibration.test.ts` — label validation/errorType/structural guard/latest-wins, store round-trip/validation/malformed-counting/I-O failure, dataset join + skip accounting + filters + export artifact, reliability bins/ECE/Brier/overconfidence/per-kind metrics/exclusions and the refusal cases, accuracy-sweep selection/fallback/bins/refusals, `hasNativeScore` per-kind.
- `tests/decision/threshold-profiles.test.ts` — provenance validation/derivation, registry validation, scope resolution (risk precedence, shadow never selected), promotion/rollback, persistence, accuracy-sweep profile derivation (shadow + accuracy provenance + threshold bound), and the "no automation without a calibrated threshold" gate.

**Child DOX Index:** none.
