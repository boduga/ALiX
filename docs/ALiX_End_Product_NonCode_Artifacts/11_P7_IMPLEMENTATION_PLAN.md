# P7 — Outcome Intelligence Implementation Plan

**Slices:** P7a foundation (Tasks 1–3, 6) ✅. P7b accuracy reporting (Task 4) — active. P7c lens calibration (Task 5) — deferred.

**CLI namespace:** `alix decision outcome record|show|report` — under `decision` for full lifecycle discoverability. P7c adds `lens-calibration`.

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

## Task 3 — Outcome CLI (P7a)

**Namespace:** `alix decision outcome record/show`

Commands:
- `alix decision outcome record <subject-id> --outcome <value> [--recommendation <id>] [--action <taken>] [--json]`
- `alix decision outcome show <subject-id> [--json]`

Acceptance:
- Can record success/failure/neutral/unknown
- `governanceReviewId` is optional (reviews are ephemeral in P6.5b)
- JSON output available
- Terminal renderer available
- `alix decision outcome report [--window N] [--json]` added in P7b

---
## P7b — Active

Task 4 builds on P7a's OutcomeStore to produce recommendation accuracy reports. P7c (lens calibration) still deferred.

---

## Task 4 — RecommendationAccuracyBuilder (P7b)

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