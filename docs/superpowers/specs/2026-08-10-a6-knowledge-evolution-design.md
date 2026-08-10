# A6 — Knowledge Evolution Design

**Status:** Approved (2026-08-10)
**Phase:** A6 — Knowledge Evolution
**Depends on:** A3 (Governance Decision engine), A5 (Outcome Observation), A0 (Evolution Contract), ADR-0008
**Checkpoint target:** `alix-a6-knowledge-evolution-complete`

---

## 1. Purpose

A6 curates ALiX's accumulated knowledge artifacts. It detects stale, duplicate,
contradictory, and compressible knowledge across the existing stores and produces
**curation proposals** that flow through the A3 governance decision engine for
approval. A6 is a **detect-and-recommend** phase: it never mutates stores directly.
Mutations happen only after a governance-approved decision, consistent with the
A-series rule that autonomous changes go through
Propose → Review → Approve → Apply → Measure.

## 2. Scope

### In scope
- Detect stale, duplicate, contradictory, and compression-candidate knowledge across four existing stores
- Emit `CurationFinding[]`, wrap into a `CurationProposal`, route through A3 `generateDecision`
- CLI: `alix governance evolution curate [--dimension ...] [--json]`
- Read-only adapters over existing stores

### Out of scope
- Mutating/compressing/evicting store artifacts (A6 only proposes)
- A new consolidated knowledge base store (A6 curates the existing stores)
- A7 (Capability Marketplace), A8 (Organizational Learning), A9 (Self-Directed Engineering)

## 3. Architecture

New module `src/evolution/knowledge/`, mirroring the A5 `observation/` layout:

```
src/evolution/knowledge/
├── contracts/
│   └── curation-contract.ts      — CurationFinding, CurationFindingKind, CurationProposal, CurationStore interface
├── curation-engine.ts            — CurationEngine: runs detectors, aggregates findings
├── detectors/
│   ├── staleness-detector.ts     — dimension: staleness
│   ├── dedup-detector.ts         — dimension: duplicate/near-duplicate
│   ├── contradiction-detector.ts — dimension: contradiction
│   └── compression-detector.ts   — dimension: compression candidates
├── adapters/
│   ├── learning-store-adapter.ts     — read-only over learning/ (signals, profiles, reports)
│   ├── chronicle-adapter.ts          — read-only over chronicle/
│   ├── failure-memory-adapter.ts     — read-only over governance/failure-memory
│   └── pattern-registry-adapter.ts   — read-only over context/pattern-registry
├── curation-proposal-builder.ts  — findings → CurationProposal
├── curation-cli.ts               — CLI handler
└── index.ts                      — barrel re-exports
```

### Structural mirror to A5

| A5 (Outcome Observation) | A6 (Knowledge Evolution) |
|--------------------------|--------------------------|
| `ObservationProvider` | `CurationDetector` |
| `ObservationResult` | `CurationFinding` |
| `buildObservationEvidence` | `buildCurationProposal` |
| `ObservationEngine.observeAll()` | `CurationEngine.curateAll()` |

### Data flow

```
Store adapters (read-only) → detectors → CurationFinding[]
                                          ↓
                             buildCurationProposal → CurationProposal
                                          ↓
                     A3 generateDecision(evidence, recommendation) → GovernanceDecision
                                          ↓
                          EvolutionStateMachine transition (proposal lifecycle)
```

### Core invariants
- Detectors are **pure** — no I/O, no store access, no side effects; operate only on artifact lists handed to them by adapters
- Adapters are **read-only** — read store files, never write
- Deterministic: same store state → same findings → same decision (ordering preserved)

## 4. Data Model

### CurationFinding

```ts
type CurationFindingKind =
  | "stale"            // superseded / old / contradicted by newer evidence
  | "duplicate"        // near-duplicate of another artifact
  | "contradiction"    // two artifacts claim incompatible things
  | "compressible";    // long-lived low-value, candidate for eviction

interface CurationFinding {
  findingId: string;              // deterministic: hash(store, kind, artifactId, targetId?)
  kind: CurationFindingKind;
  store: "learning" | "chronicle" | "failure_memory" | "pattern_registry";
  artifactId: string;             // the artifact flagged
  artifactKind: string;           // e.g. "LearningSignal" | "ChronicleEntry" | "FailureMemory" | "Pattern"
  targetId?: string;              // for duplicate/contradiction: the related artifact
  severity: "low" | "medium" | "high";
  rationale: string;              // human-readable why
  evidenceRefs: string[];         // evidence IDs that support this finding (e.g. A5 observed evidence)
  confidence: number;             // 0..1 detector confidence
  createdAt: string;              // ISO timestamp
}
```

### CurationProposal

```ts
interface CurationProposal extends DecisionArtifact {
  proposalId: string;
  findings: CurationFinding[];
  summary: string;                 // one-line "N stale, M duplicate..."
  dimension: CurationFindingKind[];// dimensions covered
  createdAt: string;
}
```

`CurationProposal` extends the existing `DecisionArtifact` base (the same base A3's
`GovernanceDecision` and P8's `LearningSignal` extend), so it drops straight into
A3's `generateDecision` pipeline.

`findingId` is a deterministic hash of `(store, kind, artifactId, targetId?)` — same
store state yields the same finding IDs, so governance decisions on them are
reproducible (A-series deterministic invariant).

## 5. Detector Logic

Each detector is pure — takes artifact lists from adapters, returns findings.

### StalenessDetector
Signals an artifact is stale when:
- **Age**: older than a threshold (default 90 days) with no evidence of refresh
- **Superseded**: a newer artifact in the same `store + artifactKind + subject` cluster exists
- **Contradicted by observed evidence**: A5 observed evidence shows the artifact's claim no longer holds

### DedupDetector
- **Exact match**: same `(store, artifactKind, subject)` — propose consolidation
- **Near-duplicate**: normalized-content similarity above a threshold (default 0.9) — flag as candidate

### ContradictionDetector
- **Value clash**: two artifacts in the same subject cluster assert incompatible values
- **Outcome contradiction**: an artifact's expectation vs A5 observed outcome disagree

### CompressionDetector
- **Low-value + long-lived**: older than threshold AND no `evidenceRefs` / no downstream references → eviction candidate

## 6. CLI

```
alix governance evolution curate [--dimension stale|dup|contradiction|compress] [--json]
```

- `--dimension` filters to one dimension; omitting runs all four
- Default output: report of findings grouped by kind, plus the resulting governance decision (via A3)
- `--json`: structured `{ findings, proposal, decision }`
- Unknown dimension → usage error + exit 1
- No findings → "No curation findings" message (mirrors `runEvidence`)

Wiring follows the existing `evolution-cli.ts` subcommand pattern (`decide`/`execute`/`observe` cases).

## 7. Error Handling

- **Adapters never throw**: each wraps store reads in try/catch, returns `[]` on corrupt/missing artifacts, skips corrupt JSONL lines (reusing the `parseLines` pattern from `learning-store.ts`)
- **Detectors never throw**: pure logic; edge cases (empty input, missing target) return empty findings, never exceptions
- **Missing store dir**: absent `.alix/learning`, `.alix/chronicle`, etc. → adapter returns empty list, engine emits a `store_unavailable` note rather than failing
- **CLI**: unknown dimension → usage error + exit 1; no findings → "No curation findings"

## 8. Testing

Mirror the A5 test layout at `tests/evolution/knowledge/`:

| Suite | Covers |
|-------|--------|
| `curation-contract.test.ts` | validators for finding/proposal types |
| `staleness-detector.test.ts` | age / superseded / outcome-contradiction |
| `dedup-detector.test.ts` | exact + near-duplicate |
| `contradiction-detector.test.ts` | value clash + outcome contradiction |
| `compression-detector.test.ts` | low-value + long-lived |
| `curation-engine.test.ts` | aggregation, ordering determinism |
| `curation-proposal-builder.test.ts` | findings → proposal, DecisionArtifact base |
| `curation-cli.test.ts` | dimension filter, JSON, no-findings, exit codes |
| `integration/a6-curation-integration.test.ts` | end-to-end: adapters → detectors → builder → A3 decision |

**Success criteria:** all 9 suites pass; determinism test (same input → identical findings + decision) green; governance decision properly generated from a non-empty proposal.
