# Capability Governance Ledger

## Overview
The type-and-persistence seam for CAP-9 capability evolution governance. It defines the five canonical governance events, computes deterministic proposal ids, and wraps the shared `EventLog` with an append-only `capability.governance.proposal.*` ledger. Governance history is append-only here; the capability catalog remains the authoritative capability state ([governance-proposal-store.ts:GovernanceProposalStore] module doc, [governance-types.ts:CapabilityMutationResult] module doc).

## Interface
- `CapabilityGovernanceEventType` — the five long-form event types (`…proposal.submitted|approved|rejected|executed|execution_failed`) ([governance-types.ts:CapabilityGovernanceEventType])
- `CAPABILITY_GOVERNANCE_EVENT_TYPES` / `CAPABILITY_GOVERNANCE_EVENT_SHORT_TYPES` — long and prefix-stripped short forms ([governance-types.ts:CAPABILITY_GOVERNANCE_EVENT_TYPES])
- `GOVERNANCE_EVENT_PREFIX` = `"capability.governance.proposal."` ([governance-types.ts:GOVERNANCE_EVENT_PREFIX])
- `isGovernanceEventType(value)` — runtime narrowing guard ([governance-types.ts:isGovernanceEventType])
- `CapabilityMutationResult` — narrow four-field projection of an A4/CAP-6 mutation result ([governance-types.ts:CapabilityMutationResult])
- `projectCapabilityMutationResult(result)` — two-level-envelope projection (`output.mutation`, `output.result.artifactId`) ([governance-types.ts:projectCapabilityMutationResult])
- `CapabilityGovernanceEvent` / `CapabilityGovernanceEventProjection` — discriminated ledger and application-facing unions ([governance-types.ts:CapabilityGovernanceEvent])
- `GovernanceProposalStore` — `submit`, `recordApproved`, `recordRejected`, `recordExecuted`, `recordExecutionFailed`, `findById`, `existsSubmitted` ([governance-proposal-store.ts:GovernanceProposalStore])
- `computeProposalId(candidate)` / `isValidProposalId(value)` ([proposal-identity.ts:computeProposalId])

## Invariants
- `computeProposalId` is a pure hash of `canonicalStringify(candidate)` under the domain prefix `alix-capability-proposal-v1:` — no clock and no I/O; key order does not change the id ([proposal-identity.ts:computeProposalId]).
- A valid proposal id is exactly 64 lowercase hex chars ([proposal-identity.ts:isValidProposalId]).
- `submit` refuses a duplicate: an existing `proposal.submitted` event with the same computed id throws `CapabilityProposalDuplicateError` ([governance-proposal-store.ts:GovernanceProposalStore]).
- Events are written with `actor: "system"` and a payload carrying `proposalId`; the id lives in the payload, not a top-level EventLog field ([governance-proposal-store.ts:GovernanceProposalStore]).
- `findById` filters by the governance prefix and payload `proposalId`, then sorts by `seq` ascending ([governance-proposal-store.ts:GovernanceProposalStore]).
- Reconstructed events are frozen with long-form discriminants and are cast from the persisted `AlixEvent` shape ([governance-proposal-store.ts:GovernanceProposalStore]).
- The module holds no live catalog/registry reference; it only reads and writes the `EventLog` ([governance-proposal-store.ts:ProposalStoreOptions]).
- `sourceVersion` is captured before persistence (`null` for create intent) so apply can reject a stale publication ([governance-types.ts:ProposalSubmittedPayload]).
- `partialState` is `"rolled_back" | "not_committed"` and is omitted from the payload when undefined ([governance-types.ts:ProposalPartialState], [governance-proposal-store.ts:GovernanceProposalStore]).

## Side Effects
- Appends events to the shared `EventLog` via `eventLog.append` and reads the ledger via `eventLog.readAll` ([governance-proposal-store.ts:GovernanceProposalStore]).
- `recordApproved` stamps `approvedAt` from `new Date().toISOString()` — wall-clock read at call time ([governance-proposal-store.ts:GovernanceProposalStore]).

## Verification
- Run: `pnpm test`
