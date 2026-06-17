# M0.78g.1 — Model-Assisted Replanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable model-assisted replanning where the model proposes typed `PlanRevisionDraft` revisions and ALiX validates, policies, gates, and applies them atomically.

**Architecture:** Nine sequential slices building on the M0.78g foundation. The model returns a typed `PlanRevisionDraft` (never mutates a run directly). ALiX validates structural/DAG integrity, analyzes risk/policy/ownership impact, routes high-risk revisions to human approval, then applies via the existing `updateRunWithRevisionCheck` CAS guard.

**Tech Stack:** TypeScript, Node `node:test`, existing `CoordinationStore`, `CoordinationPlanner`, `CollaborativePlanner`, `CollaborationStore`, provider abstraction

## Global Constraints

- All new tests use `node:test` + `node:assert/strict` — no vitest, no chai
- Stateful kernel tests use `mkdtempSync` + `rmSync`
- Model never mutates a run — only returns `PlanRevisionDraft`
- All run mutations use `updateRunWithRevisionCheck` CAS guard
- The system must work without model-assisted replanning configured (graceful fallback)
- 2902+ existing tests must pass after every task

---

## File Structure

| File | Action | Task |
|------|--------|------|
| `src/kernel/coordination-types.ts` | MODIFY | 1a |
| `src/kernel/collaborative-planner.ts` | MODIFY | 1c, 1d, 1e, 1f, 1g |
| `src/kernel/collaboration-context-builder.ts` | MODIFY | 1b |
| `src/kernel/replan-types.ts` | CREATE | 1a |
| `src/kernel/replan-validator.ts` | CREATE | 1d |
| `src/kernel/replan-impact-analyzer.ts` | CREATE | 1e |
| `src/kernel/replan-approval-gate.ts` | CREATE | 1f |
| `src/kernel/replan-applier.ts` | CREATE | 1g |
| `src/kernel/model-replan-adapter.ts` | CREATE | 1c |
| `tests/kernel/replan-validator.test.ts` | CREATE | 1d |
| `tests/kernel/replan-impact-analyzer.test.ts` | CREATE | 1e |
| `tests/kernel/replan-approval-gate.test.ts` | CREATE | 1f |
| `tests/kernel/replan-applier.test.ts` | CREATE | 1g |
| `tests/kernel/model-replan-adapter.test.ts` | CREATE | 1c |
| `tests/kernel/replan-integration.test.ts` | CREATE | 1i |

---

### Task 1a: Revision Proposal Schema

**Files:**
- Create: `src/kernel/replan-types.ts`
- Modify: `src/kernel/coordination-types.ts` (optional — re-export if needed)
- Test: (embedded in test helpers, no dedicated test file needed for types)

**Interfaces:**
- Consumes: existing `PlanTriggerKind`, `WorkerAssignment`, `RiskLevel` types
- Produces: `PlanRevisionDraft`, `TriggerEvidence`, `WorkerSpec`, `WorkerReplaceSpec`, `WorkerModifySpec`, `DependencyRewire`, `CapabilityChange`, `OwnershipChange`, `ValidationResult`, `ImpactAnalysis`

```typescript
// src/kernel/replan-types.ts

import type { PlanTriggerKind } from "./coordination-types.js";

// ── Model Output ────────────────────────────────────────────────

export interface TriggerEvidence {
  workerId: string;
  findingIds: string[];
  conflictIds: string[];
  reason: string;
}

export interface WorkerSpec {
  taskLabel: string;
  goalPrompt: string;
  requiredCapabilities: string[];
  dependencies: string[];
  ownershipScopes: string[];
  riskLevel: string;
  approvalMode?: string;
}

export interface WorkerReplaceSpec {
  targetWorkerId: string;
  replacement: WorkerSpec;
  reason: string;
}

export interface WorkerModifySpec {
  workerId: string;
  goalPrompt?: string;
  dependencies?: string[];
  ownershipScopes?: string[];
}

export interface DependencyRewire {
  fromWorkerId: string;
  toWorkerId: string;
}

export interface CapabilityChange {
  agentId: string;
  addedCapabilities?: string[];
  removedCapabilities?: string[];
}

export interface OwnershipChange {
  scope: string;
  previousOwner: string;
  newOwner: string;
}

export interface PlanRevisionDraft {
  triggerKind: PlanTriggerKind;
  triggerEvidence: TriggerEvidence;
  workersToAdd: WorkerSpec[];
  workersToReplace: WorkerReplaceSpec[];
  workersToRemove: string[];
  workersToModify: WorkerModifySpec[];
  dependencyRewiring: DependencyRewire[];
  capabilityChanges: CapabilityChange[];
  ownershipChanges: OwnershipChange[];
  expectedBenefit: string;
  confidence: number;
  unresolvedConflicts: string[];
  verificationRequirements: string[];
}

// ── Validation ──────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
}

// ── Impact Analysis ─────────────────────────────────────────────

export interface ImpactAnalysis {
  riskLevel: "low" | "medium" | "high" | "critical";
  policyCompliant: boolean;
  policyViolations: string[];
  ownershipConflicts: OwnershipConflict[];
  requiresApproval: boolean;
  summary: string;
}

export interface OwnershipConflict {
  scope: string;
  currentOwner: string;
  proposedOwner: string;
  severity: "info" | "warning" | "blocking";
}

// ── Replanning Context ──────────────────────────────────────────

export interface ModelReplanContext {
  runId: string;
  trigger: PlanTriggerKind;
  triggerEvidence: TriggerEvidence;
  completedWorkers: Array<{
    workerId: string;
    taskLabel: string;
    status: string;
    attempt: number;
    findings: string[];
  }>;
  activeConflicts: Array<{
    conflictId: string;
    criticality: string;
    status: string;
    summary: string;
  }>;
  recentFindings: Array<{
    findingId: string;
    summary: string;
    invalidatesAssumption: boolean;
  }>;
  workerGraph: string[]; // topological order of worker IDs
}
```

- [ ] **Step 1: Write the types file**

Create `src/kernel/replan-types.ts` with all interfaces above.

- [ ] **Step 2: Build and verify**

```bash
npx tsc -p tsconfig.json --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/kernel/replan-types.ts
git commit -m "feat(replan): add PlanRevisionDraft and supporting types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1b: Replanning Context Builder

**Files:**
- Modify: `src/kernel/collaboration-context-builder.ts`

**Interfaces:**
- Consumes: `ModelReplanContext`, `CoordinationStore`, `CollaborationStore`
- Produces: `buildModelReplanContext(runId, trigger, evidence): ModelReplanContext`

```typescript
// Add to CollaborationContextBuilder

async buildModelReplanContext(
  runId: string,
  trigger: PlanTriggerKind,
  evidence: TriggerEvidence,
): Promise<ModelReplanContext> {
  const run = await this.coordinationStore.load(runId);
  if (!run) {
    return {
      runId,
      trigger,
      triggerEvidence: evidence,
      completedWorkers: [],
      activeConflicts: [],
      recentFindings: [],
      workerGraph: [],
    };
  }

  const completedWorkers = run.workers
    .filter(w => w.status === "completed" || w.status === "failed")
    .map(w => ({
      workerId: w.id,
      taskLabel: w.taskLabel,
      status: w.status,
      attempt: w.attempt,
      findings: [], // populated from collaboration store
    }));

  const activeConflicts = await this.collabStore.queryConflicts({
    statuses: ["detected", "under_review"],
  }).catch(() => []);

  const recentFindings = await this.collabStore.queryFindings({
    limit: 20,
  }).catch(() => []);

  // Topological order of workers
  const workerGraph = this.topologicalSort(run.workers);

  return {
    runId,
    trigger,
    triggerEvidence: evidence,
    completedWorkers,
    activeConflicts: activeConflicts.map(c => ({
      conflictId: c.id,
      criticality: (c as any).criticality ?? "medium",
      status: c.status,
      summary: (c as any).summary ?? "",
    })),
    recentFindings: recentFindings.map(f => ({
      findingId: f.id,
      summary: (f as any).summary ?? "",
      invalidatesAssumption: (f as any).invalidatesAssumption ?? false,
    })),
    workerGraph,
  };
}

private topologicalSort(workers: WorkerAssignment[]): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(workerId: string) {
    if (visited.has(workerId)) return;
    visited.add(workerId);
    const w = workers.find(x => x.id === workerId);
    if (w) {
      for (const dep of w.dependencies) visit(dep);
      result.push(workerId);
    }
  }

  for (const w of workers) visit(w.id);
  return result;
}
```

- [ ] **Step 1: Write tests**

```typescript
import test from "node:test";
import assert from "node:assert/strict";

test("buildModelReplanContext returns empty when run doesn't exist", async () => { /* ... */ });
test("buildModelReplanContext includes completed workers", async () => { /* ... */ });
test("buildModelReplanContext includes active conflicts", async () => { /* ... */ });
test("buildModelReplanContext includes recent findings", async () => { /* ... */ });
test("topologicalSort returns correct order", async () => { /* ... */ });
test("topologicalSort handles no dependencies", async () => { /* ... */ });
```

- [ ] **Step 2: Implement `buildModelReplanContext` and `topologicalSort`**

- [ ] **Step 3: Run tests**

```bash
node --test dist/tests/kernel/collaboration-context-builder-replan.test.js
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/kernel/collaboration-context-builder.ts
git commit -m "feat(replan): add buildModelReplanContext with topological sort

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1c: Model Proposal Adapter

**Files:**
- Create: `src/kernel/model-replan-adapter.ts`
- Test: `tests/kernel/model-replan-adapter.test.ts`

**Interfaces:**
- Consumes: `ModelReplanContext`, provider abstraction for LLM calls
- Produces: `PlanRevisionDraft` (parsed from model output)

```typescript
// src/kernel/model-replan-adapter.ts

import type { ModelReplanContext, PlanRevisionDraft } from "./replan-types.js";

export interface ReplanModelAdapterOptions {
  provider: {
    generateStructured(prompt: string, schema: object): Promise<object>;
  };
  maxRetries?: number;
}

export class ModelReplanAdapter {
  constructor(private options: ReplanModelAdapterOptions) {}

  async proposeRevision(context: ModelReplanContext): Promise<PlanRevisionDraft> {
    const prompt = this.buildPrompt(context);
    const schema = this.getRevisionSchema();

    let lastError: Error | null = null;
    const maxRetries = this.options.maxRetries ?? 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const raw = await this.options.provider.generateStructured(prompt, schema);
        return this.parseDraft(raw);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError ?? new Error("Failed to generate revision proposal");
  }

  private buildPrompt(context: ModelReplanContext): string {
    return JSON.stringify(context, null, 2);
  }

  private getRevisionSchema(): object {
    // The JSON schema for PlanRevisionDraft
    return {
      type: "object",
      properties: {
        triggerKind: { type: "string" },
        triggerEvidence: { type: "object" },
        workersToAdd: { type: "array", items: { type: "object" } },
        workersToReplace: { type: "array", items: { type: "object" } },
        workersToRemove: { type: "array", items: { type: "string" } },
        workersToModify: { type: "array", items: { type: "object" } },
        dependencyRewiring: { type: "array", items: { type: "object" } },
        capabilityChanges: { type: "array", items: { type: "object" } },
        ownershipChanges: { type: "array", items: { type: "object" } },
        expectedBenefit: { type: "string" },
        confidence: { type: "number" },
        unresolvedConflicts: { type: "array", items: { type: "string" } },
        verificationRequirements: { type: "array", items: { type: "string" } },
      },
      required: ["triggerKind", "triggerEvidence", "expectedBenefit", "confidence"],
    };
  }

  private parseDraft(raw: unknown): PlanRevisionDraft {
    const draft = raw as PlanRevisionDraft;
    if (!draft.triggerKind || !draft.triggerEvidence) {
      throw new Error("Invalid PlanRevisionDraft: missing required fields");
    }
    return {
      triggerKind: draft.triggerKind,
      triggerEvidence: draft.triggerEvidence,
      workersToAdd: draft.workersToAdd ?? [],
      workersToReplace: draft.workersToReplace ?? [],
      workersToRemove: draft.workersToRemove ?? [],
      workersToModify: draft.workersToModify ?? [],
      dependencyRewiring: draft.dependencyRewiring ?? [],
      capabilityChanges: draft.capabilityChanges ?? [],
      ownershipChanges: draft.ownershipChanges ?? [],
      expectedBenefit: draft.expectedBenefit,
      confidence: draft.confidence ?? 0,
      unresolvedConflicts: draft.unresolvedConflicts ?? [],
      verificationRequirements: draft.verificationRequirements ?? [],
    };
  }
}
```

- [ ] **Step 1: Write tests**

```typescript
// tests/kernel/model-replan-adapter.test.ts
test("proposeRevision returns parsed draft on success", async () => { /* mock provider returns valid draft */ });
test("proposeRevision retries on failure", async () => { /* mock fails twice, succeeds third */ });
test("proposeRevision throws after exhausting retries", async () => { /* mock always fails */ });
test("parseDraft fills defaults for missing optional arrays", async () => { /* partial response */ });
test("buildPrompt includes all context fields", async () => { /* verify prompt shape */ });
```

- [ ] **Step 2: Implement `ModelReplanAdapter`**

- [ ] **Step 3: Run tests**

```bash
node --test dist/tests/kernel/model-replan-adapter.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/kernel/model-replan-adapter.ts tests/kernel/model-replan-adapter.test.ts
git commit -m "feat(replan): add ModelReplanAdapter for structured proposal generation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1d: Structural and DAG Validation

**Files:**
- Create: `src/kernel/replan-validator.ts`
- Test: `tests/kernel/replan-validator.test.ts`

**Interfaces:**
- Consumes: `PlanRevisionDraft`, current run's worker list
- Produces: `ValidationResult`

```typescript
// src/kernel/replan-validator.ts

import type { WorkerAssignment } from "./coordination-types.js";
import type { PlanRevisionDraft, ValidationResult } from "./replan-types.js";

export class ReplanValidator {
  validate(draft: PlanRevisionDraft, existingWorkers: WorkerAssignment[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 1. Check workersToReplace reference existing workers
    for (const replace of draft.workersToReplace) {
      if (!existingWorkers.find(w => w.id === replace.targetWorkerId)) {
        errors.push({
          field: `workersToReplace[].targetWorkerId`,
          message: `Worker ${replace.targetWorkerId} not found in run`,
          code: "WORKER_NOT_FOUND",
        });
      }
    }

    // 2. Check workersToRemove reference existing workers
    for (const workerId of draft.workersToRemove) {
      if (!existingWorkers.find(w => w.id === workerId)) {
        errors.push({
          field: "workersToRemove[]",
          message: `Worker ${workerId} not found in run`,
          code: "WORKER_NOT_FOUND",
        });
      }
    }

    // 3. Check workersToModify reference existing workers
    for (const mod of draft.workersToModify) {
      if (!existingWorkers.find(w => w.id === mod.workerId)) {
        errors.push({
          field: "workersToModify[].workerId",
          message: `Worker ${mod.workerId} not found in run`,
          code: "WORKER_NOT_FOUND",
        });
      }
    }

    // 4. Check dependency rewiring references
    for (const wire of draft.dependencyRewiring) {
      const existsFrom = draft.workersToReplace.some(r => r.targetWorkerId === wire.fromWorkerId)
        || existingWorkers.some(w => w.id === wire.fromWorkerId);
      if (!existsFrom) {
        warnings.push({
          field: "dependencyRewiring[].fromWorkerId",
          message: `Source ${wire.fromWorkerId} neither existing nor being replaced`,
          code: "DEP_SOURCE_MISSING",
        });
      }
    }

    // 5. Check for cycles in proposed DAG
    const allWorkerIds = new Set(existingWorkers.map(w => w.id));
    for (const remove of draft.workersToRemove) allWorkerIds.delete(remove);
    for (const replace of draft.workersToReplace) allWorkerIds.delete(replace.targetWorkerId);
    for (const replace of draft.workersToReplace) {
      // Replacement gets a new ID; add it
      allWorkerIds.add(`repl_${replace.targetWorkerId}`);
    }
    for (const add of draft.workersToAdd) {
      allWorkerIds.add(`add_${add.taskLabel.replace(/[^a-zA-Z0-9]/g, "_")}`);
    }

    if (this.hasCycle(draft, existingWorkers, allWorkerIds)) {
      errors.push({
        field: "dependencies",
        message: "Proposed DAG contains a cycle",
        code: "DAG_CYCLE",
      });
    }

    // 6. Check capability matching is possible
    // (light check — full capability resolution happens at apply time)

    return { valid: errors.length === 0, errors, warnings };
  }

  private hasCycle(
    draft: PlanRevisionDraft,
    existingWorkers: WorkerAssignment[],
    allIds: Set<string>,
  ): boolean {
    // Build adjacency list
    const adj = new Map<string, string[]>();
    for (const id of allIds) adj.set(id, []);

    for (const w of existingWorkers) {
      if (draft.workersToRemove.includes(w.id)) continue;
      if (draft.workersToReplace.some(r => r.targetWorkerId === w.id)) continue;
      adj.set(w.id, [...(w.dependencies ?? [])]);
    }

    for (const replace of draft.workersToReplace) {
      const newId = `repl_${replace.targetWorkerId}`;
      const deps = [...(replace.replacement.dependencies ?? [])];
      // Rewire any dependency rewiring
      for (const wire of draft.dependencyRewiring) {
        const idx = deps.indexOf(wire.fromWorkerId);
        if (idx !== -1) deps[idx] = wire.toWorkerId;
      }
      adj.set(newId, deps);
    }

    for (const add of draft.workersToAdd) {
      adj.set(`add_${add.taskLabel.replace(/[^a-zA-Z0-9]/g, "_")}`, [...(add.dependencies ?? [])]);
    }

    // Standard DFS cycle detection
    const visited = new Set<string>();
    const inStack = new Set<string>();

    function dfs(node: string): boolean {
      if (inStack.has(node)) return true;
      if (visited.has(node)) return false;
      visited.add(node);
      inStack.add(node);
      for (const neighbor of adj.get(node) ?? []) {
        if (adj.has(neighbor) && dfs(neighbor)) return true;
      }
      inStack.delete(node);
      return false;
    }

    for (const node of adj.keys()) {
      if (dfs(node)) return true;
    }
    return false;
  }
}
```

- [ ] **Step 1: Write failing tests**

```typescript
test("validates empty draft as valid", async () => { /* no errors */ });
test("rejects workersToReplace with nonexistent targetWorkerId", async () => { /* error */ });
test("rejects workersToRemove with nonexistent workerId", async () => { /* error */ });
test("rejects workersToModify with nonexistent workerId", async () => { /* error */ });
test("detects cycle in proposed DAG", async () => { /* A depends B, B depends A → cycle */ });
test("accepts acyclic DAG", async () => { /* A depends B → no cycle */ });
test("generates warning for unmatched dep rewiring", async () => { /* warning */ });
test("validates with mixed adds, removes, replaces", async () => { /* all valid */ });
```

- [ ] **Step 2: Implement `ReplanValidator`**

- [ ] **Step 3: Run tests**

```bash
node --test dist/tests/kernel/replan-validator.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/kernel/replan-validator.ts tests/kernel/replan-validator.test.ts
git commit -m "feat(replan): add ReplanValidator for structural and DAG validation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1e: Risk, Policy, and Ownership Impact Analysis

**Files:**
- Create: `src/kernel/replan-impact-analyzer.ts`
- Test: `tests/kernel/replan-impact-analyzer.test.ts`

**Interfaces:**
- Consumes: `PlanRevisionDraft`, existing run state, ownership registry
- Produces: `ImpactAnalysis`

```typescript
// src/kernel/replan-impact-analyzer.ts

import type { WorkerAssignment } from "./coordination-types.js";
import type { PlanRevisionDraft, ImpactAnalysis, OwnershipConflict } from "./replan-types.js";

export class ReplanImpactAnalyzer {
  analyze(
    draft: PlanRevisionDraft,
    existingWorkers: WorkerAssignment[],
  ): ImpactAnalysis {
    const ownershipConflicts: OwnershipConflict[] = [];
    const policyViolations: string[] = [];
    let maxRiskLevel: "low" | "medium" | "high" | "critical" = "low";

    // 1. Calculate risk from added/replaced workers
    for (const add of draft.workersToAdd) {
      if (add.riskLevel === "critical" || add.riskLevel === "high") {
        maxRiskLevel = this.maxRisk(maxRiskLevel, add.riskLevel);
      }
    }
    for (const replace of draft.workersToReplace) {
      if (replace.replacement.riskLevel === "critical" || replace.replacement.riskLevel === "high") {
        maxRiskLevel = this.maxRisk(maxRiskLevel, replace.replacement.riskLevel);
      }
    }

    // 2. Check ownership changes
    for (const change of draft.ownershipChanges) {
      ownershipConflicts.push({
        scope: change.scope,
        currentOwner: change.previousOwner,
        proposedOwner: change.newOwner,
        severity: change.previousOwner ? "warning" : "info",
      });
    }

    // 3. Policy compliance
    // Check if any worker requires approval mode
    const hasApprovalMode = [...draft.workersToAdd, ...draft.workersToReplace.map(r => r.replacement)]
      .some(w => w.approvalMode && w.approvalMode !== "none");
    if (hasApprovalMode && maxRiskLevel !== "low") {
      policyViolations.push("Workers with approval mode require low-risk plans");
    }

    // 4. Determine if approval required
    const requiresApproval = maxRiskLevel !== "low" || ownershipConflicts.some(c => c.severity === "blocking");

    const summary = this.buildSummary(draft, maxRiskLevel, ownershipConflicts);

    return {
      riskLevel: maxRiskLevel,
      policyCompliant: policyViolations.length === 0,
      policyViolations,
      ownershipConflicts,
      requiresApproval,
      summary,
    };
  }

  private maxRisk(
    a: "low" | "medium" | "high" | "critical",
    b: string,
  ): "low" | "medium" | "high" | "critical" {
    const order: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    return (order[b] ?? 0) > order[a] ? (b as any) : a;
  }

  private buildSummary(
    draft: PlanRevisionDraft,
    riskLevel: string,
    conflicts: OwnershipConflict[],
  ): string {
    const parts: string[] = [];
    if (draft.workersToAdd.length > 0) parts.push(`+${draft.workersToAdd.length} workers`);
    if (draft.workersToReplace.length > 0) parts.push(`replace ${draft.workersToReplace.length}`);
    if (draft.workersToRemove.length > 0) parts.push(`-${draft.workersToRemove.length}`);
    if (draft.workersToModify.length > 0) parts.push(`modify ${draft.workersToModify.length}`);
    parts.push(`risk: ${riskLevel}`);
    if (conflicts.length > 0) parts.push(`${conflicts.length} ownership changes`);
    return parts.join(", ");
  }
}
```

- [ ] **Step 1: Write tests**

```typescript
test("low risk when no critical workers added", async () => { /* low */ });
test("high risk when critical worker added", async () => { /* high */ });
test("ownership conflict generates warning", async () => { /* conflict.severity = warning */ });
test("policy violation when approval mode with high risk", async () => { /* violation */ });
test("requiresApproval true when risk is high", async () => { /* true */ });
test("requiresApproval false when risk low and no blocking conflicts", async () => { /* false */ });
test("summary includes counts", async () => { /* check summary string */ });
```

- [ ] **Step 2: Implement `ReplanImpactAnalyzer`**

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

---

### Task 1f: Approval Gating

**Files:**
- Create: `src/kernel/replan-approval-gate.ts`
- Test: `tests/kernel/replan-approval-gate.test.ts`

**Interfaces:**
- Consumes: `ImpactAnalysis`, `ApprovalStore` (existing)
- Produces: `ApprovalGateResult`

```typescript
export interface ApprovalGateResult {
  approved: boolean;
  requiresApproval: boolean;
  approvalId?: string;
  reason?: string;
}

export class ReplanApprovalGate {
  constructor(private approvalStore: ApprovalStore) {}

  async evaluate(analysis: ImpactAnalysis, runId: string): Promise<ApprovalGateResult> {
    if (!analysis.requiresApproval) {
      return { approved: true, requiresApproval: false };
    }

    // Route to approval flow via requestBound
    const bound = await this.approvalStore.requestBound({
      runId,
      type: "replan",
      reason: analysis.summary,
      expiresAt: Date.now() + 300_000, // 5 min
    });

    return {
      approved: false,
      requiresApproval: true,
      approvalId: bound.id,
      reason: analysis.summary,
    };
  }

  async checkApproval(approvalId: string): Promise<ApprovalGateResult> {
    const bound = await this.approvalStore.load(approvalId);
    if (!bound) {
      return { approved: false, requiresApproval: true, reason: "Approval request not found" };
    }
    if (bound.status === "approved") {
      return { approved: true, requiresApproval: true, approvalId };
    }
    if (bound.status === "rejected") {
      return { approved: false, requiresApproval: true, approvalId, reason: "Rejected by approver" };
    }
    // Still pending
    return { approved: false, requiresApproval: true, approvalId, reason: "Awaiting approval" };
  }
}
```

- [ ] **Step 1: Write tests**

```typescript
test("auto-approves when analysis says not required", async () => { /* approved: true */ });
test("creates approval bound when required", async () => { /* approvalId set */ });
test("checkApproval returns approved when bound approved", async () => { /* true */ });
test("checkApproval returns rejected when bound rejected", async () => { /* false */ });
test("checkApproval returns pending when not yet decided", async () => { /* false, pending */ });
test("checkApproval handles missing bound gracefully", async () => { /* not found */ });
```

- [ ] **Step 2: Implement `ReplanApprovalGate`**

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

---

### Task 1g: Atomic Application and Rollback

**Files:**
- Create: `src/kernel/replan-applier.ts`
- Test: `tests/kernel/replan-applier.test.ts`

**Interfaces:**
- Consumes: `PlanRevisionDraft`, `CoordinationStore`, existing run state
- Produces: `ApplyResult`

```typescript
export interface ApplyResult {
  applied: boolean;
  run: CoordinationRun | null;
  revision: PlanRevision | null;
  errors: string[];
}

export class ReplanApplier {
  constructor(private store: CoordinationStore) {}

  async apply(draft: PlanRevisionDraft, runId: string): Promise<ApplyResult> {
    const run = await this.store.load(runId);
    if (!run) return { applied: false, run: null, revision: null, errors: ["Run not found"] };

    // Create snapshot for rollback
    const snapshot = JSON.parse(JSON.stringify(run));

    const expectedRev = run.planRevision ?? 0;

    const updated = await this.store.updateRunWithRevisionCheck(
      runId,
      expectedRev,
      (r) => {
        // 1. Remove workers
        for (const removeId of draft.workersToRemove) {
          const idx = r.workers.findIndex(w => w.id === removeId);
          if (idx !== -1) r.workers.splice(idx, 1);
        }

        // 2. Replace workers
        for (const replace of draft.workersToReplace) {
          const existing = r.workers.find(w => w.id === replace.targetWorkerId);
          if (!existing) continue;
          const replId = `worker_repl_${Date.now()}_${replace.targetWorkerId.slice(-8)}`;
          const replacement = createWorkerAssignment({
            coordinationRunId: runId,
            agentId: existing.agentId,
            taskLabel: replace.replacement.taskLabel,
            goalPrompt: replace.replacement.goalPrompt,
            dependencies: replace.replacement.dependencies,
            ownershipScopes: replace.replacement.ownershipScopes,
            requiredCapabilities: replace.replacement.requiredCapabilities,
            ownershipClaims: [],
            riskLevel: replace.replacement.riskLevel,
            approvalMode: replace.replacement.approvalMode,
            status: "ready",
            attempt: 0,
            maxAttempts: existing.maxAttempts,
            id: replId,
          });
          (replacement as any).replacementForWorkerId = replace.targetWorkerId;
          (existing as any).supersededByWorkerId = replId;
          r.workers.push(replacement);
        }

        // 3. Add new workers
        for (const spec of draft.workersToAdd) {
          const newId = `worker_add_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const worker = createWorkerAssignment({
            coordinationRunId: runId,
            agentId: "",
            taskLabel: spec.taskLabel,
            goalPrompt: spec.goalPrompt,
            dependencies: spec.dependencies,
            ownershipScopes: spec.ownershipScopes,
            requiredCapabilities: spec.requiredCapabilities,
            ownershipClaims: [],
            riskLevel: spec.riskLevel,
            approvalMode: spec.approvalMode,
            status: "ready",
            attempt: 0,
            maxAttempts: 3,
            id: newId,
          });
          r.workers.push(worker);
        }

        // 4. Modify workers
        for (const mod of draft.workersToModify) {
          const worker = r.workers.find(w => w.id === mod.workerId);
          if (!worker) continue;
          if (mod.goalPrompt) worker.goalPrompt = mod.goalPrompt;
          if (mod.dependencies) worker.dependencies = mod.dependencies;
          if (mod.ownershipScopes) worker.ownershipScopes = mod.ownershipScopes;
        }

        // 5. Rewire dependencies
        for (const wire of draft.dependencyRewiring) {
          for (const worker of r.workers) {
            const idx = worker.dependencies.indexOf(wire.fromWorkerId);
            if (idx !== -1) {
              worker.dependencies = [...worker.dependencies];
              worker.dependencies[idx] = wire.toWorkerId;
            }
          }
        }

        // 6. Build PlanRevision
        const diff: PlanDiffEntry[] = this.buildDiff(draft, run.workers, r.workers);
        const revision: PlanRevision = {
          revisionNumber: r.planRevision + 1,
          timestamp: new Date().toISOString(),
          reason: `Model-assisted replan: ${draft.expectedBenefit}`,
          triggerKind: draft.triggerKind,
          triggerWorkerId: draft.triggerEvidence.workerId,
          diff,
        };
        r.revisionHistory = [...(r.revisionHistory ?? []), revision];

        // 7. Set status
        r.status = "running";
      },
    );

    if (!updated) {
      return { applied: false, run: null, revision: null, errors: ["CAS conflict — concurrent replan"] };
    }

    const lastRevision = (updated.revisionHistory?.slice(-1)[0]) ?? null;
    return { applied: true, run: updated, revision: lastRevision, errors: [] };
  }

  private buildDiff(
    draft: PlanRevisionDraft,
    before: WorkerAssignment[],
    after: WorkerAssignment[],
  ): PlanDiffEntry[] {
    const diff: PlanDiffEntry[] = [];
    const beforeIds = new Set(before.map(w => w.id));
    const afterIds = new Set(after.map(w => w.id));

    for (const w of after) {
      if (!beforeIds.has(w.id)) {
        diff.push({ workerId: w.id, change: "added", taskLabel: w.taskLabel, reason: "Model-assisted replan" });
      }
    }
    for (const w of before) {
      if (!afterIds.has(w.id)) {
        diff.push({ workerId: w.id, change: "removed", taskLabel: w.taskLabel, reason: "Model-assisted replan" });
      }
    }

    return diff;
  }
}
```

- [ ] **Step 1: Write failing tests**

```typescript
test("applies add workers successfully", async () => { /* worker added */ });
test("applies replace workers with lineage", async () => { /* replacementForWorkerId set */ });
test("applies remove workers", async () => { /* worker removed */ });
test("applies modify workers", async () => { /* goalPrompt updated */ });
test("rewires dependencies", async () => { /* dep fromWorkerId→toWorkerId */ });
test("builds PlanRevision with diff", async () => { /* diff entries */ });
test("increments planRevision", async () => { /* planRevision += 1 */ });
test("CAS conflict returns applied:false", async () => { /* null */ });
test("handles empty draft (no changes)", async () => { /* applied: true */ });
```

- [ ] **Step 2: Implement `ReplanApplier`**

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

---

### Task 1h: Observability and Operator Visibility

**Files:**
- Modify: `src/cli/commands/inspect-coordination.ts` (or equivalent CLI command)

The existing `alix coordination inspect` output already shows `revisionHistory` from M0.78g. This task ensures model-assisted replan revisions are surfaced with their trigger kind, expected benefit, and confidence score.

- [ ] **Step 1: Verify existing inspect output includes revision info**

```bash
# Inspect a coordination run that has revision history
alix coordination inspect <run-id> --json | grep -A 10 "revisionHistory"
```

- [ ] **Step 2: Add model replan detail to inspect output**

Add `modelAssistedReplan` section showing trigger, benefit, confidence, and status.

- [ ] **Step 3: Write test**

```typescript
test("inspect output includes model-assisted replan data", async () => { /* ... */ });
```

- [ ] **Step 4: Commit**

---

### Task 1i: Adversarial and Integration Tests

**Files:**
- Create: `tests/kernel/replan-integration.test.ts`

**Integration test — full flow:**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("full model-assisted replan flow: trigger → context → validate → apply", async () => {
  // 1. Create a coordination run with workers
  // 2. Simulate a trigger (conflict, failure, etc.)
  // 3. Build replan context via CollaborationContextBuilder
  // 4. Create a PlanRevisionDraft
  // 5. Validate via ReplanValidator
  // 6. Analyze impact via ReplanImpactAnalyzer
  // 7. Apply via ReplanApplier
  // 8. Verify run has updated revisionHistory and planRevision
});
```

**Adversarial tests:**

```typescript
test("invalid draft with cycle is rejected by validator", async () => { /* ... */ });
test("invalid draft with missing worker is rejected by validator", async () => { /* ... */ });
test("invalid draft with duplicate worker ID is rejected by validator", async () => { /* ... */ });

test("model timeout — adapter throws after retries", async () => { /* ... */ });

test("approval reject — high-risk revision blocked when rejected", async () => { /* ... */ });

test("CAS conflict while applying — retry succeeds on second attempt", async () => { /* ... */ });
test("CAS conflict exhausted — apply returns applied:false", async () => { /* ... */ });

test("graceful fallback — no model replan adapter configured, mechanical replan still works", async () => { /* ... */ });
```

- [ ] **Step 1: Write all integration tests**
- [ ] **Step 2: Run tests**

```bash
node --test dist/tests/kernel/replan-integration.test.js
```

- [ ] **Step 3: Run full test suite**

```bash
npm run test:node:ci
```

Expected: 2902+ tests, 0 failures.

- [ ] **Step 4: Commit**

---

## Verification

1. **`npm run build`** — clean TypeScript build
2. **`npm run test:node:ci`** — all tests pass
3. **`npm run test:vitest`** — both vitest files pass
4. **Integration test** — full trigger → context → validate → apply flow passes
5. **Graceful fallback** — existing mechanical replan works without model adapter
