# Learning Pattern Detectors

## Overview
Pure detectors that turn normalized measurement and governance records into deterministic learning findings: underperforming capabilities, operator contradictions of binary recommendations, and repeated execution failures sharing a fingerprint.

## Interface
- `detectUnderperformer(records, options, now)` — groups ineffective measurement outcomes by capability inside the evidence window `[underperformer-detector.ts:detectUnderperformer]`.
- `UNDERPERFORMER_DETECTOR_KIND` — the `underperformer` finding-kind constant `[underperformer-detector.ts:UNDERPERFORMER_DETECTOR_KIND]`.
- `detectOutcomeContradictions(proposalRecs, recommendationRecs, options, now)` — joins proposals to recommendations by `proposalId` and counts binary disposition contradictions per capability `[outcome-contradiction-detector.ts:detectOutcomeContradictions]`.
- `OUTCOME_CONTRADICTION_DETECTOR_KIND` — the `outcome-contradiction` finding-kind constant `[outcome-contradiction-detector.ts:OUTCOME_CONTRADICTION_DETECTOR_KIND]`.
- `detectRepeatedPatternFailures(records, options, now)` — groups `proposal.execution_failed` records by an error-plus-capability fingerprint `[repeated-pattern-failure-detector.ts:detectRepeatedPatternFailures]`.
- `REPEATED_PATTERN_FAILURE_DETECTOR_KIND` — the `repeated-pattern-failure` finding-kind constant `[repeated-pattern-failure-detector.ts:REPEATED_PATTERN_FAILURE_DETECTOR_KIND]`.

## Invariants
- Every detector is pure and deterministic: identical inputs and options produce findings sorted by `identityKey` `[underperformer-detector.ts:detectUnderperformer]` `[outcome-contradiction-detector.ts:detectOutcomeContradictions]` `[repeated-pattern-failure-detector.ts:detectRepeatedPatternFailures]`.
- Evidence is bounded by `options.evidenceWindowDays`, and a finding is emitted only when occurrences reach `options.minCardinality` in all three detectors `[underperformer-detector.ts:detectUnderperformer]` `[outcome-contradiction-detector.ts:detectOutcomeContradictions]` `[repeated-pattern-failure-detector.ts:detectRepeatedPatternFailures]`.
- Underperformer detection counts only records whose outcome is exactly `ineffective` `[underperformer-detector.ts:detectUnderperformer]`.
- Outcome contradictions require an approved/rejected proposal with a matching binary `APPROVE` or `REJECT` recommendation; missing recommendations and non-binary recommendation kinds are skipped `[outcome-contradiction-detector.ts:detectOutcomeContradictions]`.
- When one `proposalId` has multiple recommendations, the last recommendation wins as the latest advisory `[outcome-contradiction-detector.ts:detectOutcomeContradictions]`.
- The repeated-failure capability index is built from submitted events across all records, not window-filtered; the evidence window gates failures only, because submitted events provide identity rather than evidence `[repeated-pattern-failure-detector.ts:detectRepeatedPatternFailures]`.
- Failure fingerprints use `${error ?? "unspecified"}:${capabilityId}`, preferring a capability id already on the record and otherwise joining through the submitted event `[repeated-pattern-failure-detector.ts:fingerprintOf]`.
- These are organizational pattern signals, not scores or blame for individual governance decisions `[outcome-contradiction-detector.ts:detectOutcomeContradictions]` `[repeated-pattern-failure-detector.ts:detectRepeatedPatternFailures]`.

## Side Effects
- None. All three detectors only transform in-memory records.

## Verification
- Run: `pnpm test`
