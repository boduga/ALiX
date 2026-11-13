# Adaptation CLI Commands

## Overview
The `alix adaptation <subcommand>` surface that closes the reflection → propose → approve → apply loop. `main.ts` wires the proposal store, evidence store/writer, and `ApprovalGate`; `handlers.ts` implements each subcommand; `renderers.ts` prints human and JSON output; `appliers.ts` selects the applier implementation for a proposal's `target.kind`; `shared.ts` owns the `.alix` path constants and actor detection. The governance invariant "no approval, no mutation" is owned by `ApprovalGate`, not this module.

## Interface
- Entry point and subcommand dispatch: `handleAdaptationCommand(args)` in [main.ts:handleAdaptationCommand]
- Handler set: `runList`, `runShow`, `runPropose`, `runApprove`, `runReject`, `runApply`, `runLineage`, `runEffectiveness`, `runGenerate`, `runRevert`, `runIntelligence`, `runPrioritize`, `runCapabilityEvolution` in [handlers.ts:runApply]
- Applier selection by target kind: `selectApplier(cwd, proposal, writer)` in [appliers.ts:selectApplier]
- Renderers: `printProposal`, `printUsage`, `printManualAction`, `describeTarget`, `printEffectiveness`, `printGenerateSummary`, `printIntelligenceReport`, `printPriorityReport`, `printCapabilityEvolutionReport`, `pad` in [renderers.ts:printProposal]
- `.alix` path constants: `PROPOSALS_DIR`, `EFFECTIVENESS_DIR`, `INTELLIGENCE_DIR`, `EVIDENCE_DIR`, `CARDS_DIR`, `SKILLS_DIR`, `SNAPSHOTS_DIR` in [shared.ts:PROPOSALS_DIR]
- Actor identity helper: `detectActor()` in [shared.ts:detectActor]

## Invariants
- `apply` never calls an applier directly: `runApply` selects the applier and routes through `gate.apply(id, applier)`, which owns status transitions and evidence recording ([handlers.ts:runApply]).
- `runApply` gates on `computeProposalReadiness` before selecting an applier; `needs_approval`, `needs_specification`, `blocked`, and `completed` each exit non-zero without mutation, while `manual_action` prints guidance and returns cleanly ([handlers.ts:runApply]).
- Unknown subcommands print usage to stderr and exit with code 1 ([main.ts:handleAdaptationCommand]).
- `selectApplier` throws for `learning` targets (deferred to P8.9/P9) and for any unregistered `target.kind`, so the gate never receives an applier and no mutation occurs ([appliers.ts:selectApplier]).
- `runEffectiveness` is documented as pure read + compute that persists an advisory `keep | revert | investigate` recommendation and never mutates the proposal, agent cards, or skills ([handlers.ts:runEffectiveness]).
- `runGenerate` is generator-only: it never approves, applies, or mutates cards/skill files ([handlers.ts:runGenerate]).
- `runRevert` is creation-only: it saves a `pending` revert proposal and records `adaptation_proposed` evidence without approving or applying it ([handlers.ts:runRevert]).
- `detectActor` falls back through `USER`, `USERNAME`, then the literal `"cli-user"` ([shared.ts:detectActor]).

## Side Effects
- Creates and mutates the append-only proposal store under `.alix/adaptation/proposals` ([shared.ts:PROPOSALS_DIR]).
- Appends governance evidence through `EvidenceEventWriter` into the evidence store under `.alix/security` ([main.ts:handleAdaptationCommand]).
- Writes effectiveness, intelligence, and snapshot artifacts under `.alix/adaptation/{effectiveness,intelligence,snapshots}` ([shared.ts:SNAPSHOTS_DIR]).
- When an executive plans directory exists, constructs `ExecutiveOrchestrator` and fires `onProposalTerminal` best-effort after an apply succeeds or fails ([main.ts:handleAdaptationCommand]).
- Writes to stdout/stderr (proposal rendering, usage, error messages) and may call `process.exit(1)` ([renderers.ts:printUsage]).
- Reads `process.cwd()` and `process.env.USER`/`USERNAME` ([shared.ts:detectActor]).

## Verification
- Run: `pnpm test`
