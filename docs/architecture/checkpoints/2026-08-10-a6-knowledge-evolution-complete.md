# A6 — Knowledge Evolution Checkpoint

**Date:** 2026-08-10
**Phase:** A6 — Knowledge Evolution
**Checkpoint tag:** `alix-a6-knowledge-evolution-complete`

## Summary

A6 curates ALiX's accumulated knowledge artifacts. It detects stale, duplicate,
contradictory, and compressible knowledge across the existing stores
(`learning`, `chronicle`, `failure_memory`, `pattern_registry`, plus A5 observed
evidence) and produces **curation proposals** that flow through the A3
governance decision engine for approval. A6 is a **detect-and-recommend**
phase: it never mutates stores directly. Mutations happen only after a
governance-approved decision, consistent with the A-series rule that autonomous
changes go through Propose → Review → Approve → Apply → Measure.

Read-only adapters project each store into a normalized in-memory
`KnowledgeArtifact` read model (an internal projection, **not** a new persistent
store). Pure detectors — staleness, duplicate, contradiction, compression — emit
`CurationFinding`s. A deterministic proposal builder aggregates findings into a
`CurationProposal`, wraps them into `VerificationEvidence`, and maps to the
A2.5 `GovernanceRecommendation` that A3 `generateDecision` consumes.

Implemented as part of the A6 plan (`docs/superpowers/plans/2026-08-10-a6-knowledge-evolution.md`).
CLI: `alix governance evolution curate [--dimension ...] [--json]`.

## Implemented

| File | Responsibility |
|------|----------------|
| `src/evolution/knowledge/contracts/curation-contract.ts` | `KnowledgeArtifact`, `CurationFinding`, `CurationProposal`, `CurationConfig`, `CurationResult`, `StoreStatus` |
| `src/evolution/knowledge/adapters/shared.ts` | `AdapterResult`, `parseLines`, `readTextFileOrNull` |
| `src/evolution/knowledge/adapters/learning-store-adapter.ts` | `LearningStoreAdapter` — signals/profiles/reports → read model |
| `src/evolution/knowledge/adapters/chronicle-adapter.ts` | `ChronicleAdapter` — chronicle entries → read model |
| `src/evolution/knowledge/adapters/failure-memory-adapter.ts` | `FailureMemoryAdapter` — failure records → read model |
| `src/evolution/knowledge/adapters/pattern-registry-adapter.ts` | `PatternRegistryAdapter` — task-type stats → read model |
| `src/evolution/knowledge/adapters/evidence-adapter.ts` | `EvidenceAdapter` — A5 `VerificationEvidenceLedger` → read model |
| `src/evolution/knowledge/detectors/finding-id.ts` | `computeFindingId`, `normalizeContent` (deterministic identity) |
| `src/evolution/knowledge/detectors/staleness-detector.ts` | `detectStale` — age / superseded / outcome_contradiction |
| `src/evolution/knowledge/detectors/dedup-detector.ts` | `detectDuplicates` — exact / near (Sørensen–Dice) |
| `src/evolution/knowledge/detectors/contradiction-detector.ts` | `detectContradictions` — claims only (value_clash / outcome_contradiction) |
| `src/evolution/knowledge/detectors/compression-detector.ts` | `detectCompressible` — low-value + long-lived |
| `src/evolution/knowledge/curation-engine.ts` | `CurationEngine.curateAll()` — adapters → detectors → findings + store status |
| `src/evolution/knowledge/curation-proposal-builder.ts` | `buildCurationProposal`, `buildEvidenceFromFindings`, `buildGovernanceRecommendation` (A2.5 mapping) |
| `src/evolution/knowledge/curation-cli.ts` | CLI handler (`handleCurationCommand`) |
| `src/evolution/knowledge/index.ts` | Barrel re-exports |
| `src/governance/evolution-cli.ts` | `curate` subcommand wiring (`handleEvolutionCommand`) |

**Tests:** `tests/evolution/knowledge/` — curation-contract, knowledge-artifact-adapter,
staleness-detector, dedup-detector, contradiction-detector, compression-detector,
curation-engine, curation-proposal-builder, curation-cli, and
`integration/a6-curation-integration` (end-to-end adapters → detectors → builder →
A3 decision + no-mutation snapshot). 77/77 A6 tests pass across 21 suites.

## Verification Checklist

### No mutation of knowledge stores (A-series invariant)
- [x] Adapters are read-only — `readFile` only, never write (verified by the no-mutation byte snapshot in the integration test)
- [x] Detectors are pure — no I/O, no store access, no mutation of their input
- [x] Full pipeline (curateAll → proposal → evidence → recommendation → decision) is byte-identical against a snapshot of the store dir
- [x] A6 only proposes; A3 remains the governance authority that decides

### Zero-findings invariant
- [x] `buildCurationProposal([])` → `null` — empty findings never produce a proposal
- [x] No proposal → no evidence → no A3 `generateDecision` call
- [x] CLI prints "No curation findings" and takes no governance action on an empty run

### Determinism
- [x] `findingId` is a deterministic content-addressed hash of `(store, kind, artifactId, targetId?)`
- [x] Pairwise findings canonicalized — target IDs sorted lexicographically before hashing, so `duplicate(A,B)` ≡ `duplicate(B,A)`
- [x] `createdAt` observation timestamps excluded from deterministic identity
- [x] Same store snapshot + same config → identical findings, proposal, recommendation (integration test asserts identical `findingId` sets across two runs)
- [x] Detector confidence formula invariant holds exactly: `min(a,a,a) × historicalSimilarity(1) === overallConfidence`

### Contradiction limited to structured claims
- [x] Contradiction detection operates only on `KnowledgeArtifact.claim` — never on free text, never via semantic inference (no LLM layer)
- [x] Adapters expose structured claims only where the underlying store already has them

### Store availability is diagnostic, not a finding
- [x] A missing store dir → `{ status: "unavailable" }` in `CurationResult.storeStatus`, no findings from that store
- [x] Unavailable store never suppresses findings from other stores
- [x] Store unavailability never becomes a proposal or governance decision

### No ungoverned action
- [x] A6 never mutates governed state — recommendations only
- [x] A6 does not instantiate the evolution lifecycle; `GovernanceDecision` flows through the existing A-series machinery
- [x] `observe` subcommand does not fall through into `curate` (regression-tested)
