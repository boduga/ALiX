# Mutation Path Audit

> **Part of:** P5.7a Governance Invariant Audit
> **Canonical reference for:** governance-model.md, operational-runbook.md, security reviews
> **Generated at:** 2026-06-20

## Format

Each mutation path documents:

- **Trigger:** CLI command or automated event that initiates the path
- **Store reads:** data read during the path
- **Gate check:** the governance invariant enforced before mutation
- **Applier:** the module that performs the mutation
- **Snapshot:** whether before-state is captured
- **Evidence:** the evidence records produced
- **Stores written:** data written during/after mutation

## Mutation Paths

### Path 1: Agent Card Update (update_agent_card)

| Property | Value |
|----------|-------|
| Trigger | `alix adaptation apply <id>` where source proposal has `action: "update_agent_card"` |
| Target kind | `agent_card` |
| Store reads | ProposalStore (load proposal by id) |
| Gate check | ApprovalGate.apply(): `status === "approved"` |
| Applier | AgentCardApplier.update() — deep-merges payload into existing card JSON |
| Applier defense-in-depth | Checks `proposal.status !== "approved"` before proceeding |
| Snapshot | SnapshotStore.save() of card file BEFORE mutation (SHA-256 contentHash) |
| Evidence | `adaptation_snapshot_taken` (by applier), `adaptation_applied` (by gate on success) or `adaptation_failed` (by gate on error) |
| Stores written | Agent card JSON file, SnapshotStore, EvidenceStore |

### Path 2: Agent Card Create (create_agent_card)

| Property | Value |
|----------|-------|
| Trigger | `alix adaptation apply <id>` where source proposal has `action: "create_agent_card"` |
| Target kind | `agent_card` |
| Store reads | ProposalStore (load proposal by id) |
| Gate check | ApprovalGate.apply(): `status === "approved"` |
| Applier | AgentCardApplier.create() — writes new card JSON |
| Applier defense-in-depth | Checks `proposal.status !== "approved"`; refuses to overwrite existing file |
| Snapshot | NONE — no pre-existing file to snapshot |
| Evidence | `adaptation_applied` (by gate on success) or `adaptation_failed` (by gate on error) |
| Stores written | Agent card JSON file, EvidenceStore |

### Path 3: Add Capability (add_capability)

| Property | Value |
|----------|-------|
| Trigger | `alix adaptation apply <id>` where source proposal has `action: "add_capability"` |
| Target kind | `agent_card` |
| Store reads | ProposalStore (load proposal by id) |
| Gate check | ApprovalGate.apply(): `status === "approved"` |
| Applier | AgentCardApplier.addCapability() — appends capability to card's capabilities array |
| Applier defense-in-depth | Checks `proposal.status !== "approved"` |
| Snapshot | SnapshotStore.save() of card file BEFORE mutation |
| Evidence | `adaptation_snapshot_taken`, `adaptation_applied` or `adaptation_failed` |
| Stores written | Agent card JSON file, SnapshotStore, EvidenceStore |

### Path 4: Skill Definition Adjustment (adjust_skill_definition)

| Property | Value |
|----------|-------|
| Trigger | `alix adaptation apply <id>` where proposal has `action: "adjust_skill_definition"` |
| Target kind | `skill` |
| Store reads | ProposalStore (load proposal by id) |
| Gate check | ApprovalGate.apply(): `status === "approved"` |
| Applier | SkillApplier.adjustStep() — replaces action on matching step |
| Applier defense-in-depth | Checks `proposal.status !== "approved"` |
| Snapshot | SnapshotStore.save() of skill file BEFORE mutation |
| Evidence | `adaptation_snapshot_taken`, `adaptation_applied` or `adaptation_failed` |
| Stores written | Skill JSON file, SnapshotStore, EvidenceStore |

### Path 5: Revert Proposal (revert_proposal)

| Property | Value |
|----------|-------|
| Trigger | `alix adaptation apply <id>` where proposal has `action: "revert_proposal"` |
| Target kind | `revert` |
| Store reads | ProposalStore (load proposal by id), SnapshotStore.loadVerified (load + integrity check) |
| Gate check | ApprovalGate.apply(): `status === "approved"` |
| Applier | RevertApplier.apply() — writes snapshot content back to original file path |
| Applier defense-in-depth | Only accepts `action === "revert_proposal"`; requires `target.kind === "revert"` |
| Snapshot | NONE — the revert restores from the original proposal's existing snapshot |
| Evidence | `adaptation_applied` or `adaptation_revert_failed` (snapshot not found, hash mismatch, write failure) |
| Stores written | Target file (restored from snapshot), EvidenceStore |

### Path 6: Manual Actions (create_improvement_issue, suggest_routing_weight)

| Property | Value |
|----------|-------|
| Trigger | `alix adaptation apply <id>` where proposal is a manual kind |
| Target kind | `issue` or `routing_weight` or `capability` |
| Gate check | Proposal goes through ApprovalGate — status reaches `"approved"` normally |
| Applier selection | Intercepted after approval at `selectApplier` routing (never reaches automated applier) |
| Action | `printManualAction()` — prints actionable guidance to stdout, NO file mutation |
| Stores written | NONE — status stays `"approved"` (manual completion not tracked) |

## Governance Boundary Summary

```
Generators (proposal creation only, always pending status)
    ↓
ProposalStore (persistence, no lifecycle enforcement)
    ↓
ApprovalGate (sole owner of pending→approved→applied transitions)
    ↓
selectApplier (routes by target.kind, always through gate)
    ↓
Appliers (file mutation, defense-in-depth status check)
**Invariant:** Every mutation path passes through `ApprovalGate.apply()` which enforces `status === "approved"` before calling the applier. Manual actions (`create_improvement_issue`, `suggest_routing_weight`) still require approval through the gate. After approval, `runApply` intercepts them at the `selectApplier` routing step (not before the gate) and prints actionable guidance instead of mutating.
