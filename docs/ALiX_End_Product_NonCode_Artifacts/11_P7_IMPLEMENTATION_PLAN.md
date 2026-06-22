# P7 — Outcome Intelligence Implementation Plan

**Slice:** P7a foundation (Tasks 1–3, 6). P7b accuracy reporting (Task 4) and P7c lens calibration (Task 5) deferred.

**CLI namespace:** `alix decision outcome record/show` — under the decision pipeline for full lifecycle discoverability.

**Key invariant:** Outcome ≠ Recommendation. P7 records what happened; it does not mutate recommendations, governance reviews, or trigger actions.

**Note on `governanceReviewId`:** Keep optional. P6.5b reviews are ephemeral. Primary link is `recommendationId`.

---
## Task 1 — Outcome Types

Create:
- OutcomeRecord
- OutcomeEvidence
- OutcomeClassification
- RecommendationAccuracyReport
- LensCalibrationReport

Acceptance:
- Type tests pass
- DecisionArtifact compatibility preserved

## Task 2 — Outcome Store

Create append-only OutcomeStore.

Operations:
- append
- list
- get
- query by subject
- query by window

Acceptance:
- No update-in-place
- No delete by default
- Evidence references preserved

## Task 3 — Outcome CLI

Commands:
- alix outcome record
- alix outcome show
- alix outcome report

Acceptance:
- Can record success/failure/neutral/unknown
- JSON output available
- Terminal renderer available

---
## P7b — Deferred

The following tasks build on P7a's OutcomeStore to produce analytical reports. Deferred until P7a is validated.

---

## Task 4 — Recommendation Accuracy Builder (P7b)

Inputs:
- recommendations
- outcomes
- governance reviews

Outputs:
- RecommendationAccuracyReport

Acceptance:
- Precision computed
- Failure rate computed
- Unknowns excluded from accuracy denominator but reported


---
## P7c — Deferred

Lens calibration requires P7b's accuracy data plus P6.5b's lens scores. Deferred.

---

## Task 5 — Lens Calibration Builder (P7c)

Inputs:
- governance lens scores
- outcomes

Outputs:
- LensCalibrationReport

Acceptance:
- Each lens gets predictive score
- False positives reported
- Missed failures reported

## Task 6 — Sentinels

Sentinels:
- P7 cannot mutate recommendations
- P7 cannot mutate governance reviews
- P7 cannot trigger actions
- Outcome records are append-only

## Task 7 — Release Gate

Must pass:
- Unit tests
- Store tests
- CLI tests
- Sentinel tests
- Backward compatibility checks

> **P7a gate:** Tasks 1–3 (types, store, CLI) and Task 6 (sentinels) must pass. Tasks 4–5 are deferred and their tests are not required for P7a.