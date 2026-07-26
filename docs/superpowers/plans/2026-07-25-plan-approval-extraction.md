# Plan Approval Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Extract the duplicated approve/reject/edit/detail state machine from `plan-phase.ts` into a shared `runApprovalLoop()` with a `PlanApprovalIO` adapter interface.

**Architecture:** New `src/run/plan-approval.ts` file contains `PlanApprovalIO`, `PlanDecision`, and `runApprovalLoop()`. The two existing functions (`resolvePlanDecisionViaGate`, `promptForPlanApproval`) become thin wrappers.

**Spec:** `docs/superpowers/specs/2026-07-25-plan-approval-extraction-design.md`

## Global Constraints

- `PlanDecision` = `'approve' | 'reject' | 'edit' | 'detail'`
- `PlanApprovalIO` has two methods: `requestDecision(display)` and `showPlanDetail(content, planPath)`
- `runApprovalLoop()` is a bounded loop (max 10 rounds)
- The loop returns `{ action: 'rejected' }` after 10 rounds without explicit approval
- Editor launch + re-read + re-parse + sidecar persistence stays in the shared loop
- Existing TTY and TUI paths continue to work identically

---

### Task 1: Create shared module + tests + wire both paths

**Files:**
- Create: `src/run/plan-approval.ts`
- Modify: `src/run/plan-phase.ts` (delete 2 functions, add 2 adapter calls)
- Create: `tests/run/plan-approval.vitest.ts`

**Interfaces:**
- Produces: `PlanApprovalIO`, `PlanDecision`, `runApprovalLoop()` from `src/run/plan-approval.ts`
- Consumes: `SidecarFs`, `PlanPhaseResult`, `PlanApprovalGate`, `parsePlanTasks`, `openPlanInEditor`, `persistPlanTaskSidecar`, `clearPlanTaskSidecar` — all existing in `plan-phase.ts`

- [ ] **Step 1: Read `plan-phase.ts` lines 222-283 and 418-492** to confirm the exact function signatures and shared imports

- [ ] **Step 2: Create `src/run/plan-approval.ts`** with the exact code from the design spec — types, interface, and `runApprovalLoop()`

- [ ] **Step 3: Write failing tests** in `tests/run/plan-approval.vitest.ts` with a mock IO adapter:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runApprovalLoop } from '../../src/run/plan-approval.js';
import type { PlanApprovalIO, PlanDecision } from '../../src/run/plan-approval.js';

// Mock IO that returns decisions from a predefined sequence
function mockIO(decisions: PlanDecision[]): { io: PlanApprovalIO; details: string[] } {
  const details: string[] = [];
  let i = 0;
  return {
    io: {
      requestDecision: vi.fn(async () => decisions[i++] ?? 'approve'),
      showPlanDetail: vi.fn(async (content) => { details.push(content); }),
    },
    details,
  };
}

it('returns approved when io returns approve', async () => {
  const { io } = mockIO(['approve']);
  const result = await runApprovalLoop(io, '/path', 'plan', 'sid', '/dir', {} as any);
  expect(result.action).toBe('approved');
});

it('returns rejected when io returns reject', async () => {
  const { io } = mockIO(['reject']);
  const result = await runApprovalLoop(io, '/path', 'plan', 'sid', '/dir', {} as any);
  expect(result.action).toBe('rejected');
});

it('calls showPlanDetail on detail, then re-prompts', async () => {
  const { io, details } = mockIO(['detail', 'approve']);
  const result = await runApprovalLoop(io, '/path', 'plan', 'sid', '/dir', {} as any);
  expect(details).toContain('plan');
  expect(result.action).toBe('approved');
});

it('returns rejected after 10 rounds without explicit approval', async () => {
  // Never returns approve or reject — loop exhausts
  const { io } = mockIO(['edit', 'edit', 'edit', 'edit', 'edit', 'edit', 'edit', 'edit', 'edit', 'edit']);
  // But edit will fail because openPlanInEditor is not passed — need to handle
  // Note: this test needs the sidecar fs mock; edit without editor will
  // call openPlanInEditor which is a stub that returns null.
  // For this test, use a sequence that just keeps asking for detail
  const result = await runApprovalLoop(io, '/path', 'plan', 'sid', '/dir', {} as any);
  expect(result.action).toBe('rejected');
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/run/plan-approval.vitest.ts`
Expected: FAIL with module-not-found

- [ ] **Step 5: Implement `runApprovalLoop()` and wire it in `plan-phase.ts`**

Replace `resolvePlanDecisionViaGate()` with:

```ts
async function resolvePlanDecisionViaGate(
  gate: PlanApprovalGate,
  planPath: string,
  planContent: string,
  sessionId: string,
  planDir: string,
  sidecarFs: SidecarFs,
): Promise<PlanPhaseResult> {
  const tuiIO: PlanApprovalIO = {
    async requestDecision(display) {
      return await gate.requestDecision({
        planId: sessionId,
        planSummary: display.planSummary,
        planContent: display.planContent,
        planPath: display.planPath,
      });
    },
    showPlanDetail() { /* TUI gate renders plan in card */ },
  };
  return runApprovalLoop(tuiIO, planPath, planContent, sessionId, planDir, sidecarFs);
}
```

Replace `promptForPlanApproval()` with:

```ts
async function promptForPlanApproval(
  planPath: string,
  planContent: string,
  sidecarCtx: PromptForPlanApprovalCtx,
): Promise<PlanPhaseResult> {
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
    showPlanDetail(content: string, planPath: string) {
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
  return runApprovalLoop(ttyIO, planPath, planContent, sidecarCtx.sessionId, sidecarCtx.planDir, sidecarCtx.sidecarFs);
}
```

- [ ] **Step 6: Run all tests**

Run: `pnpm test:vitest 2>&1 | tail -5`
Expected: ~3274 tests pass

- [ ] **Step 7: Commit**

```bash
git add src/run/plan-approval.ts src/run/plan-phase.ts tests/run/plan-approval.vitest.ts
git commit -m "refactor(run): extract ApprovalMachine from duplicated plan approval logic"
```
