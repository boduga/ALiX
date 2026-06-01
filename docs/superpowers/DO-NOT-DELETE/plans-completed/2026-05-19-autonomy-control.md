# Autonomy Control Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete TaskStateMachine with RunLimiter and scope tracking per research spec.

**Architecture:** Build on existing state machine. Add hard limits, scope expansion detection, and progress evaluation.

**Tech Stack:** TypeScript, existing agent loop, event log

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/autonomy/run-limiter.ts` | Enforce max steps, cost, files, shell commands |
| `src/autonomy/scope-tracker.ts` | Detect scope expansion and track task scope |
| `src/autonomy/progress-evaluator.ts` | Evaluate run progress and stop conditions |
| `tests/autonomy/run-limiter.test.ts` | Run limiter tests |
| `tests/autonomy/scope-tracker.test.ts` | Scope tracker tests |

---

## Task 1: Add RunLimiter

**Files:**
- Create: `src/autonomy/run-limiter.ts`
- Test: `tests/autonomy/run-limiter.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { RunLimiter, type RunLimits, type RunCounters } from "../../src/autonomy/run-limiter.js";

describe("RunLimiter", () => {
  const limits: RunLimits = {
    maxSteps: 10,
    maxCost: 100,
    maxFileChanges: 50,
    maxShellCommands: 100,
    maxRetries: 3,
    maxRuntimeSeconds: 600,
  };

  it("allows operation within limits", () => {
    const limiter = new RunLimiter(limits);
    const counters: RunCounters = { steps: 5, cost: 50, fileChanges: 10, shellCommands: 20 };
    const result = limiter.check(counters);
    assert.equal(result.allowed, true);
  });

  it("blocks when max steps reached", () => {
    const limiter = new RunLimiter(limits);
    const counters: RunCounters = { steps: 10, cost: 0, fileChanges: 0, shellCommands: 0 };
    const result = limiter.check(counters);
    assert.equal(result.allowed, false);
    assert.ok(result.reason?.includes("steps"));
  });

  it("blocks when max cost exceeded", () => {
    const limiter = new RunLimiter(limits);
    const counters: RunCounters = { steps: 5, cost: 101, fileChanges: 0, shellCommands: 0 };
    const result = limiter.check(counters);
    assert.equal(result.allowed, false);
    assert.ok(result.reason?.includes("cost"));
  });

  it("tracks remaining capacity", () => {
    const limiter = new RunLimiter(limits);
    const counters: RunCounters = { steps: 5, cost: 25, fileChanges: 20, shellCommands: 50 };
    const remaining = limiter.getRemaining(counters);
    assert.equal(remaining.steps, 5);
    assert.equal(remaining.cost, 75);
  });

  it("warns when approaching limits", () => {
    const limiter = new RunLimiter(limits);
    const counters: RunCounters = { steps: 9, cost: 90, fileChanges: 40, shellCommands: 90 };
    const warnings = limiter.getWarnings(counters);
    assert.ok(warnings.length > 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/autonomy/run-limiter.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement RunLimiter**

```typescript
// src/autonomy/run-limiter.ts

export type RunLimits = {
  maxSteps: number;
  maxCost: number;
  maxFileChanges: number;
  maxShellCommands: number;
  maxRetries: number;
  maxRuntimeSeconds: number;
};

export type RunCounters = {
  steps: number;
  cost: number;
  fileChanges: number;
  shellCommands: number;
};

export type LimitCheckResult = {
  allowed: boolean;
  reason?: string;
  limit?: string;
};

export type RemainingCapacity = {
  steps: number;
  cost: number;
  fileChanges: number;
  shellCommands: number;
};

export class RunLimiter {
  constructor(private limits: RunLimits) {}

  check(counters: RunCounters): LimitCheckResult {
    if (counters.steps >= this.limits.maxSteps) {
      return { allowed: false, reason: "Max steps reached", limit: "steps" };
    }
    if (counters.cost >= this.limits.maxCost) {
      return { allowed: false, reason: "Max cost exceeded", limit: "cost" };
    }
    if (counters.fileChanges >= this.limits.maxFileChanges) {
      return { allowed: false, reason: "Max file changes reached", limit: "fileChanges" };
    }
    if (counters.shellCommands >= this.limits.maxShellCommands) {
      return { allowed: false, reason: "Max shell commands reached", limit: "shellCommands" };
    }
    return { allowed: true };
  }

  getRemaining(counters: RunCounters): RemainingCapacity {
    return {
      steps: Math.max(0, this.limits.maxSteps - counters.steps),
      cost: Math.max(0, this.limits.maxCost - counters.cost),
      fileChanges: Math.max(0, this.limits.maxFileChanges - counters.fileChanges),
      shellCommands: Math.max(0, this.limits.maxShellCommands - counters.shellCommands),
    };
  }

  getWarnings(counters: RunCounters): string[] {
    const warnings: string[] = [];
    const remaining = this.getRemaining(counters);
    const threshold = 0.2; // 20% remaining = warning

    if (remaining.steps / this.limits.maxSteps <= threshold) {
      warnings.push(`${remaining.steps} steps remaining (${Math.round(threshold * 100)}% left)`);
    }
    if (remaining.cost / this.limits.maxCost <= threshold) {
      warnings.push(`$${remaining.cost} cost remaining (${Math.round(threshold * 100)}% left)`);
    }
    if (remaining.fileChanges / this.limits.maxFileChanges <= threshold) {
      warnings.push(`${remaining.fileChanges} file changes remaining`);
    }

    return warnings;
  }

  isExpired(startTime: Date): boolean {
    const elapsed = (Date.now() - startTime.getTime()) / 1000;
    return elapsed >= this.limits.maxRuntimeSeconds;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/autonomy/run-limiter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/autonomy/run-limiter.ts tests/autonomy/run-limiter.test.ts
git commit -m "feat(autonomy): add RunLimiter for execution limits"
```

---

## Task 2: Add ScopeTracker

**Files:**
- Create: `src/autonomy/scope-tracker.ts`
- Test: `tests/autonomy/scope-tracker.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { ScopeTracker, type TaskScope } from "../../src/autonomy/scope-tracker.js";

describe("ScopeTracker", () => {
  const tracker = new ScopeTracker();

  it("tracks declared scope", () => {
    tracker.setInitialScope({
      goal: "fix login bug",
      files: ["src/auth/login.ts"],
    });

    const scope = tracker.getCurrentScope();
    assert.equal(scope.goal, "fix login bug");
    assert.ok(scope.files.includes("src/auth/login.ts"));
  });

  it("detects scope expansion", () => {
    tracker.setInitialScope({
      goal: "add feature",
      files: ["src/feature.ts"],
    });

    tracker.checkExpansion({
      files: ["src/feature.ts", "src/other.ts", "src/new.ts"],
    });

    const expansions = tracker.getExpansions();
    assert.ok(expansions.length > 0);
  });

  it("asks for confirmation on expansion", () => {
    tracker.setInitialScope({
      goal: "small fix",
      files: ["file1.ts"],
    });

    const needsConfirmation = tracker.needsConfirmation({
      files: ["file1.ts", "file2.ts", "file3.ts"],
    });

    assert.equal(needsConfirmation, true);
  });

  it("approves within scope", () => {
    tracker.setInitialScope({
      goal: "refactor",
      files: ["src/utils.ts"],
    });

    const result = tracker.evaluateChange({
      files: ["src/utils.ts"],
    });

    assert.equal(result.approved, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/autonomy/scope-tracker.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ScopeTracker**

```typescript
// src/autonomy/scope-tracker.ts

export type TaskScope = {
  goal: string;
  files: string[];
  approvedAt?: string;
};

export type Expansion = {
  detectedAt: string;
  originalFiles: string[];
  newFiles: string[];
  additionalFiles: string[];
};

export type ChangeEvaluation = {
  approved: boolean;
  reason: string;
  requiresConfirmation?: boolean;
  newFiles?: string[];
};

export class ScopeTracker {
  private initialScope: TaskScope | null = null;
  private expansions: Expansion[] = [];
  private confirmedFiles: Set<string> = new Set();

  setInitialScope(scope: TaskScope): void {
    this.initialScope = { ...scope };
    this.confirmedFiles = new Set(scope.files);
  }

  getCurrentScope(): TaskScope {
    return this.initialScope ?? { goal: "", files: [] };
  }

  checkExpansion(current: { files?: string[] }): void {
    if (!this.initialScope) return;

    const initialFiles = new Set(this.initialScope.files);
    const currentFiles = new Set(current.files ?? []);

    const added = [...currentFiles].filter(f => !initialFiles.has(f));

    if (added.length > 0) {
      this.expansions.push({
        detectedAt: new Date().toISOString(),
        originalFiles: [...initialFiles],
        newFiles: [...currentFiles],
        additionalFiles: added,
      });
    }
  }

  getExpansions(): Expansion[] {
    return [...this.expansions];
  }

  needsConfirmation(current: { files?: string[] }): boolean {
    if (!this.initialScope) return false;

    const currentFiles = current.files ?? [];
    const unconfirmed = currentFiles.filter(f => !this.confirmedFiles.has(f));

    // Need confirmation if more than 2 new files or 50% expansion
    const expansionRatio = unconfirmed.length / Math.max(currentFiles.length, 1);
    return unconfirmed.length > 2 || expansionRatio > 0.5;
  }

  evaluateChange(change: { files?: string[] }): ChangeEvaluation {
    if (!this.initialScope) {
      return { approved: false, reason: "No scope defined" };
    }

    const changeFiles = change.files ?? [];
    const initialFiles = new Set(this.initialScope.files);
    
    const newFiles = changeFiles.filter(f => !initialFiles.has(f));
    const withinScope = newFiles.length === 0;

    if (withinScope) {
      return { approved: true, reason: "Within declared scope" };
    }

    const needsConfirm = this.needsConfirmation(change);
    return {
      approved: false,
      requiresConfirmation: true,
      reason: `Scope expansion detected: ${newFiles.length} new file(s)`,
      newFiles,
    };
  }

  confirmExpansion(): void {
    if (!this.initialScope) return;
    // Add all pending expansions to confirmed
    for (const exp of this.expansions) {
      for (const f of exp.additionalFiles) {
        this.confirmedFiles.add(f);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/autonomy/scope-tracker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/autonomy/scope-tracker.ts tests/autonomy/scope-tracker.test.ts
git commit -m "feat(autonomy): add ScopeTracker for task scope monitoring"
```

---

## Verification

```bash
npm test -- tests/autonomy/run-limiter.test.ts tests/autonomy/scope-tracker.test.ts
```

All tests should pass. Manual verification:
- [ ] RunLimiter enforces max steps/cost/files/shell commands
- [ ] ScopeTracker detects scope expansion
- [ ] Confirmation required when scope expands significantly
- [ ] Agent loop uses these to stop or pause runs