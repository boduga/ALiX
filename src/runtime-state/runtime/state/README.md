# State Transition Harness

## Overview
Patch-only execution-state harness. A state-transition proposal is run through a
fixed gate sequence — schema, version CAS, governor, capability resolver,
permission, validated state transition, narrow step executor, authoritative
event emission, projector — and only then persisted with optimistic
concurrency. The execution state is derived from authoritative events; the
harness never writes state directly from a patch. A policy-backed governor
adapter lets production `PolicyGate` authorize proposals.

## Interface
- `StateTransitionProposal`, `ActionProposal` [state-transition.ts:StateTransitionProposal], [state-transition.ts:ActionProposal]
- `StateTransitionHarness.propose` — 10-gate pipeline returning `StateTransitionResult` [state-transition.ts:StateTransitionHarness]
- `validateStateTransitionProposal` [state-transition.ts:validateStateTransitionProposal]
- `REJECTION_REASONS`, `RejectionReason`, `ProposalRejected`, `ProposalCommitted` [state-transition.ts:REJECTION_REASONS], [state-transition.ts:ProposalRejected]
- `GovernorDecision`, `TransitionGovernor`, `TransitionCapabilityResolver`, `TransitionPermissionChecker`, `TransitionStepExecutor`, `TransitionEventLog`, `TransitionStateProjector`, `TransitionStateStore`, `ObservabilitySink` [state-transition.ts:TransitionGovernor]
- `createInMemoryStore` — OCC CAS in-memory store for tests [state-transition.ts:createInMemoryStore]
- `allowAllGovernor`, `denyAllGovernor`, `allowAllResolver`, `allowAllPermission`, `noopExecutor`, `noopObservability` test doubles [state-transition.ts:allowAllGovernor]
- `createPolicyTransitionGovernor` — adapts `PolicyGate` to `TransitionGovernor` [policy-governor.ts:createPolicyTransitionGovernor]
- `createPolicyBackedEmitter` — composition-root emitter factory [policy-governor.ts:createPolicyBackedEmitter]
- `EXECUTION_STATE_CAPABILITY`, `PolicyGovernorContext` [policy-governor.ts:EXECUTION_STATE_CAPABILITY]

## Invariants
- Gate order is fixed and enforced: schema, version CAS, governor, capability resolver, permission, apply/validate transition, step executor, emit events, project, then OCC save [state-transition.ts:StateTransitionHarness]
- Version CAS (`current.version === baseStateVersion`) precedes governance; a stale proposal never reaches resolver, permission, or executor [state-transition.ts:StateTransitionHarness]
- Rejections are exactly three distinct reasons — `INVALID_PATCH`, `STATE_VERSION_CONFLICT`, `GOVERNANCE_DENIED` — and every rejection preserves state and never reaches the step executor [state-transition.ts:REJECTION_REASONS]
- `rationale` is non-authoritative: it is carried but never consulted for authorization [state-transition.ts:StateTransitionProposal]
- A patch is never applied blindly: `applyStatePatch` output must pass `validateExecutionState` and status-lifecycle legality before commit [state-transition.ts:StateTransitionHarness]
- Only committed transitions increment the version; the harness owns version and step bumping, not the patch [state-transition.ts:StateTransitionHarness]
- An empty patch with no action is a no-op commit returning the current state with no events [state-transition.ts:StateTransitionHarness]
- `createInMemoryStore` requires an initial save at version 0, then increments by exactly 1 per save, and throws `STATE_VERSION_CONFLICT` on a base mismatch [state-transition.ts:createInMemoryStore]
- Patch and action are separate tracks: a patch-only proposal skips resolver and permission; resolver and permission run only when an `action` is present [state-transition.ts:StateTransitionHarness]
- The policy governor evaluates patch-only proposals under synthetic capability `execution-state.write`; proposals carrying an `action` are always denied [policy-governor.ts:createPolicyTransitionGovernor]
- Governor decision mapping: allow→allow, deny→deny, ask→escalate; the harness treats escalate as rejection and never auto-approves; gate errors fail closed to deny [policy-governor.ts:createPolicyTransitionGovernor]

## Side Effects
- Persists the committed state through the injected `TransitionStateStore.save`, which applies the OCC CAS [state-transition.ts:StateTransitionHarness]
- Appends authoritative `execution.*` events through the injected `TransitionEventLog` after a successful commit [state-transition.ts:StateTransitionHarness]
- Emits `execution.proposal.rejected` observability events on rejection paths [state-transition.ts:StateTransitionHarness]
- A store-backed `PolicyGate` in `ask` mode creates a pending approval per evaluation; this adapter must not be wired live in ask mode without an explicit `execution-state.write: allow` policy or approval throttling [policy-governor.ts:createPolicyTransitionGovernor]

## Verification
- Run: `pnpm test`
