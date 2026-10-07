# DOX — State Transition Harness (Governed Patch-Only Execution)

## Purpose

`StateTransitionProposal` patch-only harness through 10-gate validation → GOVERNOR → CapabilityResolver → Permission → apply → StepExecutor → emit events → Projector. Patch and action are separate tracks converging on authoritative events.

## Ownership

- `state-transition.ts` — StateTransitionProposal {executionId, baseStateVersion, patch, action, rationale}, validateStateTransitionProposal, StateTransitionHarness.propose() (schema → version CAS → governor → resolver → permission → apply validate transition not blind patch → StepExecutor narrow → emit events → save CAS), 3 RejectionReason (INVALID_PATCH / STATE_VERSION_CONFLICT / GOVERNANCE_DENIED), ExecutionState never mutated on rejection, version counts only committed, 10 invariant enforcement (INV-1..INV-10), status lifecycle check, observable execution.proposal.rejected, patchAction separate tracks, createInMemoryStore helpers.
- `policy-governor.ts` — `createPolicyTransitionGovernor`: adapts the real `PolicyGate` to `TransitionGovernor` (patch-only proposals evaluated as synthetic `execution-state.write` capability; allow→allow, deny→deny, ask→escalate, errors fail closed to deny; actions denied). `createPolicyBackedEmitter`: composition-root factory wiring the adapter into an `ExecutionStateEmitter`. Approval-spam caveat: store-backed gates in ask mode create a pending approval per evaluation — use an explicit allow policy or throttling before live wiring.
- Re-export: `src/runtime/execution-state/state-transition.ts` — alias for canonical path.

## Local Contracts

- Patch-only: omission=preserve, null=delete, no whole-state rewrite; harness never writes state directly from patch (applyStatePatch validated then versioned then CAS save).
- Version CAS baseStateVersion vs current.version precedes expensive governance (INV-2); stale never reaches resolver/permission/executor.
- Governor before StepExecutor (INV-3, INV-8); resolver canonical (INV-4) then permission distinct (INV-5); evidence/rationale never authorizes (INV-6).
- Patches never become state directly; transition validated (INV-7): resulting ExecutionState must pass validateExecutionState + status lifecycle legality.
- Emit authoritative event(s) (execution.* typed) → EventLog (INV-9) → StateProjector → ExecutionState (INV-10). State derived, EventLog authoritative.
- 3 rejections distinct, preserve ExecutionState and never reach StepExecutor: INVALID_PATCH (schema/transition legality), STATE_VERSION_CONFLICT (discard reload v18 rebuild context retry no auto-rebase), GOVERNANCE_DENIED (policyId/ruleId surfaced). Version increments only on committed.
- Proposal lifecycle: v17 read, B commits v18, A base 17 → STATE_VERSION_CONFLICT remains v18 no partial mutation.

## Work Guidance

- Keep governance and permission checks before execution; rejection paths must
  leave state unchanged and surface their distinct reasons.

## Verification

- `pnpm build && pnpm typecheck` — harness + in-memory store + governor/resolver/permission/executor interfaces compile.
- Verify version conflicts precede governance, rejection reasons stay distinct with no execution or mutation, omission preserves and null deletes, only commits increment versions, patch/action events converge, terminal lifecycle rules hold, and filesystem OCC rejects stale writes.
- `vitest run tests/runtime/policy-governor.vitest.ts` — policy adapter allow/deny/escalate mapping against a real PolicyGate, patch-only action denial, fail-closed on gate errors and storeless ask, policy-backed emitter end-to-end.

## Child DOX Index

None.
