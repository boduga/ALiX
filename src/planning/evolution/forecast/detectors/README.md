# Forecast Detectors

## Overview
Deterministic A9 risk detectors that convert proposal evidence into sorted `DetectorFinding` records. Each detector is a pure function over records supplied by the forecast adapters; clock-sensitive detectors receive `now` explicitly.

## Interface
- `detectTrustVelocity(records)` and exported kind, weights, trigger, and default confidence for submitted-proposal risk [trust-velocity-detector.ts:detectTrustVelocity]
- `detectEvidenceCompleteness(records, now)` and exported kind, weights, trigger, and confidence base for sparse, stale, or single-source evidence [evidence-completeness-detector.ts:detectEvidenceCompleteness]
- `detectFingerprintCoincidence(records, now)`, `normalizeFingerprint(error)`, and exported kind, minimum occurrences, weights, and trigger [fingerprint-coincidence-detector.ts:detectFingerprintCoincidence]

## Invariants
- Trust velocity scores only `proposal.submitted` records, derives its base from `low`/`medium`/`high` risk classes, applies consolidation, patch, and redefinition bonuses, clamps to 1, and emits only at or above `0.3` [trust-velocity-detector.ts:TRUST_VELOCITY_WEIGHTS]
- Evidence completeness treats missing enriched fields, age beyond the 30-day window, and fewer than three evidence fingerprints as risk; findings require an incompleteness score of at least `0.4` [evidence-completeness-detector.ts:EVIDENCE_COMPLETENESS_WEIGHTS]
- Fingerprint coincidence normalizes errors by trim and lowercase, groups by normalized error plus capability, excludes future-dated failures, requires at least two occurrences, and uses the latest member as the finding subject [fingerprint-coincidence-detector.ts:detectFingerprintCoincidence]
- Every detector returns findings sorted by subject and then kind and clamps scores and confidence into `[0, 1]` [trust-velocity-detector.ts:detectTrustVelocity]

## Side Effects
- None; detectors perform no I/O, clock access, or configuration mutation [trust-velocity-detector.ts:detectTrustVelocity]

## Verification
- Run: `pnpm test`
