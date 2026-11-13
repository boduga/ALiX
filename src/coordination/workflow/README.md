# Workflow Coordination

## Overview

The issue-lifecycle state machine kernel. `WorkflowCoordinator` is the single writer of workflow state: agents report results, and the coordinator alone moves an issue through its twelve states, persisting entries to `state.json` and an append-only `history.jsonl`. Skills layer reusable step sequences over that kernel, hooks provide lifecycle interception, and `EvidenceEventWriter` records typed audit events.

## Interface

- `WorkflowCoordinator` — state transitions, agent assignment, block management, stale detection, and recovery [coordinator.ts:WorkflowCoordinator].
- `WorkflowCoordinator.transition(issueNumber, to, opts)` — validated state change appending a history event [coordinator.ts:transition].
- `WorkflowCoordinator.block` / `.unblock` — `BLOCKED` entry and return to `EXECUTING` with block metadata [coordinator.ts:block], [coordinator.ts:unblock].
- `WorkflowCoordinator.assignAgent` / `.releaseAgent` — bind or clear `assignedAgent` [coordinator.ts:assignAgent], [coordinator.ts:releaseAgent].
- `WorkflowCoordinator.detectStale` / `.recover` — stale scan and force-recovery outside transition validation [coordinator.ts:detectStale], [coordinator.ts:recover].
- `WorkflowCoordinator.getEvidenceWriter()` — lazily constructed writer, `null` when no evidence store [coordinator.ts:getEvidenceWriter].
- `StateFile` — `state.json`, `state.json.lock`, and `history.jsonl` access [state-file.ts:StateFile].
- `StateFile.readState` / `.writeState` / `.acquireLock` / `.appendHistory` [state-file.ts:readState], [state-file.ts:writeState], [state-file.ts:acquireLock], [state-file.ts:appendHistory].
- `WorkflowState`, `WORKFLOW_STATES`, `ALLOWED_TRANSITIONS`, `AgentName` — state machine definitions [types.ts:WorkflowState], [types.ts:WORKFLOW_STATES], [types.ts:ALLOWED_TRANSITIONS], [types.ts:AgentName].
- `WorkflowStateEntry`, `WorkflowHistoryEvent`, `ExecutionPermit`, `WorkflowCoordinatorConfig` — persisted and hand-off records [types.ts:WorkflowStateEntry], [types.ts:WorkflowHistoryEvent], [types.ts:ExecutionPermit], [types.ts:WorkflowCoordinatorConfig].
- `WorkPackage`, `ExecutionPlan`, `ReviewReport`, `PullRequestArtifact` — inter-agent payload types [types.ts:WorkPackage], [types.ts:ExecutionPlan], [types.ts:ReviewReport], [types.ts:PullRequestArtifact].
- `EvidenceEventWriter` — one typed method per workflow, adaptation, governance, and executive event [evidence-writer.ts:EvidenceEventWriter].
- `HookManager`, `HookType`, `HOOK_TYPES`, `HookFn`, `HookContext` — lifecycle interception [hooks.ts:HookManager], [hooks.ts:HookType], [hooks.ts:HOOK_TYPES], [hooks.ts:HookFn].
- `loadSkill`, `listSkills`, `SkillDefinition`, `SkillStep` — JSON-defined workflow skills [skill.ts:loadSkill], [skill.ts:listSkills], [skill.ts:SkillDefinition], [skill.ts:SkillStep].
- `runWorkflowSkill`, `SkillGoal`, `SkillContext`, `SkillResult` — binds a skill to the agent chain [workflow-skill.ts:runWorkflowSkill], [workflow-skill.ts:SkillGoal], [workflow-skill.ts:SkillContext].
- Stage agents (intake, planning, review, execution, PR): [./agents/README.md](./agents/README.md).

## Invariants

- `WorkflowCoordinator` is the only component that writes workflow state; every mutation runs inside `StateFile.acquireLock()` [coordinator.ts:WorkflowCoordinator], [coordinator.ts:transition].
- The first transition for an issue must be to `NEW`; later transitions must appear in `ALLOWED_TRANSITIONS[from]` [coordinator.ts:transition], [types.ts:ALLOWED_TRANSITIONS].
- Target states are checked against `WORKFLOW_STATES` before persisting [coordinator.ts:transition], [types.ts:WORKFLOW_STATES].
- Transitioning out of `BLOCKED` deletes `blockReason`, `blockingItem`, and `blockedAt` [coordinator.ts:transition].
- `recover()` deliberately skips transition validation but still requires a valid `WORKFLOW_STATES` target and records `workflow_aborted` evidence [coordinator.ts:recover].
- `unblock` throws unless the issue is currently `BLOCKED`, and reports `blockedDurationMs` from `blockedAt` [coordinator.ts:unblock].
- `detectStale` ignores terminal `COMPLETE` and `MERGED` entries and compares `updatedAt` against the threshold [coordinator.ts:detectStale].
- `listActive` excludes `COMPLETE` and `MERGED` [coordinator.ts:listActive].
- A missing or corrupt `state.json` reads as an empty map rather than an error [state-file.ts:readState].
- `ExecutionPermit` carries issue number, plan fingerprint, allowed files, and issue time — the execution authorization surface [types.ts:ExecutionPermit].
- A pre-hook returning `false` blocks the operation; hooks run in registration order [hooks.ts:HookManager], [hooks.ts:HookFn].
- `register` rejects hook types outside `HOOK_TYPES` [hooks.ts:HookManager], [hooks.ts:HOOK_TYPES].
- Skill lookup order is project-local `.alix/skills/workflow`, then user-global, then built-ins [skill.ts:loadSkill], [skill.ts:skillDirs].
- `listSkills` de-duplicates by id, with built-ins losing on conflict [skill.ts:listSkills].
- Built-in skills are `issue-lifecycle` and `plan-only` [skill.ts:builtInSkills].
- `runWorkflowSkill` returns failure when a requested capability resolves to no agent, and records `capability_routed` plus `agent_resolved` evidence on resolution [workflow-skill.ts:runWorkflowSkill].
- Execution and PR steps stop the automated flow with a success result rather than acting, because both require human approval [workflow-skill.ts:runWorkflowSkill].
- Every `EvidenceEventWriter` method is best-effort and returns `null` instead of throwing [evidence-writer.ts:EvidenceEventWriter], [evidence-writer.ts:record].

## Side Effects

- Creates the workflow directory recursively in the constructor [coordinator.ts:WorkflowCoordinator].
- Writes `state.json` and appends `history.jsonl` on every transition [coordinator.ts:transition], [state-file.ts:appendHistory].
- Takes a cross-process audit lock on `state.json.lock` with automatic stale recovery and a default 5000 ms timeout [state-file.ts:acquireLock], [state-file.ts:StateFile].
- Lazily opens the evidence store under the configured `evidenceDir` and appends records there [coordinator.ts:initEvidenceStore], [coordinator.ts:recordEvidence].
- Evidence failures are swallowed after an operator-visible warning; they never block a transition [coordinator.ts:recordEvidence], [evidence-writer.ts:record].
- Reads skill JSON from `.alix/skills/workflow` in the current working directory and the user home directory [skill.ts:skillDirs], [skill.ts:loadSkill].
- `runWorkflowSkill` dynamically imports stage agents and the capability resolver, and drives coordinator transitions plus review evidence [workflow-skill.ts:runWorkflowSkill].

## Verification

- Run: `pnpm test`
