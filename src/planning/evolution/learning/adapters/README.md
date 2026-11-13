# Learning Adapters

## Overview

Read-only adapters that normalize four heterogeneous sources into the
`LearningAdapter` contract consumed by the evolution learning engine:
enriched proposals, governance proposal events, capability measurement
events, and governance recommendations. Each adapter lists records and maps
them field-for-field; joins and correlation are owned by the detector layer
above this boundary.

## Interface

- `EnrichedProposalsAdapter` (`name: "enriched-proposals"`) — normalizes `EnrichedProposal[]` into `EnrichedProposalRecord[]` (`enriched-proposals-adapter.ts:EnrichedProposalsAdapter`).
- `ProposalEventsAdapter` (`name: "proposal-events"`) — filters `EventLog` events by the `capability.governance.proposal.` prefix into `ProposalGovernanceRecord[]` (`proposal-events-adapter.ts:ProposalEventsAdapter`).
- `MeasurementEventsAdapter` (`name: "measurement-events"`) — reads only `capability.governance.measurement.measured` events into `MeasurementOutcomeRecord[]` (`measurement-events-adapter.ts:MeasurementEventsAdapter`).
- `RecommendationsAdapter` (`name: "recommendations"`) — projects `RecommendationStore.list()` records into `RecommendationRecord[]` (`recommendations-adapter.ts:RecommendationsAdapter`).
- `LearningAdapter` / record types — defined in `../contracts/learning-contract.js` and re-exported by the barrel (`index.ts`, `enriched-proposals-adapter.ts:LearningAdapter`).
- Barrel — `index.ts` re-exports all four adapters (`index.ts`).

## Invariants

- Adapters never write and never join across sources; correlation by `proposalId` happens in the detector layer (`proposal-events-adapter.ts:ProposalEventsAdapter`, `recommendations-adapter.ts:RecommendationsAdapter`).
- `capabilityId` is derived from `target.capability` only for `kind: "capability"` targets and is `""` otherwise (`enriched-proposals-adapter.ts:EnrichedProposalsAdapter`).
- The enriched adapter's `enrichedFields` is the top-level key list of the wrapper, and `recordedAt` falls back to the Unix epoch ISO string when `proposal.createdAt` is absent (`enriched-proposals-adapter.ts:EnrichedProposalsAdapter`).
- `ProposalEventsAdapter.capabilityId` is populated only for `proposal.submitted` (from `payload.candidate.target.id`); `operatorId`/`operatorReason` come only from approved/rejected payloads (`proposal-events-adapter.ts:ProposalEventsAdapter`).
- `ProposalGovernanceRecord.error` is populated from `payload.error` on `proposal.execution_failed` events so repeated-pattern failures can be fingerprinted (`proposal-events-adapter.ts:ProposalEventsAdapter`).
- Measurement events are capability-targeted, not proposal-targeted; events lacking a `measurement` payload yield `capabilityId: ""` and outcome `"inconclusive"` (`measurement-events-adapter.ts:MeasurementEventsAdapter`).
- `signals_unpublished` events are deliberately excluded because only `measured` events carry outcomes (`measurement-events-adapter.ts:MeasurementEventsAdapter`).
- The recommendations adapter reads exclusively from the A2.5 `RecommendationStore` (`recommendations.jsonl` under `.alix/verification/`), never the P9.x `GovernanceStore` report file (`recommendations-adapter.ts:RecommendationsAdapter`).
- `RecommendationsAdapter` maps `supportingEvidence` → `evidenceRefs` and `createdAt` → `recordedAt`, with no default substitution for an empty `proposalId` (`recommendations-adapter.ts:RecommendationsAdapter`).

## Side Effects

- `ProposalEventsAdapter` and `MeasurementEventsAdapter` call `EventLog.readAll()` and read the whole event log on each `list()` (`proposal-events-adapter.ts:ProposalEventsAdapter`, `measurement-events-adapter.ts:MeasurementEventsAdapter`).
- `RecommendationsAdapter` calls `RecommendationStore.list()`, which reads the `.alix/verification/recommendations.jsonl` store (`recommendations-adapter.ts:RecommendationsAdapter`).
- `EnrichedProposalsAdapter` reads only its injected in-memory array (`enriched-proposals-adapter.ts:EnrichedProposalsAdapter`).
- No adapter performs network I/O, disk writes, or process spawning (`index.ts`).

## Verification

- Run: `pnpm test`
