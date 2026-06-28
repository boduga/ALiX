# P8.5a — Operational Learning Pipeline

> **Status:** SDS awaiting review.
> **Spec home (on approval):** `docs/superpowers/specs/2026-06-22-p8-5a-operational-learning-pipeline-design.md`
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-22-p8-5a-operational-learning-pipeline.md`
> **Governs:** `feature/p8.5a-operational-learning-pipeline` branch, off `main` at HEAD.
> **Risk level:** MEDIUM — wires the dormant P8 stack to P7 evidence, but does not change mutation authority.

## Why P8.5a exists

P8 ships 9 sub-phases and 106 passing tests, but its loop is dormant:

```
P7 Outcomes (real)
     ↓
     ???         ← missing
     ↓
P8 Builders (test fixtures only)
     ↓
P8 LearningStore (empty)
     ↓
alix learning report
     ↓
"No learning signals found."
```

P9 — Meta-Governance — is supposed to govern the quality of learning decisions. Without live P7→P8 wiring, P9 would govern an empty system. **P8.5a is the bridge.**

## Hard governance boundary (non-negotiable)

```
P8.5a wires data, not authority.
P8.5a writes to LearningStore (append-only).
P8.5a does NOT create AdaptationProposals automatically.
P8.5a does NOT approve or apply anything.
P8.5a does NOT mutate ProposalStore, ApprovalGate, or any applier.
```

The LearningStore boundary from P8.0b remains: signals and profiles in, no proposals out. Operators always run `alix learning propose` explicitly.

## Five phases

| Phase | Sub-phase | Deliverable | Why this order |
|---|---|---|---|
| 1 | **P8.5a.0** | Evidence Chain / Provenance Graph | Define the type first so adapters inherit backlinks from day one. Retrofitting provenance later is the most expensive mistake. |
| 2 | **P8.5a.1** | Source Recon | Inspect the codebase to confirm what stores exist. Don't guess. Routing telemetry is the known gap. |
| 3 | **P8.5a.2** | Operational Adapters + `alix learning refresh` | Wire only the sources that exist. Accept partial coverage. |
| 4 | **P8.5b** | Learning Dashboard | NiceGUI panel for signals/profiles/proposal readiness. |
| 5 | **P8.5c** | `alix explain` command | Traverses the Evidence Chain — foundation for P9 audit. |

Phases 1–3 are the pipeline. Phases 4–5 are the operation surface. **P8.5a.0 must ship first** so the chain exists before any adapter populates it.

---

# P8.5a.0 — Evidence Chain / Provenance Graph (the focus of this SDS)

## Core framing

Every artifact in the P6→P7→P8 chain already has *forward references* to its sources:

| Artifact | Existing forward refs |
|---|---|
| `OutcomeRecord` | `decisionId`, `recommendationId`, `governanceReviewId` |
| `GovernanceReview` | `recommendationId`, `proposalId` |
| `RiskScore` | `sourceArtifacts: SourceArtifact[]` |
| `LensCalibrationReport` | (inherits `evidenceRefs: string[]` from `DecisionArtifact`) |
| `RecommendationAccuracyReport` | (standalone report — no parent ref) |
| `AdaptationProposal` | `sourceRecommendationType`, `sourceSignalIds`, `provenance` |
| `LearningSignal` | `sourceReportId`, `evidenceRefs` |
| `CalibrationProfile` | `evidenceRefs`, `sourceSignalIds` |
| `LearningProposal` | `sourceSignalIds` |

The Evidence Chain is **a graph view over those existing forward refs**, plus a first-class artifact that records the relationship. It is *not* a new field on every type.

## Design questions

### 1. What is the Evidence Chain?

A **separate, append-only graph artifact** (not a backlink field on each type). The chain is a record of relationships that can be queried, replayed, and audited.

```ts
/**
 * A single directed relationship in the Evidence Chain.
 *
 * Direction: from `sourceArtifactId` (the dependent/derived artifact)
 * to `targetArtifactId` (the artifact it depends on / was derived from).
 */
export interface ProvenanceLink {
  /** The artifact that depends on / was derived from something. */
  sourceArtifactId: string;
  /** The artifact it depends on. */
  targetArtifactId: string;
  /** Type of the source artifact (e.g., "learning_signal", "adaptation_proposal"). */
  sourceArtifactType: ArtifactType;
  /** Type of the target artifact. */
  targetArtifactType: ArtifactType;
  /** The relationship kind. */
  relationship: ProvenanceRelationship;
  /** When the link was recorded. */
  recordedAt: string;
}

export type ProvenanceRelationship =
  | "derived_from"     // A was derived from B (e.g., signal from outcome)
  | "supports"         // A provides evidence for B (e.g., outcome supports decision)
  | "generated"        // A generated B (e.g., profile generated proposal)
  | "approved_from"    // A was approved from B (e.g., proposal approved from review)
  | "reviewed_from";   // A was reviewed from B (e.g., review was on recommendation)
```

### 2. What is the first-class `LearningEvidenceChain`?

```ts
export interface LearningEvidenceChain extends DecisionArtifact {
  /** The artifact this chain is rooted at. */
  rootArtifactId: string;
  /** The type of the root artifact. */
  rootArtifactType: ArtifactType;
  /** Ordered provenance links, traversing outward from the root. */
  links: ProvenanceLink[];
  /** Maximum depth traversed (1 = direct links, N = transitive). */
  depth: number;
  /** When the chain was assembled. */
  generatedAt: string;
  /** Optional: the lookup that triggered this chain. */
  generatedBy?: "alix explain" | "alix learning refresh" | "alix audit";
}
```

`LearningEvidenceChain` is a **derived artifact**: it's computed on demand from existing forward refs. Persisted to enable replay and audit (`alix explain prop-x` should not require re-running every builder).

### 3. How are forward refs extracted from each artifact type?

A **registry of forward-ref extractors**, one per artifact type. Each extractor is a function `(artifact) => ProvenanceLink[]`.

```ts
export type ForwardRefExtractor = (artifact: unknown) => ProvenanceLink[];

const EXTRACTORS: Record<ArtifactType, ForwardRefExtractor> = {
  outcome_record: (a) => {
    const o = a as OutcomeRecord;
    return [
      ...(o.decisionId ? [{ ..., targetArtifactId: o.decisionId, targetArtifactType: "decision_context", relationship: "derived_from" }] : []),
      ...(o.recommendationId ? [{ ..., targetArtifactId: o.recommendationId, ... }] : []),
      ...(o.governanceReviewId ? [{ ... }] : []),
    ];
  },
  governance_review: (a) => { ... },
  // ... one per type
};
```

Adding a new artifact type = registering one extractor. Existing types are unchanged.

### 4. What is `ArtifactType`?

```ts
export type ArtifactType =
  | "decision_context"
  | "risk_score"
  | "recommendation"
  | "governance_review"
  | "outcome_record"
  | "lens_calibration_report"
  | "recommendation_accuracy_report"
  | "adaptation_proposal"
  | "learning_signal"
  | "calibration_profile"
  | "learning_proposal"
  | "learning_evidence_chain";
```

### 5. Where is the chain stored?

`.alix/learning/evidence-chains.jsonl` — append-only, same pattern as `LearningStore` (P8.0b). Methods:

```ts
class EvidenceChainStore {
  async appendChain(chain: LearningEvidenceChain): Promise<LearningEvidenceChain>;
  async getChainForRoot(rootArtifactId: string): Promise<LearningEvidenceChain[]>;
  async listChains(opts?: { since?: string; artifactType?: ArtifactType }): Promise<LearningEvidenceChain[]>;
}
```

No `delete`, `update`, `clear`, or `truncate`. Sentinel-enforced.

### 6. What is `alix explain`?

A new CLI command (P8.5c) that traverses the Evidence Chain in both directions:

```bash
alix explain signal-123
```

Output:

```
═══ Evidence Chain: signal-123 (learning_signal) ═══

─── Sources (what this was derived from) ───
  ↓ outcome-8 (outcome_record, derived_from)
  ↓ outcome-9 (outcome_record, derived_from)
  ↓ outcome-10 (outcome_record, derived_from)

─── Derivatives (what this generated) ───
  ↑ profile-4 (calibration_profile, generated)

─── Chain metadata ───
  generated: 2026-06-22T14:00:00Z
  depth: 3
  links: 4
```

Traversal is BFS up to a configurable depth (default 5). The command is **strictly read-only** — it queries stores and the registry, never mutates.

### 7. What does `alix learning refresh` do?

Added in P8.5a.2. For P8.5a.0 we only define the interface:

```bash
alix learning refresh [--window 30] [--adapter <name>] [--dry-run]
```

The refresh command:
1. Reads P7 sources (via adapters)
2. Runs P8 builders
3. Appends signals/profiles to LearningStore
4. Does NOT create proposals
5. Does NOT call ApprovalGate
6. Does NOT mutate ProposalStore

For P8.5a.0, the command itself is not built — only the chain type that the refresh will record into.

### 8. How does P8.5a.0 avoid breaking existing types?

The Evidence Chain is **additive**:
- New types: `ProvenanceLink`, `ProvenanceRelationship`, `ArtifactType`, `LearningEvidenceChain`, `EvidenceChainStore`
- New extractors added to the registry
- Existing types (OutcomeRecord, AdaptationProposal, etc.) are **unchanged**
- The chain is *derived from* existing forward refs, not a replacement

A test asserts the unchanged-types invariant: `git diff` on existing type files shows zero changes.

### 9. What sentinels enforce the boundary?

`tests/learning/evidence-chain-sentinels.vitest.ts`:

| Check | Why |
|---|---|
| `EvidenceChainStore` has no `delete`/`update`/`clear`/`truncate` method | Append-only invariant |
| `src/learning/evidence-chain*` does not import `ProposalStore`, `ApprovalGate`, appliers, or `AutomaticProposalGenerator` | Learning layer can't reach governance mutation |
| `alix explain` handler is read-only (no file writes, no `propose`, no `approve`, no `apply`) | The audit command can't mutate |
| All P8 sentinels still pass | No regression |
| The chain type extends `DecisionArtifact` | The chain itself is a first-class governed artifact |

### 10. How does P8.5a.0 interact with P9?

P9 will ask: *"Was this learning recommendation justified?"*

P8.5a.0 gives P9 a way to answer:
1. Take any AdaptationProposal with `action: "learning_adjustment"`
2. Call `alix explain <proposal-id>` → traverses backward through the Evidence Chain
3. P9 sees the proposal, the profiles, the signals, and the outcome records that produced them
4. P9 makes a quality judgment: was the signal evidence-based? Was the proposal warranted?

Without P8.5a.0, P9 would have to re-run all builders. With it, P9 is a *query*, not a *computation*.

---

# P8.5a.1 — Source Recon (forward-looking)

The user explicitly directed: **"I would not guess. I would inspect the codebase first."** This phase answers four questions before any adapter is written:

| Question | Source | Status (per pre-P8.5a recon) |
|---|---|---|
| Recommendation Calibration source? | `OutcomeStore` (src/adaptation/outcome-store.ts) | ✅ exists |
| Risk Calibration source? | `RiskScore` (per-decision) — **but is it persisted?** | ⚠️ needs verification |
| Governance Calibration source? | `LensCalibrationReport` (P7c) | ✅ exists |
| Routing Calibration source? | `RoutingObservation[]` — **telemetry store?** | ❌ does not exist |

**Known gap: P8.4 routing builder is operationally starved.** The builder accepts `RoutingObservation[]` but no store produces them. Options:
- (a) P8.5a.2 includes a `TelemetryCapture` layer
- (b) P8.5a.2 defers routing adapter, accepts the gap
- (c) P8.4 builder stays observational; a later phase captures telemetry

**Recommended: (b)** — P8.5a.2 ships three adapters (Recommendation, Risk, Governance) and explicitly defers Routing. The user's structure allows partial coverage: *"That is perfectly acceptable."*

---

# P8.5a.2 — Operational Adapters (forward-looking)

Wire the three confirmed sources:

```
OutcomeStore         → RecommendationCalibrationBuilder (P8.1) → LearningStore
RiskScore (aggregated) → RiskCalibrationBuilder (P8.2)        → LearningStore
LensCalibrationReport → GovernanceCalibrationBuilder (P8.3)    → LearningStore
```

Plus the new `alix learning refresh` command.

**No new intelligence.** The builders are unchanged. The adapters are pure wiring.

**Note on RiskScore source:** the adapter will compute per-dimension outcomes from `OutcomeRecord` data, since `RiskScore` instances are not stored as historical records. This is a different shape from the builder's existing input; the adapter will produce aggregated observations the builder already accepts.

---

# P8.5b — Learning Dashboard (forward-looking)

NiceGUI panel: Signals | Profiles | Proposal Readiness

| Display | Source |
|---|---|
| Signal count by type | `LearningStore.querySignals({ windowDays })` |
| Profile count by area | `LearningStore.queryProfiles({ windowDays })` |
| Ready-to-propose count | Profiles not yet converted (track via Evidence Chain) |
| Already-proposed count | Profiles with at least one chain link to an `adaptation_proposal` |

---

# P8.5c — Explain Command (forward-looking)

The `alix explain <artifact-id>` command from question 6. BFS traversal, both directions, configurable depth, read-only.

---

## Pipeline placement (revised roadmap)

```
P5  Governed Evolution           ✅
P6  Decision Intelligence        ✅
P7  Outcome Intelligence         ✅
P8  Meta-Intelligence            ✅
P8.5a.0 Evidence Chain          ← new (this SDS, focus)
P8.5a.1 Source Recon            ← new
P8.5a.2 Operational Adapters    ← new
P8.5b Learning Dashboard        ← new
P8.5c Explain Command           ← new
P9  Meta-Governance              (deferred — needs live data to govern)
P10 Executive Intelligence
```

## Test results expected

- All existing P8 tests (10 files, 106 tests) continue to pass — no regression
- New P8.5a.0 tests:
  - `tests/learning/evidence-chain-types.vitest.ts` (type tests)
  - `tests/learning/evidence-chain-store.vitest.ts` (append-only invariant, query methods)
  - `tests/learning/forward-ref-extractors.vitest.ts` (per-type extractor tests)
  - `tests/learning/evidence-chain-sentinels.vitest.ts` (governance boundary)
  - `tests/learning/unchanged-types-invariance.vitest.ts` (no edits to existing types)

## Explicitly out of scope

| Feature | Belongs to |
|---|---|
| `alix learning refresh` command (the orchestrator) | P8.5a.2 |
| Adapters themselves (the wiring) | P8.5a.2 |
| `alix explain` command (the consumer) | P8.5c |
| NiceGUI dashboard | P8.5b |
| Telemetry capture for routing | Future phase (post-P8.5a, possibly post-P9) |
| P9 governance over the chain | P9 |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Forward-ref extractors get out of sync with their types | Each extractor test covers all known forward refs of its type. CI runs all extractors against fixture data. |
| Chain graph grows unbounded | Chains are per-root and shallow (depth ≤ 5 by default). Not a graph DB. |
| Re-traversal is expensive | Chains are persisted as derived artifacts. Once computed, `alix explain` is a JSONL read. |
| Adapters add new failure modes | Adapters are pure functions over stores — same testable shape as the builders. |
| Routing gap is never closed | Explicitly tracked as a separate concern; the user accepted partial coverage. |
