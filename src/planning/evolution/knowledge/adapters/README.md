# Evolution Knowledge Store Adapters (A6)

## Overview

Read-only projections that normalize heterogeneous knowledge stores into a single
`KnowledgeArtifact` read model for the A6 curation detectors. The shared module
states the contract the whole directory obeys: every adapter returns
`{ artifacts, status }` and mirrors the A5 providers pattern — "adapters never
throw to their callers" [shared.ts:AdapterResult].

## Interface

- `AdapterResult` (`artifacts` + `status`) and `StoreStatus` re-export surface [shared.ts:AdapterResult]
- `runAdapter(store, project, dir?)`, `parseLines(raw)`, `readTextFileOrNull(path)` [shared.ts:runAdapter]
- `LearningStoreAdapter` — projects `signals.jsonl` / `profiles.jsonl` / `reports.jsonl` into `LearningSignal`, `CalibrationProfile`, `LearningReport` artifacts [learning-store-adapter.ts:LearningStoreAdapter]
- `ChronicleAdapter` — projects `.alix/chronicle/index.json` + `entries/<entryId>.json` into `ChronicleEntry` artifacts [chronicle-adapter.ts:ChronicleAdapter]
- `FailureMemoryAdapter` — projects `failure-memory.jsonl` into `FailureRecord` artifacts [failure-memory-adapter.ts:FailureMemoryAdapter]
- `PatternRegistryAdapter` — projects live `PatternRegistry.getStats(taskType)` into `Pattern` artifacts [pattern-registry-adapter.ts:PatternRegistryAdapter]
- `EvidenceAdapter` — projects `VerificationEvidence` from `VerificationEvidenceLedger` into `VerificationEvidence` artifacts [evidence-adapter.ts:EvidenceAdapter]
- Barrel re-exports every adapter and shared helper ([./index.ts](./index.ts)).

## Invariants

- Adapters never throw: a missing store directory yields `status: "unavailable"` with zero artifacts, and a read error is converted into `unavailable` plus the error message as `reason` [shared.ts:runAdapter].
- An empty but readable store is still `available` — zero artifacts is not a failure [shared.ts:runAdapter].
- A missing store directory is a diagnostic status, never a curation finding or a proposal [shared.ts:runAdapter].
- A corrupt JSONL line never suppresses valid neighbors; corrupt entries are skipped individually [shared.ts:parseLines].
- A missing file (`ENOENT`) reads as an empty store; any other read failure rethrows so the adapter can report `unavailable` [shared.ts:readTextFileOrNull].
- Adapter mapping is fixed per store: `LearningSignal` becomes a `delta` claim when present, `CalibrationProfile` a `value` claim, `LearningReport` kind only [learning-store-adapter.ts:LearningStoreAdapter].
- `ChronicleAdapter` only emits an artifact for a fully populated entry; a corrupt index or entry is treated as empty/skip, not fatal [chronicle-adapter.ts:ChronicleAdapter].
- `EvidenceAdapter` projects the lexicographically-first metric delta as its claim, sorted for determinism, and includes expired evidence via `includeExpired: true` [evidence-adapter.ts:EvidenceAdapter].
- `PatternRegistryAdapter` is memory-only, calls only the public `getStats`, never `recordOutcome`/`save`/`clear`, and stamps a single read timestamp because per-task stats carry no creation time [pattern-registry-adapter.ts:PatternRegistryAdapter].

## Side Effects

- No writes anywhere in this directory: each adapter is documented as "Never writes" and `PatternRegistryAdapter` touches no files [shared.ts:AdapterResult].
- Filesystem reads only: JSONL files, `.alix/chronicle` entries, and the ledger's proposal enumeration [chronicle-adapter.ts:ChronicleAdapter].
- `EvidenceAdapter` reads through `VerificationEvidenceLedger.listProposals()` / `listByProposal()` without mutating the ledger [evidence-adapter.ts:EvidenceAdapter].

## Verification

- Run: `pnpm test`
