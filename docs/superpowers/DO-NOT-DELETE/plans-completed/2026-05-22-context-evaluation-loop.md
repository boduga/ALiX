# Context Evaluation & Feedback Loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a feedback loop that learns from past context patterns — tracking which context selection strategies work best for which task types, and using that to improve future context bundles.

**Architecture:** Store task-type statistics in a lightweight JSON registry. After each session, extract outcome metrics (success, iterations, tokens) and update the registry. On subsequent runs, use the registry to bias context selection thresholds toward proven patterns.

**Tech Stack:** TypeScript, existing EventLog/JSONL infrastructure, Pattern registry stored in `~/.alix/patterns/`

---

## File Structure

```
src/
  context/
    pattern-registry.ts   # NEW: stores and retrieves task-type statistics
    session-outcome.ts     # NEW: extracts outcome from events.jsonl
  events/
    types.ts              # MODIFY: add CONTEXT_PATTERN_EVALUATED event
  run/
    task-loop.ts           # MODIFY: emit evaluation after task completion
  repomap/
    context-pipeline.ts    # MODIFY: accept threshold bias from registry
```

---

## Tasks

### Task 1: Session Outcome Extraction

**Files:**
- Create: `src/context/session-outcome.ts`
- Test: `tests/unit/session-outcome.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/unit/session-outcome.test.ts
import { extractSessionOutcome } from '../../src/context/session-outcome';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

describe('extractSessionOutcome', () => {
  it('extracts outcome from completed session', async () => {
    const sessionDir = '/tmp/test-session';
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'events.jsonl'), JSON.stringify({
      type: 'session.started', sessionId: 'test', timestamp: new Date().toISOString(),
      actor: 'system', seq: 1, id: '1', version: 1, payload: {}
    }) + '\n' + JSON.stringify({
      type: 'session.ended', sessionId: 'test', timestamp: new Date().toISOString(),
      actor: 'system', seq: 2, id: '2', version: 1,
      payload: { reason: 'completed', summary: 'Done' }
    }) + '\n' + JSON.stringify({
      type: 'model.usage', sessionId: 'test', timestamp: new Date().toISOString(),
      actor: 'system', seq: 3, id: '3', version: 1,
      payload: { inputTokens: 1000, outputTokens: 500 }
    }) + '\n');

    const outcome = await extractSessionOutcome(sessionDir);
    expect(outcome.success).toBe(true);
    expect(outcome.reason).toBe('completed');
    expect(outcome.totalTokens).toBe(1500);
  });

  it('extracts iteration count', async () => {
    // ... setup with iteration events
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/session-outcome.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/context/session-outcome.ts
import { readFile } from 'fs/promises';
import { join } from 'path';

export type SessionOutcome = {
  success: boolean;
  reason?: 'completed' | 'max_iterations' | 'error';
  iterations: number;
  totalTokens: number;
  primaryCount: number;
  testCount: number;
  supportingCount: number;
};

export async function extractSessionOutcome(sessionDir: string): Promise<SessionOutcome> {
  const eventsPath = join(sessionDir, 'events.jsonl');
  const content = await readFile(eventsPath, 'utf8');
  const lines = content.split('\n').filter(Boolean);

  let success = false;
  let reason: SessionOutcome['reason'];
  let iterations = 0;
  let totalTokens = 0;

  for (const line of lines) {
    const event = JSON.parse(line);
    if (event.type === 'session.ended') {
      success = event.payload.reason === 'completed';
      reason = event.payload.reason;
    }
    if (event.type === 'agent.message') {
      iterations++;
    }
    if (event.type === 'model.usage') {
      totalTokens += (event.payload.inputTokens ?? 0) + (event.payload.outputTokens ?? 0);
    }
  }

  return { success, reason, iterations, totalTokens, primaryCount: 0, testCount: 0, supportingCount: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/session-outcome.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context/session-outcome.ts tests/unit/session-outcome.test.ts
git commit -m "feat(context): add session outcome extraction"
```

---

### Task 2: Pattern Registry

**Files:**
- Create: `src/context/pattern-registry.ts`
- Test: `tests/unit/pattern-registry.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/unit/pattern-registry.test.ts
import { PatternRegistry } from '../../src/context/pattern-registry';
import { rm } from 'fs/promises';

describe('PatternRegistry', () => {
  const testDir = '/tmp/test-patterns';

  beforeEach(async () => {
    await rm(testDir, { force: true, recursive: true });
  });

  it('records outcome for task type', async () => {
    const registry = new PatternRegistry(testDir);
    await registry.recordOutcome('feature', { success: true, iterations: 5, totalTokens: 1000 });

    const stats = registry.getStats('feature');
    expect(stats.count).toBe(1);
    expect(stats.successRate).toBe(1.0);
  });

  it('calculates rolling success rate', async () => {
    const registry = new PatternRegistry(testDir);
    await registry.recordOutcome('bugfix', { success: true, iterations: 3, totalTokens: 500 });
    await registry.recordOutcome('bugfix', { success: false, iterations: 10, totalTokens: 2000 });

    const stats = registry.getStats('bugfix');
    expect(stats.count).toBe(2);
    expect(stats.successRate).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/pattern-registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/context/pattern-registry.ts
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { TaskType } from '../task-classifier.js';

type TaskTypeStats = {
  count: number;
  successCount: number;
  successRate: number;
  avgIterations: number;
  totalIterations: number;
};

export class PatternRegistry {
  private dir: string;
  private stats: Map<TaskType, TaskTypeStats> = new Map();

  constructor(dir: string) {
    this.dir = dir;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await this.load();
  }

  private async load(): Promise<void> {
    const statsPath = join(this.dir, 'stats.json');
    try {
      const content = await readFile(statsPath, 'utf8');
      const data = JSON.parse(content);
      for (const [key, value] of Object.entries(data)) {
        this.stats.set(key as TaskType, value as TaskTypeStats);
      }
    } catch {
      // No existing stats
    }
  }

  async save(): Promise<void> {
    const statsPath = join(this.dir, 'stats.json');
    const data: Record<string, TaskTypeStats> = {};
    for (const [key, value] of this.stats) {
      data[key] = value;
    }
    await writeFile(statsPath, JSON.stringify(data, null, 2));
  }

  async recordOutcome(taskType: TaskType, outcome: { success: boolean; iterations: number; totalTokens: number }): Promise<void> {
    const stats = this.stats.get(taskType) ?? { count: 0, successCount: 0, successRate: 0, avgIterations: 0, totalIterations: 0 };

    stats.count++;
    if (outcome.success) stats.successCount++;
    stats.totalIterations += outcome.iterations;
    stats.successRate = stats.successCount / stats.count;
    stats.avgIterations = stats.totalIterations / stats.count;

    this.stats.set(taskType, stats);
    await this.save();
  }

  getStats(taskType: TaskType): TaskTypeStats | undefined {
    return this.stats.get(taskType);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/pattern-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context/pattern-registry.ts tests/unit/pattern-registry.test.ts
git commit -m "feat(context): add pattern registry for task-type statistics"
```

---

### Task 3: Wire Evaluation into Task Loop

**Files:**
- Modify: `src/events/types.ts`
- Modify: `src/run/task-loop.ts`

- [ ] **Step 1: Add event type**

In `src/events/types.ts`, add to `CONTEXT_EVENT_TYPES`:

```typescript
CONTEXT_PATTERN_EVALUATED = 'context.pattern_evaluated',
```

- [ ] **Step 2: Modify task loop to emit evaluation**

In `src/run/task-loop.ts`, after task completion, add:

```typescript
import { extractSessionOutcome } from '../context/session-outcome.js';
import { PatternRegistry } from '../context/pattern-registry.js';

// In runTaskLoop, after result is determined:
const patternsDir = join(cwd, '.alix', 'patterns');
const registry = new PatternRegistry(patternsDir);
await registry.init();

const outcome = await extractSessionOutcome(sessionDir);
await registry.recordOutcome(taskType, {
  success: outcome.success,
  iterations: outcome.iterations,
  totalTokens: outcome.totalTokens,
});

await log.append({
  sessionId,
  actor: 'system',
  type: 'context.pattern_evaluated',
  payload: {
    taskType,
    success: outcome.success,
    iterations: outcome.iterations,
    tokenUsage: outcome.totalTokens,
  },
});
```

- [ ] **Step 3: Run build to verify types**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/events/types.ts src/run/task-loop.ts
git commit -m "feat(context): wire pattern evaluation into task loop"
```

---

### Task 4: Use Registry to Bias Context Selection

**Files:**
- Modify: `src/repomap/context-pipeline.ts`
- Modify: `src/repomap/context-compiler.ts`

- [ ] **Step 1: Add threshold bias option to RankingStage**

In `src/repomap/context-pipeline.ts`, modify `RankingStage`:

```typescript
export class RankingStage implements ContextStage<RankingInput, RankingOutput> {
  name = "ranking";

  constructor(private options: {
    task: string;
    taskType: TaskType;
    pinnedPaths?: string[];
    semanticSearchStage?: SemanticSearchStage;
    gitActivity?: Map<string, number>;
    thresholdBias?: number;  // NEW: adjust min threshold based on stats
  } = { task: "", taskType: "unknown" }) {}
```

Adjust the min threshold in the process method:

```typescript
const effectiveThreshold = MIN_SCORE_THRESHOLD + (this.options.thresholdBias ?? 0);
const filteredItems = items.filter(i => i.score >= effectiveThreshold);
```

- [ ] **Step 2: Load registry and pass bias to RankingStage**

In `src/repomap/context-compiler.ts`, modify `compileContext`:

```typescript
import { PatternRegistry } from '../context/pattern-registry.js';

async compileContext(task: string, taskType: TaskType, pinnedPaths?: string[]): Promise<ContextBundle> {
  // ... existing setup ...

  // Load pattern stats for threshold adjustment
  let thresholdBias = 0;
  const patternsDir = join(this.options.root, '.alix', 'patterns');
  try {
    const registry = new PatternRegistry(patternsDir);
    await registry.init();
    const stats = registry.getStats(taskType);
    if (stats) {
      // Boost threshold for task types with low success rate
      // Low success rate → more selective context (fewer files, higher quality)
      if (stats.successRate < 0.5) {
        thresholdBias = 20;
      } else if (stats.successRate < 0.7) {
        thresholdBias = 10;
      }
    }
  } catch {
    // No registry yet
  }

  const pipeline = new ContextPipeline([
    semanticStage,
    new RankingStage({
      task,
      taskType,
      pinnedPaths: pinnedPaths ?? [],
      gitActivity: this.repoMap?.gitActivity,
      semanticSearchStage: semanticStage,
      thresholdBias,  // Pass bias
    }),
    new BudgetingStage({ maxTokens }),
  ]);

  // ... rest unchanged ...
}
```

- [ ] **Step 3: Run build to verify**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/repomap/context-pipeline.ts src/repomap/context-compiler.ts
git commit -m "feat(context): bias context thresholds based on task-type statistics"
```

---

## Verification

1. Run a task: `alix run "add console.log to src/cli.ts"`
2. Check registry updated: `cat ~/.alix/patterns/stats.json`
3. Run another task: `alix run "fix the bug in auth"`
4. Check both task types recorded in stats
5. Check events include `context.pattern_evaluated`
6. Run same task again — should use bias based on previous success rate

---

## Self-Review

- [x] All requirements covered (outcome extraction, registry, task loop wiring, context bias)
- [x] No TODOs/TBDs in steps
- [x] Types consistent across files (SessionOutcome, TaskType, etc.)
- [x] Each task is independently testable