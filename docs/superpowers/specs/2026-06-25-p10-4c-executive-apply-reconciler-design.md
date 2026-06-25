# P10.4c — Executive Apply Reconciler (Design)

> **Status:** Design spec — awaiting user review before implementation plan is written.
> **Spec home (on approval):** this file.
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-25-p10-4c-executive-apply-reconciler.md`
> **Risk level:** LOW — read-only reconciler, no mutation path, additive evidence infrastructure only.

## Hard governance boundary (non-negotiable)

```
P10.4c may read proposal status.
P10.4c may mark executive steps completed when proof exists.
P10.4c may not approve proposals.
P10.4c may not apply proposals.
P10.4c may not reject proposals.
```

P10.4c is the **executive lifecycle reconciler** — it observes the external P5/P9 mutation lifecycle and reflects outcomes back into executive plan state. The executive layer bridges intent into proposals; the human completes the proposals; P10.4c closes the loop by reconciling execution state.

```
P10.4a = executive orchestrator (records intent, never mutates)
P10.4b = executive proposal bridge (creates pending proposals only)
P10.4c = executive apply reconciler (this spec — observes applied proposals, completes steps)
P10.4d = executive apply automation (future — applies proposals automatically; requires separate approval-first design, not a mechanical follow-up)
```

## Why this exists

P10.4b bridges `create_remediation_proposal` steps into pending `AdaptationProposal` objects, but the counterpart step — `apply_remediation` — remains stuck in `waiting_for_bridge` indefinitely. The human approves and applies the proposal via the existing `alix adaptation` lifecycle, but the executive plan never learns about it.

P10.4c closes this gap: it observes the external proposal lifecycle and, when it detects that a proposal has reached `applied` status, marks the corresponding executive step as `completed`.

## Why "Reconciler" not "Bridge"

P10.4b is a **bridge**: it creates new proposals from executive intent. That's an outward mutation.

P10.4c is a **reconciler**: it reads external state and updates internal executive state to match. That's an inward observation. It never creates, approves, or applies proposals. It only marks executive plan steps as completed when the external lifecycle has already proven completion.

## Scope

### In scope
- `apply_remediation` — one step action only
- Match by sibling `create_remediation_proposal` step's proposal
- Mark step `completed` when linked proposal is `applied`

### Deferred (stays `waiting_for_bridge`)
- `implement_improvements` — no concrete artifact to observe yet

### Explicitly out of scope
- No calls to `.approve()`, `.apply()`, `.reject()`
- No new `ProposalAction` or `ProposalTarget` members in `adaptation-types.ts`
- No changes to `StepRunner` or `StepBehavior`
- No changes to `executive-bridge.ts`
- No new `ProposalStore` wiring (already wired in P10.4b follow-up)

## The matching strategy

P10.4b stamps every bridged proposal with a `target` that includes the originating step ID:

```ts
target: {
  kind: "executive_remediation",
  planId: plan.id,
  stepId: createRemediationStep.id,  // <-- the create step, not the apply step
  objectiveId: step.objectiveId,
  subsystem: step.targetSubsystem,
}
```

When the engine encounters an `apply_remediation` step, it must find the **sibling** `create_remediation_proposal` step on the same objective, then match the proposal using that step's ID.

```
Plan steps:
  1. diagnose_root_cause          (obj-A)
  2. create_remediation_proposal  (obj-A)  → proposal targets this stepId
  3. apply_remediation            (obj-A)  ← we are here
```

Step 3 finds step 2 by matching `objectiveId`, then looks for a proposal whose `target.stepId === step2.id`.

## Data flow

```
1. ExecutionEngine.executeStepInternal(planId, stepId)
   ↓
2. StepRunner.execute() returns { newStepStatus: "waiting_for_bridge" }
   ↓
3. P10.4c reconciler fires (after runner, before terminal write):
   a. Guard: step.action === "apply_remediation" && this.proposalStore
   b. proposals = await this.proposalStore.list()
   c. Find sibling create_remediation_proposal step: same objectiveId
   d. Find matching proposal:
        target.kind === "executive_remediation"
        target.planId === plan.id
        target.stepId === siblingStep.id
        status === "applied"
   e. If match found:
        → override step status to "completed"
        → record evidence: executive_step_applied_remediation
        → step summary includes "Proposal <id> was applied"
   f. If no match or proposal not yet applied:
        → stay "waiting_for_bridge" (no-op, step-runner's default)
```

## Pure reconciler function

```ts
// src/executive/executive-apply-reconciler.ts

import type { PersistedExecutionPlan } from "./executive-plan-types.js";
import type { ExecutionStep } from "./planning-engine.js";
import type { AdaptationProposal } from "../adaptation/adaptation-types.js";

export interface ApplyReconciliationResult {
  stepCompleted: boolean;
  matchedProposalId?: string;
  matchedCreateStepId?: string;
}

/**
 * PURE: Determine whether an `apply_remediation` step should be marked
 * completed based on the proposal lifecycle.
 *
 * Finds the sibling create_remediation_proposal step on the same objective,
 * then checks whether its linked proposal has reached "applied" status.
 *
 * @returns stepCompleted=false when no sibling, no match, or not yet applied.
 */
export function reconcileApplyStep(
  plan: PersistedExecutionPlan,
  step: ExecutionStep,
  proposals: AdaptationProposal[],
): ApplyReconciliationResult {
  // 1. Find sibling create_remediation_proposal step on the same objective
  const createStep = plan.steps.find(
    s =>
      s.action === "create_remediation_proposal" &&
      s.objectiveId === step.objectiveId,
  );
  if (!createStep) return { stepCompleted: false };

  // 2. Find proposal targeting that create step
  const match = proposals.find(p => {
    if (p.target?.kind !== "executive_remediation") return false;
    const t = p.target; // narrowed to executive_remediation target
    return t.planId === plan.id && t.stepId === createStep.id;
  });
  if (!match) return { stepCompleted: false };

  // 3. Check if the proposal has been fully applied
  return {
    stepCompleted: match.status === "applied",
    matchedProposalId: match.id,
    matchedCreateStepId: createStep.id,
  };
}
```

## Evidence

One new evidence type, additive evidence infrastructure (not an ADR-0004 protected-type change):

```ts
// src/security/evidence/evidence-types.ts — additive member
"executive_step_applied_remediation"
```

One new public method on `EvidenceEventWriter` (matching P10.4b pattern):

```ts
// src/workflow/evidence-writer.ts
recordExecutiveStepAppliedRemediation(payload: {
  planId: string;
  stepId: string;
  proposalId: string;
}): Promise<void>
```

## Engine dispatch

In `ExecutionEngine.executeStepInternal`, after the existing P10.4b bridge block (line ~213) and before the terminal-state write (line ~215):

```ts
// ─── P10.4c executive apply reconciler ──────────────────────────────────────
// Reconcile `apply_remediation` steps by observing the linked proposal's
// lifecycle status. If the proposal is "applied", mark the step completed.
// Otherwise stay "waiting_for_bridge".
if (step.action === "apply_remediation" && this.proposalStore) {
  const proposals = await this.proposalStore.list();
  const reconcileResult = reconcileApplyStep(plan, step, proposals);
  if (reconcileResult.stepCompleted) {
    // Override the waiting_for_bridge from StepRunner — proposal is applied
    result.newStepStatus = "completed";
    result.summary = `Proposal ${reconcileResult.matchedProposalId} was applied`;
    // Append reconciler note; do NOT clear prior warnings (they may contain
    // useful history from previous run attempts). The caller accumulates
    // warnings from both the runner result and the bridge dispatch, so
    // clearing would erase prior context.
    await this.writer.recordExecutiveStepAppliedRemediation({
      planId: plan.id,
      stepId: step.id,
      proposalId: reconcileResult.matchedProposalId!,
    });
  }
}
```

The StepRunner returns `{ newStepStatus: "waiting_for_bridge" }` for all mutation steps. The reconciler overrides this to `"completed"` when the proposal proves the apply succeeded. This is the same pattern as P10.4b — the runner provides the conservative default, and the engine decides whether to upgrade.

### Backward compatibility

The `proposalStore` guard ensures no-op when the store isn't wired (same as P10.4b). Existing consumers without `ProposalStore` see no behavioral change.

## File changes

### New files
- `src/executive/executive-apply-reconciler.ts` — pure `reconcileApplyStep` function
- `tests/executive/executive-apply-reconciler.vitest.ts` — unit tests (minimum 5)
- `tests/executive/execution-engine-apply-dispatch.vitest.ts` — integration tests (minimum 2)

### Modified files
- `src/executive/execution-engine.ts` — add `apply_remediation` dispatch block
- `src/workflow/evidence-writer.ts` — new `recordExecutiveStepAppliedRemediation` method
- `src/security/evidence/evidence-types.ts` — additive `"executive_step_applied_remediation"`

### Not modified
- `src/adaptation/adaptation-types.ts` — no new types
- `src/executive/executive-bridge.ts` — no changes
- `src/executive/step-behavior.ts` — no changes
- `src/executive/step-runner.ts` — no changes
- `src/cli/commands/executive.ts` — no changes
- `tests/executive/executive-sentinels.vitest.ts` — likely needs allowlist update (new `executive-apply-reconciler.ts` file must be listed if the sentinel enumerates executive file paths; verify at implementation time)

## Test cases

### Unit tests (reconcileApplyStep)
1. No sibling `create_remediation_proposal` step on the same objective → `stepCompleted: false`
2. Sibling exists, no matching proposal in store → `stepCompleted: false`
3. Matching proposal exists, status `"pending"` → `stepCompleted: false`
4. Matching proposal exists, status `"approved"` → `stepCompleted: false`
5. Matching proposal exists, status `"applied"` → `stepCompleted: true`, returns matched IDs
6. Multiple proposals, only one matches planId + stepId → correct match selected
7. Non-executive-remediation proposals in the list are correctly filtered out

### Integration tests (engine dispatch)
8. `apply_remediation` step with applied proposal → step `completed`, evidence recorded
9. `apply_remediation` step without applied proposal → stays `waiting_for_bridge`
10. `apply_remediation` step without `ProposalStore` → no-op (backward compat)

## Architecture fit

```
P10.4a execution orchestration
  │
  ├─ read-only steps     → StepRunner runs, marks completed
  ├─ investigation steps → StepRunner marks waiting_for_bridge (future bridge)
  │
  ├─ create_remediation_proposal → P10.4b: creates pending proposal
  │                                  ↓ human approves/apply via alix adaptation
  └─ apply_remediation            → P10.4c: checks proposal was applied
                                     ↓ if yes: step completed
                                     ↓ if no:  stay waiting_for_bridge
```

The executive stack remains **read-only for mutation**: it creates proposals (P10.4b), observes their lifecycle (P10.4c), and never performs mutation itself.
