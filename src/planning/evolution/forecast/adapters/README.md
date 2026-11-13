# Forecast Adapters

## Overview
Read-only adapters that project proposal, measurement, and enriched-proposal sources into the A9 forecast contracts. Adapters perform selection and shape reconciliation only; joins and scoring remain above this boundary.

## Interface
- `EnrichedProposalsAdapter` and `EnrichedProposalsSource` [enriched-proposals-adapter.ts:EnrichedProposalsAdapter]
- `createEnrichedProposalsSource(cwd)` for lazy reads from adaptation proposals, effectiveness, and security evidence stores [enriched-proposals-source.ts:createEnrichedProposalsSource]
- `MeasurementEventsAdapter` and `MEASUREMENT_EVENT_TYPE` [measurement-events-adapter.ts:MeasurementEventsAdapter]
- `ProposalEventsAdapter`, `PROPOSAL_EVENT_PREFIX`, and `GOVERNANCE_NAMESPACE_PREFIX` [proposal-events-adapter.ts:ProposalEventsAdapter]

## Invariants
- The enriched adapter accepts either a loaded array or a lazy asynchronous supplier; it maps capability ids only for capability-typed targets and uses epoch ISO when `createdAt` is absent [enriched-proposals-adapter.ts:toRecord]
- The enriched source is lazy and degrades to an empty array when store construction or analysis fails [enriched-proposals-source.ts:createEnrichedProposalsSource]
- Measurement events select exactly `capability.governance.measurement.measured`, default missing outcomes to `inconclusive`, and expose no proposal, forecast, or correlation linkage [measurement-events-adapter.ts:MEASUREMENT_EVENT_TYPE]
- Proposal events select the governance proposal prefix, strip the namespace, prefer `payload.proposalId`, and preserve the raw payload verbatim [proposal-events-adapter.ts:toRecord]

## Side Effects
- Enriched source reads `.alix/adaptation/proposals`, `.alix/adaptation/effectiveness`, and `.alix/security` on first `list()` [enriched-proposals-source.ts:createEnrichedProposalsSource]
- Proposal and measurement adapters read the event log with `readAll()`; none write or mutate source state [proposal-events-adapter.ts:list]

## Verification
- Run: `pnpm test`
