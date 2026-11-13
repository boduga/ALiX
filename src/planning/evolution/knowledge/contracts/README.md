# Knowledge Curation Contracts

## Overview
Defines the normalized artifact, finding, proposal, configuration, and result types shared by the A6 knowledge-curation pipeline. Detectors consume the read model and emit findings; governance consumes proposals built from those findings.

## Interface
- `KnowledgeStore` and `KnowledgeArtifact` — the five projected store names and the normalized in-memory artifact read model `[curation-contract.ts:KnowledgeStore]` `[curation-contract.ts:KnowledgeArtifact]`.
- `CurationFinding`, `CurationFindingKind`, `CurationFindingSeverity`, and `CurationFindingReasonCode` — the closed finding taxonomy and deterministic evidence record `[curation-contract.ts:CurationFinding]`.
- `CurationProposal` — the internal proposal shape wrapped by governance, deliberately not a `DecisionArtifact` `[curation-contract.ts:CurationProposal]`.
- `CurationConfig` and `DEFAULT_CURATION_CONFIG` — explicit stale, duplicate, and compression thresholds `[curation-contract.ts:CurationConfig]` `[curation-contract.ts:DEFAULT_CURATION_CONFIG]`.
- `CurationResult` and `StoreStatus` — findings plus per-store availability diagnostics `[curation-contract.ts:CurationResult]` `[curation-contract.ts:StoreStatus]`.
- `isKnowledgeArtifact()` / `isCurationFinding()` — runtime shape guards `[curation-contract.ts:isKnowledgeArtifact]` `[curation-contract.ts:isCurationFinding]`.

## Invariants
- `KnowledgeArtifact` is a read model projected by read-only adapters; it is not a serializable DTO and is never persisted `[curation-contract.ts:KnowledgeArtifact]`.
- `CurationFinding.findingId` is deterministic identity derived from store, kind, artifact id, and optional target id, never from detection circumstances `[curation-contract.ts:CurationFinding]`.
- Finding `severity` is independent of detector `confidence`, and `reasonCode` is a closed set rather than parsed rationale `[curation-contract.ts:CurationFinding]`.
- Thresholds are supplied to detectors through `CurationConfig` and are not hard-coded in detector implementations `[curation-contract.ts:CurationConfig]`.
- Store unavailability is diagnostic `StoreStatus`, not a curation finding and never a governance proposal `[curation-contract.ts:StoreStatus]`.
- Contradiction detection operates only on artifacts that already carry the optional structured `claim` `[curation-contract.ts:KnowledgeArtifact]`.
- `CurationProposal` intentionally omits A3-facing `DecisionArtifact` fields because those belong to the governance artifact built later `[curation-contract.ts:CurationProposal]`.

## Side Effects
- None. This module declares types, constants, default data, and pure type guards.

## Verification
- Run: `pnpm test`
