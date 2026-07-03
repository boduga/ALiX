# P10.9.2c — Lifecycle Automation / Executive Orchestration

> **Status:** Design — approved for implementation
> **Spoke to:** P10.9.2a (Proposal Readiness), P10.9.2b (Remediation Wizard), P10.4a (Execution Engine), P10.4c (Apply Reconciliation)
> **Builds on:** `source: "executive_remediate"` lineage payload, `planId`/`stepId` in child proposals, `runReadySteps(planId)`, `Engine.bridgeCreateRemediationProposal`
> **Protected files touched:** None (no ADR-0004 schema changes)

## Goal

Detect when a remediated child proposal reaches terminal status (applied/failed) and resume/advance the originating executive plan. Closes the orchestration loop:

```
Plan → Bridge → Remediation → Child → Approval → Apply → ✔ ORCHESTRATE → Resume Plan
```

## Architecture

Two-layer hybrid:

- **Event-driven (fast path):** After `alix adaptation apply <childId>` succeeds, a hook checks the proposal's lineage. If it has `source === "executive_remediate"` with a valid `planId`/`stepId`, the orchestrator transitions the parent plan's bridge step and advances the DAG.
- **Recovery command (scan path):** `alix executive orchestrate` scans existing proposals for any that have remediation lineage and a terminal status, then reconcilies what was missed. Safe to run multiple times.

No daemon. No background watcher. No long-running processes.

```
Event path (primary):
  adaptation apply <child>
    → gate.apply()                           [existing]
    → proposal.status = "applied"            [existing]
    → OrchestrationHook.onProposalTerminal()  ★ NEW
        → extractChildLineage(payload)
        → planId + stepId present?
          → YES: reconcile step → runReadySteps(planId)
          → NO:  no-op

Recovery path (scan):
  alix executive orchestrate [--plan <planId>] [--dry-run] [--json]
    → scan proposals
    → filter: source === "executive_remediate" + terminal status
    → for each: reconcileChildProposal()
    → print actions taken
```

## Section 1: Types

```typescript
// New file: src/executive/executive-orchestrator.ts

/** Lineage extracted from a child proposal's payload. */
export interface ChildLineageInfo {
  planId: string;
  stepId: string;
  parentProposalId: string;
}

/** Result of a single child proposal reconciliation. */
export interface ReconcileResult {
  childProposalId: string;
  planId: string;
  stepId: string;
  /** Whether this child proposal caused a step transition. */
  transitioned: boolean;
  /** The step's new status after reconciliation (if transitioned). */
  newStepStatus?: StepRuntimeStatus;
  /** Human-readable summary of what happened. */
  summary: string;
}

/** Generate a deterministic execution ID for orchestrator transitions. */
export function orchestrationSequence(): string {
  // Uses randomUUID for correlation. Distinguished from ExecutionEngine's
  // internal executionId by the "orchestration-" prefix. This is NOT an
  // engine-internal executionId — it's an audit-trail correlation key for
  // out-of-band state transitions. The constitutional invariant "only
  // ExecutionEngine generates executionId" applies to engine-internal
  // execution flows; the orchestrator generates its own distinct IDs.
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/** Orchestrate command result (multiple proposals). */
export interface OrchestrateResult {
  scanned: number;
  matched: number;
  reconciled: number;
  plansResumed: string[];
  results: ReconcileResult[];
}
```

## Section 2: Pure Functions

### `extractChildLineage(proposal)`

```typescript
function extractChildLineage(
  proposal: AdaptationProposal,
): ChildLineageInfo | null {
  const payload = proposal.payload as Record<string, unknown>;
  if (payload?.source !== "executive_remediate") return null;
  if (!payload?.planId || !payload?.stepId || !payload?.parentProposalId) return null;
  return {
    planId: String(payload.planId),
    stepId: String(payload.stepId),
    parentProposalId: String(payload.parentProposalId),
  };
}
```

Conditions:
- `payload.source === "executive_remediate"` — only remediated children
- `planId`, `stepId`, `parentProposalId` all present and non-empty
- All others → `null` (no-op, safe with non-remediated proposals)

### `computeStepTransition(state, stepId, childStatus)`

```typescript
function computeStepTransition(
  state: PlanExecutionState,
  stepId: string,
  childStatus: ProposalStatus,
): StepRuntimeStatus | null {
  const stepState = state.stepStates[stepId];
  if (!stepState) return null;
  // Only transition steps currently waiting_for_bridge
  if (stepState.status !== "waiting_for_bridge") return null;

  if (childStatus === "applied") return "completed";
  if (childStatus === "failed") return "blocked";
  return null; // pending/approved/rejected — not terminal
}
```

Transitions:

| Child status | Step transition | Rationale |
|---|---|---|
| `applied` | `waiting_for_bridge` → `completed` | Remediation succeeded |
| `failed` | `waiting_for_bridge` → `blocked` | Remediation failed, needs attention |
| `pending` | No change | Still in progress |
| `approved` | No change | Approved but not yet applied |
| `rejected` | No change | Cancelled by operator |

## Section 3: Effectful Reconciliation

### `planChildReconciliation` (pure preview)

Returns the same transition info as the effectful path but never writes. Used by dry-run mode and for pre-checking before applying.

```typescript
/**
 * PURE: compute what reconciliation would do for a child proposal.
 * Never mutates state — reads only.
 */
export function planChildReconciliation(
  proposal: AdaptationProposal,
  state: PlanExecutionState,
): { newStatus: StepRuntimeStatus | null; summary: string } {
  const lineage = extractChildLineage(proposal);
  if (!lineage) {
    return { newStatus: null, summary: "Proposal has no executive_remediate lineage — skipped" };
  }
  if (!state.stepStates[lineage.stepId]) {
    return { newStatus: null, summary: `Step ${lineage.stepId} not found in plan ${lineage.planId}` };
  }
  return {
    newStatus: computeStepTransition(state, lineage.stepId, proposal.status),
    summary: `Step ${lineage.stepId} → ${state.stepStates[lineage.stepId].status} would become ${computeStepTransition(state, lineage.stepId, proposal.status) ?? "unchanged"}`,
  };
}
```

### `reconcileChildProposal` (effectful)

Shares `extractChildLineage` + `computeStepTransition` with the pure preview. Only the `planChildReconciliation` variant is used for dry-run.

```typescript
async function reconcileChildProposal(
  proposal: AdaptationProposal,
  stateStore: ExecutionStateStore,
  engine: ExecutionEngine,
  writer: EvidenceEventWriter,
): Promise<ReconcileResult> {
  // 1. Extract lineage — non-remediated proposals are no-ops
  const lineage = extractChildLineage(proposal);
  if (!lineage) {
    return {
      childProposalId: proposal.id,
      planId: "",
      stepId: "",
      transitioned: false,
      summary: "Proposal has no executive_remediate lineage — skipped",
    };
  }

  // 2. Load plan state — if plan doesn't exist, nothing to reconcile
  let state: PlanExecutionState;
  try {
    state = stateStore.load(lineage.planId);
  } catch {
    return {
      childProposalId: proposal.id,
      planId: lineage.planId,
      stepId: lineage.stepId,
      transitioned: false,
      summary: `Parent plan ${lineage.planId} not found — skipped`,
    };
  }

  // 3. Compute the step transition (shared with pure preview path)
  const { newStatus } = planChildReconciliation(proposal, state);
  if (!newStatus) {
    const stepStatus = state.stepStates[lineage.stepId]?.status ?? "unknown";
    return {
      childProposalId: proposal.id,
      planId: lineage.planId,
      stepId: lineage.stepId,
      transitioned: false,
      summary: `Step ${lineage.stepId} status is "${stepStatus}" — no transition needed`,
    };
  }

  // 4. Apply transition via state store
  // completedAt is only set for "completed" transitions. For "blocked"
  // (failed child), no timestamp is written — the step's existing
  // timestamps are left unchanged. StepRuntimeState has no blockedAt
  // field; the blocked status itself is sufficient signal.
  const executionId = `orchestration-${orchestrationSequence()}`;
  stateStore.update(lineage.planId, {
    from: state.status,
    to: state.status,
    executionId,
    reason: `Child proposal ${proposal.id} (${proposal.status}) → step ${lineage.stepId} → ${newStatus}`,
  }, s => {
    s.stepStates[lineage.stepId].status = newStatus;
    if (newStatus === "completed") {
      s.stepStates[lineage.stepId].completedAt = new Date().toISOString();
    }
    s.stepStates[lineage.stepId].summary =
      `Orchestrated from child proposal ${proposal.id} (${proposal.status})`;
    return s;
  });

  // 5. Record evidence (best-effort, non-blocking warning on failure)
  const evidenceResult = await writer.recordExecutiveStepOrchestrated({
    planId: lineage.planId,
    stepId: lineage.stepId,
    parentProposalId: lineage.parentProposalId,
    childProposalId: proposal.id,
    childStatus: proposal.status,
    newStepStatus: newStatus,
  });
  if (!evidenceResult) {
    console.warn(
      `[executive-orchestrator] Failed to record executive_step_orchestrated evidence for plan ${lineage.planId} step ${lineage.stepId} — non-blocking, audit trail may be incomplete`,
    );
  }

  // 6. Advance plan DAG (only if step was completed)
  if (newStatus === "completed") {
    await engine.runReadySteps(lineage.planId);
  }

  // 5. Record evidence (best-effort, fire-and-forget)
  await writer.recordExecutiveStepOrchestrated({
    planId: lineage.planId,
    stepId: lineage.stepId,
    parentProposalId: lineage.parentProposalId,
    childProposalId: proposal.id,
    childStatus: proposal.status,
    newStepStatus: newStatus,
  }).catch(() => {});

  // 6. Advance plan DAG (only if step was completed)
  if (newStatus === "completed") {
    await engine.runReadySteps(lineage.planId);
  }

  return {
    childProposalId: proposal.id,
    planId: lineage.planId,
    stepId: lineage.stepId,
    transitioned: true,
    newStepStatus: newStatus,
    summary: `Child proposal ${proposal.id} (${proposal.status}) → step ${lineage.stepId} → ${newStatus}`,
  };
}
```

### `ExecutiveOrchestrator` — event hook

Fires on both `applied` and `failed` terminal states. Named `onProposalTerminal` to cover both — the event path is symmetric: `gate.apply()` either succeeds (→ `applied`) or catches the error and sets `failed`. In both cases the hook fires with the proposal's current status.

```typescript
export interface OrchestrationHook {
  /**
   * Called when a proposal reaches a terminal status (applied or failed).
   * Best-effort — never blocks the caller.
   */
  onProposalTerminal(proposal: AdaptationProposal): Promise<void>;
}

export class ExecutiveOrchestrator implements OrchestrationHook {
  constructor(
    private readonly stateStore: ExecutionStateStore,
    private readonly engine: ExecutionEngine,
    private readonly writer: EvidenceEventWriter,
  ) {}

  async onProposalTerminal(proposal: AdaptationProposal): Promise<void> {
    try {
      const lineage = extractChildLineage(proposal);
      if (!lineage) return; // not a remediated child

      await reconcileChildProposal(
        proposal, this.stateStore,
        this.engine, this.writer,
      );
    } catch (e) {
      // Best-effort: never block the caller
      console.warn(
        `[executive-orchestrator] Failed to orchestrate proposal ${proposal.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
```

**Best-effort contract** — mirrors `OutcomeEvaluationHook` (P10.5c):
- Never throws
- Never blocks the apply/fail from completing
- Failures are logged as warnings
- Recovery command handles any missed events

## Section 4: Recovery CLI

```
alix executive orchestrate [--plan <planId>] [--dry-run] [--json]
```

### Flags

| Flag | Description |
|------|-------------|
| `--plan <planId>` | Scope reconciliation to proposals linked to this plan |
| `--dry-run` | Show what would be reconciled, don't mutate |
| `--json` | Structured JSON output |

### Behavior

1. Load all proposals (or filter by `--plan` scoped to `payload.planId`)
2. Filter: `status === "applied" || status === "failed"` AND `payload.source === "executive_remediate"`
3. For each match: call `reconcileChildProposal` (or `planChildReconciliation` for dry-run)
4. Collect unique plan IDs where a step transitioned to `completed` — those are `plansResumed`
5. For each such plan, call `engine.runReadySteps(planId)` exactly once (deduped)
6. Report: matched count, reconciled count, plans resumed

`plansResumed` only includes plans where `runReadySteps()` was actually invoked. Failed child → blocked step does NOT count as resumed. Already-reconciled child does NOT count as resumed.

### Dry-run

Uses `planChildReconciliation()` (pure preview) instead of `reconcileChildProposal()`. Reads plan state once, computes transitions, and prints what would occur — never calls `stateStore.update()` or `engine.runReadySteps()`. The pure and effectful paths share `extractChildLineage` + `computeStepTransition`, guaranteeing they produce identical transition decisions.

### Output

```
$ alix executive orchestrate

Scanned 24 proposals.
Found 3 matched child proposals (2 applied, 1 failed).
Reconciled 3 steps across 2 plans.
Resumed 2 plans (p10_exec, p10_other).

  prop-009  applied   → step completed   → p10_exec / step-3 ✓
  prop-010  applied   → step completed   → p10_exec / step-3 ✓ (already completed)
  prop-011  failed    → step blocked     → p10_other / step-2 ⚠
```

JSON output:

```json
{
  "scanned": 24,
  "matched": 3,
  "reconciled": 3,
  "plansResumed": ["p10_exec", "p10_other"],
  "results": [
    { "childProposalId": "prop-009", "planId": "p10_exec", "stepId": "step-3", "transitioned": true, "newStepStatus": "completed", "summary": "Child proposal prop-009 applied → step-3 completed" },
    { "childProposalId": "prop-010", "planId": "p10_exec", "stepId": "step-3", "transitioned": false, "newStepStatus": undefined, "summary": "Step already completed" },
    { "childProposalId": "prop-011", "planId": "p10_other", "stepId": "step-2", "transitioned": true, "newStepStatus": "blocked", "summary": "Child proposal prop-011 failed → step-2 blocked" }
  ]
}
```

### Error cases

| Condition | Output |
|-----------|--------|
| No proposals with lineage found | `No remediated child proposals found.` |
| `--plan` not found | `Plan not found: <planId>` |
| No transitions needed | `All matched proposals already reconciled.` |

## Section 5: Evidence

One new evidence type:

```
executive_step_orchestrated
```

Payload:

```typescript
interface ExecutiveStepOrchestratedPayload {
  planId: string;
  stepId: string;
  parentProposalId: string;
  childProposalId: string;
  childStatus: ProposalStatus;
  newStepStatus: StepRuntimeStatus;
}
```

Added to `evidence-writer.ts` as:

```typescript
async recordExecutiveStepOrchestrated(payload: {
  planId: string;
  stepId: string;
  parentProposalId: string;
  childProposalId: string;
  childStatus: string;
  newStepStatus: string;
}): Promise<EvidenceRecord | null>
```

Added to `EvidenceType` union and `EVIDENCE_TYPES` set.

## Section 6: Where the Hook Fires

In `src/cli/commands/adaptation.ts`, `runApply()` function, after `gate.apply()` completes:

`gate.apply()` handles both outcomes:
- **Success:** proposal transitions to `applied` → the hook fires with the updated proposal
- **Failure (applier throws):** `gate.apply()` catches the error, sets proposal status to `failed`, and re-throws → the hook fires BEFORE the error propagates, so the failed status is captured in the proposal object

```typescript
// After existing apply logic
const updated = await gate.apply(id, applier);
console.log(`Applied: ${updated.id} → ${updated.action} (${describeTarget(updated)})`);

// ★ NEW: fire orchestration hook (best-effort, never blocks apply)
// Fires on both "applied" and "failed" terminal statuses.
// Failed → bridge step becomes blocked (operator investigates).
// Already-reconciled → idempotent no-op.
if (orchestrator) {
  orchestrator.onProposalTerminal(updated).catch(() => {});
}
```

The `orchestrator` parameter is threaded through `runApply`'s signature. In `handleAdaptationCommand`, it's constructed from the executive directory (same pattern as `execution-engine` / `outcome-hook` wiring).

The hook is optional: if `orchestrator` is `undefined` or `null`, skip. This preserves backward compatibility.

**Note on `rejected` status:** A child proposal that is `rejected` (operator declines via `alix adaptation reject`) does NOT trigger orchestration. Rationale: rejection means the operator explicitly declined this particular remediation attempt. The parent bridge step remains `waiting_for_bridge` — the operator may create a new child proposal via the remediation wizard, or handle the situation manually. If the operator intended the rejection to unblock the plan, they can use the recovery CLI or a manual step transition.

## Section 7: Invariants

### R1 — Event never blocks apply

The hook fires AFTER `gate.apply()` returns. If the hook throws, the apply result is already committed. Errors are caught and logged as warnings. The recovery path covers any missed events.

### R2 — Idempotent reconciliation

`computeStepTransition` only returns a new status when the current status is `waiting_for_bridge`. Already-`completed` or already-`blocked` steps return `null` — no-op. Multiple `alix executive orchestrate` runs are safe.

### R3 — Step transitions only

The orchestrator modifies step-level state (`stepStates[stepId].status`), never plan-level status. DAG advancement is delegated to `engine.runReadySteps()`, which has its own completion detection for the plan level.

### R4 — Lineage validation is strict

Only proposals where `payload.source === "executive_remediate"` AND `payload.planId`, `payload.stepId`, `payload.parentProposalId` are all present trigger orchestration. Missing any field → no-op.

### R5 — Recovery is safe

The recovery command scans proposals and computes transitions before writing. Dry-run mode (`--dry-run`) skips all writes and engine calls.

### R6 — No daemon

This phase explicitly does NOT add a background watcher, cron job, or persistent process. Event hook + recovery command only.

### R7 — Failed child → blocked step

When a child proposal reaches `failed` status, the bridge step transitions to `blocked` (not `waiting_for_bridge`). The operator must investigate and decide whether to retry with a new child proposal.

## Section 8: Files

| File | Action | Purpose |
|------|--------|---------|
| `src/executive/executive-orchestrator.ts` | **Create** | Types, pure functions, ExecutiveOrchestrator class |
| `tests/executive/executive-orchestrator.vitest.ts` | **Create** | Unit tests for pure functions + orchestrator |
| `src/cli/commands/executive-orchestrate-handler.ts` | **Create** | `handleOrchestrateCommand` for recovery CLI |
| `tests/cli/commands/executive-orchestrate-cli.vitest.ts` | **Create** | CLI integration tests |
| `src/cli/commands/adaptation.ts` | **Modify** | Wire OrchestrationHook after `gate.apply()` |
| `src/cli/commands/executive.ts` | **Modify** | Add `"orchestrate"` case |
| `src/workflow/evidence-writer.ts` | **Modify** | Add `recordExecutiveStepOrchestrated` method |
| `src/security/evidence/evidence-types.ts` | **Modify** | Add `executive_step_orchestrated` evidence type |
| Executive purity sentinel | **Modify** | Add new files to `EXECUTIVE_FILES` allowlist |

## Section 9: Wiring Detail

### `adaptation.ts` changes

The `runApply` function gains an optional `orchestrator` parameter:

```typescript
async function runApply(
  cwd: string,
  store: ProposalStore,
  gate: ApprovalGate,
  writer: EvidenceEventWriter,
  args: string[],
  orchestrator?: OrchestrationHook,          // ★ NEW
): Promise<void>
```

The `handleAdaptationCommand` dispatcher constructs the orchestrator when the executive directory exists:

```typescript
// In handleAdaptationCommand, when executive data dir exists
let orchestrator: ExecutiveOrchestrator | undefined;
const execDir = join(cwd, ".alix", "executive");
if (existsSync(join(execDir, "plans"))) {
  const stateStore = new ExecutionStateStore(join(execDir, "states"));
  const engine = new ExecutionEngine(...); // constructed with existing stores
  orchestrator = new ExecutiveOrchestrator(stateStore, engine, writer);
}
```

The plan store, state store, and engine reuse the same instances the `executive.ts` dispatch would create — ensuring single-writer consistency.

### `executive.ts` changes

```typescript
case "orchestrate": {
  const { handleOrchestrateCommand } = await import(
    "./executive-orchestrate-handler.js"
  );
  return handleOrchestrateCommand(rest);
}
```

## Section 10: Success Criteria

- ✅ Applied child proposal with `source === "executive_remediate"` triggers step transition
- ✅ Failed child proposal transitions step to `blocked`
- ✅ Non-remediated proposals (no lineage fields) are no-ops
- ✅ `alix executive orchestrate` finds and reconciles missed proposals
- ✅ Dry-run mode shows transitions without mutating state
- ✅ Idempotent: running twice produces same result as running once
- ✅ Event hook never blocks the apply from completing
- ✅ Full test suite green
- ✅ Executive purity sentinel green
- ✅ No ADR-0004 protected files modified
- ✅ New evidence type `executive_step_orchestrated` recorded on transition
