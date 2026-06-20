# ALiX Governance Model

> **Audience:** Operators, auditors, contributors
> **Part of:** P5.7e Documentation Freeze
> **See also:** [Mutation Path Audit](mutation-path-audit.md), [Adaptation Lifecycle](adaptation-lifecycle.md)

## Purpose

This document describes the governance invariants that ALiX enforces at every
system mutation boundary. These invariants are verified by sentinel tests in CI
and are architectural, not optional.

## Governance Invariants

| # | Invariant | Description |
|---|-----------|-------------|
| 1 | Generate ≠ Approve | Auto-generated proposals always start as `pending`. No auto-approval path exists. |
| 2 | Approve ≠ Apply | Approval only transitions status to `approved`. A separate human action invokes the applier. |
| 3 | Apply ≠ Mutate Topology | Capability topology changes (new agent cards, skill changes) require a separate human gate. |
| 4 | Observe ≠ Revert | A revert is a new `revert_proposal` that flows through the full propose→approve→apply lifecycle. |
| 5 | Learn ≠ Evolve | Intelligence reports inform human decisions but never mutate system state. |

## Trust Boundary Diagram

```
Generators (AutomaticProposalGenerator, CapabilityEvolutionProposalGenerator)
  ↓  status: "pending"
ProposalStore
  ↓
ApprovalGate  ←── Human Gate ──→ approve / reject
  ↓  status: "approved"
Appliers (AgentCardApplier, SkillApplier, RevertApplier)
  ↓
Snapshots (SnapshotStore)
  ↓
Evidence (EvidenceStore)
  ↓
Effectiveness (EffectivenessReporter)
  ↓
Intelligence (IntelligenceReporter)
```

Every mutation boundary requires a human decision.

## Mutation Path Map

See [Mutation Path Audit](mutation-path-audit.md) for the complete catalog of
every mutation path, its trigger, governance check, applier, and evidence
records. The following summary covers the three automated paths:

| Path | Gate Check | Applier | Snapshot Before? |
|------|-----------|---------|-----------------|
| `update_agent_card` | `ApprovalGate.apply(): status === "approved"` | AgentCardApplier.update() | Yes |
| `add_capability` | `ApprovalGate.apply(): status === "approved"` | AgentCardApplier.addCapability() | Yes |
| `adjust_skill_definition` | `ApprovalGate.apply(): status === "approved"` | SkillApplier.adjustStep() | Yes |
| `revert_proposal` | `ApprovalGate.apply(): status === "approved"` + `SnapshotStore.loadVerified()` | RevertApplier.apply() | No (restores from source snapshot) |

Manual actions (`create_improvement_issue`, `suggest_routing_weight`) still require
approval through the gate. After approval, `runApply` intercepts them at the
`selectApplier` routing step and prints actionable guidance instead of mutating —
no evidence transition for the apply stage, as the action was performed out-of-band.

## Evidence Chain

Every lifecycle event records an evidence entry:

| Event | Evidence Type | Recorded By |
|-------|--------------|-------------|
| Proposal created | `adaptation_proposed` | CLI / generator |
| Proposal approved | `adaptation_approved` | ApprovalGate |
| Proposal rejected | `adaptation_rejected` | ApprovalGate |
| Proposal applied | `adaptation_applied` | ApprovalGate (on success) |
| Apply failed | `adaptation_failed` | ApprovalGate (on error) |
| Snapshot taken | `adaptation_snapshot_taken` | Applier |
| Revert failed | `adaptation_revert_failed` | RevertApplier |
| Effectiveness assessed | `adaptation_effectiveness` | CLI |

## Related Documents

- [Mutation Path Audit](mutation-path-audit.md) — detailed path-by-path audit
- [Adaptation Lifecycle](adaptation-lifecycle.md) — proposal status flow
- [Operational Runbook](../operations/operational-runbook.md) — operator procedures
- [Decision Records](../architecture/decision-records.md) — governance design decisions
