# Knowledge Evolution Curation

## Overview

The A6 knowledge-evolution package projects ALiX knowledge stores into a normalized read model, runs pure detectors over the combined artifact set, and turns findings into a bounded curation proposal for A3 governance. The package separates read-only store adapters from deterministic detection and orchestration; A6 proposes a curation action while A3 remains the decision authority. The `alix governance evolution curate` command is the CLI entry point and operates across stores without an evolution id.

## Interface

- `handleCurationCommand()` and `CurationCLIDeps` - CLI handler for `curate`, including `--dimension` and `--json` handling `[curation-cli.ts:handleCurationCommand]` `[curation-cli.ts:CurationCLIDeps]`.
- `CurationEngine` and `CurationEngineDeps` - orchestration over read-only adapter functions and pure detector functions `[curation-engine.ts:CurationEngine]` `[curation-engine.ts:CurationEngineDeps]`.
- `CurationEngine.curateAll()` - runs every adapter, combines artifacts, runs every detector, and returns findings plus store status `[curation-engine.ts:curateAll]`.
- `buildCurationProposal()` - aggregates a non-empty finding list into a content-addressed `CurationProposal` `[curation-proposal-builder.ts:buildCurationProposal]`.
- `buildEvidenceFromFindings()` - wraps finding evidence references and rationales into `VerificationEvidence` with deterministic identity `[curation-proposal-builder.ts:buildEvidenceFromFindings]`.
- `buildGovernanceRecommendation()` - maps a proposal and evidence to the A2.5 `GovernanceRecommendation` consumed by A3 `[curation-proposal-builder.ts:buildGovernanceRecommendation]`.
- Package barrel re-exports the curation contracts, adapters, detectors, engine, and proposal builder `[index.ts]`.
- `contracts/` - normalized artifact, finding, proposal, config, result, and type-guard contracts: [./contracts/README.md](./contracts/README.md).
- `adapters/` - read-only store adapters for learning, chronicle, failure memory, pattern registry, and evidence (no separate contract file).
- `detectors/` - pure stale, duplicate, contradiction, and compressible detectors plus shared finding identity (no separate contract file).

## Invariants

- Zero findings yields `null` from `buildCurationProposal`; no proposal, evidence, or A3 call is produced `[curation-proposal-builder.ts:buildCurationProposal]` `[curation-cli.ts:handleCurationCommand]`.
- A6 always recommends `kind: "APPROVE"`; the recommendation is advisory and A3 remains authoritative `[curation-proposal-builder.ts:buildGovernanceRecommendation]`.
- Proposal and evidence identities are deterministic SHA-256 hashes over sorted finding ids, independent of finding order `[curation-proposal-builder.ts:computeCurationProposalId]` `[curation-proposal-builder.ts:computeCurationEvidenceId]`.
- Evidence confidence fields replay, coverage, and determinism use the mean finding confidence; historical similarity is fixed at `1` and reproducibility level is `2` `[curation-proposal-builder.ts:buildEvidenceFromFindings]`.
- The engine performs no detection and no store writes; an unavailable store contributes no artifacts but never suppresses other stores and remains in `storeStatus` `[curation-engine.ts:curateAll]`.
- Findings follow adapter-then-detector order, and store status follows adapter order `[curation-engine.ts:curateAll]`.
- `--dimension` accepts only the full kinds `stale`, `duplicate`, `contradiction`, and `compressible`; aliases, unknown values, and a missing value are usage errors `[curation-cli.ts:parseDimensionFlag]`.
- The CLI base directory defaults to `process.cwd()`; evidence and pattern-registry adapters are wired only when their dependencies are supplied `[curation-cli.ts:buildCurationEngine]`.
- An empty finding set prints `No curation findings` without invoking A3; JSON mode emits `{ findings: [], proposal: null }` `[curation-cli.ts:handleCurationCommand]`.
- Proposal summaries count findings by kind in first-seen order, and proposal dimensions preserve first-seen kind order `[curation-proposal-builder.ts:buildSummary]` `[curation-proposal-builder.ts:uniqueKinds]`.

## Side Effects

- The CLI writes human-readable or JSON output to stdout and sets `process.exitCode = 1` on usage or proposal-build failure `[curation-cli.ts:handleCurationCommand]`.
- The CLI invokes the A3 decision engine after building proposal evidence and prints the returned governance decision `[curation-cli.ts:handleCurationCommand]`.
- Curation reads configured knowledge stores through adapters under the base directory, including `.alix/learning` and `.alix/governance`, plus the optional evidence ledger and pattern registry `[curation-cli.ts:buildCurationEngine]`.
- Proposal and evidence timestamps are read from the wall clock, while their identifiers remain content-addressed `[curation-proposal-builder.ts:buildCurationProposal]` `[curation-proposal-builder.ts:buildEvidenceFromFindings]`.
- No file, network, or store mutation is performed by the engine itself `[curation-engine.ts:curateAll]`.

## Verification

- Run: `pnpm test`
