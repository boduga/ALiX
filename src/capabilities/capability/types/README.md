# Capability Service Result Types

## Overview

Type-only module (no runtime code) defining the narrow, readonly result shapes
returned by the `CapabilityService` surface. The locked ruling recorded in the
file's header is "narrow typed result shapes, one per method, no generic
envelope" and "No mutable domain objects by reference — results are snapshots":
every interface is `readonly` end-to-end, so mutating a returned object cannot
change the underlying catalog, registry, or event-log state. Types are grouped
by service method (read side, history, apply) and by governance/measurement
capability sections (CAP-9, CAP-10).

## Interface

- Read side: `CapabilityListItem`, `CapabilityListResult` (`list`) [service-results.ts:CapabilityListResult]
- `CapabilityInspectResult` (`inspect`) — includes `availability.reason: "missing_binding" | "provider_unavailable"` [service-results.ts:CapabilityInspectResult]
- `CapabilitySearchQuery` / `CapabilitySearchResult` (`search`) — filters `text`, `kind`, `tags`, `lifecycle`, `availableOnly`, `limit` [service-results.ts:CapabilitySearchQuery]
- `CapabilityHealthResult` (`health`) — intentionally not `ProviderCandidate[]` [service-results.ts:CapabilityHealthResult]
- `CapabilityRecommendInput` / `CapabilityRecommendResult` (`recommend`) [service-results.ts:CapabilityRecommendResult]
- `CapabilityHistoryEvent` / `CapabilityHistoryResult` — EventLog projection with `seq`, `type`, readonly payload [service-results.ts:CapabilityHistoryResult]
- `CapabilityApplyStep` — operation union `capability.create | update | transition | consolidate | remove` [service-results.ts:CapabilityApplyStep]
- `CapabilityApplyInput` — discriminated union of `{ step }` or `{ proposalId }` [service-results.ts:CapabilityApplyInput]
- `CapabilityApplyResult` — `success`, `operation`, `affected`, optional `artifactId`/`error` [service-results.ts:CapabilityApplyResult]
- `CapabilityServiceOptions` — constructor dependency list `catalog`, `resolver`, `mutationExecutor`, `eventLog`, optional `proposalGenerator`, optional `measurementEngine` [service-results.ts:CapabilityServiceOptions]
- CAP-9: `CapabilityProposeResult` (`status: "pending"`), `CapabilityApplyProposalResult` (`status: "executed" | "execution_failed"`), `CapabilityGovernanceResult` [service-results.ts:CapabilityApplyProposalResult]
- CAP-10: `CapabilityMeasurementEventProjection`, `CapabilityMeasureInput`, `CapabilityMeasureResult` (`status: "measured"`, `post.status: ObservationStatus`) [service-results.ts:CapabilityMeasureResult]

## Invariants

- Every field on every exported interface is `readonly`; results are snapshots, not live references [service-results.ts:CapabilityListItem]
- No generic `{ok, value, error}` envelope and no `CapabilityServiceResult<T>`; each method has its own shape [service-results.ts:CapabilityInspectResult]
- `CapabilityApplyInput` is a discriminated union keyed on `step` vs `proposalId` [service-results.ts:CapabilityApplyInput]
- `CapabilityApplyProposalResult.mutation` is present only when `status === "executed"`; `error` only when `status === "execution_failed"` [service-results.ts:CapabilityApplyProposalResult]
- Optional `proposalGenerator`/`measurementEngine` keep the read-only CAP-8 call sites valid; when absent, `propose()`/`measure()` are documented to throw `CapabilityServiceNotImplementedError` rather than return a degraded shape [service-results.ts:CapabilityServiceOptions]
- `CapabilityMeasureResult.eventIds` mirrors the single `capability.governance.measurement.measured` event as `{type, seq}` entries [service-results.ts:CapabilityMeasureResult]

## Side Effects

- ["None"] — this module declares types only and performs no I/O, mutation, or registration.

## Verification

- Run: `pnpm test`
