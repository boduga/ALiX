Yes. Given the locked Q1–Q8 decisions and the defects you just identified, the plan should be **implementation-ready and scope-disciplined**, not another design document.

The key correction is that the plan must implement the **two-hop canonical bridge**:

`A9Forecast.subject (proposalId)` → `proposal.submitted.payload.candidate.target.id (capabilityId)` → `CapabilityMeasurement.capabilityId`

with `proposal.executed` as the authorization gate.

Below is the full plan.

# A9 — Pre-Execution Risk Forecast & Governance Gating Implementation Plan

**Status:** Implementation Plan
**Date:** 2026-08-15
**Parent spec:** A9 — Pre-Execution Risk Forecast & Governance Gating Design
**Predecessor:** A8 Organizational Learning
**Scope:** A9 v1 only
**Implementation rule:** Contracts first → pure builders/detectors → persistence → adapters → engines → bridge → composition root → CLI → integration/sentinel tests.

---

## 1. Implementation objective

Implement A9 as an independent evolution module that:

1. reads canonical proposal, measurement, and enrichment evidence;
2. produces immutable, content-addressed `A9Forecast` artifacts before execution;
3. projects high/critical forecasts into the new A2.5 `RISK_GATED_REVIEW` recommendation;
4. maps that recommendation to A3's existing `REQUEST_MORE_EVIDENCE` decision;
5. persists forecasts and correlations in A9-owned append-only JSONL stores;
6. correlates forecasts to post-execution measurements through the canonical two-hop bridge;
7. preserves CAP-9, CAP-10/10.5, A2.5, and A3 namespace/contract boundaries.

The implementation must **not** invent proposal/measurement relationships from temporal proximity, payload similarity, or copied foreign IDs.

---

# 2. Locked architectural invariants

These are implementation constraints, not implementation suggestions.

### A9 owns identity

Every A9-owned artifact has an A9-owned deterministic identity.

* `forecastId = SHA-256(canonical(A9ForecastWithoutIdentity))`
* `correlationId = SHA-256(canonical(A9CorrelationWithoutIdentity))`

Foreign IDs never become A9 identities.

### A9 owns persistence

Two independent append-only stores:

```text
.alix/governance/forecasts.jsonl
.alix/governance/correlations.jsonl
```

No A9 artifact is persisted inside EventLog, ProposalStore, measurement records, or A8 records.

### A9 owns correlation

The relationship is represented only by:

```text
A9Correlation
```

No foreign record receives `forecastId`.

### Measurements remain capability-targeted

Do **not** add:

```text
proposalId
sourceProposalIds
forecastId
```

to `CapabilityMeasurementPayload`.

### Correlation is positive evidence

No:

* negative `A9Correlation`;
* `correlationStatus`;
* `attempted`;
* `unresolved`;
* `primaryMeasurement`;
* `expired`;
* `abandoned`.

Absence of a correlation means unresolved/unestablished.

### Many-to-many is native

A forecast can correlate with many measurements.

A measurement can correlate with many forecasts.

Each relationship is an independent immutable `A9Correlation`.

### Calibration is not correlation

`A9Correlation` says:

> this measurement is evidence related to this forecast.

It does **not** say:

> this measurement is the primary realization.

No primary designation is persisted.

### No speculative attempt artifact

Do not implement `A9CorrelationAttempt`.

---

# 3. Critical corrected correlation architecture

This is the most important implementation detail.

## 3.1 Forecast identity

The forecast is proposal-scoped.

```typescript
subject: proposalId
subjectCapability: capabilityId
```

The two values have different meanings.

```text
subject
  = A9 forecast subject
  = proposalId

subjectCapability
  = derived capability bridge
  = proposal.submitted.payload.candidate.target.id
```

`subjectCapability` is copied into the immutable forecast at emission time.

It is **not** an independent canonical source of truth.

---

## 3.2 Canonical bridge

The correlation engine must use:

```text
A9Forecast.subject
        │
        │ exact proposalId equality
        ▼
proposal.submitted.proposalId
        │
        │ payload.candidate.target.id
        ▼
proposal capabilityId
        │
        │ exact capabilityId equality
        ▼
CapabilityMeasurement.capabilityId
```

Before emitting a correlation, the engine must additionally establish:

```text
proposal.executed.proposalId === forecast.subject
```

The executed event is the authorization gate.

Therefore the complete relationship is:

```text
forecastId
   ↓
A9Forecast.subject = proposalId
   ↓
proposal.submitted
   ↓
payload.candidate.target.id = capabilityId
   ↓
proposal.executed exists
   ↓
CapabilityMeasurement.capabilityId = capabilityId
   ↓
measurementId
```

No temporal matching determines identity.

The horizon only determines whether an otherwise exact measurement is still within the forecast's validity window.

---

# 4. Phase 0 — Repository and contract verification

Before changing code, verify the implementation plan against the current repository.

### Tasks

Inspect:

```text
src/evolution/learning/
src/evolution/governance/
src/capability/governance/
src/capability/
src/adaptation/
```

Specifically locate:

* A8 adapter patterns;
* A8 JSONL persistence;
* A8 bridge;
* A2.5 `GovernanceRecommendation`;
* `GovernanceRecommendationKind`;
* A2.5 → A3 mapping;
* A3 `generateDecision()`;
* proposal EventLog event contracts;
* measurement EventLog event contracts;
* `CapabilityMeasurementPayload`;
* `proposal.submitted`;
* `proposal.executed`;
* `EnrichedProposal`;
* canonical SHA-256/content-addressing helpers;
* CLI registration seam;
* composition root;
* CAP-12 forbidden-file list.

### Required verification

Confirm that:

```text
proposal.submitted.payload.candidate.target.id
```

actually contains the canonical capability identity required by the bridge.

Confirm that:

```text
proposal.executed
```

can be deterministically queried by proposal ID.

Confirm that measurement records expose:

```text
measurementId
capabilityId
outcome
recordedAt
```

without proposal linkage.

### STOP condition

If the repository does not expose the proposal → capability bridge exactly as specified, **stop**.

Do not substitute:

* EnrichedProposal;
* ProposalStore indexes;
* temporal proximity;
* fingerprint matching;
* copied proposal IDs;
* inferred capability identity.

That would reopen Q8.

---

# 5. Phase 1 — A9 contracts

Create:

```text
src/evolution/a9/contracts/a9-contract.ts
```

Define:

```typescript
export type ForecastId = string;
export type CorrelationId = string;

export type A9ForecastKind =
  | "trust-velocity"
  | "evidence-completeness"
  | "fingerprint-coincidence";

export type RiskBand =
  | "low"
  | "medium"
  | "high"
  | "critical";
```

Define the corrected forecast contract:

```typescript
export interface A9Forecast {
  readonly forecastId: ForecastId;
  readonly forecastVersion: string;

  readonly subject: string;
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
    readonly evidenceRefs: ReadonlyArray<string>;
  };
}
```

Define:

```typescript
export interface A9Correlation {
  readonly correlationId: CorrelationId;
  readonly correlationVersion: string;

  readonly forecastId: ForecastId;
  readonly measurementId: string;

  readonly foreignProvenance: {
    readonly proposalId?: string;
    readonly notes?: string;
  };

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

### Important contract rule

Do **not** add:

```typescript
primary: boolean
correlationStatus
proposalId: string // to measurement
```

to these contracts.

---

# 6. Phase 2 — Canonical identity utilities

Create an A9-local identity seam if no suitable existing generic canonicalization helper already exists.

Recommended:

```text
src/evolution/a9/identity.ts
```

Responsibilities:

```text
canonicalizeForecast()
forecastIdFor()
canonicalizeCorrelation()
correlationIdFor()
```

Canonicalization must exclude mutable/incidental identity fields.

For forecast identity, exclude at minimum:

```text
forecastId
```

and any other field explicitly designated non-identity.

Do not include:

```text
storage location
JSONL sequence
append order
```

Do not use timestamps as incidental identity components if they are not part of the actual artifact content.

For correlation identity, identity must derive from the correlation's canonical content, not JSONL position.

### Tests

Verify:

* same content → same ID;
* changed substantive content → different ID;
* storage order does not change ID;
* repeated construction produces identical IDs.

---

# 7. Phase 3 — Risk band projection

Create:

```text
src/evolution/a9/risk-band.ts
```

Implement:

```typescript
internalScoreToBand(score)
```

with the locked A6 thresholds:

```text
[0.0, 0.3)   low
[0.3, 0.6)   medium
[0.6, 0.85)  high
[0.85, 1.0]  critical
```

Boundary tests are mandatory:

```text
0
0.299999...
0.3
0.599999...
0.6
0.849999...
0.85
1.0
```

Invalid scores must be handled deterministically.

Do not introduce alternate thresholds.

---

# 8. Phase 4 — Raw evidence adapter contracts

Create:

```text
src/evolution/a9/adapters/
```

## 8.1 Proposal events adapter

```text
proposal-events-adapter.ts
```

Read-only interface exposing raw proposal events.

Required information includes:

```typescript
{
  proposalId,
  capabilityId?,
  kind,
  payload,
  recordedAt
}
```

The adapter must preserve the raw payload because A9 needs:

```text
proposal.submitted.payload.candidate.target.id
```

Do not normalize the target away.

---

## 8.2 Measurement events adapter

```text
measurement-events-adapter.ts
```

Corrected contract:

```typescript
{
  measurementId,
  capabilityId,
  outcome,
  recordedAt
}
```

Do **not** expose or invent:

```text
proposalId
sourceProposalIds
forecastId
```

unless those fields genuinely exist in the current canonical contract—which the locked Q8 decision says they do not.

The adapter remains read-only.

---

## 8.3 Enriched proposals adapter

```text
enriched-proposals-adapter.ts
```

Read-only over raw `EnrichedProposal[]`.

A9 reads:

```text
enrichedFields
```

directly.

It must not import A8's normalized aggregation layer.

---

# 9. Phase 5 — Adapter implementation

Implement the three adapters against their canonical sources.

### Proposal adapter

Source:

```text
EventLog
```

Filter:

```text
capability.governance.proposal.*
```

Preserve the raw event payload.

### Measurement adapter

Source:

```text
EventLog
```

Filter:

```text
capability.governance.measurement.*
```

Return only the canonical measurement information.

### Enriched proposal adapter

Source:

```text
EnrichedProposal[]
```

No mutation.

### Adapter tests

Verify:

1. empty source → empty list;
2. raw values preserved;
3. proposal target remains available;
4. measurement has no proposal linkage;
5. adapter exposes no mutation operation;
6. A9 does not consume A8 normalized records.

---

# 10. Phase 6 — Pure detector contracts

Create:

```text
src/evolution/a9/detectors/
```

or the equivalent structure if the repository's conventions favor a flatter module.

Implement three pure detectors.

---

## 10.1 Trust velocity detector

Input:

```text
proposal.submitted
```

Evaluate the locked predicate structure:

* blast radius;
* replacement targets;
* capability surface area;
* multi-tenancy impact.

Output a deterministic finding:

```typescript
{
  subject: proposalId,
  subjectCapability: capabilityId,
  kind: "trust-velocity",
  internalScore,
  confidence,
  evidenceRefs
}
```

No I/O.

No clock access.

No hidden configuration mutation.

---

## 10.2 Evidence completeness detector

Input:

```text
EnrichedProposal
```

Evaluate:

* populated enriched fields;
* recency;
* source diversity.

Produce a deterministic score.

The concrete scoring weights are implementation-plan decisions only where they are already authorized by the spec. Do not introduce adaptive tuning.

---

## 10.3 Fingerprint coincidence detector

Input:

```text
proposal.execution_failed
```

Build the normalized failure fingerprint defined by the existing repository contract.

Measure prior failure density.

Do not correlate using:

* timestamps alone;
* proposal similarity;
* arbitrary payload equality.

---

# 11. Phase 7 — Forecast builder

Create:

```text
src/evolution/a9/forecast-builder.ts
```

Pure function:

```typescript
buildForecast(
  findings,
  subject,
  subjectCapability,
  timestamp
): A9Forecast
```

Responsibilities:

1. validate findings;
2. aggregate detector results;
3. choose maximum internal score;
4. project maximum score to `RiskBand`;
5. calculate weighted confidence;
6. preserve evidence references;
7. construct canonical content;
8. calculate `forecastId`.

### Aggregation rule

For one subject:

```text
max(internalScore)
```

determines the forecast band.

Confidence:

```text
weighted average of detector confidences
weighted by internalScore
```

must be deterministic.

### Identity

`forecastId` must be generated after canonical forecast construction.

No persistence metadata may affect the ID.

---

# 12. Phase 8 — Forecast engine

Create:

```text
src/evolution/a9/forecast-engine.ts
```

Constructor receives adapters from the composition root.

The engine itself does not instantiate infrastructure.

Flow:

```text
list proposal evidence
list measurement evidence if detector requires it
list enriched proposals
        ↓
run detectors
        ↓
group findings by subject
        ↓
aggregate
        ↓
build forecasts
```

### No-trigger rule

If no detector emits a detection-worthy finding:

```text
return []
```

No empty forecast artifact is persisted.

### Determinism

Given:

```text
same evidence
same timestamp
same generator version
```

the result must be identical.

---

# 13. Phase 9 — A9 forecast persistence

Implement:

```text
src/evolution/a9/forecasts-store.ts
```

or the repository-equivalent store seam.

Path:

```text
.alix/governance/forecasts.jsonl
```

Requirements:

* append-only;
* one JSON object per line;
* no destructive updates;
* duplicate deterministic identities must be handled explicitly;
* writes must be atomic at the record level.

Implement:

```text
append(forecast)
list()
getById(forecastId)
```

if these seams are required by consumers.

Do not expose mutation methods.

---

# 14. Phase 10 — ForecastsAdapter

Implement:

```text
src/evolution/a9/forecasts-adapter.ts
```

This is a read-only projection over:

```text
forecasts.jsonl
```

It supports correlation lookup.

At minimum it must support finding forecasts by:

```text
subject
subjectCapability
horizon
```

The lookup must not mutate stored records.

---

# 15. Phase 11 — Corrected correlation engine

Create:

```text
src/evolution/a9/correlation-engine.ts
```

This is the most contract-sensitive implementation phase.

The engine receives:

* forecast store;
* proposal event adapter;
* measurement event adapter;
* timestamp/event context.

---

## 15.1 Step 1 — Load forecast

Read:

```typescript
forecast.subject
forecast.subjectCapability
forecast.horizon
forecast.forecastId
```

Interpret:

```text
subject = proposalId
subjectCapability = capabilityId
```

---

## 15.2 Step 2 — Authorize through proposal.submitted

Find the canonical:

```text
proposal.submitted
```

where:

```text
proposal.submitted.proposalId === forecast.subject
```

Then verify:

```text
proposal.submitted.payload.candidate.target.id
    === forecast.subjectCapability
```

If not:

```text
no correlation
```

Do not repair or infer the mismatch.

---

## 15.3 Step 3 — Require proposal.executed

Find:

```text
proposal.executed
```

where:

```text
proposal.executed.proposalId === forecast.subject
```

If absent:

```text
no correlation
```

If the proposal was rejected:

```text
no correlation
```

The engine must not correlate a forecast to measurements when execution did not occur.

---

## 15.4 Step 4 — Find measurements

Read measurement events.

Select measurements where:

```text
measurement.capabilityId === forecast.subjectCapability
```

and:

```text
measurement.recordedAt >= forecast.horizon.from
measurement.recordedAt <= forecast.horizon.to
```

The horizon is a **validity boundary**, not a ranking heuristic.

Do not select:

```text
latest measurement
nearest measurement
first measurement
```

All qualifying measurements are candidates.

---

## 15.5 Step 5 — Emit one correlation per pair

For every qualifying pair:

```text
(forecastId, measurementId)
```

construct one independent `A9Correlation`.

Example:

```text
F1 → M1
F1 → M2
F2 → M1
```

produces:

```text
C1(F1,M1)
C2(F1,M2)
C3(F2,M1)
```

No group artifact.

No reverse pointer.

No primary designation.

---

# 16. Phase 12 — Correlation builder

Create:

```text
src/evolution/a9/correlation-builder.ts
```

Pure function:

```typescript
buildCorrelation(
  forecast,
  measurement,
  proposalId,
  timestamp
)
```

The builder must construct only positive evidence.

`resolution` remains interpretation metadata defined by the locked A9 v1 contract.

Do not add:

```text
primary
terminal
resolved
attempted
```

The correlation ID is calculated from canonical correlation content.

---

# 17. Phase 13 — Correlation persistence

Implement:

```text
.alix/governance/correlations.jsonl
```

Append-only.

Required operations:

```text
append()
list()
getById()
findByForecastId()
findByMeasurementId()
```

The latter two are query/index operations, not additional persistence structures.

### Duplicate handling

Because identities are deterministic:

```text
same canonical correlation → same correlationId
```

The store must avoid silently producing semantically duplicated identities.

Do not mutate an existing correlation.

---

# 18. Phase 14 — CorrelationsAdapter

Implement:

```text
src/evolution/a9/correlations-adapter.ts
```

Read-only queries:

```text
byForecast(forecastId)
byMeasurement(measurementId)
```

This provides the Q6 many-to-many query path.

Example:

```text
all forecasts sharing measurement M
```

is answered by:

```text
correlationsAdapter.byMeasurement(M)
```

No new measurement-group artifact.

---

# 19. Phase 15 — A9 bridge

Create:

```text
src/evolution/a9/a9-bridge.ts
```

Implement:

```typescript
buildGovernanceRecommendation(
  forecast: A9Forecast
): GovernanceRecommendation
```

Mapping:

```text
low      → MONITOR
medium   → MONITOR
high     → RISK_GATED_REVIEW
critical → RISK_GATED_REVIEW
```

The recommendation references the A9 forecast identity.

Do not create a second A9 identity.

Do not alter A3 directly.

---

# 20. Phase 16 — A2.5 sixth kind

Extend the existing A2.5 recommendation vocabulary with exactly:

```text
RISK_GATED_REVIEW
```

Existing five kinds remain unchanged.

The implementation must establish:

```text
5 existing kinds + RISK_GATED_REVIEW = 6
```

No seventh kind.

---

# 21. Phase 17 — A2.5 → A3 mapping

Extend:

```text
RECOMMENDATION_KIND_MAP
```

with exactly:

```text
RISK_GATED_REVIEW
    →
REQUEST_MORE_EVIDENCE
```

Target state:

```text
UNDER_REVIEW
```

Do not modify:

```text
APPROVE
REJECT
MONITOR
REQUEST_MORE_EVIDENCE
```

as A3 binding kinds.

Do not add an A3 binding kind.

Do not add an A3 target state.

---

# 22. Phase 18 — Composition-root wiring

Wire A9 through the existing composition root.

The root constructs:

```text
ProposalEventsAdapter
MeasurementEventsAdapter
EnrichedProposalsAdapter
ForecastsAdapter
CorrelationsAdapter
ForecastEngine
CorrelationEngine
```

and injects dependencies.

A9 modules do not instantiate EventLog or other global infrastructure themselves.

### CAP-12 carve-out

Only the explicitly authorized composition-root file may be touched for A9 wiring.

The plan must preserve the locked CAP-12 carve-out.

No unrelated platform refactoring.

---

# 23. Phase 19 — Forecast CLI

Implement:

```text
alix governance evolution forecast
```

Options:

```text
--dimension
--json
```

Output:

* generated forecast(s), or;
* deterministic no-findings output.

For high/critical:

```text
RISK_GATED_REVIEW
```

must be visible.

The CLI must not expose correlation as an operator mutation command.

Correlation is automatic.

---

# 24. Phase 20 — Error handling

Implement the locked failure behavior.

### Adapter failure

A failed adapter does not automatically destroy the entire run.

The engine may continue with available evidence.

The resulting finding must make source unavailability explicit where the contract supports it.

### Detector failure

A detector failure does not silently become a successful detector result.

It is surfaced and other detectors may continue.

### Identity collision

A deterministic identity collision is fatal.

Do not overwrite.

Do not merge.

Do not silently continue.

### Correlation join miss

Silent absence.

No:

```text
A9Correlation
A9CorrelationAttempt
status update
negative record
```

### JSONL write failure

Fail the operation.

Do not report an artifact as persisted when the write failed.

---

# 25. Phase 21 — Unit test suite

Create:

```text
tests/evolution/a9-forecast-detectors.vitest.ts
```

Cover:

### Trust velocity

* empty input;
* below threshold;
* threshold boundary;
* high-risk input;
* deterministic result.

### Evidence completeness

* empty enrichment;
* complete enrichment;
* recency;
* source diversity;
* deterministic result.

### Fingerprint coincidence

* no failures;
* unrelated fingerprint;
* repeated fingerprint;
* deterministic result.

### Risk projection

Test every boundary.

### Aggregation

Verify:

```text
low + high → high
medium + critical → critical
```

and that the maximum score is never diluted.

---

# 26. Phase 22 — Adapter tests

Create:

```text
tests/evolution/a9-adapters.vitest.ts
```

Required tests:

1. proposal adapter preserves raw payload;
2. proposal adapter exposes `payload.candidate.target.id`;
3. measurement adapter exposes capability identity;
4. measurement adapter does not introduce proposal identity;
5. enriched adapter preserves enriched values;
6. adapters are read-only;
7. A9 does not import A8 normalization.

---

# 27. Phase 23 — Persistence tests

Create:

```text
tests/evolution/a9-persistence.vitest.ts
```

Test:

* append-only forecast persistence;
* append-only correlation persistence;
* deterministic forecast ID;
* deterministic correlation ID;
* restart reload;
* same data reconstructs same A9 artifacts;
* no mutation;
* foreign IDs remain references;
* duplicate identity behavior;
* no negative correlation on join miss.

### Mandatory restart test

Simulate:

```text
process 1:
  write forecast
  write correlation

shutdown

process 2:
  memory cleared
  reload forecast store
  reload correlation store
```

Verify that A9 can reconstruct:

```text
forecast → correlation → measurement reference
```

without requiring foreign stores to contain an A9 relationship record.

Foreign sources are only needed to dereference/enrich the referenced entities.

---

# 28. Phase 24 — Correlation tests

Create:

```text
tests/evolution/a9-correlation.vitest.ts
```

This deserves a dedicated suite because Q8 exposed the highest-risk seam.

### Required cases

#### Valid path

```text
forecast.subject = P1
proposal.submitted(P1).target.id = C1
proposal.executed(P1)
measurement(M1).capabilityId = C1
measurement within horizon
```

→ one correlation.

#### No submitted event

→ no correlation.

#### Submitted event mismatch

```text
forecast.subjectCapability !== submitted.target.id
```

→ no correlation.

#### No executed event

→ no correlation.

#### Rejected proposal

→ no correlation.

#### Wrong capability

```text
measurement.capabilityId !== forecast.subjectCapability
```

→ no correlation.

#### Outside horizon

→ no correlation.

#### Multiple measurements

```text
F1 → M1
F1 → M2
F1 → M3
```

→ three independent correlations.

#### Shared measurement

```text
F1 → M1
F2 → M1
```

→ two independent correlations.

#### No temporal heuristic

A nearer measurement must not outrank or suppress an exact qualifying measurement.

#### No payload heuristic

Similar payloads without the exact canonical bridge must not correlate.

---

# 29. Phase 25 — Bridge tests

Create:

```text
tests/evolution/a9-bridge.vitest.ts
```

Verify:

```text
low → MONITOR
medium → MONITOR
high → RISK_GATED_REVIEW
critical → RISK_GATED_REVIEW
```

Verify:

```text
RISK_GATED_REVIEW
    → REQUEST_MORE_EVIDENCE
```

Verify A3 target:

```text
UNDER_REVIEW
```

Regression:

* all five existing A2.5 kinds remain;
* A3 retains four binding kinds;
* A3 retains three target states.

---

# 30. Phase 26 — End-to-end test

Create:

```text
tests/evolution/a9-engine-end-to-end.vitest.ts
```

Test the complete pre-execution path:

```text
raw adapters
    ↓
detectors
    ↓
A9Forecast
    ↓
forecast JSONL
    ↓
A9 bridge
    ↓
A2.5 recommendation
    ↓
A3 generateDecision()
```

High/critical:

```text
A9Forecast
 → RISK_GATED_REVIEW
 → REQUEST_MORE_EVIDENCE
 → UNDER_REVIEW
```

Low/medium:

```text
A9Forecast
 → MONITOR
 → existing A3 MONITOR path
```

No finding:

```text
null/empty
 → no recommendation
 → no A3 call
```

---

# 31. Phase 27 — Post-execution correlation integration test

Add a dedicated integration fixture:

```text
proposal.submitted
proposal.executed
measurement.measured
```

Then verify:

```text
proposalId
    ↓
submitted.target.id
    ↓
measurement.capabilityId
```

produces exactly one `A9Correlation`.

Then repeat with:

```text
two forecasts
one measurement
```

and:

```text
one forecast
two measurements
```

to prove many-to-many behavior.

---

# 32. Phase 28 — Sentinel tests

Create:

```text
tests/evolution/a9-sentinel.vitest.ts
```

The sentinel must protect every architectural boundary likely to regress.

### Identity

```text
forecastId = deterministic canonical hash
correlationId = deterministic canonical hash
```

### Persistence

```text
forecasts.jsonl
correlations.jsonl
```

remain A9-owned.

### Foreign references

Verify foreign IDs are references only.

### Measurement namespace

Assert:

```text
CapabilityMeasurementPayload
```

does **not** gain:

```text
proposalId
sourceProposalIds
forecastId
```

### Event taxonomy

Assert CAP-9 five-event taxonomy remains unchanged.

### A2.5 taxonomy

Assert exactly six recommendation kinds.

### A3

Assert exactly four binding kinds.

Assert exactly three target states.

### A8 boundary

Assert A9 does not import:

```text
enriched-proposal-aggregator.ts
```

or the A8 normalization layer.

### Correlation bridge

Assert the implementation uses:

```text
proposal.submitted.payload.candidate.target.id
```

and:

```text
proposal.executed
```

rather than measurement-side proposal IDs.

---

# 33. Phase 29 — CLI tests

Test:

```text
alix governance evolution forecast
```

including:

* successful forecast;
* no findings;
* `--json`;
* dimension filtering;
* high-risk output;
* persistence failure;
* adapter failure.

The CLI must not introduce a second binary.

---

# 34. Phase 30 — Full regression

Run the complete suite.

Required areas:

```text
A6
CAP-N
CAP-O
CAP-P
A8
A2.5
A3
EventLog
measurement contracts
CLI
all A9 tests
```

Expected:

```text
0 regressions
```

Any pre-existing failure must be compared against the fork/base commit and explicitly classified rather than attributed to A9.

---

# 35. Phase 31 — Static architecture verification

Before closeout, inspect the changed-file set.

Expected A9-owned additions:

```text
src/evolution/a9/**
tests/evolution/a9-*.vitest.ts
```

plus only explicitly authorized:

```text
composition root
CLI registration
A2.5 recommendation type/mapping
```

No unrelated refactoring.

Search for prohibited changes:

```text
CapabilityMeasurementPayload
sourceProposalIds
proposal.submitted payload schema
CAP-9 event taxonomy
A3 binding kinds
A3 target states
A8 normalized contracts
```

---

# 36. Phase 32 — Persistence/restart verification

Perform a real restart-style test rather than only unit-testing JSON parsing.

Sequence:

```text
run A9
↓
persist forecast
↓
persist correlation
↓
destroy/reinitialize process state
↓
reload both JSONL stores
↓
query by forecastId
↓
query by measurementId
```

Verify the relationship is recoverable entirely from A9-owned persistence.

This directly satisfies Q4.

---

# 37. Phase 33 — Closeout audit

The implementation is complete only when all ten locked invariants can be answered "yes":

| Invariant                               | Verification                  |
| --------------------------------------- | ----------------------------- |
| A9 owns identity                        | canonical hash tests          |
| A9 owns persistence                     | JSONL ownership tests         |
| A9 owns correlation                     | no foreign writes             |
| Foreign IDs are references              | identity/sentinel tests       |
| Measurements remain capability-targeted | contract sentinel             |
| Correlation is positive evidence        | no-negative-record test       |
| Many-to-many                            | correlation integration tests |
| Artifacts immutable                     | append-only tests             |
| Calibration separated                   | no primary/status fields      |
| No speculative artifacts                | no `A9CorrelationAttempt`     |

---

# 38. Implementation order

The actual execution order should be:

```text
T1  Repository verification
 ↓
T2  A9 contracts
 ↓
T3  Identity/canonicalization
 ↓
T4  Risk-band projection
 ↓
T5  Raw adapter contracts
 ↓
T6  Adapter implementations
 ↓
T7  Detector implementations
 ↓
T8  Forecast builder
 ↓
T9  Forecast engine
 ↓
T10 Forecast JSONL store
 ↓
T11 ForecastsAdapter
 ↓
T12 Correlation builder
 ↓
T13 Corrected correlation engine
 ↓
T14 Correlation JSONL store
 ↓
T15 CorrelationsAdapter
 ↓
T16 A9 bridge
 ↓
T17 A2.5 sixth kind
 ↓
T18 A2.5 → A3 mapping
 ↓
T19 Composition-root wiring
 ↓
T20 CLI registration
 ↓
T21 Detector/adapter tests
 ↓
T22 Persistence/restart tests
 ↓
T23 Correlation tests
 ↓
T24 Bridge tests
 ↓
T25 E2E tests
 ↓
T26 Sentinel tests
 ↓
T27 Full regression
 ↓
T28 Static architecture audit
 ↓
T29 Closeout
```

---

# 39. Critical STOP conditions

The implementer must stop and surface rather than improvise if any of these occur:

### STOP-1 — Measurement contains proposal linkage

If the actual current contract differs from the locked Q8 finding, stop and reconcile the repository state.

Do not simply use the field.

### STOP-2 — `proposal.submitted.payload.candidate.target.id` cannot establish capability identity

Do not substitute another source without architectural approval.

### STOP-3 — `proposal.executed` cannot be deterministically identified by proposal ID

Stop.

Do not infer execution from:

* timestamps;
* measurement existence;
* governance state;
* proposal status heuristics.

### STOP-4 — Forecast subject cannot remain proposal-scoped

Stop before changing the authority model.

### STOP-5 — Existing A2.5 kind count differs from five

Stop and reconcile before adding the sixth.

### STOP-6 — A3 mapping cannot accept `REQUEST_MORE_EVIDENCE` without contract mutation

Stop.

Do not expand A3.

### STOP-7 — Correlation requires temporal proximity

Stop.

Temporal proximity is explicitly not an identity mechanism.

### STOP-8 — A9 needs to write into a foreign namespace

Stop.

The solution is architecturally wrong.

### STOP-9 — Identity requires storage metadata

Stop.

Identity must be reproducible.

### STOP-10 — Implementation requires `A9CorrelationAttempt`

Stop.

That artifact is separately authorized only.

---

# 40. Final acceptance criteria

A9 v1 is accepted only when:

### Forecast

* [ ] `A9Forecast` is immutable.
* [ ] `forecastId` is deterministic and A9-owned.
* [ ] forecast subject is `proposalId`.
* [ ] `subjectCapability` is copied from `proposal.submitted.payload.candidate.target.id`.
* [ ] forecasts persist independently in A9 JSONL.
* [ ] no-trigger runs emit no forecast.

### Governance

* [ ] low/medium → `MONITOR`.
* [ ] high/critical → `RISK_GATED_REVIEW`.
* [ ] exactly six A2.5 kinds.
* [ ] `RISK_GATED_REVIEW` → A3 `REQUEST_MORE_EVIDENCE`.
* [ ] A3 retains four binding kinds.
* [ ] A3 retains three target states.

### Correlation

* [ ] proposal-submitted event is the canonical proposal → capability bridge.
* [ ] proposal-executed event is required.
* [ ] measurement matching is exact on `capabilityId`.
* [ ] horizon is a validity bound.
* [ ] no temporal heuristic.
* [ ] no payload similarity heuristic.
* [ ] no proposal ID added to measurements.
* [ ] one forecast → many measurements works.
* [ ] one measurement → many forecasts works.
* [ ] no primary designation.
* [ ] no negative correlation records.
* [ ] no correlation status field.

### Persistence

* [ ] forecasts and correlations have separate JSONL stores.
* [ ] both are append-only.
* [ ] both reload after restart.
* [ ] A9 provenance is reconstructable from A9 stores alone.
* [ ] foreign stores are needed only for dereference/enrichment.

### Boundaries

* [ ] CAP-9 five-event taxonomy unchanged.
* [ ] CAP-10/10.5 measurement contract unchanged.
* [ ] A8 normalization untouched.
* [ ] no generalized correlation engine introduced.
* [ ] no A9 → A4 mandatory path introduced.
* [ ] no speculative `A9CorrelationAttempt`.
* [ ] no TUI/Web work.

### Quality

* [ ] full test suite green.
* [ ] A9 tests green.
* [ ] restart test green.
* [ ] sentinel green.
* [ ] changed-file audit clean.
* [ ] no unauthorized files modified.

---

## One important correction to carry into implementation

There is one place in the original design that should **not** survive into the plan unchanged:

> `correlationEngine.correlate(forecastId, measurementId, timestamp)` as though those two IDs alone are sufficient.

They are sufficient **only after the canonical authorization/bridge resolution has already happened**.

The actual engine seam should conceptually be closer to:

```text
measurement arrives
       ↓
load candidate A9 forecasts
       ↓
forecast.subject = proposalId
       ↓
resolve proposal.submitted(proposalId)
       ↓
verify submitted.target.id = forecast.subjectCapability
       ↓
verify proposal.executed(proposalId)
       ↓
match measurement.capabilityId
       ↓
check horizon
       ↓
build A9Correlation(forecastId, measurementId)
       ↓
append
```

That distinction is important because otherwise the implementation could accidentally reduce Q8's carefully established **canonical two-hop bridge** back into a simple `forecastId + measurementId` association and lose the authorization semantics.

**This plan should therefore be treated as the implementation baseline; any implementation finding that contradicts one of the STOP conditions should be surfaced rather than silently adapted.**

