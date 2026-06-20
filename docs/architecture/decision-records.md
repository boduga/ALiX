# ALiX Architecture Decision Records

> **Audience:** Contributors, architects
> **Part of:** P5.7e Documentation Freeze
> **See also:** [Governance Infrastructure](governance-infrastructure.md)

## Purpose

This document catalogs the key architectural decisions that shaped the ALiX
governance model. Each entry links to the SDS/spec where the decision was
designed and the plan where it was implemented.

## Decision Records

### ADR-001: Generate ≠ Approve

| Property | Value |
|----------|-------|
| **Context** | P5.2c Automatic Proposal Generation |
| **Decision** | Generators create `pending` proposals only. The `ApprovalGate` (separate module, never imported by generators) enforces all status transitions. |
| **Why** | Prevents a single code path from creating and applying changes. Each step requires a different authority. |
| **Spec** | `docs/superpowers/specs/2026-06-19-p5-2c-automatic-proposal-generation-design.md` |
| **Enforced by** | Sentinel test: no generator imports `approval-gate.ts` |

### ADR-002: Revert is a Proposal

| Property | Value |
|----------|-------|
| **Context** | P5.2e Executable Revert |
| **Decision** | A revert is not an automatic rollback. It is a new `revert_proposal` action that flows through the full propose → approve → apply lifecycle. |
| **Why** | Keeps the governance model uniform. No bypass of the approval gate. Every mutation path, including undo, is human-gated. |
| **Spec** | `docs/superpowers/specs/2026-06-19-p5-2e-executable-revert-design.md` |
| **Enforced by** | Sentinel test: `AutomaticProposalGenerator` must not produce `revert_proposal` |

### ADR-003: Intelligence is Advisory-Only

| Property | Value |
|----------|-------|
| **Context** | P5.3 Proposal Effectiveness Intelligence, P5.4 Prioritization |
| **Decision** | Intelligence and prioritization reports are read-only. They inform human decisions but never mutate system state or auto-approve proposals. |
| **Why** | Intelligence exists to guide operators, not replace them. Keeping it read-only prevents feedback loops where the system acts on its own learning without human review. |
| **Spec** | `docs/superpowers/specs/2026-06-19-p5-3-proposal-effectiveness-intelligence-design.md`, `docs/superpowers/specs/2026-06-19-p5-4-proposal-prioritization-design.md` |
| **Enforced by** | No mutation paths through intelligence modules |

### ADR-004: Capability Evolution Emits Investigation Issues Only

| Property | Value |
|----------|-------|
| **Context** | P5.5–P5.6 Capability Evolution |
| **Decision** | Capability evolution proposals always use `create_improvement_issue` action. They never create agent cards, modify capabilities, or adjust skills automatically. |
| **Why** | A capability gap or overlap finding is not enough information to safely mutate the capability topology. Investigation proposals ensure a human evaluates the finding before any structural change. |
| **Spec** | `docs/superpowers/specs/2026-06-20-p5-6-capability-evolution-proposal-generation-design.md` |
| **Enforced by** | `CapabilityEvolutionProposalGenerator` only produces `action: "create_improvement_issue"` |

### ADR-005: ApprovalGate Owns Policy, Stores Own Validation

| Property | Value |
|----------|-------|
| **Context** | P5.7c Security Boundary Audit |
| **Decision** | `ProposalStore.save()` validates structural shape (required fields, valid status values). `ApprovalGate` enforces lifecycle transitions (only pending→approved, only approved→applied). The store does not know about lifecycle policy. The gate does not know about file layout. |
| **Why** | Separates concerns: persistence validates shape, gate validates policy. Each layer has a single responsibility. |
| **Spec** | `docs/superpowers/specs/2026-06-20-p5-7-trustworthiness-hardening-design.md` |
| **Enforced by** | ProposalStore shape validation; ApprovalGate `requirePending()` and `apply()` status checks |

## Design Decision Map

```
P5.0        Reflection design → P5.1 Guided Adaptation → P5.2c Auto-generation
              → ADR-001 (Generate ≠ Approve)
P5.2e       Executable revert design → ADR-002 (Revert is a Proposal)
P5.3–P5.4   Intelligence + Prioritization → ADR-003 (Intelligence is Advisory)
P5.5–P5.6   Capability evolution design → ADR-004 (Investigation Only)
P5.7        Hardening design → ADR-005 (Gate vs Store separation)
```

## Related Documents

- [Governance Infrastructure](governance-infrastructure.md) — code map and data flow
- [Governance Model](../governance/governance-model.md) — governance invariants
