# DOX — Calibration (J4)

**Purpose:** Turn journaled decisions into calibration evidence. Labels supply ground truth, the dataset joins them to observations, reliability scores the native score. Evidence only — nothing here changes decision behavior or grants authority.

**Ownership:**
- `labels.ts` — `DecisionOutcomeLabel` (`correct|incorrect|unknown`), `RiskContext` (`low|medium|high`), `createOutcomeLabel` validator, `indexLabelsByDecisionId` (latest wins).
- `label-store.ts` — append-only JSONL `labels.jsonl`; validates before persisting and re-validates on read; explicit write/read errors.
- `dataset.ts` — `buildCalibrationDataset(records, labels, filters)` joining journal × labels; counts every skip (`unlabeled`/`unknownLabel`/`failureOutcome`/`duplicateDecisionId`).
- `reliability.ts` — `computeReliability(samples, { bins })`: binned accuracy vs mean score, ECE, Brier.
- `index.ts` — barrel.

**Local Contracts:**
- A label is ground truth recorded after the fact; it is never inferred from the engine's own output.
- Labels live in their own store, so the journal stays an observation record and calibration evidence stays attributable and revocable.
- `unknown` means "not judged" and is excluded, never counted as incorrect.
- Reliability refuses invalid semantics rather than guessing: empty samples, mixed probability/confidence metrics, and cross-engine or cross-decision sets all throw (`CalibrationError`). Cross-engine refusal is the JEV-9 "calibration is not transferable" rule.
- Samples with no native score are counted in `excludedUnscored`, never treated as 0.
- `metric` is `probability` for Noul samples and `confidence` for Choice/Score samples.

**Work Guidance:**
- Label a decision by its `decisionId`; re-labelling is allowed and the latest `observedAt` wins.
- Calibrate one engine at a time — a report spanning engines is a bug, not a bigger dataset.
- Threshold changes must cite a dataset and metric (J4b); do not tune by eye.

**Verification:**
- `tests/decision/calibration.test.ts` — label validation/latest-wins, store round-trip/validation/corrupt-line/I-O failure, dataset join + skip accounting + filters, reliability bins/ECE/Brier/overconfidence/exclusions and the refusal cases.

**Child DOX Index:** none.
