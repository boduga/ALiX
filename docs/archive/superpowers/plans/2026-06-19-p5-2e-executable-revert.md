# P5.2e — Executable Revert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
> **Plan home:** `docs/superpowers/plans/2026-06-19-p5-2e-executable-revert.md`
> **SDS:** `docs/superpowers/specs/2026-06-19-p5-2e-executable-revert-design.md`

**Goal:** Make applied proposals revertable via a governed revert lifecycle — snapshot before mutation, restore from snapshot, full propose→approve→apply lifecycle, no auto-revert.

**Risk:** HIGH — first modification to the appliers (untouched since P5.1). Every change to agent-card-applier.ts and skill-applier.ts must run impact analysis and be reviewed with the governance invariant in focus.

## Global Constraints

- **revert ≠ auto-revert.** Revert proposals are created by explicit CLI command only. The generator never creates revert proposals (sentinel-tested).
- **Only revert what ALiX previously changed and snapshotted.** `create_agent_card`, `create_improvement_issue`, `suggest_routing_weight`, and `revert_proposal` are irreversible (no snapshot).
- **Snapshot integrity:** file + `contentHash` + evidence chain. No JSONL index. Snapshot exists check + hash verify + `adaptation_snapshot_taken` evidence link.
- **Evidence:** lean. 2 new types (`adaptation_snapshot_taken`, `adaptation_revert_failed`). Reuse existing lifecycle events (proposed/approved/applied/failed) distinguished by `action: "revert_proposal"`.
- **Human approval always.** Revert proposals start `pending` and go through the full approve→apply lifecycle unchanged.
- **`selectApplier` routing** — `revert_proposal` action routes to `RevertApplier`, never to AgentCardApplier or SkillApplier. Cross-wiring prevented by the switch statement.
- **Run `gitnexus_impact` before editing any indexed symbol** — especially `agent-card-applier.ts`, `skill-applier.ts`, `adaptation-types.ts`, `evidence-types.ts`, `evidence-writer.ts`, and `adaptation.ts`. Report blast radius.
- **Do not touch** the 5 pre-existing uncommitted files (`AGENTS.md`, `CLAUDE.md`, `planning-agent.ts`, 2 `tests/workflow/agents/` test files).

## File Structure

| File | Role |
|---|---|
| `src/adaptation/snapshot-store.ts` | **Create** — save/load/verify snapshots |
| `src/adaptation/revert-applier.ts` | **Create** — restore from snapshot, integrity verify, record revert evidence |
| `src/adaptation/adaptation-types.ts` | **Modify** — add `revert_proposal` action + `revert` target kind |
| `src/adaptation/appliers/agent-card-applier.ts` | **Modify** — snapshot before update/add_capability |
| `src/adaptation/appliers/skill-applier.ts` | **Modify** — snapshot before adjust_skill_definition |
| `src/security/evidence/evidence-types.ts` | **Modify** — add `adaptation_snapshot_taken`, `adaptation_revert_failed` |
| `src/workflow/evidence-writer.ts` | **Modify** — add `recordSnapshotTaken`, `recordRevertFailed` |
| `src/cli/commands/adaptation.ts` | **Modify** — add `revert` subcommand + route `revert_proposal` to RevertApplier in `selectApplier` |
| Tests | Per task |

## Task 1: Revert types + snapshot store

**Files:**
- Create: `src/adaptation/snapshot-store.ts`
- Test: `tests/adaptation/snapshot-store.vitest.ts`

**Interfaces:**
- Produces: `SnapshotStore.save(snapshot)`, `.load(proposalId)`, `.verify(snapshot): boolean` (decode + hash compare), `AdaptationSnapshot` type.

Snapshot content is base64-encoded. Storage at `.alix/adaptation/snapshots/<proposalId>.json`.

- **Step 0:** Impact analysis on `adaptation-types.ts` (will modify in Task 2).
- **Step 1-5:** TDD round. Test: save round-trips; load returns null for missing; verify passes for valid snapshot; verify fails for corrupted content (modify content in saved file, re-run verify → false).

## Task 2: `revert_proposal` action + target

**Files:**
- Modify: `src/adaptation/adaptation-types.ts`

Add to `ProposalAction` union:
```ts
| "revert_proposal"
```
Add to `ProposalTarget` union:
```ts
| { kind: "revert"; sourceProposalId: string }
```

**Step 0:** Impact analysis on `AdaptationProposal` interface.
**Step 1-5:** TDD. Test: constructing a proposal with `action: "revert_proposal"` type-checks; target kind `"revert"` type-checks with `sourceProposalId`.

## Task 3: `adaptation_snapshot_taken` + `adaptation_revert_failed` evidence

**Files:**
- Modify: `src/security/evidence/evidence-types.ts`
- Modify: `src/workflow/evidence-writer.ts`
- Test: `tests/security/evidence/evidence-writer.revert.vitest.ts`

**Step 0:** Impact analysis on `EvidenceType`, `EvidenceEventWriter`.
**Step 1-5:** TDD. Add `adaptation_snapshot_taken` and `adaptation_revert_failed` to the `EvidenceType` union + `EVIDENCE_TYPES` set. Add `recordSnapshotTaken(proposalId, payload)` and `recordRevertFailed(proposalId, payload)` to `EvidenceEventWriter` (mirroring `recordAdaptationProposed`). Test: each records one event; query by type returns it; payload carries `proposalId`.

## Task 4: Before-snapshotting in appliers

**Files:**
- Modify: `src/adaptation/appliers/agent-card-applier.ts`
- Modify: `src/adaptation/appliers/skill-applier.ts`
- Test: Extend `tests/adaptation/appliers/agent-card-applier.vitest.ts` and `tests/adaptation/appliers/skill-applier.vitest.ts`

**Behavior:**
- Before the write in each mutation path (`update_agent_card`, `add_capability` for AgentCardApplier; `adjust_skill_definition` for SkillApplier): read the existing file, base64-encode content, compute SHA-256 hash, call `SnapshotStore.save(snapshot)`, call `EvidenceEventWriter.recordSnapshotTaken(...)`.
- **Do NOT snapshot** for `create_agent_card` (no pre-existing file) or for the existing `writeCard` internals that are initialization (files that don't exist yet).
- Pass `SnapshotStore` and `EvidenceEventWriter` to the appliers via constructor (add optional constructor params — backwards-compatible with existing instantiation in `selectApplier`).

## Task 5: RevertApplier

**Files:**
- Create: `src/adaptation/revert-applier.ts`
- Test: `tests/adaptation/revert-applier.vitest.ts`

**Behavior:**
- Constructor takes `SnapshotStore` + `EvidenceEventWriter`.
- `apply(proposal)`:
  1. Verify `proposal.action === "revert_proposal"` — throw if not.
  2. Extract `sourceProposalId` from `proposal.target.sourceProposalId`.
  3. Load snapshot via `SnapshotStore.load(sourceProposalId)`.
  4. Throw if snapshot not found (proposal was never snapshotted or snapshot was deleted).
  5. Verify snapshot integrity via `SnapshotStore.verify(snapshot)` — throw with detailed error if hash mismatch (corrupted snapshot).
  6. Decode base64 content.
  7. Write decoded content to `snapshot.filePath` (restore the file).
  8. Record nothing on success (the gate handles `adaptation_applied` via the existing lifecycle).
  9. On any failure (missing snapshot, hash mismatch, write error), throw — the gate catches and records `adaptation_failed`. OPTIONALLY also call `writer.recordRevertFailed(...)` with details. The user chose lean evidence, so `adaptation_failed` with the error message + `action: "revert_proposal"` in the payload may be sufficient. But `adaptation_revert_failed` exists as a new type — use it for clarity. Recommendation: use `recordRevertFailed` for snapshot-specific failures (missing, corrupt) and let the gate's `adaptation_failed` catch write errors (which the gate already captures).
- **`apply` does NOT call the gate's approve/apply.** It is the applier that the gate calls. See Task 6 for routing.

**Test (at minimum):**
- (a) Snapshot exists + hash matches + file write succeeds → restore succeeds.
- (b) Snapshot not found → throws with clear message.
- (c) Snapshot content corrupted → hash mismatch → throws.
- (d) Non-revert action → throws.

## Task 6: CLI `revert` subcommand + selectApplier routing

**Files:**
- Modify: `src/cli/commands/adaptation.ts`
- Test: Extend `tests/cli/commands/adaptation.vitest.ts` (or create `adaptation-revert.vitest.ts`)

**Behavior:**

**selectApplier routing** (in existing `selectApplier` function):
- Add a new case: `proposal.action === "revert_proposal"` → return a `RevertApplier` callback bound to the snapshot directories and evidence writer.
- Install the `RevertApplier` import + instance. The routing happens inside the existing `selectApplier` switch, matching `proposal.target.kind === "revert"` or `proposal.action === "revert_proposal"`.
- **Critical:** a revert proposal must NEVER be passed to AgentCardApplier or SkillApplier. The switch ensures this by matching `revert` first.

**New subcommand `alix adaptation revert <id> [--reason <text>]`:**
1. Load the source applied proposal by `<id>`.
2. Check `SnapshotStore.load(id)` exists. If not, print error and exit (proposal not revertable).
3. Create a `pending` proposal with:
   - `id`: `nextProposalId()` (import from recommendation-to-proposal.ts — already exported since P5.2c)
   - `action`: `"revert_proposal"`
   - `target`: `{ kind: "revert", sourceProposalId: id }`
   - `payload`: `{ reason, snapshotFingerprint }`
   - `provenance`: `"auto"` (auto-triggered, but not generator-created — `"auto"` is still accurate for "machine-initiated")
   - `status`: `"pending"`
   - `evidenceFingerprints`: `[snapshotFingerprint]`
4. Save via `ProposalStore.save`.
5. Record `adaptation_proposed` evidence with `action: "revert_proposal"` and `provenance: "auto"`.
6. Print: `Revert proposed: <revertProposalId> (approve then apply to execute).`
7. Update help text in `printUsage`.

**Step 0:** Impact analysis on `handleAdaptationCommand` and `selectApplier`.
**Step 1-5:** TDD.

## Task 7: Integration verify + PR

- Full suite: `npx vitest run tests/adaptation/ tests/security/evidence/ tests/cli/ --config vitest.config.mts`
- `npx tsc --noEmit`
- `gitnexus_detect_changes`
- Push branch, open PR, summary focusing on the governance boundary (`revert ≠ auto-revert`, snapshot integrity, applier routing).
- Tag `alix-p5.2e-complete` on merge.

**Architectural sentinel:** Add a test that `AutomaticProposalGenerator` does NOT produce `revert_proposal` proposals (grep-style, mirroring the P5.2c sentinel). Place it in `tests/adaptation/auto-proposal-generator.vitest.ts`.

## Verification (end-to-end)
```bash
# Create a temp card file
# Apply an update_agent_card (via test helper)
# Confirm adaptation_snapshot_taken evidence recorded (1 event)
# alix adaptation revert <proposalId>
# Confirm revert proposal created (pending, action=revert_proposal)
# Confirm adaptation_proposed evidence recorded with action=revert_proposal
# alix adaptation approve <revertId>
# Confirm status=approved
# alix adaptation apply <revertId>
# Confirm card file restored to pre-update content
# Confirm adaptation_applied evidence recorded
# Confirm agent card file hash matches original (pre-mutation) hash
```
