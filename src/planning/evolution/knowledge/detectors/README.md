# Knowledge Curation Detectors

## Overview
Pure, non-mutating detectors for A6 knowledge curation. Each detector takes the normalized read model (`KnowledgeArtifact[]`) plus a `CurationConfig` where applicable, and returns `CurationFinding[]`. They perform no I/O and hold no store access; `CurationEngine` combines their output into a proposal for A3 governance.

## Interface
- Barrel re-exports all detectors and shared helpers [index.ts]
- `detectStale(artifacts, config)` with reason codes `age`, `superseded`, and `outcome_contradiction` [staleness-detector.ts:detectStale]
- `detectDuplicates(artifacts, config)` with reason codes `exact` and `near` [dedup-detector.ts:detectDuplicates]
- `detectContradictions(artifacts)` with reason codes `value_clash` and `outcome_contradiction` [contradiction-detector.ts:detectContradictions]
- `detectCompressible(artifacts, config)` with reason code `low_value_long_lived` [compression-detector.ts:detectCompressible]
- `computeFindingId(store, kind, artifactId, targetId?)` — deterministic SHA-256 finding identity [finding-id.ts:computeFindingId]
- `normalizeContent(s)` — lowercase and collapsed-whitespace normalization for similarity [finding-id.ts:normalizeContent]
- `canonicalPair`, `clusterKey`, `sameCluster`, `isEvidenceArtifact`, `claimsConflict`, `daysSince` — shared helpers [shared.ts:canonicalPair]

## Invariants
- Detectors never mutate their input and perform no I/O or store access [staleness-detector.ts:detectStale] [dedup-detector.ts:detectDuplicates]
- Findings are deterministically ordered by `findingId` [staleness-detector.ts:detectStale] [contradiction-detector.ts:detectContradictions]
- Pairwise identity canonicalizes the two ids lexicographically, so `duplicate(A,B)` and `duplicate(B,A)` hash identically [finding-id.ts:computeFindingId] [shared.ts:canonicalPair]
- Evidence-projection artifacts (`store === "evidence"`) are governance inputs and are not flagged as stale/age or compressible [shared.ts:isEvidenceArtifact] [staleness-detector.ts:detectStale] [compression-detector.ts:detectCompressible]
- `superseded` flags every non-newest artifact in a cluster against the newest (ties by largest id), so no artifact is both superseder and superseded [staleness-detector.ts:detectStale]
- `value_clash` requires the same `(store, artifactKind, subject)` cluster; evidence-involving pairs are cross-store and classified `outcome_contradiction` [contradiction-detector.ts:detectContradictions] [shared.ts:sameCluster]
- Contradictions operate only on structured `claim` data, never free text or semantic inference; artifacts without a claim never conflict [contradiction-detector.ts:detectContradictions] [shared.ts:claimsConflict]
- The near-duplicate pass skips pairs already flagged `exact`, because `computeFindingId` ignores `reasonCode` and the two would share one id [dedup-detector.ts:detectDuplicates]
- `exact` means shared `(store, artifactKind, subject)` cluster key; `near` uses Sørensen–Dice character-bigram similarity against `config.duplicateSimilarityThreshold` [dedup-detector.ts:detectDuplicates] [shared.ts:clusterKey]
- Thresholds come from `CurationConfig` and are never hard-coded in the detectors [compression-detector.ts:detectCompressible] [dedup-detector.ts:detectDuplicates]
- `daysSince` returns `0` for an unparseable ISO timestamp [shared.ts:daysSince]
- Architecture thresholds are not here — detectors only emit findings and A3 remains the decision authority [staleness-detector.ts:detectStale]

## Side Effects
- Reads the wall clock (`Date.now()`) once per detector call to stamp `createdAt` and compute artifact age [staleness-detector.ts:detectStale] [dedup-detector.ts:detectDuplicates] [compression-detector.ts:detectCompressible]
- `computeFindingId` uses `node:crypto` `createHash("sha256")` [finding-id.ts:computeFindingId]
- No file, network, or store I/O [dedup-detector.ts:detectDuplicates] [contradiction-detector.ts:detectContradictions]

## Verification
- Run: `pnpm test`
