# Capability Domain Errors

## Overview
Five stable, frozen error classes for the capability lifecycle: measurement target/failure classification, proposal deduplication and staleness, and the forward-wired not-implemented signal. Callers (CLI, service, measurement engine) branch on the typed `code` field instead of parsing messages.

## Interface
- `CapabilityMeasureFailedError`: wraps an underlying A5 measurement failure with `code: "measure_failed"` and carries `capabilityId`, `version`, `baselineObservationId`, and `cause` [measure-failed.ts:CapabilityMeasureFailedError].
- `CapabilityMeasureInvalidTargetError`: unknown `id@version` target before A5 is invoked, with `code: "measure_invalid_target"` [measure-invalid-target.ts:CapabilityMeasureInvalidTargetError].
- `CapabilityProposalDuplicateError`: duplicate canonical proposal id, with `code: "CAPABILITY_PROPOSAL_DUPLICATE"` and the offending `proposalId` [proposal-duplicate.ts:CapabilityProposalDuplicateError].
- `CapabilityProposalStaleError`: pinned source no longer matches the catalog, with `code: "CAPABILITY_PROPOSAL_STALE"` plus `proposalId`, `sourceId`, `sourceVersion`, and `currentVersion` [proposal-stale.ts:CapabilityProposalStaleError].
- `CapabilityServiceNotImplementedError`: forward-wired `propose()`/`measure()` stub signal, with `code: "not_implemented_yet"` [service-not-implemented.ts:CapabilityServiceNotImplementedError].

## Invariants
- Every class calls `Object.freeze(this)` after assigning `name` and `code`, so instances are immutable and safe across logger/event boundaries [measure-failed.ts:CapabilityMeasureFailedError], [measure-invalid-target.ts:CapabilityMeasureInvalidTargetError], [proposal-duplicate.ts:CapabilityProposalDuplicateError], [proposal-stale.ts:CapabilityProposalStaleError], [service-not-implemented.ts:CapabilityServiceNotImplementedError].
- The measure pair is partitioned: invalid targets fail before A5 runs, while `CapabilityMeasureFailedError` is reserved for A5-side throws [measure-invalid-target.ts:CapabilityMeasureInvalidTargetError], [measure-failed.ts:CapabilityMeasureFailedError].
- `CapabilityMeasureFailedError` preserves the original failure through `cause` and renders `absent` when no baseline id is supplied [measure-failed.ts:CapabilityMeasureFailedError].
- The not-implemented message is caller-supplied and must not encode roadmap states such as `awaiting_cap_9`/`awaiting_cap_10` [service-not-implemented.ts:CapabilityServiceNotImplementedError].
- Stale-error rendering substitutes `undefined` when the catalog has no current version [proposal-stale.ts:CapabilityProposalStaleError].

## Side Effects
- None: the module only constructs `Error` subclasses and performs no I/O, logging, or registry mutation [proposal-duplicate.ts:CapabilityProposalDuplicateError], [measure-failed.ts:CapabilityMeasureFailedError].

## Verification
- Run: `pnpm test`
