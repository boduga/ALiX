# A6 — Knowledge Evolution Design

**Status:** Approved with contract refinements (2026-08-10)
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
│   ├── pattern-registry-adapter.ts   — read-only over context/pattern-registry
│   └── evidence-adapter.ts           — read-only over VerificationEvidenceLedger (A5 input)
├── curation-proposal-builder.ts  — findings → CurationProposal
├── curation-cli.ts               — CLI handler
└── index.ts                      — barrel re-exports
```

### A5 evidence input

The staleness and contradiction detectors need A5 observed evidence. The
`evidence-adapter.ts` reads `VerificationEvidenceLedger` read-only
(`listByProposal`, `listExpired`) and projects the relevant evidence alongside
`KnowledgeArtifact`s so detectors receive it as part of their pure input — no
store access from detectors.

```
A5 observed evidence (VerificationEvidenceLedger)
        ↓ read-only evidence adapter
KnowledgeArtifact[] / evidence projection
        ↓
staleness / contradiction detector (pure, no I/O)
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
Existing stores ──read-only adapters──▶ KnowledgeArtifact[]
                                                     │
                        ┌────────────────────────────┼────────────────────────────┐
                        ▼                            ▼                            ▼
                 StalenessDetector             DedupDetector            ContradictionDetector
                        │                            │                            │
                        └────────────────────────────┼────────────────────────────┘
                                                     ▼
                                             CompressionDetector
                                                     │
                                                     ▼
                                            CurationFinding[]
                                                     │
                                                     ▼
                                            CurationProposal
                                                     │
                                            (non-empty only)
                                                     ▼
                                    A3 generateDecision(evidence, recommendation)
                                                     │
                                                     ▼
                                             GovernanceDecision
                                                     │
                                                     ▼
                                  existing A-series evolution lifecycle
```

### Core invariants
- Detectors are **pure** — no I/O, no store access, no side effects; operate only on `KnowledgeArtifact[]` handed to them by adapters
- Adapters are **read-only** — read store files, never write
- **A6 never writes to knowledge stores.** It recommends; A3 is the governance authority that decides.
- Deterministic: same store snapshot + same detector config + same timestamp semantics → identical semantic findings, proposal, and governance recommendation (ordering preserved)

## 4. Data Model

### 4.1 Normalized read model — `KnowledgeArtifact`

The four stores expose different shapes. To keep detectors pure (they must not know how `LearningSignal`, `ChronicleEntry`, `FailureMemory`, and `Pattern` differ), adapters project artifacts into a **small in-memory read model**. This is an internal projection, **not a new persistent store** and not a serializable DTO.

```ts
type KnowledgeStore = "learning" | "chronicle" | "failure_memory" | "pattern_registry";

interface KnowledgeArtifact {
  readonly store: KnowledgeStore;
  readonly artifactId: string;
  readonly artifactKind: string;
  readonly subject?: string;          // e.g. subsystem / policy / task-type cluster key
  readonly content: string;           // normalized text for similarity + dedup
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly evidenceRefs: readonly string[];
  readonly downstreamRefs: readonly string[];
  readonly claim?: {                  // structured claim, only where the store already has one
    readonly subject: string;
    readonly predicate: string;
    readonly value: string;
  };
}
```

Mapping to existing stores (grounded in source):

| Store | artifactKind | subject | claim source |
|-------|--------------|---------|--------------|
| `learning` | `LearningSignal` | signalType/target | native `delta { expected, observed }` |
| `learning` | `CalibrationProfile` | target+targetName | native `previousValue`/`suggestedValue` |
| `learning` | `LearningReport` | — | — |
| `chronicle` | `ChronicleEntry` | — | native `outcome` |
| `failure_memory` | `FailureRecord` | failureType | native `failureType`/`detail` |
| `pattern_registry` | `Pattern` | TaskType | native `PatternOutcome` |

**Contradiction detection operates only on `claim`.** If a store has no structured claim, contradiction detection cannot establish incompatibility for it — A6 explicitly does **not** introduce an LLM/semantic-inference layer. Adapters expose structured claims only where the underlying store already has them.

### 4.2 `CurationFinding`

```ts
type CurationFindingKind =
  | "stale"         // reasonCode distinguishes the phenomenon
  | "duplicate"
  | "contradiction"
  | "compressible";

interface CurationFinding {
  findingId: string;              // deterministic identity — see §4.4
  kind: CurationFindingKind;
  reasonCode: string;             // deterministic subtype, not parsed from rationale:
                                  //   stale → "age" | "superseded" | "outcome_contradiction"
                                  //   duplicate → "exact" | "near"
                                  //   contradiction → "value_clash" | "outcome_contradiction"
                                  //   compressible → "low_value_long_lived"
  store: KnowledgeStore;
  artifactId: string;             // the artifact flagged
  artifactKind: string;
  targetId?: string;              // for duplicate/contradiction: the related artifact
  severity: "low" | "medium" | "high";
  rationale: string;              // human-readable why
  evidenceRefs: readonly string[];// evidence IDs that support this finding (e.g. A5 observed evidence)
  confidence: number;             // 0..1 detector confidence
  createdAt: string;              // observation timestamp — NOT part of deterministic identity
}
```

### 4.3 `CurationProposal`

`CurationProposal` is A6's **internal** proposal artifact. It does **not** extend
`DecisionArtifact` — `DecisionArtifact` requires fields (`id`, `subject`,
`outcome`, `confidence`, `reasons`, `generatedAt`) that are the A3-facing
artifact's concern, not the curation phase's. A6 must not invent compatibility
fields to fake the interface; the builder constructs the A3-facing artifact
(§6) from this proposal following the existing construction pattern.

```ts
interface CurationProposal {
  proposalId: string;
  findings: CurationFinding[];
  summary: string;                 // one-line "N stale, M duplicate..."
  dimension: CurationFindingKind[];// dimensions covered
  createdAt: string;               // observation timestamp — not part of deterministic identity
}
```

### 4.4 Deterministic identity

`findingId` is a deterministic hash of `(store, kind, artifactId, targetId?)`. It identifies the **artifact relationship being proposed for curation**, not the detection circumstances.

- Detector rationale, confidence, and evidence may change between observations; `findingId` stays stable.
- For **pairwise** findings (duplicate, contradiction), the pair is canonicalized: **target IDs sorted lexicographically before hashing**, so `duplicate(A,B)` and `duplicate(B,A)` produce the same `findingId`.
- `createdAt` is observation metadata and is **excluded** from the deterministic comparison and hash.

**Determinism invariant:** `findingId`, finding ordering, finding content, proposal content, and the governance recommendation are deterministic. Lifecycle timestamps are not part of deterministic identity.

### 4.5 `CurationConfig` — explicit detector input

Thresholds are an explicit input, not hard-coded in detectors:

```ts
interface CurationConfig {
  readonly staleAfterDays: number;              // default 90
  readonly duplicateSimilarityThreshold: number;// default 0.9
  readonly compressionAfterDays: number;        // default 180
}
```

Each detector signature is `detect(artifacts: KnowledgeArtifact[], config: CurationConfig): CurationFinding[]`.
The CLI/config layer is where these evolve later. Determinism invariant: same artifacts + same config = same findings.

### 4.6 `CurationResult` — engine output (findings + store status)

Store availability is **not** a curation finding and must not become a governance proposal:

```ts
type StoreStatus =
  | { status: "available"; store: KnowledgeStore }
  | { status: "unavailable"; store: KnowledgeStore; reason?: string };

interface CurationResult {
  findings: CurationFinding[];
  storeStatus: StoreStatus[];
}
```

A missing store dir → `{ status: "unavailable" }` in `storeStatus`, no findings from that store, and a diagnostic line in the report — but **no finding, no proposal, no governance decision**.

### 4.7 The zero-findings invariant

```
0 findings → no CurationProposal → no GovernanceDecision
```

A6 must not route an empty proposal to A3 (which would mint a "do nothing" governance decision and add noise to the ledger).

## 5. Detector Logic

Each detector is pure — `detect(artifacts: KnowledgeArtifact[], config: CurationConfig): CurationFinding[]`, returns findings. Thresholds come from `config`, never hard-coded.

### StalenessDetector
Signals an artifact is stale (`reasonCode: "age" | "superseded" | "outcome_contradiction"`) when:
- **Age** (`age`): older than `config.staleAfterDays` with no evidence of refresh
- **Superseded** (`superseded`): a newer artifact in the same `store + artifactKind + subject` cluster exists
- **Contradicted by observed evidence** (`outcome_contradiction`): A5 observed evidence shows the artifact's claim no longer holds

### DedupDetector
- **Exact match** (`exact`): same `(store, artifactKind, subject)` — propose consolidation
- **Near-duplicate** (`near`): normalized-content similarity above `config.duplicateSimilarityThreshold` — flag as candidate

### ContradictionDetector
Operates **only on `KnowledgeArtifact.claim`** — never on free text, never via semantic inference.
- **Value clash** (`value_clash`): two artifacts in the same subject cluster assert incompatible claim values
- **Outcome contradiction** (`outcome_contradiction`): an artifact's claim expectation vs A5 observed outcome disagree

### CompressionDetector
- **Low-value + long-lived**: older than threshold AND no `evidenceRefs` / no downstream references → eviction candidate

## 6. A6 → A3 governance mapping

A6 is the **curation proposer**; A3 remains the governance authority. A6 must not
decide whether an artifact is deleted, compressed, merged, or retained — it
recommends a curation action, and A3 decides.

```
CurationProposal (non-empty findings)
        ↓
curation-proposal-builder
        ↓
GovernanceRecommendation (extends DecisionArtifact) + VerificationEvidence
        ↓
A3 generateDecision(evidence, recommendation)
```

The builder transforms a `CurationProposal` into A3's two inputs, following the
existing artifact-construction pattern (the same pattern used by
`LearningSignal` and `GovernanceRecommendation` when they extend
`DecisionArtifact`):

- **`GovernanceRecommendation`** (the A3-facing `DecisionArtifact`) — built from
  the proposal's findings: `id` ← proposal `proposalId`, `subject` ← summary,
  `outcome` ← "curation_proposed", `confidence` ← aggregated finding confidence,
  `reasons` ← finding rationales, `evidenceRefs` ← union of finding `evidenceRefs`,
  `generatedAt` ← observation timestamp. `reportType: "governance_recommendation"`,
  `recommendations` ← one `Recommendation` per curation dimension. A6 recommends
  a **bounded curation action** — never "delete X" specifics.
- **`VerificationEvidence`** — wrapped from finding `evidenceRefs` (A5 observed
  evidence) + finding rationale, satisfying A3's `VerificationEvidence` input.

A3's `GovernanceDecision` (APPROVE / REJECT / etc.) is the authority;
`EvolutionStateMachine` transition happens through the **existing A-series
lifecycle**, which A6 does not instantiate.

- **0 findings → no proposal → no A3 call → no decision** (see §4.7)

## 7. CLI

```
alix governance evolution curate [--dimension stale|duplicate|contradiction|compressible] [--json]
```

- `--dimension` filters to one dimension; omitting runs all four. The CLI uses the
  full `CurationFindingKind` names (`duplicate`, `compressible`) — no short aliases
- Default output: report of findings grouped by kind, plus the resulting governance decision (via A3, only when findings exist)
- `--json`: structured `{ findings, proposal, decision }` (decision present only when a proposal exists)
- Unknown dimension → usage error + exit 1
- No findings → "No curation findings" message, no A3 call (mirrors `runEvidence`)

Wiring follows the existing `evolution-cli.ts` subcommand pattern (`decide`/`execute`/`observe` cases).

## 8. Error Handling

- **Adapters never throw**: each wraps store reads in try/catch, returns `[]` on corrupt/missing artifacts, skips corrupt JSONL lines (reusing the `parseLines` pattern from `learning-store.ts`)
- **Detectors never throw**: pure logic; edge cases (empty input, missing target) return empty findings, never exceptions
- **Missing store dir**: absent `.alix/learning`, `.alix/chronicle`, etc. → adapter returns empty list, engine records `{ status: "unavailable", store }` in `CurationResult.storeStatus` — **not** a finding, never a proposal (§4.6)
- **CLI**: unknown dimension → usage error + exit 1; no findings → "No curation findings"

## 9. Testing

Mirror the A5 test layout at `tests/evolution/knowledge/`:

| Suite | Covers |
|-------|--------|
| `curation-contract.test.ts` | validators for finding/proposal/artifact types |
| `knowledge-artifact-adapter.test.ts` | store→`KnowledgeArtifact` projection, corrupt JSONL resilience |
| `staleness-detector.test.ts` | age / superseded / outcome-contradiction, config thresholds |
| `dedup-detector.test.ts` | exact + near-duplicate |
| `contradiction-detector.test.ts` | value clash + outcome contradiction (claims only) |
| `compression-detector.test.ts` | low-value + long-lived |
| `curation-engine.test.ts` | aggregation, ordering determinism, store status |
| `curation-proposal-builder.test.ts` | findings → proposal, and proposal → GovernanceRecommendation + VerificationEvidence (A3 mapping) |
| `curation-cli.test.ts` | dimension filter, JSON, no-findings, exit codes |
| `integration/a6-curation-integration.test.ts` | end-to-end: adapters → detectors → builder → A3 decision |

**Critical invariant tests:**

- **Deterministic pair ordering**: `duplicate(A,B)` and `duplicate(B,A)` → identical finding
- **Deterministic finding IDs**: same input twice → identical `findingId`s
- **No mutation**: snapshot adapter inputs before/after detector execution — unchanged
- **Missing stores**: one unavailable store does not suppress findings from the other three
- **No findings**: no proposal, no A3 call
- **Configuration determinism**: same artifacts + same config → identical semantic result
- **Corrupt JSONL**: one bad line doesn't suppress valid neighboring artifacts

**Success criteria:** all 10 suites pass; determinism tests green; governance decision generated only from a non-empty proposal.
