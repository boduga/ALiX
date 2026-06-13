# M0.73 — Observability and Performance Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define measurable latency budgets with per-environment ceilings, build a correlated `measurePhase()` helper for structured timing events, instrument RuntimeIndex/context/tool-routing with timing, surface timing events in RuntimeIndex and Inspector, and add `alix doctor --performance` for passive budget checking against stored benchmark data.

**Architecture:** Four layers — (1) `PerformanceBudget` type with warning/failure thresholds, environment context, and a typed budget store; (2) `measurePhase()` helper that emits correlated `runtime.phase.started`/`runtime.phase.completed` events with timingId, outcome, and error fields; (3) instrumentation of `buildRuntimeIndex()`, `applyPatch()`/tool routing, and context pipeline using `measurePhase()`; (4) `alix doctor --performance` reads the latest saved benchmark run and checks budgets passively (no new log files or sessions). Active re-measurement happens via `alix benchmark run --suite quick --check-budgets`.

**Tech Stack:** TypeScript, existing `EventLog.append()`, existing `buildRuntimeIndex()` from `runtime-index.ts`, existing `ToolAwareRouter`/`CompositeToolRouter`, existing `buildRepoMapLite()`, existing `PERFORMANCE_BUDGETS` from M0.71, `node:test`, `node:crypto` (randomUUID for timing correlation).

---

## File Structure

### Create
- `src/config/performance-budgets.ts` — `PerformanceBudget` type, warningMs/failureMs, `BudgetContext`, `checkBudget()`, `checkAllBudgets()`
- `src/runtime/timing-events.ts` — `measurePhase()` helper, `TimingEventPayload` type with timingId/operation/outcome/error/metadata
- `src/cli/commands/performance-doctor.ts` — `runPerformanceDoctor()` passive budget check CLI handler
- `tests/config/performance-budgets.test.ts`
- `tests/runtime/timing-events.test.ts`

### Modify
- `src/runtime/runtime-index.ts` — accept optional `eventLog`/`sessionId` options, wrap build in `measurePhase()`
- `src/repomap/context-pipeline.ts` or `src/repomap/repomap-lite.ts` — wrap compile in `measurePhase()`
- `src/tools/tool-router.ts` — wrap `ToolAwareRouter.execute()` in `measurePhase()`
- `src/runtime/runtime-index.ts` — add `runtime.phase.started/completed`, `tool.route.completed`, `context.compile.completed` to the session-event allowlist
- `src/server/server.ts` — add timing events to `VISIBLE_EVENTS` SSE array
- `src/cli.ts` — add small `--performance` dispatch to `performance-doctor.ts`
- `package.json` — add `test:observability` script (optional)

---

### Task 1: Performance Budget Types and Constants (environment-aware)

**Files:**
- Create: `src/config/performance-budgets.ts`
- Create: `tests/config/performance-budgets.test.ts`

- [ ] **Step 1: Create performance-budgets.ts**

```typescript
/**
 * performance-budgets.ts — Latency budgets for ALiX operations.
 *
 * Each budget has two thresholds:
 *   warningMs  — exceeded → non-fatal warning
 *   failureMs  — exceeded → hard failure
 *
 * Environments let CI and local workstations use different ceilings.
 */

export type BudgetEnvironment = "local" | "ci";

export type PerformanceBudget = {
  name: string;           // kebab-case, matches benchmark case names
  label: string;
  warningMs: number;      // exceeded → warning (non-fatal)
  failureMs: number;      // exceeded → failure
};

export type BudgetContext = {
  os: string;
  arch: string;
  profile?: string;
  environment: BudgetEnvironment;
};

export type BudgetStatus = "pass" | "warning" | "fail" | "unbudgeted";

export type BudgetResult = {
  name: string;
  label: string;
  actualMs: number;
  status: BudgetStatus;
  message: string;
};

// Default local budgets (CI budgets would be a separate profile)
export const PERFORMANCE_BUDGETS: PerformanceBudget[] = [
  { name: "cli-startup",     label: "CLI startup (--help)",              warningMs: 300,  failureMs: 800 },
  { name: "models-doctor",   label: "Hardware + model doctor",           warningMs: 1000, failureMs: 3000 },
  { name: "runtime-index",   label: "RuntimeIndex build + query",        warningMs: 300,  failureMs: 1000 },
  { name: "context-compile", label: "Context compilation (repo map)",     warningMs: 2000, failureMs: 5000 },
  { name: "daemon-submit",   label: "Daemon submit + ack",               warningMs: 50,   failureMs: 200 },
  { name: "no-tool-task",    label: "End-to-end no-tool task (mock)",    warningMs: 5000, failureMs: 15000 },
];

/** 
 * Check a single measurement against a budget.
 * Returns pass/warning/fail based on actualMs relative to thresholds.
 */
export function checkBudget(actualMs: number, budget: PerformanceBudget): BudgetResult {
  const rounded = Math.round(actualMs * 100) / 100;
  if (rounded > budget.failureMs) {
    return { name: budget.name, label: budget.label, actualMs: rounded, status: "fail", message: `${budget.label}: ${rounded} ms over failure budget ${budget.failureMs} ms ❌` };
  }
  if (rounded > budget.warningMs) {
    return { name: budget.name, label: budget.label, actualMs: rounded, status: "warning", message: `${budget.label}: ${rounded} ms (warning at ${budget.warningMs} ms) ⚠️` };
  }
  return { name: budget.name, label: budget.label, actualMs: rounded, status: "pass", message: `${budget.label}: ${rounded} ms ✅` };
}

/** 
 * Check all measurements against their budgets.
 * Unknown benchmark names return "unbudgeted" — they do not block.
 */
export function checkAllBudgets(
  measurements: Array<{ name: string; meanMs: number }>,
): BudgetResult[] {
  return measurements.map(m => {
    const budget = PERFORMANCE_BUDGETS.find(b => b.name === m.name);
    if (!budget) {
      return { name: m.name, label: m.name, actualMs: m.meanMs, status: "unbudgeted", message: `${m.name}: no budget configured` };
    }
    return checkBudget(m.meanMs, budget);
  });
}
```

- [ ] **Step 2: Write the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkBudget, checkAllBudgets, PERFORMANCE_BUDGETS } from "../../src/config/performance-budgets.js";

describe("PERFORMANCE_BUDGETS", () => {
  it("has the expected set of budgets", () => {
    const names = PERFORMANCE_BUDGETS.map(b => b.name).sort();
    assert.ok(names.includes("cli-startup"));
    assert.ok(names.includes("models-doctor"));
    assert.ok(names.includes("context-compile"));
  });

  it("all failureMs > warningMs", () => {
    for (const b of PERFORMANCE_BUDGETS) assert.ok(b.failureMs >= b.warningMs, `${b.name}: failureMs >= warningMs`);
  });
});

describe("checkBudget", () => {
  const budget = PERFORMANCE_BUDGETS.find(b => b.name === "cli-startup")!;

  it("pass when under warning threshold", () => {
    assert.equal(checkBudget(200, budget).status, "pass");
  });

  it("warning when between warning and failure", () => {
    assert.equal(checkBudget(500, budget).status, "warning");
  });

  it("fail when over failure threshold", () => {
    assert.equal(checkBudget(900, budget).status, "fail");
  });
});

describe("checkAllBudgets", () => {
  it("unbudgeted for unknown names", () => {
    const results = checkAllBudgets([{ name: "mystery-bench", meanMs: 999 }]);
    assert.equal(results[0].status, "unbudgeted");
  });

  it("returns results for matching names", () => {
    const r = checkAllBudgets([{ name: "cli-startup", meanMs: 200 }]);
    assert.equal(r.length, 1);
    assert.equal(r[0].status, "pass");
  });
});
```

- [ ] **Step 3: Build and test**

```bash
npm run build && node --test dist/tests/config/performance-budgets.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/config/performance-budgets.ts tests/config/performance-budgets.test.ts
git commit -m "feat(perf): add environment-aware performance budgets with warning/failure thresholds"
```

---

### Task 2: Correlated measurePhase() Helper

**Files:**
- Create: `src/runtime/timing-events.ts`
- Create: `tests/runtime/timing-events.test.ts`

- [ ] **Step 1: Create timing-events.ts**

```typescript
/**
 * timing-events.ts — Correlated timing events for ALiX operations.
 *
 * measurePhase() wraps any async operation and emits a started/completed
 * pair via EventLog with a shared timingId for correlation.
 *
 * On success: phase.completed includes durationMs and outcome:"success".
 * On failure: phase.completed includes durationMs, outcome:"failure", and error.
 * The original error is rethrown.
 */

import type { EventLog } from "../events/event-log.js";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

export type TimingMetadata = Record<string, string | number | boolean>;

export type TimingEventPayload = {
  timingId: string;
  operation: string;
  durationMs?: number;
  outcome?: "success" | "failure";
  error?: string;
  metadata?: TimingMetadata;
};

/**
 * Wrapper that emits runtime.phase.started, runs work, emits
 * runtime.phase.completed, and rethrows on failure.
 *
 * When log is undefined, runs work without instrumentation.
 */
export async function measurePhase<T>(
  log: EventLog | undefined,
  sessionId: string,
  operation: string,
  work: () => Promise<T>,
  metadata?: TimingMetadata,
): Promise<T> {
  if (!log) return work();

  const timingId = randomUUID();
  await log.append({
    sessionId,
    actor: "system",
    type: "runtime.phase.started",
    payload: { timingId, operation, metadata } as TimingEventPayload,
  });

  const startTime = performance.now();
  try {
    const result = await work();
    const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
    await log.append({
      sessionId,
      actor: "system",
      type: "runtime.phase.completed",
      payload: { timingId, operation, durationMs, outcome: "success", metadata } as TimingEventPayload,
    });
    return result;
  } catch (e: any) {
    const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
    await log.append({
      sessionId,
      actor: "system",
      type: "runtime.phase.completed",
      payload: { timingId, operation, durationMs, outcome: "failure", error: e.message || String(e), metadata } as TimingEventPayload,
    });
    throw e;
  }
}
```

- [ ] **Step 2: Write the test file using clock injection**

```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventLog } from "../../src/events/event-log.js";

describe("measurePhase", () => {
  let dir: string;
  let log: EventLog;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "measure-test-"));
    log = new EventLog(dir);
    await log.init();
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("emits started + completed on success", async () => {
    const { measurePhase } = await import("../../src/runtime/timing-events.js");
    const result = await measurePhase(log, "s1", "test.op", async () => "hello");
    assert.equal(result, "hello", "returns the work result");
    const events = await log.readAll();
    const started = events.filter((e: any) => e.type === "runtime.phase.started");
    const completed = events.filter((e: any) => e.type === "runtime.phase.completed");
    assert.equal(started.length, 1);
    assert.equal(completed.length, 1);
    assert.equal(completed[0].payload.outcome, "success");
    assert.ok(completed[0].payload.durationMs >= 0);
  });

  it("emits completed with failure and rethrows on error", async () => {
    const { measurePhase } = await import("../../src/runtime/timing-events.js");
    await assert.rejects(
      () => measurePhase(log, "s1", "failing.op", async () => { throw new Error("boom"); }),
      /boom/,
    );
    const events = await log.readAll();
    const completed = events.filter((e: any) => e.type === "runtime.phase.completed");
    assert.equal(completed.length, 1);
    assert.equal(completed[0].payload.outcome, "failure");
    assert.equal(completed[0].payload.error, "boom");
  });

  it("timingId matches between started and completed", async () => {
    const { measurePhase } = await import("../../src/runtime/timing-events.js");
    await measurePhase(log, "s1", "correlated.op", async () => {});
    const events = await log.readAll();
    const started = events.find((e: any) => e.type === "runtime.phase.started");
    const completed = events.find((e: any) => e.type === "runtime.phase.completed");
    assert.equal(completed.payload.timingId, started.payload.timingId);
  });

  it("skips instrumentation when log is undefined", async () => {
    const { measurePhase } = await import("../../src/runtime/timing-events.js");
    const result = await measurePhase(undefined, "s1", "unlogged", async () => 42);
    assert.equal(result, 42);
    const events = await log.readAll();
    const phaseEvents = events.filter((e: any) => e.type.startsWith("runtime.phase."));
    assert.equal(phaseEvents.length, 0, "no timing events when log undefined");
  });
});
```

- [ ] **Step 3: Build and test**

```bash
npm run build && node --test dist/tests/runtime/timing-events.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/runtime/timing-events.ts tests/runtime/timing-events.test.ts
git commit -m "feat(observability): add correlated measurePhase() helper with timingId and outcome"
```

---

### Task 3: Instrument RuntimeIndex with measurePhase()

**Files:**
- Modify: `src/runtime/runtime-index.ts`

- [ ] **Step 1: Add options parameter to buildRuntimeIndex**

Read the current `buildRuntimeIndex` signature and add an optional options parameter:

```typescript
export type RuntimeIndexOptions = {
  eventLog?: EventLog;
  sessionId?: string;
};

export async function buildRuntimeIndex(
  cwd: string,
  options: RuntimeIndexOptions = {},
): Promise<RuntimeIndex> {
```

Then wrap the implementation in `measurePhase()`:

```typescript
// Top of file: add import
import { measurePhase } from "./timing-events.js";

// Inside body, after the options destructuring:
export async function buildRuntimeIndex(
  cwd: string,
  options: RuntimeIndexOptions = {},
): Promise<RuntimeIndex> {
  return measurePhase(
    options.eventLog,
    options.sessionId ?? "system",
    "runtime-index.build",
    async () => {
      // ... existing implementation unchanged ...
    },
  );
}
```

- [ ] **Step 2: Add timing event types to the session-event allowlist**

Find the event-type allowlist used by `buildRuntimeIndex` for session file scanning. Add:
```typescript
"runtime.phase.started",
"runtime.phase.completed",
```

- [ ] **Step 3: Commit**

```bash
git add src/runtime/runtime-index.ts
git commit -m "feat(observability): instrument buildRuntimeIndex with measurePhase and add timing events to allowlist"
```

---

### Task 4: Instrument Tool Router and Context Compile

**Files:**
- Modify: `src/tools/tool-router.ts` (ToolAwareRouter.execute)
- Modify: `src/repomap/repomap-lite.ts` (buildRepoMapLite)

- [ ] **Step 1: Add measurePhase to ToolAwareRouter.execute**

In `src/tools/tool-router.ts`, import `measurePhase` and wrap the execute delegation:

```typescript
import { measurePhase } from "../runtime/timing-events.js";

// In ToolAwareRouter class:
// Add an optional eventLog parameter to the constructor

async execute(request: ToolCallRequest): Promise<ToolResult> {
  if (this.currentIntent.length > 0 && !this.canHandle(request.name)) {
    return { kind: "error", message: `Tool "${request.name}" is not available for the current task intent`, retryable: false };
  }
  return measurePhase(
    this.eventLog,
    this.sessionId ?? "system",
    `tool.route.${request.name}`,
    () => this.downstream.execute(request),
  );
}
```

Add constructor parameter:
```typescript
constructor(
  readonly downstream: ToolRouter,
  private eventLog?: EventLog,
  private sessionId?: string,
) { ... }
```

- [ ] **Step 2: Add measurePhase to buildRepoMapLite**

In `src/repomap/repomap-lite.ts`:
```typescript
import { measurePhase } from "../runtime/timing-events.js";

export async function buildRepoMapLite(
  cwd: string,
  options?: { eventLog?: EventLog; sessionId?: string },
): Promise<RepoMapResult | null> {
  return measurePhase(
    options?.eventLog,
    options?.sessionId ?? "system",
    "context.compile",
    async () => {
      // ... existing implementation ...
    },
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/tool-router.ts src/repomap/repomap-lite.ts
git commit -m "feat(observability): instrument ToolAwareRouter and buildRepoMapLite with measurePhase"
```

---

### Task 5: Surface Timing Events in Inspector SSE

**Files:**
- Modify: `src/server/server.ts`

- [ ] **Step 1: Add timing events to VISIBLE_EVENTS**

Find the `VISIBLE_EVENTS` array in `src/server/server.ts` and add:
```typescript
"runtime.phase.started",
"runtime.phase.completed",
```

- [ ] **Step 2: Commit**

```bash
git add src/server/server.ts
git commit -m "feat(observability): add timing events to Inspector SSE visibility list"
```

---

### Task 6: `alix doctor --performance` CLI (Passive Budget Check)

**Files:**
- Create: `src/cli/commands/performance-doctor.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create performance-doctor.ts**

```typescript
/**
 * performance-doctor.ts — Passive budget check against stored benchmarks.
 *
 * Reads the latest saved benchmark run from .alix/benchmarks/ and
 * checks each measurement against its performance budget.
 * Does NOT run new benchmarks — use alix benchmark run for that.
 *
 * Returns a numeric exit code: 0 = pass, 1 = fail/warning, 2 = no data.
 */

import { loadPreviousRuns } from "../../benchmark/benchmark-runner.js";
import { checkAllBudgets } from "../../config/performance-budgets.js";

export async function runPerformanceDoctor(cwd: string): Promise<number> {
  const runs = loadPreviousRuns(cwd);
  if (runs.length === 0) {
    console.log("No benchmark data found. Run: alix benchmark run --suite quick");
    return 2;
  }

  // Use the most recent run
  const latest = runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  console.log(`Checking budgets against ${latest.runId} (${latest.createdAt})\n`);

  const results = checkAllBudgets(latest.results);
  let hasFailure = false;
  let hasWarning = false;

  for (const r of results) {
    if (r.status === "fail") hasFailure = true;
    if (r.status === "warning") hasWarning = true;
    console.log(`  ${r.message}`);
  }

  if (hasFailure) {
    console.log("\n  ❌ Some budgets exceeded — review data or tune thresholds.");
    return 1;
  }
  if (hasWarning) {
    console.log("\n  ⚠️  Some budgets in warning range.");
    return 0; // Warnings don't block
  }
  console.log("\n  ✅ All budgets pass.");
  return 0;
}
```

- [ ] **Step 2: Add dispatch in src/cli.ts**

Find the `alix doctor` command block and add at the top:
```typescript
if (command === "doctor") {
  if (args.includes("--performance")) {
    const { runPerformanceDoctor } = await import("./cli/commands/performance-doctor.js");
    process.exit(await runPerformanceDoctor(process.cwd()));
  }
  // ... existing doctor logic ...
```

- [ ] **Step 3: Add help text**

```
  alix doctor --performance     Check latest benchmark data against performance budgets
```

- [ ] **Step 4: Build and smoke test**

```bash
npm run build && node dist/src/cli.js doctor --performance
```
Expected: if no benchmark data, prints message and exits 2

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/performance-doctor.ts src/cli.ts
git commit -m "feat(cli): add alix doctor --performance for passive budget checking"
```

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/config/performance-budgets.test.js` — all pass
3. `node --test dist/tests/runtime/timing-events.test.js` — all pass (including error emission and undefined-log guard)
4. `node dist/src/cli.js doctor --performance` — passive check (no data exits 2, data prints budget status)
5. Per CLAUDE.md: `mcp__gitnexus__detect_changes` — verify only intended files changed
