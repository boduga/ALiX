Yes. The right move is to produce a **single authoritative corrected spec**, not keep patching the draft conversationally.

Below is the full corrected version incorporating **Q1–Q8**, including the two defects exposed by Q8 and the semantic distinction between **correlation/evidence** and **calibration/realization**.

````md
# A9 — Pre-Execution Risk Forecast & Governance Gating Design

**Status:** Design (brainstorm → spec → plan → SDD → closeout)  
**Date:** 2026-08-15  
**Author:** A9 spec authoring session  
**Parent program:** A-series autonomous evolution  
**Predecessor frontier:** A8 Organizational Learning (closed 2026-08-15)  
**A9 recon:** #527, #528, #529, #530, #531, #546  
**Decision authority:** A3 retains final governance decision authority

---

## 1. Problem

A8 surfaces organizational patterns from history and routes them through A2.5 → A3 as MONITOR-only signals. A8 is post-hoc learning.

There is no pre-execution risk lens: a proposal can be technically well-formed yet forecast to be high-risk because of low confidence, hostile execution conditions, incomplete evidence, high blast radius, or recurrence of prior failures.

The current A2.5 → A3 path has no clean gate between "submitted" and "approved" for that case.

The A9 recon sequence (#527 → #546 → #528 → #529 → #530 → #531) established:

1. **Identity is fragmented.**
   Three distinct proposal-id namespaces exist:
   - CAP-9 SHA-256 hex
   - A2.5/A3 free-form proposal identifiers
   - P5.1c `prop-YYYY-MM-DD-NNN`

   A9 therefore cannot treat a foreign proposal ID as its own identity.

2. **Measurement identity is intentionally capability-scoped.**
   CAP-10/10.5 measurement events are capability-targeted and do not carry proposal identity. A9 must not modify that contract to solve correlation.

3. **A8 normalization is lossy.**
   `EnrichedProposalRecord.enrichedFields` is names-only; `ProposalGovernanceRecord.capabilityId` is empty on 4/5 event kinds; `proposal.target.kind` is not propagated; and `outcome-contradiction.evidenceRefs` is heterogeneous composite.

   A9 therefore reads raw canonical sources rather than relying on A8's normalized surface.

4. **Risk vocabulary is fragmented.**
   A6's `RiskOutcome` vocabulary and thresholds are canonical for risk-band projection, but no A9 forecast contract exists.

5. **Governance outcomes are exhausted.**
   A3's four binding kinds are locked:

   ```text
   APPROVE
   REJECT
   MONITOR
   REQUEST_MORE_EVIDENCE
````

A9 requires a distinct pre-execution gate semantic without introducing a fifth A3 binding decision.

6. **The forecast/measurement correlation boundary is structural.**
   Measurement records do not carry proposal identity. A9 therefore cannot perform a direct proposalId → measurementId join.

A9 closes this gap by owning:

* pre-execution risk forecasting;
* deterministic proposal-to-capability correlation metadata;
* post-execution evidence correlation;
* a new A2.5 `RISK_GATED_REVIEW` recommendation kind;
* mapping of that recommendation to A3's existing `REQUEST_MORE_EVIDENCE` decision.

A3 retains final decision authority.

---

# 2. Goal

A9 produces an immutable, content-addressed `A9Forecast` before proposal execution.

The forecast:

* is owned and persisted by A9;
* is identified by an A9-owned deterministic `forecastId`;
* is scoped to a proposal;
* preserves the proposal's canonical capability target as an immutable bridge attribute;
* projects risk onto:

  ```text
  low | medium | high | critical
  ```

For high/critical forecasts, A9 emits an A2.5 `GovernanceRecommendation` with:

```text
kind = RISK_GATED_REVIEW
```

A2.5 maps this to:

```text
REQUEST_MORE_EVIDENCE
```

and A3 retains final decision authority.

After execution, A9 may emit immutable `A9Correlation` records connecting an A9 forecast to capability measurements **only when an existing deterministic canonical bridge establishes correlation eligibility**.

A9 owns the correlation relationship and its identity.

Foreign identities remain references/provenance.

---

# 3. Locked Architectural Decisions — Q1–Q8

## Q1 — Forecast identity

`forecastId` is A9-owned.

It is deterministically derived:

```text
forecastId =
  SHA-256(canonical(A9ForecastWithoutIdentity))
```

Foreign proposal identifiers never substitute for `forecastId`.

---

## Q2 — Correlation artifact

`A9Correlation` is an immutable A9-owned positive evidence artifact.

A correlation is written only when correlation can be deterministically established.

Absence means:

```text
unresolved / unestablished
```

It does **not** mean:

```text
open
failed
abandoned
expired
```

A9 does not continuously observe measurements merely to promise a future correlation.

The correlation operation writes a record only when it has sufficient information to assert the relationship.

Corrections are new records.

Existing records are never mutated.

---

## Q3 — A9 identity ownership

A9 is an **identity owner**, not merely an identity bridge.

Every A9-owned artifact has an A9-owned deterministic identity.

Therefore:

```text
A9Forecast       → forecastId
A9Correlation    → correlationId
```

Foreign identifiers are references/provenance only.

Foreign identifiers never substitute for A9 identity.

Canonicalization excludes mutable/incidental fields such as:

* timestamps that represent write timing rather than artifact content;
* sequence numbers;
* storage locations;
* filesystem paths;
* other mutable persistence metadata.

Identity must be reproducible from the artifact's canonical semantic content.

---

## Q4 — Persistence and restart durability

A9 owns two separate append-only JSONL stores:

```text
.alix/governance/forecasts.jsonl
.alix/governance/correlations.jsonl
```

Forecast and correlation stores have separate lifecycles and therefore remain separate files.

A9 persistence is self-sufficient for A9 provenance.

A foreign store must not know that a correlation existed.

Foreign stores are consulted only for:

* dereferencing;
* enrichment;
* establishing an existing canonical correlation bridge.

A9 uses read-only adapters over canonical foreign sources.

A9 never copies foreign records into its own namespace merely to make correlation possible.

No destructive pruning is part of the initial A9 persistence contract.

---

## Q5 — Forecast-to-measurement cardinality

A forecast may have many supporting measurements.

There is no primary measurement at the correlation layer.

`A9Correlation` answers:

> What evidence is related to this forecast?

It does not answer:

> Which measurement is the realized outcome?

That distinction belongs to future calibration/result semantics.

Multiple independent immutable correlation records may therefore reference the same forecast:

```text
F1 → M1
F1 → M2
F1 → M3
```

No measurement is marked primary.

Conflicting evidence is preserved.

A9 does not resolve conflicts at the correlation layer.

---

## Q6 — Measurement reuse

A measurement may support multiple forecasts.

Many-to-many relationships emerge naturally from independent `A9Correlation` records:

```text
F1 → M
F2 → M
F3 → M
```

No reverse pointer is added to the measurement.

No measurement-group artifact is introduced.

No maximum forecast-per-measurement cardinality is enforced.

Measurements are evidence, not consumable resources.

The relationship is structurally acyclic:

```text
A9Forecast → Measurement
```

A measurement never becomes an A9Forecast node.

---

## Q7 — Unavailable correlation

No persisted correlation-status field exists on `A9Forecast`.

There is no:

```text
correlationStatus: "open" | "resolved"
```

There are no negative `A9Correlation` records.

There is no speculative `A9CorrelationAttempt` artifact.

Absence from `correlations.jsonl` means only:

```text
correlation unresolved / unestablished
```

It does not assert whether A9 attempted correlation.

If failure auditing becomes necessary, `A9CorrelationAttempt` must be separately authorized as a future architectural increment.

---

## Q8 — Measurement namespace boundary

CAP-10/10.5 measurement contracts remain unchanged.

A9 MUST NOT add:

```text
proposalId
sourceProposalIds
forecastId
correlationId
```

or any other A9 relationship field to `CapabilityMeasurementPayload`.

The measurement surface remains capability-targeted.

A9 owns the relationship externally through `A9Correlation`.

The existing canonical bridge is:

```text
A9Forecast.subject
        =
proposal.submitted.proposalId

A9Forecast.subjectCapability
        =
proposal.submitted.payload.target.id

A9Forecast.subjectCapability
        =
measurement.capabilityId
```

The proposal's execution status is separately authorized through:

```text
proposal.executed
```

No foreign surface is modified.

---

# 4. A9 Architecture

## 4.1 Module structure

A9 mirrors the architectural shape of A8's `src/evolution/learning/` module without reusing A8 domain contracts.

```text
src/evolution/a9/
├── contracts/
│   └── a9-contract.ts
│
├── adapters/
│   ├── proposal-events-adapter.ts
│   ├── measurement-events-adapter.ts
│   └── enriched-proposals-adapter.ts
│
├── forecast-engine.ts
├── forecast-builder.ts
├── correlation-engine.ts
├── correlation-builder.ts
│
├── a9-bridge.ts
│
├── forecasts-adapter.ts
├── correlations-adapter.ts
│
├── a9-cli.ts
└── index.ts
```

Each module must correspond to a distinct contract or architectural seam.

Mechanical file symmetry with A8 is not required.

---

# 5. Core Contracts

## 5.1 Identity types

```typescript
export type ForecastId = string;
// SHA-256(canonical(A9ForecastWithoutIdentity))

export type CorrelationId = string;
// SHA-256(canonical(A9CorrelationWithoutIdentity))
```

---

## 5.2 Forecast kinds

```typescript
export type A9ForecastKind =
  | "trust-velocity"
  | "evidence-completeness"
  | "fingerprint-coincidence";
```

---

## 5.3 Risk band

```typescript
export type RiskBand =
  | "low"
  | "medium"
  | "high"
  | "critical";
```

Risk-band projection uses the canonical A6 thresholds:

```typescript
function internalScoreToBand(score: number): RiskBand {
  if (score < 0.3) return "low";
  if (score < 0.6) return "medium";
  if (score < 0.85) return "high";
  return "critical";
}
```

Thresholds:

```text
0.0 ≤ score < 0.3     → low
0.3 ≤ score < 0.6     → medium
0.6 ≤ score < 0.85    → high
0.85 ≤ score ≤ 1.0    → critical
```

---

# 6. A9Forecast

```typescript
export interface A9Forecast {
  readonly forecastId: ForecastId;

  readonly forecastVersion: string;

  /**
   * Foreign proposal identity.
   *
   * This is the canonical proposal identifier supplied by the
   * proposal event surface. It is NOT A9 identity.
   */
  readonly subject: string;

  /**
   * Immutable capability-target snapshot copied from:
   *
   * proposal.submitted.payload.target.id
   *
   * This is a derived bridge attribute, not an independent
   * source of truth.
   */
  readonly subjectCapability: string;

  readonly prediction: {
    readonly kind: A9ForecastKind;
    readonly band: RiskBand;
    readonly internalScore: number;
  };

  readonly horizon: {
    readonly from: string;
    readonly to: string;
  };

  readonly confidence: number;

  readonly provenance: {
    readonly generatedAt: string;
    readonly generatorVersion: string;

    /**
     * Preserved canonical evidence references.
     */
    readonly evidenceRefs: ReadonlyArray<string>;
  };
}
```

### Identity rule

`forecastId` is calculated from the canonical semantic content of the forecast excluding identity and incidental persistence metadata.

The canonical identity input includes:

* `forecastVersion`;
* `subject`;
* `subjectCapability`;
* `prediction`;
* `horizon`;
* `confidence`;
* semantic provenance references.

It excludes:

* storage location;
* JSONL line number;
* append sequence;
* unrelated persistence metadata.

---

# 7. A9Correlation

```typescript
export interface A9Correlation {
  readonly correlationId: CorrelationId;

  readonly correlationVersion: string;

  /**
   * A9-owned reference.
   */
  readonly forecastId: ForecastId;

  /**
   * Foreign CAP-10/10.5 measurement identity.
   */
  readonly measurementId: string;

  readonly foreignProvenance: {
    /**
     * Foreign proposal identity.
     *
     * This is provenance only.
     */
    readonly proposalId?: string;

    readonly notes?: string;
  };

  /**
   * Evidence relationship metadata.
   *
   * This does NOT designate a primary realization.
   */
  readonly resolution: {
    readonly band: RiskBand;
    readonly forecastBand: RiskBand;

    readonly delta:
      | "match"
      | "under-forecast"
      | "over-forecast";
  };
}
```

`correlationId` is:

```text
SHA-256(
  canonical(
    A9CorrelationWithoutIdentity
  )
)
```

The canonical identity excludes:

* storage location;
* JSONL position;
* append sequence;
* incidental timestamps where they are not semantic content.

---

# 8. Correlation Semantics

`A9Correlation` means:

> This measurement is deterministically established as supporting evidence for this forecast.

It does **not** mean:

> This measurement is the unique realized outcome of this forecast.

It does **not** mean:

> This measurement was caused by this proposal.

It does **not** designate a primary measurement.

It does **not** resolve conflicting measurements.

Calibration/result semantics are a separate future concern.

---

# 9. Foreign Adapters

All foreign adapters are read-only.

```typescript
export interface A9Adapter<T> {
  readonly name: string;

  list(): Promise<ReadonlyArray<T>>;
}
```

A9 adapters expose no mutation methods.

---

## 9.1 Proposal events adapter

Consumes raw `CapabilityGovernanceEvent` records from EventLog.

It exposes the canonical proposal event information needed by A9:

```typescript
{
  proposalId,
  capabilityId,
  kind,
  payload,
  recordedAt
}
```

The adapter does not normalize away:

```text
proposal.target.kind
proposal.target.id
```

A9 reads the raw payload directly.

The canonical proposal bridge is:

```text
proposal.submitted.proposalId
proposal.submitted.payload.target.id
```

The adapter also exposes the canonical:

```text
proposal.executed
```

event required by the correlation eligibility gate.

---

## 9.2 Measurement events adapter

Consumes raw:

```text
capability.governance.measurement.*
```

events.

The adapter returns:

```typescript
{
  measurementId,
  capabilityId,
  outcome,
  recordedAt
}
```

It MUST NOT expose or manufacture:

```text
proposalId
sourceProposalIds
forecastId
correlationId
```

because those do not belong to the CAP-10/10.5 measurement contract.

---

## 9.3 Enriched proposals adapter

Consumes raw `EnrichedProposal[]` from P10.8a.

It exposes:

```text
proposalId
capabilityId
enrichedFields
recordedAt
```

A9 reads `enrichedFields` values directly.

A9 does not consume A8's normalized learning records.

---

# 10. Why A9 bypasses A8 normalization

A8 normalization is intentionally lossy.

A9 requires information that A8 does not preserve in its normalized surface.

Examples include:

* raw proposal target information;
* proposal target kind;
* raw enriched field values;
* heterogeneous evidence references.

Therefore:

```text
A8 normalized records
        X
        │
        │ not an A9 dependency
        ▼
A9 raw adapters
```

A9 does not amend A8 contracts.

A9 does not alter A8 normalization.

---

# 11. Forecast Detectors

All detectors are pure functions.

They:

* perform no I/O;
* use no implicit clock;
* receive deterministic timestamps from the engine;
* produce deterministic results for identical input.

---

## 11.1 Trust velocity detector

Consumes proposal-event records.

Inputs include proposal blast-radius indicators such as:

* replacing targets;
* capability surface area;
* multi-tenancy impact.

Output:

```text
internalScore ∈ [0, 1]
```

Concrete scoring weights are deferred to plan phase.

---

## 11.2 Evidence completeness detector

Consumes enriched proposal records.

Inputs include:

* populated enriched fields;
* evidence recency;
* source diversity.

Scoring structure:

```text
completeness × recency × diversity
```

Output:

```text
internalScore ∈ [0, 1]
```

Concrete weights are deferred to plan phase.

---

## 11.3 Fingerprint coincidence detector

Consumes historical `proposal.execution_failed` events.

Input:

```text
normalized failure fingerprint
```

Example:

```text
errorCategory:capabilityId
```

Output:

```text
internalScore ∈ [0, 1]
```

Concrete fingerprint scoring is deferred to plan phase.

---

# 12. Forecast Aggregation

The engine executes all applicable detectors.

Findings are grouped by:

```text
proposalId
```

Each proposal receives at most one forecast per forecast operation.

Within a subject:

```text
aggregateScore =
  max(detector.internalScore)
```

The highest score determines the risk band.

This is deterministic and monotonic.

A high-risk detector finding cannot be diluted by a low-risk finding.

Confidence is the detector-confidence weighted by internal score.

---

# 13. No Trigger → No Forecast

If no detector produces a detection-worthy finding:

```text
forecastEngine.forecast()
→ null / empty result
```

No `A9Forecast` is written.

This prevents meaningless forecast records from polluting the ledger.

---

# 14. Forecast Builder

```typescript
forecastBuilder.build(
  findings,
  subject,
  subjectCapability,
  timestamp,
)
```

is pure.

It:

1. aggregates detector findings;
2. constructs the semantic forecast;
3. canonicalizes the forecast;
4. derives `forecastId`;
5. returns the immutable `A9Forecast`.

The builder does not perform persistence.

---

# 15. A9 Governance Bridge

`a9-bridge.ts` constructs the A2.5 recommendation.

```typescript
export function buildGovernanceRecommendation(
  forecast: A9Forecast,
): GovernanceRecommendation {
  const kind: GovernanceRecommendationKind =
    forecast.prediction.band === "high" ||
    forecast.prediction.band === "critical"
      ? "RISK_GATED_REVIEW"
      : "MONITOR";

  return {
    id: forecast.forecastId,
    kind,
    confidence: forecast.confidence,
    sourceArtifactId: forecast.forecastId,
    evidenceRefs: [
      ...forecast.provenance.evidenceRefs,
    ],
    rationale:
      `A9 forecast: ` +
      `${forecast.prediction.kind} → ` +
      `${forecast.prediction.band}`,
  };
}
```

A9 owns the identity.

A2.5 references it.

---

# 16. Governance Mapping

A9 introduces exactly one new A2.5 recommendation kind:

```text
RISK_GATED_REVIEW
```

Mapping:

```text
RISK_GATED_REVIEW
        ↓
REQUEST_MORE_EVIDENCE
        ↓
UNDER_REVIEW
```

Existing A2.5 kinds remain unchanged.

A3 remains unchanged.

A3 still owns the final binding decision.

---

# 17. Risk Band → Governance Recommendation

```text
low
  → MONITOR

medium
  → MONITOR

high
  → RISK_GATED_REVIEW

critical
  → RISK_GATED_REVIEW
```

A9 does not itself approve or reject a proposal.

---

# 18. Persistence

A9 owns exactly two initial persistence surfaces:

```text
.alix/governance/forecasts.jsonl
.alix/governance/correlations.jsonl
```

Both are:

* append-only;
* restart-readable;
* immutable at the record level;
* independently owned by A9.

Corrections create new records.

No destructive pruning is specified for v1.

---

# 19. Restart Durability

After complete shutdown and memory loss:

A9 can reconstruct its own provenance entirely from:

```text
forecasts.jsonl
correlations.jsonl
```

Foreign sources are not needed to establish that an A9 correlation existed.

Foreign sources are needed only when A9 needs to:

* dereference a foreign identity;
* enrich a record;
* establish a new correlation eligibility relationship.

---

# 20. Correlation Architecture

The correlation relationship is:

```text
A9Forecast
    │
    ├── subject = proposalId
    │
    └── subjectCapability = capabilityId
              │
              ▼
       canonical EventLog
```

The forecast stores `subjectCapability` as an immutable derived bridge value.

The authoritative source for that value is:

```text
proposal.submitted.payload.target.id
```

The stored `subjectCapability` is a snapshot.

It is not a second source of truth.

---

# 21. Deterministic Correlation Bridge

The canonical bridge is a two-hop exact-equality relationship.

### Hop 1 — proposal identity

```text
forecast.subject
    ==
proposal.submitted.proposalId
```

This establishes which canonical proposal produced the forecast.

### Hop 2 — capability identity

```text
forecast.subjectCapability
    ==
measurement.capabilityId
```

This establishes that the measurement concerns the same capability target.

No temporal proximity is used to identify the proposal.

No payload similarity is used.

No "most recent" selection is used.

No fuzzy matching is used.

---

# 22. Execution Eligibility Gate

Before emitting a correlation, A9 must establish that the forecasted proposal actually reached execution.

The canonical gate is:

```text
proposal.executed
```

for:

```text
forecast.subject
```

The execution event establishes:

> the proposal associated with this forecast reached execution.

It does **not** establish:

> a particular measurement was caused by this proposal.

That distinction is essential because CAP-10/10.5 intentionally removes proposal identity from measurement events.

---

# 23. Correlation Algorithm

For each measurement event:

### Step 1

Read:

```text
forecast.subject
forecast.subjectCapability
forecast.forecastId
forecast.horizon
```

from A9's persisted forecast store.

### Step 2

Resolve the canonical proposal event:

```text
proposal.submitted.proposalId
```

and verify:

```text
proposal.submitted.payload.target.id
==
forecast.subjectCapability
```

### Step 3

Verify execution eligibility:

```text
proposal.executed.proposalId
==
forecast.subject
```

If the proposal never executed, no correlation is emitted.

### Step 4

Find measurements satisfying:

```text
measurement.capabilityId
==
forecast.subjectCapability
```

and:

```text
forecast.horizon.from
≤ measurement.recordedAt
≤ forecast.horizon.to
```

The horizon is a validity bound.

It is not a recency ranking.

### Step 5

For every eligible `(forecastId, measurementId)` pair, build:

```text
A9Correlation
```

with:

```text
foreignProvenance.proposalId =
    forecast.subject
```

### Step 6

Persist the correlation append-only.

---

# 24. What the Correlation Algorithm Does NOT Do

A9 MUST NOT:

* select the most recent measurement;
* select the closest measurement in time;
* compare payload similarity;
* infer proposal identity from capability equality alone;
* add proposal identity to measurement events;
* modify measurement records;
* modify proposal records;
* infer causality;
* designate a primary measurement;
* resolve conflicting evidence;
* create negative correlation records.

---

# 25. Correlation Eligibility Is an Architectural Fact

The governing rule is:

> **A9 may correlate a forecast with a measurement only when an existing canonical, deterministic bridge establishes eligibility. The bridge may span multiple read-only canonical sources. A9 never modifies those sources, never infers missing identity, and never treats capability equality alone as proposal provenance.**

Therefore:

```text
deterministic bridge exists
    → A9Correlation may be emitted

deterministic bridge unavailable
    → no A9Correlation
```

Absence is unresolved/unestablished.

It is not a failure record.

---

# 26. Many-to-Many Correlation

The resulting graph may be:

```text
Forecast F1 ──────┐
                  ├── Measurement M1
Forecast F2 ──────┤
                  │
Forecast F3 ──────┘
```

and:

```text
Forecast F1
   ├── Measurement M1
   ├── Measurement M2
   └── Measurement M3
```

Each relationship is an independent immutable `A9Correlation`.

No shared group artifact exists.

---

# 27. Correlation and Calibration Are Separate

A9 v1 defines:

```text
forecast
    +
evidence correlation
```

It does not define final calibration semantics.

Correlation answers:

> What evidence is related?

Calibration answers:

> What does that evidence mean relative to the forecast?

Therefore the following are explicitly outside the correlation layer:

* primary realization;
* terminal realization;
* expiration;
* abandonment;
* outcome interpretation;
* forecast accuracy policy;
* recalibration;
* strategy tuning.

---

# 28. No Primary Measurement

There is deliberately no:

```typescript
primary: boolean
```

or:

```typescript
primaryMeasurementId
```

on `A9Correlation`.

If several measurements correlate with a forecast:

```text
F → M1
F → M2
F → M3
```

all three are evidence.

No persistence-layer mechanism decides that one is the "real" outcome.

---

# 29. No Negative Correlation

If correlation cannot be established:

```text
correlations.jsonl
```

receives no record.

There is no:

```text
correlated: false
```

record.

There is no:

```text
negativeCorrelation
```

artifact.

There is no speculative:

```text
A9CorrelationAttempt
```

artifact.

---

# 30. Forecast Flow

```text
EventLog
   │
   ├── proposal-events-adapter
   │
   ├── measurement-events-adapter
   │
   └── enriched-proposals-adapter
              │
              ▼
       forecast-engine
              │
       ┌──────┼──────┐
       ▼      ▼      ▼
     trust  evidence fingerprint
    velocity completeness coincidence
       └──────┼──────┘
              ▼
       max-score aggregation
              │
              ▼
          A9Forecast
              │
              ▼
        forecasts.jsonl
              │
              ▼
          a9-bridge
              │
              ▼
      A2.5 GovernanceRecommendation
              │
              ▼
          A3 generateDecision()
              │
       ┌──────┴────────┐
       ▼               ▼
   APPROVE       REQUEST_MORE_EVIDENCE
       │               │
       ▼               ▼
      A4           UNDER_REVIEW
```

---

# 31. Correlation Flow

```text
A9 forecasts.jsonl
        │
        ▼
  correlation-engine
        │
        ├── proposal.submitted
        │       │
        │       └── target.id
        │
        ├── proposal.executed
        │
        └── measurement.measured
                │
                └── capabilityId
        │
        ▼
 exact deterministic bridge
        │
        ▼
  A9Correlation
        │
        ▼
 correlations.jsonl
```

The forecast and correlation flows are independent.

Correlation does not gate forecast emission.

Correlation does not trigger governance re-evaluation.

---

# 32. A9 Does Not Enter the Execution Path

A9 is governance-gating only.

The execution sequence remains:

```text
A9 forecast
    ↓
A2.5 recommendation
    ↓
A3 decision
    ↓
A4 if APPROVED
```

A9 does not mandate:

```text
A9 → A4
```

A9 does not execute capabilities.

A9 does not bypass A3.

---

# 33. CLI

The operator surface is:

```text
alix governance evolution forecast
```

Supported options:

```text
--dimension ...
--json
```

The CLI returns:

* the generated `A9Forecast`; or
* a no-findings result when no forecast is emitted.

For high/critical forecasts it also surfaces:

```text
RISK_GATED_REVIEW
```

and the resulting A3 decision.

There is no operator-facing correlation command.

Correlation is automatic/programmatic after measurement realization.

A9 does not introduce a new CLI binary.

---

# 34. Composition Root

The composition root constructs the A9 adapters.

The adapters are passed into `ForecastEngine`.

A9 does not instantiate its own foreign data sources.

The composition root also wires:

* `ForecastsAdapter`;
* `CorrelationsAdapter`;
* A9 bridge;
* A2.5 recommendation mapping.

Required composition-root modification is explicitly authorized.

The relevant platform composition file is added to the CAP-12 forbidden-file carve-out for this increment.

All other CAP-12 forbidden files remain forbidden.

---

# 35. Migration Boundary

No data migration is required.

A9 introduces:

```text
src/evolution/a9/
```

and:

```text
.alix/governance/forecasts.jsonl
.alix/governance/correlations.jsonl
```

Existing A6, A8, CAP-N, CAP-O, CAP-P, EventLog, A2.5, A3, and P10.8a contracts remain unchanged except for the explicitly authorized A2.5 recommendation-kind extension.

---

# 36. A2.5 Contract Extension

The existing five A2.5 recommendation kinds remain unchanged.

Exactly one new kind is added:

```typescript
"RISK_GATED_REVIEW"
```

The total becomes:

```text
5 existing
+
1 A9 kind
=
6
```

No seventh kind is permitted in this increment.

Mapping:

```text
RISK_GATED_REVIEW
    →
REQUEST_MORE_EVIDENCE
```

A3's four binding kinds remain:

```text
APPROVE
REJECT
MONITOR
REQUEST_MORE_EVIDENCE
```

A3's three target states remain unchanged.

---

# 37. Error Handling

## 37.1 Adapter failure

If an adapter fails:

* the engine records the failure;
* other available evidence may still be processed;
* findings from unavailable sources are marked accordingly.

Concrete logging/diagnostic shape is deferred to implementation plan.

---

## 37.2 Detector failure

If one detector throws:

* that detector's failure is surfaced;
* remaining detectors may continue;
* the engine does not silently invent a result.

---

## 37.3 Identity collision

A detected deterministic identity collision is a load-bearing failure.

The engine must not silently overwrite or mutate an existing record.

---

## 37.4 Correlation join miss

If any required deterministic bridge cannot be established:

```text
no A9Correlation
```

No negative record is emitted.

---

## 37.5 A3 rejection

A3 may still reject if its own validation/fail-closed rules reject the recommendation or evidence.

A9 does not override A3.

---

## 37.6 JSONL write failure

A failed write means the artifact is not considered committed.

The failure is surfaced to the caller.

No best-effort partial semantic state is accepted.

---

# 38. Testing Strategy

## 38.1 Detector tests

Tests must establish:

* empty input → no findings;
* below-threshold input → no forecast;
* threshold-crossing input → forecast;
* multiple subjects → one forecast per subject;
* multiple detectors → max-score aggregation;
* deterministic input + timestamp → deterministic forecast;
* evidence references preserved exactly;
* risk-band thresholds exactly match A6.

---

# 39. Adapter Tests

Each adapter must establish:

* expected raw record shape;
* read-only API;
* empty source behavior;
* raw proposal payload preservation;
* raw enriched-field value preservation;
* absence of A8 normalized-record dependency.

Measurement adapter specifically tests:

```text
CapabilityMeasurementPayload
```

does not expose:

```text
proposalId
sourceProposalIds
forecastId
correlationId
```

---

# 40. Persistence Tests

Tests must establish:

* forecast append-only persistence;
* correlation append-only persistence;
* deterministic forecast identity;
* deterministic correlation identity;
* foreign IDs remain references;
* no destructive mutation;
* restart reload;
* no correlation on unresolved join;
* read adapters reproduce persisted content.

---

# 41. Correlation Tests

Explicit tests must cover:

### Proposal bridge

```text
forecast.subject
==
proposal.submitted.proposalId
```

### Capability bridge

```text
forecast.subjectCapability
==
proposal.submitted.payload.target.id
```

### Execution gate

```text
proposal.executed
```

must exist before correlation.

### Measurement bridge

```text
measurement.capabilityId
==
forecast.subjectCapability
```

### Horizon

Measurement must fall within:

```text
forecast.horizon.from
≤ measurement.recordedAt
≤ forecast.horizon.to
```

### Many-to-many

One forecast → multiple measurements.

Multiple forecasts → same measurement.

### No heuristic correlation

Tests prove that:

* same capability + wrong proposal does not invent proposal provenance;
* nearest-in-time measurement is not preferentially selected;
* payload similarity is not used;
* absent execution event prevents correlation.

---

# 42. Bridge Tests

Tests must establish:

```text
low
medium
    → MONITOR

high
critical
    → RISK_GATED_REVIEW
```

and:

```text
RISK_GATED_REVIEW
    →
REQUEST_MORE_EVIDENCE
```

Regression tests must prove:

* all five existing A2.5 kinds remain unchanged;
* A3 still has four binding kinds;
* A3 still has three target states.

---

# 43. End-to-End Test

The full forecast flow must verify:

```text
raw adapters
    ↓
detectors
    ↓
A9Forecast
    ↓
forecast persistence
    ↓
A9 bridge
    ↓
A2.5 recommendation
    ↓
A3 decision
```

High/critical:

```text
RISK_GATED_REVIEW
    ↓
REQUEST_MORE_EVIDENCE
    ↓
UNDER_REVIEW
```

Low/medium:

```text
MONITOR
    ↓
existing A3 behavior
```

---

# 44. Correlation End-to-End Test

Fixture:

```text
proposal.submitted
proposal.executed
measurement.measured
```

with:

```text
proposal.submitted.proposalId
==
forecast.subject

proposal.submitted.payload.target.id
==
forecast.subjectCapability

measurement.capabilityId
==
forecast.subjectCapability
```

Expected:

```text
one A9Correlation
```

The test must also prove that the measurement event itself contains no proposal identity.

---

# 45. Sentinel Tests

The A9 sentinel must enforce:

### Identity

```text
forecastId =
SHA-256(canonical(forecastWithoutIdentity))
```

```text
correlationId =
SHA-256(canonical(correlationWithoutIdentity))
```

### Persistence

A9 artifacts live only in A9-owned persistence.

### Foreign identity

Foreign IDs are references/provenance only.

### Measurement boundary

No:

```text
proposalId
sourceProposalIds
forecastId
correlationId
```

are added to measurement contracts.

### Event taxonomy

CAP-9's five-event taxonomy remains unchanged.

### A2.5

Exactly six recommendation kinds:

```text
5 existing + RISK_GATED_REVIEW
```

### A3

Exactly four binding kinds remain.

Exactly three target states remain.

### A8 isolation

A9 source files MUST NOT import the A8 normalization layer or:

```text
enriched-proposal-aggregator.ts
```

for A9's canonical evidence model.

### Correlation

No heuristic join exists.

No negative correlation artifact exists.

No primary measurement exists.

No correlation status field exists.

---

# 46. Forward Compatibility

The following are deliberately future increments:

## A9 strategy tuning

Threshold or strategy mutation requires a new architectural increment.

## Additional forecast detector

A fourth detector is a new architectural increment.

## A9CorrelationAttempt

Failure-audit persistence requires separate authorization.

## Calibration/result semantics

Realized-outcome interpretation is separate from correlation.

## A9 → A4 conditional execution

Any future A9-controlled execution policy requires a new architectural increment.

## TUI/Web

CAP-11 territory.

---

# 47. Explicit Non-Goals

A9 v1 does not:

* modify CAP-9's five-event taxonomy;
* modify CAP-10/10.5 measurement contracts;
* add proposal identity to measurements;
* add forecast identity to measurements;
* add a sixth governance event;
* add a seventh A2.5 recommendation kind;
* modify A3 binding kinds;
* modify A3 target states;
* reuse A8 normalized records;
* modify A8 contracts;
* use temporal heuristics;
* use payload similarity;
* infer causality;
* designate primary measurements;
* emit negative correlations;
* persist correlation status;
* build `A9CorrelationAttempt`;
* define calibration semantics;
* mandate A9 → A4 execution;
* add TUI/Web surfaces;
* introduce strategy tuning;
* introduce a generalized correlation engine;
* modify foreign stores.

---

# 48. Architectural Invariants

The final A9 invariants are:

1. **A9 owns identity.**
   Every A9-owned artifact has an A9-owned deterministic identity.

2. **A9 owns persistence.**
   Forecasts and correlations live in A9-owned JSONL stores.

3. **A9 owns correlation.**
   The forecast/measurement relationship exists only in `A9Correlation`.

4. **Foreign identities remain references.**
   They never substitute for A9 identity.

5. **Measurements remain capability-targeted.**
   CAP-10/10.5 is unchanged.

6. **Correlation is positive evidence.**
   No negative correlation records exist.

7. **Correlation is many-to-many.**
   Forecasts and measurements may participate in multiple independent relationships.

8. **Artifacts are immutable.**
   Corrections are new records.

9. **Calibration is separate from correlation.**
   The correlation layer does not designate primary/terminal/realized outcomes.

10. **No speculative artifacts.**
    `A9CorrelationAttempt` is not built.

11. **Correlation is deterministic.**
    Exact canonical identity and exact canonical bridge relationships are required.

12. **Correlation availability is an architectural fact.**
    A9 may only assert relationships that existing canonical evidence establishes.

13. **A9 never modifies foreign namespaces.**
    Foreign data is read-only.

14. **Capability equality is not proposal provenance.**
    Capability identity alone never proves that a measurement belongs to a particular proposal.

15. **Execution is an eligibility gate, not causality proof.**
    `proposal.executed` establishes that the forecasted proposal executed; it does not prove that a particular measurement was caused by that proposal.

16. **A3 remains sovereign.**
    A9 recommends; A3 decides.

---

# 49. Final Architectural Shape

```text
                         A9 FORECAST DOMAIN
                         ==================

Proposal EventLog ───────────────┐
                                 │
EnrichedProposal[] ──────────────┼──► Read-only A9 adapters
                                 │
Measurement EventLog ────────────┘
                                 │
                                 ▼
                         Forecast Engine
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
               Trust Velocity  Evidence   Fingerprint
                              Completeness Coincidence
                    └────────────┼────────────┘
                                 ▼
                          Max-score aggregate
                                 │
                                 ▼
                           A9Forecast
                       ┌─────────┴─────────┐
                       │                   │
                       ▼                   ▼
                forecastId           subjectCapability
                 (A9-owned)       (derived bridge snapshot)
                       │
                       ▼
                 forecasts.jsonl
                       │
                       ▼
                  A9 → A2.5 bridge
                       │
                       ▼
             GovernanceRecommendation
                       │
              ┌────────┴────────┐
              ▼                 ▼
           MONITOR       RISK_GATED_REVIEW
                                │
                                ▼
                     REQUEST_MORE_EVIDENCE
                                │
                                ▼
                           A3 / UNDER_REVIEW


                    POST-EXECUTION EVIDENCE
                    ========================

                    proposal.submitted
                           │
                           │ proposalId
                           ▼
                    A9Forecast.subject
                           │
                           │ target.id
                           ▼
                  subjectCapability
                           │
                           │ exact equality
                           ▼
                 measurement.capabilityId

                    proposal.executed
                           │
                           │ exact proposal identity
                           ▼
                   execution eligibility

                           │
                           ▼
                    Correlation Engine
                           │
                 ┌─────────┴─────────┐
                 │                   │
                 ▼                   ▼
            forecastId          measurementId
            (A9-owned)          (foreign ref)
                 │                   │
                 └─────────┬─────────┘
                           ▼
                    A9Correlation
                           │
                           ▼
                   correlations.jsonl
```

---

# 50. Boundary Rule

The most important A9 rule is:

> **A9 owns the forecast and correlation identities and owns the relationship between them. Foreign systems remain canonical read-only sources. A9 may traverse existing deterministic relationships across those sources, but it may never modify a foreign contract, invent a missing identity, or convert a heuristic into a correlation.**

In particular:

```text
proposal.submitted
        │
        ├── proposalId ───────► A9Forecast.subject
        │
        └── target.id ────────► A9Forecast.subjectCapability
                                      │
                                      ▼
                             measurement.capabilityId
```

and:

```text
proposal.executed
        │
        └──► establishes execution eligibility
```

Neither source is modified by A9.

---

# 51. References

* A9 recon #527 findings
* A9 recon #528 decision
* A9 recon #529 decision
* A9 recon #530 decision
* A9 recon #531 decision
* A9 recon #546 locked invariants
* A9 wayfinder map #526
* A8 organizational learning specification
* `src/evolution/learning/`
* A6 risk vocabulary and thresholds
* A2.5 `GovernanceRecommendation`
* A2.5 → A3 decision mapping
* A3 `generateDecision`
* CAP-9 proposal event taxonomy
* CAP-10/10.5 measurement contract
* P10.8a `EnrichedProposal`
* A-series architecture
* ADR-0008
* ADR-0013
* CAP-N
* CAP-O
* CAP-P

---

# 52. Status

**Q1 — LOCKED:** A9 owns forecast identity.

**Q2 — LOCKED:** `A9Correlation` is immutable positive evidence; absence is unresolved.

**Q3 — LOCKED:** A9 is an identity owner.

**Q4 — LOCKED:** A9 owns separate append-only forecast/correlation JSONL stores.

**Q5 — LOCKED:** One forecast may have many supporting measurements; no primary at correlation layer.

**Q6 — LOCKED:** Many-to-many via independent `A9Correlation` records.

**Q7 — LOCKED:** No correlation-status field and no negative/attempt artifacts.

**Q8 — LOCKED:** CAP-10/10.5 measurement contract remains unchanged; correlation uses the existing canonical proposal → capability bridge.

**Current architectural state:** Ready for plan phase, subject to repository verification of the exact EventLog proposal event payload and execution-event shape before implementation.

```

### One thing I deliberately corrected beyond the two original defects

I also removed the old statement that the measurement adapter provides `sourceProposalIds`, and I **tightened the meaning of `proposal.executed`**.

It is an **execution eligibility gate**, not proof of causal provenance. That distinction is important because otherwise the new bridge would quietly claim more than CAP-10/10.5 actually allows.

The resulting architecture is internally consistent:

**proposal identity → A9 forecast identity → canonical capability bridge → capability measurement evidence**, with A9 owning the relationship and never modifying the foreign namespaces.
```

