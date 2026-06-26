# P10.5c — Automatic Outcome Evaluation Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a best-effort, idempotent automatic outcome-evaluation hook into `ExecutionEngine` that fires when a plan reaches a terminal status.

**Architecture:** `OutcomeEvaluationHook` interface (`run() → Promise<void>`) implemented by `AutomaticOutcomeEvaluator`. Hook fires after durable state commit + evidence emission in `maybeCompletePlan()`. Idempotency keyed by `(planId, terminalTimestamp)` via shared `buildOutcomeReportId()` helper.

**Tech Stack:** TypeScript, Vitest, existing P10.5a/P10.5b/P10.4a infrastructure.

## Global Constraints

- `evaluatePlanOutcome()` is NOT modified — its return value is never mutated
- `OutcomeReportStore` gains an `OutcomeReportIntegrityError` class + uses shared `buildOutcomeReportId()` from its own module
- The hook fires **after** the durable state commit and the existing `recordExecutivePlanCompleted()` evidence call
- The hook is awaited inside `maybeCompletePlan()` and wrapped in try/catch — engine returns the same result regardless of hook outcome
- Idempotency scoped to `(planId, terminalTimestamp)` — replay never creates duplicates
- `outcomeStore.load()` throws `OutcomeReportIntegrityError` on hash mismatch / invalid schema / malformed JSON; the hook **never overwrites** corrupted artifacts
- `terminalTimestamp = state.timestamps.completedAt ?? state.timestamps.failedAt`; `completedAt` wins if both present
- If `terminalTimestamp` is missing → `console.warn` to stderr and skip (no `new Date()` fallback — would break idempotency)
- Missing baseline/current snapshots still produce a report with `evaluationStatus: "insufficient_data"`
- No new evidence types
- No protected type files (ADR-0004)
- New files added to executive purity sentinel allowlist
- `OutcomeEvaluationHook.run()` always returns `Promise<void>` (no sync variant)

---

### Task 0: Create feature branch

- [ ] **Step 1: Create and push the feature branch**

```bash
git checkout -b feature/p10-5c-automatic-evaluation-hook
git push -u origin feature/p10-5c-automatic-evaluation-hook
```

---

### Task 1: Shared `buildOutcomeReportId` helper + `OutcomeReportIntegrityError` class

**Files:**
- Create: `src/executive/outcome-report-id.ts`
- Modify: `src/executive/outcome-store.ts`
- Create: `tests/executive/outcome-report-id.vitest.ts`

**Interfaces:**
- Produces: `buildOutcomeReportId(planId, generatedAt) → string`
- Produces: `OutcomeReportIntegrityError` class
- Produces (modify): `OutcomeReportStore.save()` uses the shared helper

- [ ] **Step 1: Write the failing test for `buildOutcomeReportId`**

Create `tests/executive/outcome-report-id.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildOutcomeReportId } from "../../src/executive/outcome-report-id.js";

describe("buildOutcomeReportId", () => {
  it("produces sanitized ID from planId and ISO timestamp", () => {
    expect(buildOutcomeReportId("plan-abc", "2026-06-25T12:00:00.000Z"))
      .toBe("outcome-plan-abc-20260625T120000000Z");
  });

  it("strips dashes, colons, and dots from the timestamp", () => {
    expect(buildOutcomeReportId("plan-1", "2026-01-01T00:00:00.000Z"))
      .toBe("outcome-plan-1-20260101T000000000Z");
  });

  it("preserves planId verbatim (assumes planIds are filesystem-safe)", () => {
    expect(buildOutcomeReportId("plan_with_underscores", "2026-06-25T12:00:00.000Z"))
      .toBe("outcome-plan_with_underscores-20260625T120000000Z");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/executive/outcome-report-id.vitest.ts
```

Expected: FAIL with "Cannot find module" for `outcome-report-id.js`.

- [ ] **Step 3: Create the helper module**

Create `src/executive/outcome-report-id.ts`:

```ts
/**
 * P10.5c — Shared outcome report ID helper.
 *
 * Used by both `OutcomeReportStore` (for filename generation) and the
 * automatic evaluation hook (for idempotency checks). Keeping ID generation
 * in a single module guarantees the idempotency key and the saved filename
 * never drift.
 *
 * @module
 */

/**
 * Sanitize an ISO-8601 timestamp into a filesystem-safe form:
 *   "2026-06-25T12:00:00.000Z" → "20260625T120000000Z"
 */
function sanitizeTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(".", "");
}

/**
 * Build a deterministic report ID from planId and timestamp.
 *   buildOutcomeReportId("plan-abc", "2026-06-25T12:00:00.000Z")
 *     === "outcome-plan-abc-20260625T120000000Z"
 */
export function buildOutcomeReportId(planId: string, generatedAt: string): string {
  return `outcome-${planId}-${sanitizeTimestamp(generatedAt)}`;
}
```

- [ ] **Step 4: Update `OutcomeReportStore` to use the shared helper**

Modify `src/executive/outcome-store.ts`:

1. Add import:
```ts
import { buildOutcomeReportId } from "./outcome-report-id.js";
```

2. Remove the local `sanitizeTimestamp()` and `buildReportId()` helper functions (lines 56-62).

3. Add the `OutcomeReportIntegrityError` class before the `OutcomeReportStore` class:
```ts
/**
 * Thrown by OutcomeReportStore.load() when the persisted report's integrity
 * cannot be verified: contentHash mismatch, malformed JSON, or unknown
 * schema version. Used by callers to detect and preserve corrupted audit
 * artifacts instead of overwriting them.
 */
export class OutcomeReportIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutcomeReportIntegrityError";
  }
}
```

4. Update `save()` to use the imported helper:
```ts
  save(report: ExecutiveOutcomeEvaluationReport): string {
    const id = buildOutcomeReportId(report.planId, report.generatedAt);
    // ... rest unchanged
  }
```

5. Update `load()` to throw `OutcomeReportIntegrityError`:
```ts
  load(reportId: string): ExecutiveOutcomeEvaluationReport | null {
    const targetPath = join(this.dir, `${reportId}.json`);
    if (!existsSync(targetPath)) return null;

    const raw = readFileSync(targetPath, "utf-8");
    let parsed: PersistedOutcomeReport;
    try {
      parsed = JSON.parse(raw) as PersistedOutcomeReport;
    } catch {
      throw new OutcomeReportIntegrityError(
        `Outcome report ${reportId}: invalid JSON`,
      );
    }

    if (parsed.schemaVersion !== "p10.5b.0") {
      throw new OutcomeReportIntegrityError(
        `Outcome report ${reportId}: unknown schemaVersion "${parsed.schemaVersion}"`,
      );
    }

    const expectedHash = sha256(JSON.stringify(parsed.report));
    if (parsed.contentHash !== expectedHash) {
      throw new OutcomeReportIntegrityError(
        `Outcome report ${reportId}: contentHash mismatch — expected ${expectedHash}, got ${parsed.contentHash}`,
      );
    }

    return parsed.report;
  }
```

- [ ] **Step 5: Update the existing store test for the new error type**

Modify `tests/executive/outcome-store.vitest.ts` to update the two `expect(() => ...).toThrow(...)` calls — they no longer match the generic `Error` shape, so they should keep working (the new error extends Error). Verify by running:

```bash
npx vitest run tests/executive/outcome-store.vitest.ts
```

Expected: All 9 tests still pass.

If any test fails because it asserts against the old error message format, update it to expect the new format (e.g., "contentHash mismatch" without the leading "Outcome report" prefix is fine; the test uses `toThrow(/contentHash|integrity|mismatch/i)` which still matches).

- [ ] **Step 6: Run all tests to verify**

```bash
npx vitest run tests/executive/outcome-report-id.vitest.ts
npx vitest run tests/executive/outcome-store.vitest.ts
```

Expected: All passing.

- [ ] **Step 7: Commit**

```bash
git add src/executive/outcome-report-id.ts src/executive/outcome-store.ts tests/executive/outcome-report-id.vitest.ts
git commit -m "feat(p10-5c): shared buildOutcomeReportId + OutcomeReportIntegrityError"
```

---

### Task 2: AutomaticOutcomeEvaluator + unit tests

**Files:**
- Create: `src/executive/automatic-outcome-hook.ts`
- Modify: `tests/executive/executive-sentinels.vitest.ts` (add file to allowlist)
- Create: `tests/executive/automatic-outcome-hook.vitest.ts`

**Interfaces:**
- Produces: `OutcomeEvaluationHook` interface (`run(plan, state): Promise<void>`)
- Produces: `AutomaticOutcomeEvaluator` class

- [ ] **Step 1: Update sentinel allowlist**

Modify `tests/executive/executive-sentinels.vitest.ts`:

Add to `EXECUTIVE_FILES` array (after the P10.5b entry):
```ts
  // P10.5b files
  "src/executive/outcome-store.ts",
  "src/executive/outcome-report-id.ts",
  // P10.5c files
  "src/executive/automatic-outcome-hook.ts",
  // P10.5a files
  "src/executive/outcome-evaluator.ts",
```

Modify the scoped write-exception to include `outcome-store.ts` and `automatic-outcome-hook.ts`:
```ts
            if ((file === "src/executive/plan-store.ts" ||
                 file === "src/executive/execution-state-store.ts" ||
                 file === "src/executive/outcome-store.ts" ||
                 file === "src/executive/automatic-outcome-hook.ts") &&
                (forbidden === "writeFileSync" || forbidden === "mkdirSync" ||
                 forbidden === "renameSync" || forbidden === "openSync" ||
                 forbidden === "fsyncSync" || forbidden === "closeSync")) {
              continue;
            }
```

- [ ] **Step 2: Write the failing unit tests**

Create `tests/executive/automatic-outcome-hook.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AutomaticOutcomeEvaluator } from "../../src/executive/automatic-outcome-hook.js";
import { OutcomeReportStore } from "../../src/executive/outcome-store.js";
import { ExecutiveTrendStore } from "../../src/executive/trend-store.js";
import { evaluatePlanOutcome } from "../../src/executive/outcome-evaluator.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "../../src/executive/executive-plan-types.js";
import type { ExecutiveTrendSnapshot } from "../../src/executive/trend-store.js";

// Spy on evaluatePlanOutcome so we can verify call without setting up a full plan
vi.mock("../../src/executive/outcome-evaluator.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/executive/outcome-evaluator.js")>(
    "../../src/executive/outcome-evaluator.js",
  );
  return {
    ...actual,
    evaluatePlanOutcome: vi.fn(actual.evaluatePlanOutcome),
  };
});

function makePlan(planId: string, generatedAt: string): PersistedExecutionPlan {
  return {
    id: planId,
    steps: [
      {
        id: "s1",
        stepNumber: 1,
        title: "Test",
        action: "diagnose_root_cause",
        objectiveId: "obj-1",
        targetSubsystem: "workflow",
        riskLevel: "medium",
        priorityScore: 50,
        objectiveScore: 50,
        status: "pending",
        dependsOn: [],
      },
    ],
    objectives: ["obj-1"],
    generatedAt,
    windowDays: 7,
    planStatus: "draft",
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    contentHash: "hash",
  };
}

function makeCompletedState(planId: string, completedAt: string): PlanExecutionState {
  return {
    planId,
    status: "completed",
    approval: { status: "approved" },
    stepStates: {},
    planTransitions: [],
    timestamps: { createdAt: completedAt, completedAt },
  };
}

function makeFailedState(planId: string, failedAt: string): PlanExecutionState {
  return {
    planId,
    status: "failed",
    approval: { status: "approved" },
    stepStates: {},
    planTransitions: [],
    timestamps: { createdAt: failedAt, failedAt },
  };
}

function makeTrendSnapshot(generatedAt: string): ExecutiveTrendSnapshot {
  return {
    id: `snap-${generatedAt}`,
    generatedAt,
    windowDays: 7,
    subsystemScores: { workflow: 50 },
  };
}

describe("AutomaticOutcomeEvaluator", () => {
  let tmpDir: string;
  let execDir: string;
  let outcomeStore: OutcomeReportStore;
  let trendStore: ExecutiveTrendStore;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "auto-outcome-"));
    execDir = join(tmpDir, ".alix", "executive");
    const outcomesDir = join(execDir, "outcomes");
    const trendsDir = join(execDir, "trends");
    mkdirSync(outcomesDir, { recursive: true });
    mkdirSync(trendsDir, { recursive: true });
    outcomeStore = new OutcomeReportStore(outcomesDir);
    trendStore = new ExecutiveTrendStore(execDir);
    trendStore.save(makeTrendSnapshot("2026-06-15T00:00:00.000Z")).catch(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(evaluatePlanOutcome).mockClear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper to create a ts directory
  function mkdirSync(p: string, opts: { recursive?: boolean } = {}) {
    const { mkdirSync: ms } = require("node:fs");
    ms(p, opts);
  }

  it("evaluates and saves a report when plan status is completed", async () => {
    const plan = makePlan("p1", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p1", "2026-06-15T12:00:00.000Z");
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    await evaluator.run(plan, state);

    expect(evaluatePlanOutcome).toHaveBeenCalledOnce();
    const reports = outcomeStore.list();
    expect(reports.length).toBe(1);
    expect(reports[0].planId).toBe("p1");
    expect(reports[0].evaluationStatus).toBe("completed");
  });

  it("evaluates and saves when status is failed", async () => {
    const plan = makePlan("p2", "2026-06-10T00:00:00.000Z");
    const state = makeFailedState("p2", "2026-06-15T13:00:00.000Z");
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    await evaluator.run(plan, state);

    expect(reports_after_run(outcomeStore).length).toBe(1);
  });

  it("uses completedAt as terminalTimestamp when both completedAt and failedAt are present", async () => {
    const plan = makePlan("p3", "2026-06-10T00:00:00.000Z");
    const state: PlanExecutionState = {
      ...makeFailedState("p3", "2026-06-15T13:00:00.000Z"),
      timestamps: {
        createdAt: "2026-06-10T00:00:00.000Z",
        completedAt: "2026-06-15T12:00:00.000Z",
        failedAt: "2026-06-15T13:00:00.000Z",
      },
    };
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    await evaluator.run(plan, state);

    // The filename should encode completedAt, not failedAt
    const files = require("node:fs").readdirSync(join(execDir, "outcomes")) as string[];
    expect(files.some(f => f.includes("20260615T120000000Z"))).toBe(true);
    expect(files.some(f => f.includes("20260615T130000000Z"))).toBe(false);
  });

  it("skips and warns when terminalTimestamp is missing", async () => {
    const plan = makePlan("p4", "2026-06-10T00:00:00.000Z");
    const state: PlanExecutionState = {
      ...makeCompletedState("p4", "2026-06-15T12:00:00.000Z"),
      timestamps: { createdAt: "2026-06-10T00:00:00.000Z" }, // no completedAt, no failedAt
    };
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    await evaluator.run(plan, state);

    expect(evaluatePlanOutcome).not.toHaveBeenCalled();
    expect(reports_after_run(outcomeStore).length).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("terminal timestamp"));
  });

  it("skips when a report already exists for the same (planId, terminalTimestamp) — idempotent", async () => {
    const plan = makePlan("p5", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p5", "2026-06-15T12:00:00.000Z");
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    await evaluator.run(plan, state);
    await evaluator.run(plan, state);
    await evaluator.run(plan, state);

    expect(evaluatePlanOutcome).toHaveBeenCalledOnce();
    expect(reports_after_run(outcomeStore).length).toBe(1);
  });

  it("does not mutate the report returned by evaluatePlanOutcome", async () => {
    const plan = makePlan("p6", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p6", "2026-06-15T12:00:00.000Z");
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    // Spy on the report returned by the evaluator
    const realEvaluate = vi.mocked(evaluatePlanOutcome).getMockImplementation();
    let capturedReport: any = null;
    vi.mocked(evaluatePlanOutcome).mockImplementation((...args: any[]) => {
      const result = realEvaluate!(...args);
      capturedReport = result;
      return result;
    });

    await evaluator.run(plan, state);

    // The captured report (from the evaluator) should NOT have its generatedAt
    // modified to match the terminalTimestamp
    expect(capturedReport.generatedAt).not.toBe(state.timestamps.completedAt);
    expect(reports_after_run(outcomeStore)[0].generatedAt).toBe(state.timestamps.completedAt);
  });

  it("does NOT overwrite a corrupted audit artifact (OutcomeReportIntegrityError)", async () => {
    const plan = makePlan("p7", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p7", "2026-06-15T12:00:00.000Z");
    const reportId = `outcome-p7-${"2026-06-15T12:00:00.000Z".replace(/[-:]/g, "").replace(".", "")}`;
    const corruptPath = join(execDir, "outcomes", `${reportId}.json`);

    // Write a file with valid JSON but invalid contentHash
    writeFileSync(
      corruptPath,
      JSON.stringify({
        schemaVersion: "p10.5b.0",
        id: reportId,
        contentHash: "0000000000000000000000000000000000000000000000000000000000000000",
        report: { ...plan, planStatus: "completed", evaluationStatus: "completed", baselineSnapshotId: undefined, currentSnapshotId: undefined, baselineGeneratedAt: undefined, currentGeneratedAt: undefined, evaluatedSubsystems: [], objectives: [], overallDelta: 0, warnings: [] },
      }),
      "utf-8",
    );
    const originalContent = readFileSync(corruptPath, "utf-8");

    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);
    await evaluator.run(plan, state);

    // File must NOT have been overwritten
    expect(readFileSync(corruptPath, "utf-8")).toBe(originalContent);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("integrity"));
  });

  it("save failures do not throw — only warn", async () => {
    const plan = makePlan("p8", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p8", "2026-06-15T12:00:00.000Z");
    // Use a store pointing to an unwritable directory
    const badStore = new OutcomeReportStore("/nonexistent/path/cannot/write");
    const evaluator = new AutomaticOutcomeEvaluator(badStore, trendStore);

    await expect(evaluator.run(plan, state)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

function reports_after_run(store: OutcomeReportStore) {
  return store.list();
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/executive/automatic-outcome-hook.vitest.ts
```

Expected: All tests fail — module doesn't exist.

- [ ] **Step 4: Implement `AutomaticOutcomeEvaluator`**

Create `src/executive/automatic-outcome-hook.ts`:

```ts
/**
 * P10.5c — Automatic Outcome Evaluation Hook.
 *
 * Bridges ExecutionEngine to OutcomeReportStore. When a plan reaches
 * a terminal status (completed or failed), the engine calls this hook
 * which evaluates the plan via the pure evaluator and persists the
 * report. Idempotent: keyed by (planId, terminalTimestamp).
 *
 * Best-effort: never throws upward. Integrity errors from
 * OutcomeReportStore.load() are caught and the existing artifact is
 * preserved (no overwrite).
 *
 * @module
 */

import { evaluatePlanOutcome } from "./outcome-evaluator.js";
import type { ExecutiveOutcomeEvaluationReport } from "./outcome-evaluator.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "./executive-plan-types.js";
import { OutcomeReportStore, OutcomeReportIntegrityError } from "./outcome-store.js";
import { ExecutiveTrendStore } from "./trend-store.js";
import { buildOutcomeReportId } from "./outcome-report-id.js";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface OutcomeEvaluationHook {
  run(
    plan: PersistedExecutionPlan,
    state: PlanExecutionState,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AutomaticOutcomeEvaluator implements OutcomeEvaluationHook {
  constructor(
    private readonly outcomeStore: OutcomeReportStore,
    private readonly trendStore: ExecutiveTrendStore,
  ) {}

  async run(
    plan: PersistedExecutionPlan,
    state: PlanExecutionState,
  ): Promise<void> {
    try {
      // 1. Determine terminalTimestamp (completedAt wins over failedAt)
      const terminalTimestamp =
        state.timestamps.completedAt ?? state.timestamps.failedAt;

      if (!terminalTimestamp) {
        console.warn(
          `[automatic-outcome-hook] Plan ${plan.id} reached status "${state.status}" but has no terminal timestamp — skipping auto-evaluation`,
        );
        return;
      }

      // 2. Idempotency check — preserve existing audit artifacts
      const reportId = buildOutcomeReportId(plan.id, terminalTimestamp);
      let existing: ExecutiveOutcomeEvaluationReport | null = null;
      try {
        existing = this.outcomeStore.load(reportId);
      } catch (e) {
        if (e instanceof OutcomeReportIntegrityError) {
          // Forensic preservation: never overwrite a corrupted audit artifact
          console.warn(
            `[automatic-outcome-hook] Outcome report ${reportId} failed integrity verification — preserving existing artifact: ${e.message}`,
          );
          return;
        }
        // Unexpected runtime error: warn but don't block the plan
        console.warn(
          `[automatic-outcome-hook] Unexpected load error for ${reportId} — skipping: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }

      if (existing) {
        // Already evaluated for this terminal transition — idempotent no-op
        return;
      }

      // 3. Evaluate the plan using the pure evaluator
      const baseline = await this.trendStore.findBaseline(plan.generatedAt);
      const current = await this.trendStore.loadLatest();
      const evaluated = evaluatePlanOutcome(plan, state, baseline, current);

      // 4. Build a new report object with deterministic timestamp —
      //    never mutate the evaluator's return value
      const report: ExecutiveOutcomeEvaluationReport = {
        ...evaluated,
        generatedAt: terminalTimestamp,
      };

      // 5. Persist
      this.outcomeStore.save(report);
    } catch (e) {
      // Best-effort: never block plan completion
      console.warn(
        `[automatic-outcome-hook] Auto-evaluation failed for plan ${plan.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a default AutomaticOutcomeEvaluator from a base directory.
 * Uses the standard executive directory layout (.alix/executive/{outcomes,trends}).
 */
export function createAutomaticOutcomeEvaluator(
  executiveDir: string,
): AutomaticOutcomeEvaluator {
  const outcomesDir = join(executiveDir, "outcomes");
  const trendsDir = join(executiveDir, "trends");
  return new AutomaticOutcomeEvaluator(
    new OutcomeReportStore(outcomesDir),
    new ExecutiveTrendStore(executiveDir),
  );
}
```

Note: We use `ExecutiveTrendStore(executiveDir)` because its constructor takes the base exec dir and reads/writes `trends.jsonl` inside it. Check the constructor signature in `trend-store.ts` first; if it differs, adjust accordingly.

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/executive/automatic-outcome-hook.vitest.ts
```

Expected: All tests passing (or a few may need adjustment — see Step 6).

- [ ] **Step 6: Adjust test helper if needed**

If `mkdirSync` import in the test (in the inline helper) conflicts with the existing import, remove the inline helper and use the top-level import. Also verify the `mkdirSync` recursive option works (Node 12+).

If the `findBaseline` test setup needs a trend snapshot with a generatedAt <= plan.generatedAt, the test's setup with one snapshot at "2026-06-15T00:00:00.000Z" and plan generatedAt "2026-06-10T00:00:00.000Z" should work. If not, add a baseline snapshot.

- [ ] **Step 7: Verify sentinel test passes**

```bash
npx vitest run tests/executive/executive-sentinels.vitest.ts
```

Expected: All sentinel tests pass (no purity violation for `automatic-outcome-hook.ts`).

- [ ] **Step 8: Commit**

```bash
git add src/executive/automatic-outcome-hook.ts tests/executive/automatic-outcome-hook.vitest.ts tests/executive/executive-sentinels.vitest.ts
git commit -m "feat(p10-5c): add AutomaticOutcomeEvaluator + idempotent hook"
```

---

### Task 3: Wire hook into ExecutionEngine + integration tests

**Files:**
- Modify: `src/executive/execution-engine.ts`
- Create or modify: `tests/executive/execution-engine-apply-dispatch.vitest.ts` (or equivalent) — add auto-evaluation integration tests

**Interfaces:**
- Consumes: `OutcomeEvaluationHook` interface from Task 2
- Produces: `ExecutionEngine` constructor accepts optional hook

- [ ] **Step 1: Find an existing integration test file for the engine**

```bash
ls tests/executive/execution-engine*.vitest.ts
```

Find the appropriate file (likely `execution-engine-apply-dispatch.vitest.ts` or similar). We'll append the integration tests there.

- [ ] **Step 2: Write the failing integration tests**

Append to the appropriate engine test file:

```ts
import { AutomaticOutcomeEvaluator } from "../../../src/executive/automatic-outcome-hook.js";

describe("ExecutionEngine auto-evaluation hook", () => {
  // ... existing setup helpers ...

  it("fires the outcome hook on plan completion (integration)", async () => {
    // Setup: create plan + state + trends
    const hookFired = { count: 0, planIds: [] as string[] };
    const hook: OutcomeEvaluationHook = {
      async run(plan, _state) {
        hookFired.count++;
        hookFired.planIds.push(plan.id);
      },
    };
    const engine = new ExecutionEngine(planStore, stateStore, runner, writer, hook);

    // ... trigger plan to completion (existing pattern) ...

    expect(hookFired.count).toBe(1);
    expect(hookFired.planIds).toContain(plan.id);
  });

  it("does NOT call hook.run() when plan is already in completed status", async () => {
    const hookFired = { count: 0 };
    const hook: OutcomeEvaluationHook = { async run() { hookFired.count++; } };
    const engine = new ExecutionEngine(planStore, stateStore, runner, writer, hook);

    // Setup a plan with status === "completed" already
    // ... run ready steps ...
    // Hook should NOT fire (idempotent at the engine level too — already completed)
  });

  it("hook failure does not block plan completion", async () => {
    const failingHook: OutcomeEvaluationHook = {
      async run() { throw new Error("boom"); },
    };
    const engine = new ExecutionEngine(planStore, stateStore, runner, writer, failingHook);

    // Run a complete plan
    // ... assertions ...
    // Plan should reach completed state regardless of hook failure
  });

  it("corrupted existing report is preserved — engine does not overwrite", async () => {
    // Setup: pre-existing report file with bad contentHash for the
    // would-be terminal timestamp
    const outcomesDir = join(execDir, "outcomes");
    mkdirSync(outcomesDir, { recursive: true });
    const reportId = buildOutcomeReportId(plan.id, completedAt);
    writeFileSync(join(outcomesDir, `${reportId}.json`), JSON.stringify({
      schemaVersion: "p10.5b.0",
      id: reportId,
      contentHash: "badhash",
      report: { /* whatever */ },
    }), "utf-8");
    const originalContent = readFileSync(join(outcomesDir, `${reportId}.json`), "utf-8");

    const engine = new ExecutionEngine(planStore, stateStore, runner, writer); // default hook
    // ... run to completion ...

    // Original corrupted file is preserved
    expect(readFileSync(join(outcomesDir, `${reportId}.json`), "utf-8")).toBe(originalContent);
  });
});
```

Note: Adapt these tests to use the existing helpers (plan creation, state setup, runner construction) already in the test file. The exact engine call signature is `runReadySteps(planId)` — adapt accordingly.

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/executive/execution-engine-apply-dispatch.vitest.ts
```

Expected: New integration tests fail — engine constructor doesn't accept hook.

- [ ] **Step 4: Modify ExecutionEngine to accept and wire the hook**

Modify `src/executive/execution-engine.ts`:

1. Add import:
```ts
import { AutomaticOutcomeEvaluator, createAutomaticOutcomeEvaluator } from "./automatic-outcome-hook.js";
import type { OutcomeEvaluationHook } from "./automatic-outcome-hook.js";
```

2. Update the constructor signature:
```ts
  constructor(
    private readonly planStore: PlanStore,
    private readonly stateStore: ExecutionStateStore,
    private readonly runner: StepRunner,
    private readonly writer: EvidenceEventWriter,
    private readonly outcomeHook: OutcomeEvaluationHook = createAutomaticOutcomeEvaluator(".alix/executive"),
  ) {}
```

Note: The default factory uses a relative path `.alix/executive`. Tests must pass a stub hook explicitly to avoid filesystem side effects. Real production callers in `executive.ts` already pass the constructor's default.

3. Update `maybeCompletePlan()` to fire the hook AFTER the state commit + evidence emission:

```ts
  private async maybeCompletePlan(
    plan: PersistedExecutionPlan,
    state: PlanExecutionState,
    executionId: string,
  ): Promise<void> {
    const allDone = plan.steps.every(s => {
      const r = state.stepStates[s.id];
      return r?.status === "completed" || r?.status === "waiting_for_bridge";
    });
    if (allDone && state.status === "running") {
      this.stateStore.update(
        plan.id,
        { from: "running", to: "completed", executionId },
        s => {
          s.status = "completed";
          s.timestamps.completedAt = new Date().toISOString();
          return s;
        },
      );
      const totalDurationMs = plan.steps.reduce((sum, s) => {
        const stepState = state.stepStates[s.id];
        return sum + (stepState?.durationMs ?? 0);
      }, 0);
      this.writer.recordExecutivePlanCompleted({
        planId: plan.id,
        totalDurationMs,
        executionId,
      }).catch(() => {});

      // Fire the outcome evaluation hook (best-effort, awaited)
      await this.outcomeHook.run(plan, state);
    }
  }
```

Note: `maybeCompletePlan` is now `async`. Find all callers of `maybeCompletePlan()` in the file (search for `this.maybeCompletePlan` or `maybeCompletePlan(`) and ensure they `await` the call.

4. Update all callers of `maybeCompletePlan` to `await`:
```bash
grep -n "maybeCompletePlan" src/executive/execution-engine.ts
```

Add `await` in front of each call (or `.then()` if not awaited, but prefer `await`).

- [ ] **Step 5: Run integration tests**

```bash
npx vitest run tests/executive/execution-engine-apply-dispatch.vitest.ts
```

Expected: All integration tests pass.

- [ ] **Step 6: Run full test suite + type-check**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: All tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/executive/execution-engine.ts tests/executive/execution-engine-apply-dispatch.vitest.ts
git commit -m "feat(p10-5c): wire automatic outcome hook into ExecutionEngine"
```

---

### Task 4: Final verification + PR

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: All tests passing (target ~2000).

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run GitNexus detect-changes**

Run via the MCP tool or equivalent; expected low risk.

- [ ] **Step 4: Push and create PR**

```bash
git push
gh pr create --base main --head feature/p10-5c-automatic-evaluation-hook --title "P10.5c Automatic Outcome Evaluation Hook" --body "..."
```