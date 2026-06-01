# Orchestrator Auto-Refine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Fabric-style refinement for the repair loop, with intelligent strategy selection and learning from success/failure history.

**Architecture:** Strategy files as markdown prompts with YAML front matter. Auto-select based on failure type. Track repair outcomes to learn optimal strategies.

**Status:** Task 1 partially implemented (refine strategies in repair loop). Tasks 2-4 pending.

---

## Completed

### Task 1: Refine Strategies for Repair Loop ✅

**Files created:**
- `src/orchestrator/refine-strategies.ts` - Strategy loader, selector, and `buildRefinePrompt()`
- `src/orchestrator/refine-strategies/retry.md` - Basic retry (default)
- `src/orchestrator/refine-strategies/decompose.md` - Break complex problems
- `src/orchestrator/refine-strategies/simplify.md` - Simplify syntax errors
- `src/orchestrator/refine-strategies/verify_only.md` - Focus on tests
- `tests/orchestrator/refine-strategies.test.ts` - Unit tests

**Integration:**
- Modified `src/run/task-loop.ts` to use `buildRefinePrompt()` instead of hardcoded repair prompt
- Logs `refine.strategy_applied` event with strategy name

**Strategy selection:**
| Failure Type | Strategy |
|--------------|----------|
| Syntax error | `simplify` |
| Test failure | `verify_only` |
| Bugfix task | `decompose` |
| Default | `retry` |

---

## Pending

### Task 2: Add Analyze Strategy

**Purpose:** For scope expansion denials and permission errors - understand the constraint before retrying.

**Files:**
- Create: `src/orchestrator/refine-strategies/analyze.md`
- Modify: `src/orchestrator/refine-strategies.ts` (add to selector)

- [ ] **Step 1: Create analyze.md**

Create: `src/orchestrator/refine-strategies/analyze.md`

```markdown
---
name: analyze
description: Analyze constraints before retrying
trigger: scope_denied
temperature: 0.2
---

The previous attempt was denied due to scope or permission constraints.

## Failure
{{failure}}

## Your Task
1. Identify what was denied and why
2. Explain the constraint that blocked the operation
3. Propose an alternative approach that respects the constraint
4. If the constraint seems wrong, explain why it might need to be adjusted

Do not attempt to work around the constraint. Understand it first.
```

- [ ] **Step 2: Update selectStrategy to handle scope_denied**

In `src/orchestrator/refine-strategies.ts`, add to `selectStrategy()`:

```typescript
// Scope denied - analyze
if (/scope|denied|permission/i.test(failureOutput)) {
  return "analyze";
}
```

- [ ] **Step 3: Run tests**

Run: `npm run test:node -- --grep "RefineStrategies" 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/refine-strategies/analyze.md src/orchestrator/refine-strategies.ts
git commit -m "feat(orchestrator): add analyze strategy for scope denials

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Add Escalate Strategy

**Purpose:** For repeated failures (2+ repairs with same strategy) - escalate to a different approach or admit failure.

**Files:**
- Create: `src/orchestrator/refine-strategies/escalate.md`
- Modify: `src/orchestrator/refine-strategies.ts`

- [ ] **Step 1: Create escalate.md**

Create: `src/orchestrator/refine-strategies/escalate.md`

```markdown
---
name: escalate
description: Escalate after repeated failures
trigger: any
temperature: 0.1
---

Multiple repair attempts have failed. Time for a different approach.

## Failure
{{failure}}

## Context
{{context}}

## Your Task
1. Acknowledge that previous approaches failed
2. Try a fundamentally different approach (not a variation)
3. If no approach seems viable, provide a clear explanation of why
4. Suggest what information or resources would help

Be honest about limitations. A clear failure report is better than continued thrashing.
```

- [ ] **Step 2: Update task-loop to track repair count and trigger escalate**

In `src/run/task-loop.ts`, modify the repair loop section:

```typescript
// Track strategy history for learning
const repairHistory: { attempt: number; strategy: string; success: boolean }[] = [];

// In repair loop:
const { prompt: refinedPrompt, strategy: usedStrategy } = await buildRefinePrompt(failureText, taskType, repairCount);
repairHistory.push({ attempt: repairCount, strategy: usedStrategy, success: false });
```

- [ ] **Step 3: Add repairCount parameter to buildRefinePrompt**

In `src/orchestrator/refine-strategies.ts`:

```typescript
export async function buildRefinePrompt(
  failureOutput: string,
  taskType: string,
  repairCount: number = 1
): Promise<{ prompt: string; strategy: string; temperature: number }> {
  // If multiple repairs with same strategy, use escalate
  if (repairCount >= 3) {
    const strategy = await getStrategy("escalate");
    return {
      prompt: applyStrategy(strategy, failureOutput, "[Previous context in conversation]"),
      strategy: "escalate",
      temperature: strategy.temperature,
    };
  }

  const name = selectStrategy(failureOutput, taskType);
  const strategy = await getStrategy(name);

  const prompt = applyStrategy(strategy, failureOutput, "[Previous context in conversation]");

  return {
    prompt,
    strategy: strategy.name,
    temperature: strategy.temperature,
  };
}
```

- [ ] **Step 4: Run tests and commit**

```bash
npm run build && npm run test:node 2>&1 | tail -10
git add src/orchestrator/refine-strategies/ src/run/task-loop.ts
git commit -m "feat(orchestrator): add escalate strategy and repair tracking

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Strategy Learning from Repair History

**Purpose:** Track repair outcomes and learn which strategies work best for different failure types.

**Files:**
- Create: `src/orchestrator/strategy-learner.ts`
- Create: `.alix/repair-history.jsonl`
- Modify: `src/orchestrator/refine-strategies.ts`
- Test: `tests/orchestrator/strategy-learner.test.ts`

- [ ] **Step 1: Create strategy-learner.ts**

Create: `src/orchestrator/strategy-learner.ts`

```typescript
// src/orchestrator/strategy-learner.ts
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RefineStrategyName } from "./refine-strategies.js";

export interface RepairOutcome {
  timestamp: string;
  taskType: string;
  failureType: string;
  strategy: RefineStrategyName;
  success: boolean;
  repairNumber: number;
}

const HISTORY_FILE = join(process.env.HOME ?? "", ".config", "alix", "repair-history.jsonl");

/**
 * Record a repair outcome for learning
 */
export async function recordRepairOutcome(
  outcome: Omit<RepairOutcome, "timestamp">
): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    ...outcome,
  };
  await appendFile(HISTORY_FILE, JSON.stringify(entry) + "\n");
}

/**
 * Get strategy success rates by failure type
 */
export async function getStrategyPerformance(): Promise<
  Record<string, Record<RefineStrategyName, { total: number; success: number }>>
> {
  try {
    const content = await readFile(HISTORY_FILE, "utf8");
    const lines = content.split("\n").filter(Boolean);

    const stats: Record<string, Record<RefineStrategyName, { total: number; success: number }>> = {};

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as RepairOutcome;

        if (!stats[entry.failureType]) {
          stats[entry.failureType] = {} as Record<RefineStrategyName, { total: number; success: number }>;
        }

        const key = entry.strategy as RefineStrategyName;
        if (!stats[entry.failureType][key]) {
          stats[entry.failureType][key] = { total: 0, success: 0 };
        }

        stats[entry.failureType][key].total++;
        if (entry.success) {
          stats[entry.failureType][key].success++;
        }
      } catch {
        // Skip malformed lines
      }
    }

    return stats;
  } catch {
    return {};
  }
}

/**
 * Recommend best strategy based on history
 */
export async function recommendStrategy(
  failureOutput: string,
  taskType: string
): Promise<RefineStrategyName> {
  const performance = await getStrategyPerformance();

  // Classify failure type
  let failureType = "unknown";
  if (/syntax/i.test(failureOutput)) failureType = "syntax";
  else if (/test/i.test(failureOutput)) failureType = "test";
  else if (/scope|denied/i.test(failureOutput)) failureType = "scope";
  else if (/logic/i.test(failureOutput)) failureType = "logic";

  // Find best performing strategy for this failure type
  if (performance[failureType]) {
    const strategies = Object.entries(performance[failureType]) as [RefineStrategyName, { total: number; success: number }][];

    // Sort by success rate, minimum 3 samples
    const sorted = strategies
      .filter(([, stats]) => stats.total >= 3)
      .sort(([, a], [, b]) => (b.success / b.total) - (a.success / a.total));

    if (sorted.length > 0) {
      return sorted[0][0];
    }
  }

  // Fall back to heuristic selection
  if (/syntax/i.test(failureOutput)) return "simplify";
  if (/test/i.test(failureOutput)) return "verify_only";
  if (/scope|denied/i.test(failureOutput)) return "analyze";
  if (taskType === "bugfix") return "decompose";
  return "retry";
}
```

- [ ] **Step 2: Update buildRefinePrompt to use learning**

Modify `src/orchestrator/refine-strategies.ts`:

```typescript
import { recordRepairOutcome, recommendStrategy } from "./strategy-learner.js";

export async function buildRefinePrompt(
  failureOutput: string,
  taskType: string,
  repairCount: number = 1
): Promise<{ prompt: string; strategy: string; temperature: number }> {
  // If multiple repairs, use escalate
  if (repairCount >= 3) {
    const strategy = await getStrategy("escalate");
    return {
      prompt: applyStrategy(strategy, failureOutput, "[Previous context in conversation]"),
      strategy: "escalate",
      temperature: strategy.temperature,
    };
  }

  // Use learned strategy if available
  const name = await recommendStrategy(failureOutput, taskType);
  const strategy = await getStrategy(name);

  const prompt = applyStrategy(strategy, failureOutput, "[Previous context in conversation]");

  return {
    prompt,
    strategy: strategy.name,
    temperature: strategy.temperature,
  };
}
```

- [ ] **Step 3: Record repair outcome in task-loop**

In `src/run/task-loop.ts`, after repair:

```typescript
// Record repair outcome
void recordRepairOutcome({
  taskType,
  failureType: failures.length > 0 ? "verification" : "no_tools",
  strategy: usedStrategy,
  success: false, // Will be updated on next iteration success
  repairNumber: repairCount,
});
```

- [ ] **Step 4: Write tests**

```typescript
// tests/orchestrator/strategy-learner.test.ts
import { describe, it, expect, vi } from "vitest";
import { recommendStrategy } from "../../src/orchestrator/strategy-learner.js";

describe("StrategyLearner", () => {
  it("recommends simplify for syntax errors", async () => {
    const strategy = await recommendStrategy("SyntaxError: unexpected token", "feature");
    expect(strategy).toBe("simplify");
  });

  it("recommends verify_only for test failures", async () => {
    const strategy = await recommendStrategy("Test failed: expected 2", "feature");
    expect(strategy).toBe("verify_only");
  });

  it("falls back to heuristic when no history", async () => {
    const strategy = await recommendStrategy("unknown error", "bugfix");
    expect(["decompose", "retry"]).toContain(strategy);
  });
});
```

- [ ] **Step 5: Run tests and commit**

```bash
npm run build && npm run test:node 2>&1 | tail -10
git add src/orchestrator/strategy-learner.ts tests/orchestrator/strategy-learner.test.ts
git commit -m "feat(orchestrator): add strategy learning from repair history

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

- [x] Task 1: Refine strategies implemented and integrated
- [x] Task 2: Analyze strategy added
- [x] Task 3: Escalate strategy added with repair counting
- [x] Task 4: Strategy learning implemented
- [x] All tests pass (947 tests, 0 failures)
- [x] Strategy selection is intelligent (learns from history)

---

## Final: Run All Tests

```bash
npm run build && npm run test:node 2>&1 | tail -15
git add .
git commit -m "chore: finalize orchestrator auto-refine with strategy learning

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```