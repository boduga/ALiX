# ALiX Governance Infrastructure

> **Audience:** Contributors, architects
> **Part of:** P5.7e Documentation Freeze
> **See also:** [Governance Model](../governance/governance-model.md)

## Purpose

This document provides a code-level map of the governance infrastructure.
It describes the key modules, their responsibilities, data flow, and
relationships.

## File Map

| Module | Path | Responsibility |
|--------|------|----------------|
| **ApprovalGate** | `src/adaptation/approval-gate.ts` | Enforces no-approval-no-mutation invariant; sole owner of status transitions |
| **ProposalStore** | `src/adaptation/proposal-store.ts` | File-system JSON persistence for proposals |
| **SnapshotStore** | `src/adaptation/snapshot-store.ts` | Pre-mutation file snapshots with SHA-256 content hash |
| **EvidenceStore** | `src/security/evidence/evidence-store.ts` | Append-only JSONL evidence store with deterministic fingerprints |
| **EvidenceEventWriter** | `src/workflow/evidence-writer.ts` | Typed wrapper for evidence recording (best-effort) |
| **AgentCardApplier** | `src/adaptation/appliers/agent-card-applier.ts` | File mutation: agent card CRUD |
| **SkillApplier** | `src/adaptation/appliers/skill-applier.ts` | File mutation: skill step adjustment |
| **RevertApplier** | `src/adaptation/revert-applier.ts` | File mutation: snapshot-based revert |
| **AutomaticProposalGenerator** | `src/adaptation/auto-proposal-generator.ts` | Auto-generates pending proposals from reflection/effectiveness |
| **CapabilityEvolutionProposalGenerator** | `src/adaptation/capability-evolution-proposal-generator.ts` | Auto-generates pending proposals from capability analysis |
| **LineageBuilder** | `src/adaptation/lineage-builder.ts` | Builds lineage graphs from stores |
| **CLI (adaptation)** | `src/cli/commands/adaptation.ts` | Wires everything together; command dispatch |
| **CLI (evidence)** | `src/cli/commands/evidence.ts` | Evidence query, show, verify |
| **selectApplier** | `src/cli/commands/adaptation.ts` (internal) | Routes target kind to applier |

## Data Flow

```
                    ┌─────────────┐
                    │   CLI/Gen   │
                    └──────┬──────┘
                           │ proposal
                           ▼
                    ┌─────────────┐
                    │ ProposalStore│  ←─ JSON files
                    └──────┬──────┘
                           │ load(id)
                           ▼
                    ┌─────────────┐
                    │ ApprovalGate │  ←─ enforces status check
                    └──────┬──────┘
                     ┌─────┴─────┐
                     │           │
               selectApplier   manual intercept
                     │
               ┌─────┴─────┐
               │           │
         AgentCard    Skill
          Applier    Applier
               │
          ┌────┴────┐
          │         │
     Snapshot   Evidence
      Store      Store
```

## Class Hierarchy

All appliers implement the `Applier` callback type:
```typescript
type Applier = (proposal: AdaptationProposal) => Promise<void>;
```

The `ApprovalGate` is the only caller of `Applier` in production code.

## Test Strategy

| Layer | Test location | What it covers |
|-------|---------------|----------------|
| Governance sentinels | `tests/adaptation/governance-sentinels.vitest.ts` | Architectural invariant verification |
| Applier tests | `tests/adaptation/appliers/` | Individual applier correctness |
| Approval gate tests | `tests/adaptation/approval-gate.vitest.ts` | Lifecycle enforcement |
| Proposal store tests | `tests/adaptation/` | Persistence + validation |
| Snapshot store tests | `tests/adaptation/snapshot-store.vitest.ts` | Integrity verification |
| CLI tests | `tests/cli/commands/adaptation.vitest.ts` | Command dispatch + wiring |
| Integration | `tests/integration/` | Full lifecycle |
| Soak | `tests/soak/` | Scale validation |
