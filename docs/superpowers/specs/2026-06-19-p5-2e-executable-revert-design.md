# P5.2e — Executable Revert Design Spec (SDS)

> **Status:** Approved — ready for implementation.
> **Plan:** `docs/superpowers/plans/2026-06-19-p5-2e-executable-revert.md`
> **Risk level:** HIGH — first P5 phase modifying the appliers (untouched since P5.1).

## Hard governance boundary (non-negotiable)

```
revert  ≠  auto-revert
revert  ≠  automatic rollback
revert  ≠  git reset
revert still requires human approval
Only revert what ALiX previously changed and snapshotted. Nothing else.
```

## Summary of design decisions

| Decision | Choice |
|---|---|
| Snapshot integrity | Simple: snapshot file `contentHash` + evidence chain. No JSONL index. |
| Revert creation | CLI-only (`alix adaptation revert <id>`). Generator excluded. |
| Evidence footprint | Lean: 2 new types (`adaptation_snapshot_taken`, `adaptation_revert_failed`). Reuse existing lifecycle events for propose/approve/apply. |
| Auto-revert | Never. Structural (no generator path) + procedural (sentinel tests). |
| Human approval | Always. Revert proposal goes through full approve→apply lifecycle. |
| Revertable actions | `update_agent_card`, `add_capability`, `adjust_skill_definition` (snapshotted). |
| Irreversible actions | `create_agent_card`, `create_improvement_issue`, `suggest_routing_weight`, `revert_proposal` (no snapshot). |

## The 10 design questions

### 1. What gets snapshotted before apply?
Full file content of the target file before mutation (agent card JSON, skill JSON). Read before the merge-write occurs. Create actions produce no snapshot (irreversible).

### 2. Where are snapshots stored?
`.alix/adaptation/snapshots/<proposalId>.json`
Schema: `{ proposalId, snapshotAt, action, target, filePath, content (base64), contentHash (SHA-256 hex), fingerprint }`

### 3. How is snapshot integrity verified?
Two layers: `contentHash` verify (decode → hash → compare) + evidence chain (`adaptation_snapshot_taken` links to the snapshot's fingerprint). No separate JSONL index.

### 4. What does revert ProposalAction look like?
New action `"revert_proposal"`. Target: `{ kind: "revert", sourceProposalId: string }`. Payload: `{ sourceProposalId, reason, snapshotFingerprint }`. Created `pending`, goes through full approve→apply lifecycle.

### 5. Which actions are reversible?
`update_agent_card`, `add_capability`, `adjust_skill_definition`. Determined by snapshot existence.

### 6. Which actions are explicitly not reversible?
`create_agent_card`, `create_improvement_issue`, `suggest_routing_weight`, `revert_proposal` (reverting a revert = reapplying; create a fresh proposal if needed).

### 7. How does ApprovalGate route revert safely?
Existing Approve.reject/apply unchanged. `selectApplier` gets a new case for `action: "revert_proposal"` → `RevertApplier` (never AgentCardApplier/SkillApplier). Cross-wiring prevented by the switch pattern.

### 8. What evidence events are required?
2 new: `adaptation_snapshot_taken` (before mutation, inside appliers), `adaptation_revert_failed` (on revert failure). Reuse existing `adaptation_proposed`/`approved`/`applied`/`failed` for the revert proposal's lifecycle, distinguished by `action: "revert_proposal"`.

### 9. What CLI command exposes revert?
`alix adaptation revert <id> [--reason <text>]` — checks snapshot exists, creates a `pending` `revert_proposal`, saves, records evidence. The human then `approve` + `apply` as usual.

### 10. What prevents auto-revert?
Structural: generator does NOT produce revert proposals; RevertApplier only instantiated inside selectApplier (apply path); proposals start `pending`. Procedural: sentinel tests assert generator doesn't produce revert_proposal; gate test asserts pending->approved->applied lifecycle holds for reverts.

## File structure

| File | Role |
|---|---|
| `src/adaptation/snapshot-store.ts` | Save/load/verify snapshots |
| `src/adaptation/revert-applier.ts` | Restores from snapshot; verifies integrity before restore |
| `src/adaptation/appliers/agent-card-applier.ts` | **Modify** — snapshot before update/add_capability |
| `src/adaptation/appliers/skill-applier.ts` | **Modify** — snapshot before adjust_skill_definition |
| `src/adaptation/adaptation-types.ts` | **Modify** — add `"revert_proposal"` to ProposalAction + `{ kind: "revert" }` target |
| `src/cli/commands/adaptation.ts` | **Modify** — add `revert` subcommand + route revert_proposal to RevertApplier in selectApplier |
| `src/security/evidence/evidence-types.ts` | **Modify** — add `adaptation_snapshot_taken`, `adaptation_revert_failed` |
| `src/workflow/evidence-writer.ts` | **Modify** — add `recordSnapshotTaken`, `recordRevertFailed` |
| Tests | Per-task TDD |
