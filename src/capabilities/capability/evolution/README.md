# Capability Evolution Signals & Proposals

## Overview
A7 proposal intelligence for CAP-9: it reads `CapabilityEvolutionSignal`
values from an injected source, validates caller-supplied consolidation
identity, and emits one deterministic `CapabilityEvolutionCandidate` per
signal. It performs no catalog, registry, clock, or store access; persistence
and ledger-bound proposal ids belong to `service.propose()`.

## Interface
- `CapabilityEvolutionSignal` — four-arm discriminated union: `gap`,
  `underperformer`, `consolidation_opportunity`, `deprecation_signal`.
  [proposals.ts:CapabilityEvolutionSignal]
- `CapabilityProposalGenerator.generate()` — pure one-candidate-per-signal
  mapper; source errors propagate. [proposals.ts:CapabilityProposalGenerator]
- `validateConsolidationOpportunitySignal` — rejects invalid consolidation
  arms before candidate construction. [proposals.ts:validateConsolidationOpportunitySignal]
- `defaultCapabilityProposalGenerator()` — composition-root placeholder that
  throws until a real signal source is wired. [proposals.ts:defaultCapabilityProposalGenerator]
- `ConsolidationIdentity` and `SourceDisposition` — the caller-supplied
  governed quartet and its `deprecate`/`remove` disposition.
  [consolidation-identity.ts:ConsolidationIdentity]
- `validateConsolidationIdentity` — throws on a malformed identity; never
  repairs it. [consolidation-identity.ts:validateConsolidationIdentity]
- `bundleConsolidationIdentity` — copies the quartet, defensively copying the
  absorbed array. [consolidation-identity.ts:bundleConsolidationIdentity]
- `buildOverlapSignals` — pair-layer `ProposalSignalSource` bridging overlap
  evidence to A7. [overlap-signal-source.ts:buildOverlapSignals]
- `compositeProposalSignalSource` — concatenates multiple signal sources.
  [overlap-signal-source.ts:compositeProposalSignalSource]
- `ProposalSignalSource` / `ProposalSignalSink` — read and write seams for
  signal delivery. [proposals.ts:ProposalSignalSource]
- `ProposalSignalChannel` — in-memory sink/source implementation.
  [proposal-signal-channel.ts:ProposalSignalChannel]
- `computeSignalId` and `isValidSignalId` — deterministic SHA-256 signal
  identity and its 64-hex-char guard. [signal-identity.ts:computeSignalId]

## Invariants
- Candidate ids are deterministic from signal content alone: `a7-<kind>-<id>`,
  using `new` for gaps and the survivor id for consolidation.
  [proposals.ts:candidateIdFor]
- Risk classes are fixed per kind: gap low, underperformer medium,
  consolidation and deprecation high. [proposals.ts:riskClassFor]
- A consolidation identity requires a non-empty survivor, a non-empty absorbed
  set that excludes the survivor, a well-formed definition, and a legal
  disposition. [consolidation-identity.ts:validateConsolidationIdentity]
- The well-formedness check on `consolidateDefinition` is deliberately shallow;
  deep merge invariants belong to the executor's `validateConsolidate()`.
  [consolidation-identity.ts:isWellFormedConsolidateDefinition]
- The pair layer defaults `minOverlapScore` to `0.7`, emits only overlaps with
  `consolidationCandidate === true`, and skips overlaps whose
  `identitySupplier` returns `null`. [overlap-signal-source.ts:buildOverlapSignals]
- Pair evidence travels as opaque `evidenceIds` primitives; the signal body
  gains no pair-only fields. [overlap-signal-source.ts:buildOverlapSignals]
- Signal reads are non-destructive snapshots; the channel buffer stays
  private. [proposal-signal-channel.ts:ProposalSignalChannel]
- Signal ids are domain-prefixed SHA-256 hex over canonical JSON, so key order
  does not change the id. [signal-identity.ts:computeSignalId]

## Side Effects
- `CapabilityProposalGenerator` performs no I/O, no clock reads, and no writes;
  persistence is out of scope. [proposals.ts:CapabilityProposalGenerator]
- The pair layer is stateless between invocations and persists nothing.
  [overlap-signal-source.ts:OverlapProposalSignalSourceOptions]
- `ProposalSignalChannel` buffers signals in memory only; the durable
  `measured` event log remains authoritative. [proposal-signal-channel.ts:ProposalSignalChannel]
- `computeSignalId` hashes in memory with no I/O. [signal-identity.ts:computeSignalId]

## Verification
- Run: `pnpm test`
