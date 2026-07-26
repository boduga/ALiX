# Plan Approval Extraction — Design Spec

**Date:** 2026-07-25
**Status:** Draft
**Author:** Claude (with boduga review)

## Problem

The plan approval logic is duplicated across two functions in `src/run/plan-phase.ts`:

- `resolvePlanDecisionViaGate()` (lines 222-283) — TUI path via `PlanApprovalGate`
- `promptForPlanApproval()` (lines 418-492) — TTY path via `prompt()` readline

Both implement the same approve/reject/edit/detail state machine with the same round loop, same editor-launch-and-re-parse flow, and same sidecar persistence. Only the I/O surface differs (Promise-based gate vs readline prompt).

## Design

Extract the round-loop state machine into a new file `src/run/plan-approval.ts` with a shared `PlanApprovalIO` interface. The two existing functions become thin wrappers that provide TTY or TUI adapters.

## PlanApprovalIO interface

```ts
// src/run/plan-approval.ts

export type PlanDecision = 'approve' | 'reject' | 'edit' | 'detail';

export interface PlanApprovalDisplay {
  /** Short summary for the prompt/gate title */
  planSummary: string;
  /** Full plan content */
  planContent: string;
  /** Path to the saved plan file */
  planPath: string;
}

/**
 * I/O adapter for the plan approval round loop.
 * The TTY path implements this via readline.
 * The TUI gate implements this via PlanApprovalGate.
 */
export interface PlanApprovalIO {
  /** Ask the operator for a decision. Returns the chosen action. */
  requestDecision(display: PlanApprovalDisplay): Promise<PlanDecision>;
  /** Show the full plan to the operator (triggered by 'detail'). */
  showPlanDetail(content: string, planPath: string): void | Promise<void>;
}
```

## runApprovalLoop — the shared state machine

```ts
async function runApprovalLoop(
  io: PlanApprovalIO,
  planPath: string,
  initialContent: string,
  sessionId: string,
  planDir: string,
  sidecarFs: SidecarFs,
): Promise<PlanPhaseResult> {
  let planContent = initialContent;
  let currentTasks = parsePlanTasks(planContent, sessionId);
  for (let round = 0; round < 10; round++) {
    const decision = await io.requestDecision({
      planSummary: summarisePlan(planContent),
      planContent,
      planPath,
    });
    if (decision === 'approve') {
      return { action: 'approved', planContent, planTasks: currentTasks };
    }
    if (decision === 'reject') {
      await clearPlanTaskSidecar(planDir, sessionId, sidecarFs);
      return { action: 'rejected', planContent, planTasks: currentTasks };
    }
    if (decision === 'edit') {
      const edited = await openPlanInEditor(planPath);
      if (edited === null) { /* editor failed */ continue; }
      if (edited.trim().length === 0) { /* empty plan */ ... }
      planContent = edited;
      currentTasks = parsePlanTasks(planContent, sessionId);
      await persistPlanTaskSidecar(planDir, sessionId, currentTasks, sidecarFs);
      continue;
    }
    if (decision === 'detail') {
      await io.showPlanDetail(planContent, planPath);
      continue;
    }
  }
  // 10 rounds exhausted without explicit approval → reject
  return { action: 'rejected', planContent, planTasks: currentTasks };
}
```

## TTY adapter (replaces promptForPlanApproval)

```ts
const ttyIO: PlanApprovalIO = {
  async requestDecision(display): Promise<PlanDecision> {
    while (true) {
      const answer = await prompt('Approve plan? [Y/n/e/d] ');
      const key = answer.toLowerCase().trim();
      if (key === '' || key === 'y' || key === 'yes') return 'approve';
      if (key === 'n' || key === 'no') return 'reject';
      if (key === 'e' || key === 'edit') return 'edit';
      if (key === 'd' || key === 'detail') return 'detail';
      console.log('Press Y to approve, n to reject, e to edit, d for details.');
    }
  },
  showPlanDetail(content: string, planPath: string): void {
    const createCount = (content.match(/-\s+\*\*Action:\*\*\s*create/gi) ?? []).length;
    const modifyCount = (content.match(/-\s+\*\*Action:\*\*\s*modify/gi) ?? []).length;
    const deleteCount = (content.match(/-\s+\*\*Action:\*\*\s*delete/gi) ?? []).length;
    console.log(`Files to create: ${createCount}`);
    console.log(`Files to modify: ${modifyCount}`);
    console.log(`Files to delete: ${deleteCount}`);
    console.log(`\nFull plan saved to: ${planPath}`);
    console.log('\n' + content);
  },
};
```

## TUI gate adapter (replaces the gate-specific branch inside runPlanPhase)

```ts
const tuiIO: PlanApprovalIO = {
  async requestDecision(display): Promise<PlanDecision> {
    return await gate.requestDecision({
      planId: sessionId,
      planSummary: display.planSummary,
      planContent: display.planContent,
      planPath: display.planPath,
    });
  },
  showPlanDetail(): void {
    // TUI gate shows the plan in the card — no additional output needed.
  },
};
```

## Files changed

| File | Action |
|------|--------|
| `src/run/plan-approval.ts` | Create | `runApprovalLoop()`, `PlanApprovalIO`, `PlanDecision` |
| `src/run/plan-phase.ts` | Modify | Remove `resolvePlanDecisionViaGate()` and `promptForPlanApproval()`; replace with calls to `runApprovalLoop()` with the appropriate adapter |
| `tests/run/plan-approval.vitest.ts` | Create | Tests for the shared state machine with a mock IO adapter |

## Testing strategy

The shared `runApprovalLoop()` is tested with a **mock IO adapter** that returns decisions from a predefined sequence and captures showPlanDetail calls. This avoids testing through TTY or TUI surfaces:

- Approve on first round → expect `{ action: 'approved' }`
- Reject on first round → expect `{ action: 'rejected' }` with cleared sidecar
- Edit → re-read file → re-approve (mock re-read)
- Detail → captured call to showPlanDetail
- 10 rounds without explicit approve → rejected
- Editor failure → retried
- Empty edit → rejected
