# A7 — Capability Marketplace Checkpoint

**Date:** 2026-08-10
**Phase:** A7 — Capability Marketplace
**Checkpoint tag:** `alix-a7-capability-marketplace-complete`

## Summary

A7.0 implements the **Capability Lifecycle Governance** core of the Capability
Marketplace. It observes signals about a capability's adoption and
deprecation, runs a pure analyzer that emits lifecycle **candidates**, and
routes those candidates through the existing A-series governance machinery
(A0 proposal → A2.5 evidence/recommendation → A3 decision) as a governed
**decision record** in an append-only JSONL ledger. A7.0 is strictly the
**governed DECISION boundary** — Propose → Decide → Record. Nothing in A7.0
makes a proposed transition true: no registry mutation, no A4 executor, no
applied/measured events, no `executionId`/`measurementId`. Approval never
mutates the registry; `APPROVED_PENDING_APPLICATION` is a governance-overlay
projection state, never a value in `LifecycleState`. The A7.1 increment owns
the APPLICATION boundary (A4 binding + registry mutation + A5 measurement).

Implemented as part of the A7 plan (`docs/superpowers/plans/2026-08-10-a7-capability-marketplace.md`).
CLI: `alix capabilities {list,inspect,history,health,recommend,propose}`.

## Implemented

| File | Responsibility |
|------|----------------|
| `src/evolution/contracts/evolution-contract.ts` | Contract extension — `"capability"` added to `EvolutionTargetKind` + `VALID_EVOLUTION_TARGET_KINDS` (additive, arity 7 → 8) |
| `src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts` | `CapabilityLifecycleRecord` (observed/proposed semantics), `CapabilityLifecycleIntent`/`EventType`/`Target`, `validateCapabilityLifecycleRecord`, `computeDeterministicRecordId` (clr- prefix), `CapabilityProjectionState` + `deriveCapabilityProjectionState`, `CapabilitySignalInputs`/`CapabilityLifecycleCandidate` |
| `src/evolution/capability-lifecycle/capability-lifecycle-ledger.ts` | `JsonlCapabilityLifecycleLedger` — append-only JSONL at `.alix/capability-lifecycle/lifecycle.jsonl` (`DEFAULT_CAPABILITY_LIFECYCLE_FILE`), never-throws-on-read |
| `src/evolution/capability-lifecycle/capability-lifecycle-analyzer.ts` | `analyzeCapabilityLifecycle` — pure signal → candidates; zero-candidate invariant; A6 pattern data deliberately NOT attached (user amendment) |
| `src/evolution/capability-lifecycle/capability-proposal-builder.ts` | `buildCapabilityProposals` — candidates → A0 `EvolutionIntent`/`EvolutionProposal` (targetKind `capability`, deterministic `evol-a7-`/`prop-a7-` ids) |
| `src/evolution/capability-lifecycle/capability-governance-bridge.ts` | `buildCapabilityEvidence`/`buildCapabilityRecommendation`/`runCapabilityGovernance`/`toLedgerRecord` — the A6 A2.5→A3 mirror |
| `src/evolution/capability-lifecycle/capability-lifecycle-cli.ts` | CLI handler (`handleCapabilitiesCommand`) — list/inspect/history/health/recommend/propose; fatal errors exit 1 |
| `src/evolution/capability-lifecycle/index.ts` | Barrel re-exports |
| `src/cli/commands/capabilities.ts` | CLI command wiring (`handleCapabilitiesCommand` re-export) |
| `src/cli.ts` | `capabilities` subcommand dispatch |

**Tests:** `tests/evolution/capability-lifecycle/` — evolution-target-contract,
capability-lifecycle-record, capability-lifecycle-ledger,
capability-lifecycle-analyzer, capability-proposal-builder,
capability-governance-bridge, capability-cli, and
`integration/a7-capability-lifecycle-integration`. **54/54 A7 tests pass across
10 suites**; A0 core contracts **188/188 PASS**.

## Verification Checklist

### Governed DECISION boundary only (A7.0 invariant)
- [x] A7.0 covers Propose → Decide → Record — nothing in A7.0 makes a proposed transition true
- [x] `LifecycleEventType` excludes applied/measured; `validateCapabilityLifecycleRecord` **rejects** any record claiming applied/measured (integration-asserted)
- [x] No registry mutation — `approve` records the decision, never applies it
- [x] No A4 executor binding, no `executionId`/`measurementId` anywhere in the A7.0 contracts
- [x] `APPROVED_PENDING_APPLICATION` is a governance-overlay projection state (`deriveCapabilityProjectionState`), never a `LifecycleState` value

### Approval never mutates
- [x] Governance decision is appended to the ledger only; the registry snapshot is byte-identical after approval (integration no-mutation assertion)
- [x] A rejected proposal likewise records `REJECTED` without touching the registry
- [x] A7.0 only proposes/decides/records; A3 remains the governance authority that decides

### Zero-candidate invariant
- [x] Empty signal/candidate set → `buildCapabilityProposals` returns no proposal, no evidence, no A3 `generateDecision` call, no ledger write (integration-asserted end-to-end)

### Determinism
- [x] `computeDeterministicRecordId` is a deterministic content-addressed id (`clr-` prefix) over `(eventType, correlationId)` — stable across calls, distinct across correlation ids
- [x] `buildCapabilityProposals` emits deterministic `evol-a7-`/`prop-a7-` ids
- [x] Analyzer is pure — signal inputs in, candidates out, no I/O, no store access, no mutation of its input
- [x] Ledger is append-only — writes append, reads never throw

### No ungoverned action
- [x] `recommend` is read-only; `propose` is the only state-changing command and it records, never executes
- [x] Fatal CLI errors exit 1 (unknown subcommand, missing report, no-candidates handled explicitly)
- [x] A7.0 does not instantiate the evolution lifecycle; `GovernanceDecision` flows through the existing A-series machinery
