# Adaptation Appliers

## Overview
Mutation executors for approved `AdaptationProposal` records. Each applier is deliberately narrow and side-effect-minimal: it validates that the proposal is already `approved`, applies exactly one supported action to one target file, and leaves evidence recording and proposal-status transitions to the `ApprovalGate`. Three targets exist: agent cards (`AgentCardApplier`), skill definitions (`SkillApplier`), and governance configuration files (`GovernanceChangeApplier`).

## Interface
- `AgentCardApplier(cardsDir, snapshotStore?, writer?)` with `apply(proposal)` over `create_agent_card` / `update_agent_card` / `add_capability` [agent-card-applier.ts:AgentCardApplier]
- `SkillApplier(skillsDir, snapshotStore?, writer?)` with `apply(proposal)` over `adjust_skill_definition` [skill-applier.ts:SkillApplier]
- `GovernanceChangeApplier(cwd, snapshotStore, writer, options?)` with `apply(proposal)` over `governance_change` [governance-change-applier.ts:GovernanceChangeApplier]
- `GovernanceChangeApplierOptions` — `onBeforeMutation` test hook fired after snapshot and before the pre-write hash check [governance-change-applier.ts:GovernanceChangeApplierOptions]

## Invariants
- Every applier rejects a proposal whose `status` is not `"approved"` [agent-card-applier.ts:AgentCardApplier]
- The agent id comes from `proposal.target.id` with `target.kind === "agent_card"`, not from `proposal.payload.id`; a wrong kind or empty id throws [agent-card-applier.ts:AgentCardApplier]
- The skill id comes from `proposal.target.id` with `target.kind === "skill"`; a wrong kind or empty id throws [skill-applier.ts:SkillApplier]
- Both path components pass `assertSafePathComponent` before the card or skill path is built [agent-card-applier.ts:AgentCardApplier]
- `create_agent_card` fails when the file already exists and validates the payload with `validateAgentCard` before writing; it takes no snapshot because the action is irreversible [agent-card-applier.ts:AgentCardApplier]
- `update_agent_card` deep-merges the payload into the existing card, while `add_capability` requires a non-empty `payload.capability` string and appends it [agent-card-applier.ts:AgentCardApplier]
- `adjust_skill_definition` requires non-empty `payload.step` and `payload.action`, requires a `steps` array, and throws when no step matches, replacing only that step's `action` [skill-applier.ts:SkillApplier]
- Snapshotting is a no-op when `snapshotStore` or `writer` is absent, preserving compatibility with callers that pass neither [agent-card-applier.ts:AgentCardApplier]
- `GovernanceChangeApplier` requires both `action === "governance_change"` and a supported payload kind from `SUPPORTED_KINDS` (`confidence_calibration`, `lens_adjustment`, `policy_coverage`) [governance-change-applier.ts:SUPPORTED_KINDS]
- Governance mutation order is fixed: status/action/kind validation, target resolution, schema validation, drift validation, snapshot, pre-write hash check, mutation, atomic write, after-hash, evidence [governance-change-applier.ts:GovernanceChangeApplier]
- Drift validation compares the payload's recorded current value against the on-disk value and aborts on mismatch, so a stale proposal can never apply [governance-change-applier.ts:GovernanceChangeApplier]
- A target file whose hash changed between validation and mutation aborts the write before any mutation occurs [governance-change-applier.ts:GovernanceChangeApplier]
- Governance writes are serialized by a process-local promise-chain lock scoped to steps snapshot through evidence, and the lock is always released in `finally` [governance-change-applier.ts:GovernanceChangeApplier]
- The appliers never record evidence or change proposal status themselves; that is `ApprovalGate`'s single responsibility [skill-applier.ts:SkillApplier]

## Side Effects
- Creates the cards directory with `mkdirSync({ recursive: true })` when missing and writes the card as pretty JSON [agent-card-applier.ts:AgentCardApplier]
- Creates the skills directory with `mkdirSync({ recursive: true })` when missing and writes the skill as pretty JSON [skill-applier.ts:SkillApplier]
- Reads the pre-mutation file and saves a base64 snapshot with a SHA-256 content hash and random fingerprint through `SnapshotStore.save` [skill-applier.ts:SkillApplier]
- Records `recordSnapshotTaken` through `EvidenceEventWriter` when a writer is present [agent-card-applier.ts:AgentCardApplier]
- Writes governance files under `.alix/governance/` (`calibration.json`, `lens-registry.json`, `policy-coverage.json`) via tmp write, `fsync`, and `rename` [governance-change-applier.ts:GovernanceChangeApplier]
- Records `recordGovernanceMutationApplied` with payload kind, target file, snapshot fingerprint, before hash, and after hash [governance-change-applier.ts:GovernanceChangeApplier]
- Reads and writes JSON files on the local filesystem only; no network access and no subprocess execution [agent-card-applier.ts:AgentCardApplier]

## Verification
- Run: `pnpm test`
- Relevant tests: `tests/adaptation/appliers/agent-card-applier.vitest.ts`, `tests/adaptation/appliers/skill-applier.vitest.ts`, `tests/adaptation/appliers/governance-change-applier.vitest.ts`
