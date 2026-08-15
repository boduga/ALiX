# A9 — Pre-Execution Risk Forecast & Governance Gating Design

**Status:** Design (brainstorm → spec → plan → SDD → closeout)
**Date:** 2026-08-15
**Author:** A9 spec authoring session
**Parent program:** A-series autonomous evolution; A8 (`ca4ca307`) shipped organizational learning; A9 is the next executable frontier.
**Predecessor frontier:** A8 Organizational Learning (closed 2026-08-15). A9 recon: tickets #527, #528, #529, #530, #531, #546.
**Closes:** the pre-execution risk forecast gap. A9 emits forecasts before execution, correlates them with post-execution measurements, and routes high-risk forecasts through a new `RISK_GATED_REVIEW` governance path that maps to A3 `REQUEST_MORE_EVIDENCE` (UNDER_REVIEW state). A3 retains final decision authority.

**Locked by:** post-A8 wayfinder map #517 close-out (A9 next-frontier authorization) + 8-question grilling ticket #546 (10 architectural invariants) + recon tickets #528-#531 (4 architectural decisions).

## 1. Problem

A8 surfaces organizational patterns from history and routes them through A2.5 → A3 as MONITOR-only signals. A8 is post-hoc learning. There is no pre-execution risk lens: a proposal can be technically well-formed yet forecast to be high-risk (low confidence, hostile environment, unresolved evidence, prior failures on similar fingerprints), and the current A2.5 → A3 path has no clean gate between "submitted" and "APPROVED" for that case.

The A9 recon sequence (#527 → #546 → #528 → #529 → #530 → #531) discovered that:

1. **Identity is fragmented.** Three distinct proposal-id namespaces exist (CAP-9 SHA-256 hex, A2.5-A3 free-form, P5.1c `prop-YYYY-MM-DD-NNN`); on the CAP-9 pipeline, measurement events deliberately do NOT carry `proposalId` (CAP-10/10.5 design). The forecast-vs-realization correlation gap is structural, not heuristic.
2. **A8 normalization is lossy.** `EnrichedProposalRecord.enrichedFields` is names-only; `ProposalGovernanceRecord.capabilityId` is empty on 4/5 event kinds; `proposal.target.kind` is not propagated; `outcome-contradiction.evidenceRefs` is heterogeneous composite — A9 cannot consume A8's normalized records without losing information required for correlation.
3. **Risk vocabulary is fragmented.** A6 `RiskOutcome` is canonical across ALiX (used in `approvals/approval-store.ts:35`, `kernel/replan-approval-gate.ts:123`, `governance/investigation-types.ts:31,58`, `governance-types.ts:52,107`), but no A9 forecast contract exists to project onto it.
4. **Governance outcomes are exhausted.** A3's 4 binding kinds (`APPROVE | REJECT | MONITOR | REQUEST_MORE_EVIDENCE`) and 3 target states are LOCKED. A9 needs a "hold for review" semantic that does not collapse to REJECT or APPROVE.

A9 closes this gap by owning pre-execution risk forecasting, deterministic correlation with post-execution measurement, and a new gate (`RISK_GATED_REVIEW`) that maps to existing A3 `REQUEST_MORE_EVIDENCE` (UNDER_REVIEW) — preserving all locked A3 invariants.

## 2. Goal

A9 produces a `A9Forecast` artifact before proposal execution, projects a band (`"low" | "medium" | "high" | "critical"`) from inputs, and on high/critical emits a `GovernanceRecommendation` with `kind: "RISK_GATED_REVIEW"` at the A2.5 seam. A3 retains final decision authority — A9 is governance-gating, not governance. After execution, A9 emits a `A9Correlation` artifact connecting the forecast to the realized `CapabilityMeasurement`. A9 owns identity, persistence, and correlation; foreign contracts are read-only references.

The architectural progression: `CAP-N → CAP-O → CAP-P → A8 → A9` — each frontier adds one capability layer: A9 adds the pre-execution risk lens atop A2.5 → A3 → A4.

**A9 does NOT:**
- Mutate CAP-9 5-event taxonomy (`proposal.submitted`, `proposal.approved`, `proposal.rejected`, `proposal.executed`, `proposal.execution_failed`).
- Mutate CAP-10/10.5 measurement contracts (capability-targeted, no proposalId).
- Add a 6th governance event type.
- Re-couple the three proposal-id namespaces.
- Introduce temporal-heuristic correlation.
- Mutate A3's 4 binding kinds or 3 target states.
- Mandate A9 → A4 execution path; A9 is governance-gating only.

## 3. Non-goals

- **No A9 → A4 mandatory execution.** A9 emits a governance recommendation; A3 decides; A4 executes if APPROVED. A9 is not on the execution path.
- **No mutable `A9Forecast`.** Forecasts are immutable; corrections are new forecasts with new `forecastId`s.
- **No negative `A9Correlation` records.** Absence means absence; the ledger is positive evidence only. Failure audit (`A9CorrelationAttempt`) is NOT built speculatively.
- **No primary-designation in correlation.** Primacy is calibration semantics, not persistence. A forecast may have many supporting measurements, none flagged as "primary."
- **No CAP-9 deviation.** A9 does NOT add a forecast field to `ProposalSubmittedPayload`; A9 does NOT add `proposalId` to `CapabilityMeasurementPayload`. A9 reads raw adapter records (per #528) and correlates by other means.
- **No A8 normalization reuse.** A9 bypasses A8's normalization layer; A9 reads raw adapter records directly. A9 does NOT propose A8 contract amendments.
- **No new A2.5 binding kind beyond the 6th (`RISK_GATED_REVIEW`).** The 5 existing A2.5 kinds are LOCKED. Adding a 6th kind is the minimum change; no 7th.
- **No A3 contract change.** A3 still has 4 binding kinds; A3 still has 3 target states. A9's new-gate path maps to A3's existing `REQUEST_MORE_EVIDENCE` (UNDER_REVIEW).
- **No speculative strategy-tuning.** A9 does NOT recommend threshold changes, retry-policy changes, or risk-class remapping. Those would be a new architectural increment.
- **No TUI/Web surfaces.** CAP-11 territory.
- **No A6 domain type reuse.** A6 `CurationProposal` is a different domain (knowledge artifacts vs capability targets); A9 owns its own contracts.
- **No generalized correlation engine.** A9Correlation is a specific (forecast, measurement) ledger — not a generic foreign-key tracker.

## 4. Architecture

### 4.1 Module structure (locked)

A9 mirrors A8's `src/evolution/learning/` structure in `src/evolution/a9/`. The pattern is reused; the domain is independent.

```
src/evolution/a9/
├── contracts/
│   └── a9-contract.ts — A9Forecast, A9Correlation, A9ForecastKind, A9CorrelationKind, A9Adapter
├── adapters/
│   ├── proposal-events-adapter.ts   — read-only over EventLog capability.governance.proposal.*
│   ├── measurement-events-adapter.ts — read-only over EventLog capability.governance.measurement.*
│   └── enriched-proposals-adapter.ts — read-only over EnrichedProposal[] (P10.8a)
├── forecast-engine.ts              — runs detectors, aggregates findings → A9Forecast
├── forecast-builder.ts             — findings → A9Forecast (pure)
├── correlation-engine.ts           — emits A9Correlation after measurement
├── correlation-builder.ts          — A9Correlation (pure)
├── a9-bridge.ts                    — A9Forecast → A2.5 GovernanceRecommendation (parallel to a2-bridge.ts:61-78)
├── forecasts-adapter.ts            — read-only over forecasts.jsonl (parallel to RecommendationsAdapter)
├── correlations-adapter.ts         — read-only over correlations.jsonl
├── a9-cli.ts                       — CLI handler for `alix governance evolution forecast`
└── index.ts                        — barrel re-exports
```

Each module earns its existence through a distinct contract/seam — no mechanical 1:1 file symmetry with A8. Adapters are read-only; builders are pure functions; engines own no I/O.

### 4.2 Core contracts (locked)

```typescript
// Forecast identifier — A9-owned, content-addressed.
export type ForecastId = string;  // SHA-256(canonical(A9ForecastWithoutIdentity)) hex

// Correlation identifier — A9-owned, content-addressed.
export type CorrelationId = string;  // SHA-256(canonical(A9CorrelationWithoutIdentity)) hex

// Three forecast dimensions, aligned with A8's pure detector pattern.
export type A9ForecastKind =
  | "trust-velocity"          // forecast of trust-impact velocity (high blast-radius change)
  | "evidence-completeness"   // forecast of evidence-completeness at submission
  | "fingerprint-coincidence"; // forecast of prior-failure recurrence on same fingerprint

// Risk band — A6's canonical vocabulary, projected from internal 0-1 score.
export type RiskBand = "low" | "medium" | "high" | "critical";
// Thresholds: 0.0–0.3 → low; 0.3–0.6 → medium; 0.6–0.85 → high; 0.85–1.0 → critical
// Source: src/adaptation/risk-score-types.ts:50-61

// A9Forecast — content-addressed, immutable, A9-owned.
export interface A9Forecast {
  readonly forecastId: ForecastId;
  readonly forecastVersion: string;             // `semver` of the contract shape
  readonly subject: string;                     // canonical subject identity (capabilityId, fingerprint, etc.)
  readonly prediction: {
    readonly kind: A9ForecastKind;
    readonly band: RiskBand;                    // projected from internal score
    readonly internalScore: number;             // 0-1 float, opaque to consumers
  };
  readonly horizon: {
    readonly from: string;                      // ISO 8601 timestamp
    readonly to: string;                        // ISO 8601 timestamp
  };
  readonly confidence: number;                  // 0-1 float, A9's self-confidence in the forecast
  readonly provenance: {
    readonly generatedAt: string;               // ISO 8601 timestamp
    readonly generatorVersion: string;          // A9 generator version
    readonly evidenceRefs: ReadonlyArray<string>; // EventLog eventIds / proposalIds — preserved exactly
  };
}

// A9Correlation — append-only, positive evidence ledger, A9-owned.
export interface A9Correlation {
  readonly correlationId: CorrelationId;
  readonly correlationVersion: string;          // `semver` of the contract shape
  readonly forecastId: ForecastId;              // A9-owned reference
  readonly measurementId: string;               // foreign reference (CAP-10/10.5 CapabilityMeasurement id)
  readonly foreignProvenance: {
    readonly proposalId?: string;               // A2.5/A3 free-form OR P5.1c prop-YYYY-MM-DD-NNN OR CAP-9 SHA-256 hex
    readonly notes?: string;                    // opaque metadata for cross-namespace debugging
  };
  readonly resolution: {
    readonly band: RiskBand;                    // actual realized band (from A9Forecast projection)
    readonly forecastBand: RiskBand;            // forecasted band
    readonly delta: "match" | "under-forecast" | "over-forecast";
  };
}

// Read-only adapter over a specific evidence source.
export interface A9Adapter<T> {
  readonly name: string;
  list(): Promise<ReadonlyArray<T>>;
}
```

### 4.3 Architectural invariants (locked from #546)

1. **A9 owns identity.** every A9-owned artifact has an A9-owned deterministic identity via SHA-256 of the canonical artifact.
2. **A9 owns persistence.** forecast + correlation live in A9's own JSONL stores (`.alix/governance/forecasts.jsonl` + `.alix/governance/correlations.jsonl`).
3. **A9 owns correlation.** the relationship lives in `A9Correlation`, not in foreign surfaces.
4. **Foreign IDs remain references.** never join keys, never substitute identities.
5. **Measurements remain capability-targeted.** CAP-10/10.5 boundary preserved; A9Correlation.measurementId is a foreign reference, not a write.
6. **Correlations are positive evidence.** no negative records, no status fields, no "tried but failed" entries.
7. **Relationships are many-to-many.** independent immutable records; a forecast may have many supporting correlations; a measurement may correlate with many forecasts.
8. **Artifacts are immutable/append-only.** corrections are new records, never mutations.
9. **Calibration is interpretation, not persistence.** terminal/primary/expired states belong to A9 calibration/result semantics, not the correlation ledger.
10. **No speculative artifacts.** failure audit (A9CorrelationAttempt) is NOT built speculatively.

### 4.4 Architectural progression (locked)

```
EventLog + EnrichedProposal[] (P10.8a)
   │
   ├── proposal-events-adapter   ─┐
   ├── measurement-events-adapter ─┼──► 3 read-only adapters (raw records, NOT A8 normalized)
   └── enriched-proposals-adapter ┘
                                     │
                                     ▼
                          forecast-engine
                          (3 pure detectors: trust-velocity, evidence-completeness, fingerprint-coincidence)
                                     │
                                     ▼
                          A9Forecast (content-addressed, A9-owned)
                                     │
                                     ▼
                          a9-bridge.ts → GovernanceRecommendation(kind: "RISK_GATED_REVIEW" | "MONITOR")
                                     │
                                     ▼
                          A3 generateDecision() → APPROVE | REJECT | MONITOR | REQUEST_MORE_EVIDENCE
                                     │
                                     ▼
                          A4 (if APPROVED) / UNDER_REVIEW (if REQUEST_MORE_EVIDENCE)

                  ┌──────────────────────────────────────┐
                  │   Post-execution (separate flow)    │
                  └──────────────────────────────────────┘

EventLog (capability.governance.measurement.*)
   │
   ▼
   correlation-engine (deterministic join on forecastId + measurementId)
   │
   ▼
   A9Correlation (append-only, positive evidence ledger)
```

**A9 forecast emission runs before proposal execution.** A9 correlation emission runs after measurement realization. The two flows are independent and asynchronous; the correlation engine does not gate the forecast engine.

### 4.5 Adapters (locked from #528)

A9 reads raw adapter records, NOT A8's normalized records. Three independent read-only adapters:

**(a) `proposal-events-adapter`** — consumes `CapabilityGovernanceEvent[]` from EventLog (the 5 `capability.governance.proposal.*` event types). Returns raw records: `{ proposalId, capabilityId, kind, payload, recordedAt }`. A9 inspects `payload` directly to recover `proposal.target.kind` (A8 normalizes this away).

**(b) `measurement-events-adapter`** — consumes `CapabilityMeasurementEvent[]` from EventLog (the 2 `capability.governance.measurement.*` event types). Returns raw records: `{ measurementId, capabilityId, outcome, sourceProposalIds, recordedAt }`. A9 uses `sourceProposalIds` (CAP-10/10.5 preservation) to recover proposal-correlation bridge.

**(c) `enriched-proposals-adapter`** — consumes `EnrichedProposal[]` from P10.8a. Returns raw records: `{ proposalId, capabilityId, enrichedFields, recordedAt }`. A9 reads `enrichedFields` values directly (A8 strips to names-only).

**Why bypass A8 normalization:** 4 A8 contract gaps make A8's normalized records inadequate for A9's correlation needs. A9 reads raw records to recover information A8 strips. A8's read-only adapter boundary (T2 ruling) is preserved — A9 does not amend A8 contracts.

### 4.6 Forecast detectors (locked)

All 3 detectors are **pure functions** over raw adapter input. Each emits a 0-1 score; the engine projects to a `RiskBand` via A6's threshold function.

**(a) `trust-velocity-detector`:**
- Consumes: `proposal-events-adapter` output (raw `proposal.submitted` events)
- Input: proposal blast-radius indicators (replacing targets, capability surface area, multi-tenancy impact)
- Scoring: blast-radius-weighted adjustments to a base trust score
- Output: `internalScore ∈ [0, 1]`

**(b) `evidence-completeness-detector`:**
- Consumes: `enriched-proposals-adapter` output (raw `enrichedFields` values)
- Input: count of populated enriched fields, recency, source diversity
- Scoring: completeness × recency × diversity
- Output: `internalScore ∈ [0, 1]`

**(c) `fingerprint-coincidence-detector`:**
- Consumes: `proposal-events-adapter` output (raw `proposal.execution_failed` events)
- Input: normalized failure fingerprint (e.g., `errorCategory:capabilityId`)
- Output: `internalScore ∈ [0, 1]` — measures prior failure-density on the same fingerprint

**Risk band projection:** `internalScore → RiskBand` via A6's canonical thresholds:
```typescript
function internalScoreToBand(score: number): RiskBand {
  if (score < 0.3) return "low";
  if (score < 0.6) return "medium";
  if (score < 0.85) return "high";
  return "critical";
}
```
Source: `src/adaptation/risk-score-types.ts:50-61` (LOCKED per #529).

**A2.5 kind selection:** `RiskBand` → `GovernanceRecommendationKind`:
- `"low"` → `MONITOR` (no gate)
- `"medium"` → `MONITOR` (no gate)
- `"high"` → `RISK_GATED_REVIEW` (new 6th kind, maps to A3 REQUEST_MORE_EVIDENCE)
- `"critical"` → `RISK_GATED_REVIEW` (new 6th kind, maps to A3 REQUEST_MORE_EVIDENCE)

**Detector purity invariant:** no I/O, no implicit clock. Engine passes a deterministic timestamp; same input + same timestamp → identical forecasts.

**Concrete threshold values** (per-detector scoring weights, evidence window duration) are deferred to the plan phase. The spec defines the **predicate structure**; the plan establishes **concrete defaults**.

### 4.7 Forecast + correlation engines (locked)

- `forecastEngine.forecast(timestamp)` runs all 3 detectors against the joined raw adapter outputs. Joins happen here, not in adapters.
- `forecastEngine.forecast(timestamp)` groups findings by `subject` and returns one `A9Forecast` per subject, or `null` if no detection-worthy signal (the "no trigger → no forecast" invariant).
- **Aggregation rule (locked):** within a single subject, the engine takes the **maximum** `internalScore` across detectors and projects the highest band. This is a deterministic, monotonic aggregation — a high score from one detector is not diluted by a low score from another. The `prediction.band` is the band of the max score; the `confidence` is the average of detector confidences weighted by internal score.
- `forecastBuilder.build(findings, subject, timestamp)` constructs the `A9Forecast`. Pure function. Deterministic identity via `forecastId = SHA-256(canonical(forecastWithoutIdentity))`.
- `correlationEngine.correlate(forecastId, measurementId, timestamp)` emits an `A9Correlation` after measurement realization. Pure function modulo timestamp.
- `correlationBuilder.build(forecast, measurement, timestamp)` constructs the `A9Correlation`. Pure function. Deterministic identity via `correlationId = SHA-256(canonical(correlationWithoutIdentity))`.

**No trigger → no forecast / no correlation:** if no detection-worthy signal, the engine emits no `A9Forecast` and no `A9Correlation`. This avoids polluting the ledger with meaningless entries.

### 4.8 A9 bridge (locked from #531)

`a9-bridge.ts` parallel to `a2-bridge.ts:61-78` (A8 MONITOR-only precedent). The bridge constructs `GovernanceRecommendation` from the `A9Forecast`:

```typescript
export function buildGovernanceRecommendation(
  forecast: A9Forecast,
): GovernanceRecommendation {
  // Locked: high/critical → RISK_GATED_REVIEW (6th A2.5 kind).
  // Locked: low/medium → MONITOR (no gate).
  const kind: GovernanceRecommendationKind =
    forecast.prediction.band === "high" || forecast.prediction.band === "critical"
      ? "RISK_GATED_REVIEW"
      : "MONITOR";

  return {
    id: forecast.forecastId,  // A9 owns the identity; A2.5 references it
    kind,
    confidence: forecast.confidence,
    sourceArtifactId: forecast.forecastId,
    evidenceRefs: [...forecast.provenance.evidenceRefs],
    rationale: `A9 forecast: ${forecast.prediction.kind} → ${forecast.prediction.band}`,
  };
}
```

The A2.5 → A3 mapping (`RECOMMENDATION_KIND_MAP`) needs extension to handle the new 6th kind. The minimum extension: `RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE` (UNDER_REVIEW target state). A3's 4 binding kinds and 3 target states are PRESERVED.

### 4.9 Persistence (locked from #530 + #546)

A9 owns two append-only JSONL stores:

- `.alix/governance/forecasts.jsonl` — A9Forecast records, one per line. Mirrors A2.5 recommendations JSONL pattern.
- `.alix/governance/correlations.jsonl` — A9Correlation records, one per line. Mirrors A2.5 recommendations JSONL pattern.

**Runtime path:** `.alix/governance/forecasts.jsonl` + `.alix/governance/correlations.jsonl` (alongside A2.5 recommendations JSONL).
**Module ownership:** `src/evolution/a9/` (alongside A8 `src/evolution/learning/` source module).

**Canonical correlation key:** `proposalId` (per #530). Forecasts are per-proposal per the locked authority model A9 → A2.5 → A3 → A4. The forecast emits with `subject = proposalId`; the correlation joins on `forecastId` (A9-owned) and adds `proposalId` to `foreignProvenance` for cross-namespace debugging.

**Reads via:** `ForecastsAdapter` + `CorrelationsAdapter` parallel to `RecommendationsAdapter` (A8 precedent). Adapters are read-only; no write surface.

**A9 persistence is self-sufficient for A9 provenance.** Foreign stores are NOT required to know a correlation existed; only for dereferencing/enrichment.

### 4.10 CLI (locked)

`alix governance evolution forecast [--dimension ...] [--json]`

Single namespace. The detector taxonomy is internal; the operator surface is `forecast`. Output: the `A9Forecast` (or a "no findings" notice if no forecast was emitted). High/critical forecasts are surfaced with the `RISK_GATED_REVIEW` A2.5 kind projection.

Correlation runs are emitted asynchronously after measurement; no CLI surface for correlation emission (correlation is automatic, not operator-initiated).

CLI registration via the minimum existing CLI registration seam — A9 does NOT introduce a new CLI binary. The CLI registration touch is the only permitted modification outside `src/evolution/a9/` and A9-specific tests.

## 5. Data flow

### 5.1 Forecast emission (pre-execution)

1. Engine initializes with 3 raw adapters (composition-root-owned; A9 doesn't instantiate adapters itself).
2. Operator invokes `alix governance evolution forecast` (or programmatic equivalent).
3. Engine calls each adapter's `list()`, gets raw evidence records.
4. Engine runs each of the 3 pure detectors over its assigned raw evidence.
5. Engine aggregates findings into a single `A9Forecast` (or returns `null` if no detection-worthy signal).
6. `correlationId-keyless`: A9Forecast is committed to `.alix/governance/forecasts.jsonl` (append-only).
7. `a9-bridge.ts` builds `GovernanceRecommendation(kind: "RISK_GATED_REVIEW" | "MONITOR")` from the forecast.
8. A2.5 → A3 mapping routes: `RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE` (UNDER_REVIEW) | `MONITOR → MONITOR` (existing).
9. A3 `generateDecision()` returns the binding decision.
10. CLI surfaces the decision + the underlying `A9Forecast`.

A9 never writes to EventLog, ProposalStore, or any other store. A9 owns its own JSONL only.

### 5.2 Correlation emission (post-execution)

1. Measurement event `capability.governance.measurement.measured` arrives in EventLog.
2. `correlationEngine` observes the event (via `subscription` or scheduled poll — concrete mechanism deferred to plan).
3. Engine queries `forecasts.jsonl` for **all** `A9Forecast` records whose `subject` matches the `capabilityId` AND whose `horizon.to` is `≥ measurement.recordedAt`. Multiple matches are expected (one-to-many + many-to-many); the engine emits one `A9Correlation` per (forecastId, measurementId) pair.
4. Engine constructs `A9Correlation` per pair joining `forecastId` (A9-owned) + `measurementId` (foreign) + `proposalId` (foreign provenance, from `sourceProposalIds`).
5. Each `A9Correlation` is committed to `.alix/governance/correlations.jsonl` (append-only).
6. No governance re-evaluation. Correlation is evidence, not authorization.

**Deterministic join, not a heuristic.** A9 reads the `subject` (proposalId / capabilityId) directly from the raw adapter record and joins by exact equality. The horizon check is a validity bound (forecast still applies), not a recency preference. There is no "most recent" selection — the engine correlates with every still-valid forecast on the same subject, preserving the many-to-many invariant.

## 6. Composition root

The 3 raw adapters are constructed by the composition root at `src/capability/platform.ts` (or equivalent) and passed to `ForecastEngine` at construction. The A9 bridge is registered alongside A2.5's `a2-bridge.ts` in the A2.5 → A3 mapping factory. ForecastsAdapter + CorrelationsAdapter are also composition-root-owned.

**CAP-12 forbidden-file carve-out:** A9 adds `src/capability/platform.ts` to the CAP-12 forbidden list (extends CAP-P's carve-out for `capability-service.ts` + `platform.ts`). All other CAP-12 forbidden files remain forbidden. A9 requires the composition-root wiring path; the CLI registration touch is the only permitted modification outside `src/evolution/a9/`.

## 7. Migration boundary

No migration. A9 introduces a new module; no existing data structures change. Existing A6, CAP-N, CAP-O, CAP-P, A8, EventLog, A2.5, A3, and P10.8a modules are consumed unchanged.

The A2.5 → A3 mapping (`RECOMMENDATION_KIND_MAP`) gains exactly one new entry: `RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE`. All existing mapping entries are preserved.

The 6th A2.5 kind (`RISK_GATED_REVIEW`) is added to the `GovernanceRecommendationKind` union. The 5 existing kinds are preserved. The 7th-kind prohibition is locked.

## 8. Error handling

- **Adapter failure** — engine catches and logs; engine continues with partial evidence (other adapters' results still valid). Findings carry an `evidenceSourceUnavailable` annotation when their source adapter failed.
- **Detector throw on malformed input** — engine catches per-detector; continues with remaining detectors. Failures are surfaced via the CLI but do not abort the engine run.
- **Forecast builder identity collision** — SHA-256 collision is astronomically improbable; if detected, the engine throws a deterministic error and emits no forecast. The collision is a load-bearing failure and must surface.
- **Correlation join miss** —silent absence. No A9Correlation emitted. No negative record. The miss is observable via the gap between forecast count and correlation count in the JSONL.
- **A3 returns REJECT** — possible if `verificationEvidence` is malformed (per A3's `failClosedOnExpiredEvidence`). A9's bridge constructs minimal evidence so A3 should not reject under normal operation; if it does, surface the failure to the operator.
- **JSONL write failure** — engine throws; the forecast is NOT committed. The CLI surfaces the write failure. No partial-state risk because JSONL writes are atomic (single line).

## 9. Testing strategy

### 9.1 Unit tests — `tests/evolution/a9-forecast-detectors.vitest.ts`

Per detector:
- Empty input → 0 findings → `null` forecast
- Below threshold → 0 findings → `null` forecast
- At/above threshold on same identity key → 1 finding → 1 forecast
- Above threshold split across identity keys → N findings → N forecasts (one per subject, max-score aggregation)
- Determinism: same input + same timestamp twice → identical forecasts (same `forecastId`)
- Evidence references preserved exactly in each forecast
- Internal score → RiskBand projection matches A6 thresholds exactly

Engine aggregation:
- Multiple findings from different detectors → 1 `A9Forecast` (subject-aggregated)
- 0 findings across all detectors → `null` (no forecast emitted)

### 9.2 Adapter tests — `tests/evolution/a9-adapters.vitest.ts`

- Each adapter's `list()` returns expected raw (un-normalized) record shape
- Read-only invariant: no mutation surface exposed on adapter interfaces
- Empty source store → empty list
- A9 reads `payload` directly (not A8's normalized Records)
- A9 reads `enrichedFields` values directly (not A8's names-only)

### 9.3 Persistence tests — `tests/evolution/a9-persistence.vitest.ts`

- `forecasts.jsonl` append-only on forecast emission
- `correlations.jsonl` append-only on correlation emission
- `forecastId` deterministic from canonical forecast (same content → same id)
- `correlationId` deterministic from canonical correlation (same content → same id)
- Foreign IDs preserved as references (not joined into identity)
- Negative-record prohibition: no `A9Correlation` emitted on join miss
- Read adapters expose the same content that was written

### 9.4 Bridge tests — `tests/evolution/a9-bridge.vitest.ts`

- `low`/`medium` band → `MONITOR` A2.5 kind
- `high`/`critical` band → `RISK_GATED_REVIEW` A2.5 kind
- A2.5 → A3 mapping routes `RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE` (UNDER_REVIEW)
- Existing 5 A2.5 kinds all unchanged (regression)
- A3 still has 4 binding kinds (regression)
- A3 still has 3 target states (regression)

### 9.5 Integration test — `tests/evolution/a9-engine-end-to-end.vitest.ts`

- Engine runs all 3 detectors on raw EventLog + `EnrichedProposal[]` fixtures
- Full flow: adapters → detectors → `A9Forecast` → A9 bridge → A2.5 `GovernanceRecommendation` → A3 `generateDecision()` → binding decision
- 0-finding run → `null` → no A9 bridge call → no A3 call
- High/critical forecast → `RISK_GATED_REVIEW` → A3 `REQUEST_MORE_EVIDENCE` (UNDER_REVIEW)
- Low/medium forecast → `MONITOR` → A3 `MONITOR` or `APPROVE` (existing)

### 9.6 Sentinel test — `tests/evolution/a9-sentinel.vitest.ts`

Structural + behavioral invariants:
- A9 owns identity: `forecastId` is SHA-256 of canonical forecast
- A9 owns correlation: `A9Correlation` lives in `correlations.jsonl`, not in foreign surfaces
- Foreign IDs remain references: `measurementId` is a foreign reference, not a write
- Measurements remain capability-targeted: no `proposalId` field on `CapabilityMeasurementPayload` (regression)
- 5-event taxonomy preserved: no 6th `capability.governance.*` event type (regression)
- A2.5 → A3 mapping has exactly 6 kinds (5 existing + `RISK_GATED_REVIEW`)
- A3 still has 4 binding kinds (regression)
- A3 still has 3 target states (regression)
- A9 source files MUST NOT import from `enriched-proposal-aggregator.ts` or A8 normalization layer (A9 reads raw)

### 9.7 Regression

Full test suite (A6 + A8 + CAP-N + CAP-O + CAP-P + all evolution tests + A9 tests) must remain green. New tests: ≥3 detector unit tests + 3 adapter tests + ≥3 persistence tests + ≥3 bridge tests + ≥1 integration test + ≥1 sentinel test = ≥14 new tests. Zero regressions.

## 10. Forward compatibility

- **A9 strategy-tuning** (a future capability, not in A9 v1) would be a new architectural increment, not an A9 expansion.
- **4th forecast detector kind** (e.g., trust-velocity drift, evidence-source diversity) would be a new architectural increment.
- **A9CorrelationAttempt** (failure audit) — separately authorized; NOT built speculatively.
- **Calibration/result semantics** — separate concern from correlation; A9 v1 emits forecasts + correlations; calibration interpretation is a future architectural increment.
- **A9 → A4 conditional execution** — A9 is currently governance-gating only; future A9 → A4 conditional skip (e.g., execute on low risk, skip on critical) would be a new architectural increment.

## 11. Out of scope

- TUI/Web surfaces (CAP-11 territory)
- A9 strategy-tuning (governance config mutation, threshold mutation, risk-class remapping)
- A9CorrelationAttempt (failure audit)
- A9 calibration/result semantics
- A9 → A4 conditional execution
- A9 persistence (CAP-9 / CAP-10 / CAP-10.5 deviation)
- A9 → A2.5-A3 contract coupling beyond the 6th kind + 1 mapping entry
- A9 domain type reuse (A6 `CurationProposal`, A8 `LearningProposal`)
- A9 real-time risk dashboard (would require mutation of A2.5 → A3 mapping semantics)
- M2/M3 governance signal delivery/replay

## 12. References

- A9 recon #527 findings: `~/.claude/projects/-home-babasola-Projects-Monolith/memory/a9-527-recon-findings.md`
- A9 recon #546 10 invariants: `~/.claude/projects/-home-babasola-Projects-Monolith/memory/a9-546-grilling-locked.md`
- A9 recon #528-#531 decisions: `~/.claude/projects/-home-babasola-Projects-Monolith/memory/a9-528-531-recon-locked.md`
- A9 wayfinder map #526: `~/.claude/projects/-home-babasola-Projects-Monolith/memory/a9-wayfinder-charted.md`
- A8 spec (pattern template): `docs/superpowers/specs/2026-08-14-a8-organizational-learning-design.md`
- A8 implementation: `src/evolution/learning/` (architectural pattern, not domain types)
- A6 `RiskOutcome`: `src/adaptation/risk-score-types.ts:50-61` (vocabulary + thresholds)
- A6 implementation: `src/evolution/knowledge/` (pattern template)
- A2.5 `GovernanceRecommendation`: `src/governance/governance-types.ts:172`
- A2.5 → A3 mapping: `src/evolution/governance/decision-engine.ts` (extended with 6th kind)
- A8 a2-bridge.ts: `src/evolution/learning/` (parallel pattern for a9-bridge.ts)
- A3 `generateDecision`: `src/evolution/governance/decision-engine.ts:123`
- EventLog event types: `src/capability/governance/governance-types.ts:99-103`
- `EnrichedProposal`: `src/adaptation/intelligence-types.ts`; aggregated by `src/adaptation/bucket-aggregator.ts`
- A-series lineage: `docs/architecture/ma0-alix-architecture-2-0.md` §A0-A9; `docs/roadmap/a-series-autonomous-evolution.md`
- A8 organizational learning memory: `~/.claude/projects/-home-babasola-Projects-Monolith/memory/a8-organizational-learning-complete.md`
- CAP-N spec: `docs/superpowers/specs/2026-08-14-cap-n-end-to-end-create-path-design.md`
- CAP-O spec: `docs/superpowers/specs/2026-08-14-cap-o-underperformer-update-path-design.md`
- CAP-P spec: `docs/superpowers/specs/2026-08-15-cap-p-consolidation-execution-design.md`
- ADR-0008 (A-series evolution)
- ADR-0013 §4/§5/§7 (provider abstraction + execution binding + lifecycle)
- A8 MONITOR-only bridge precedent: `src/evolution/learning/a2-bridge.ts:61-78`
- A8 RecommendationsAdapter pattern: `src/evolution/learning/` (parallel pattern for ForecastsAdapter)
