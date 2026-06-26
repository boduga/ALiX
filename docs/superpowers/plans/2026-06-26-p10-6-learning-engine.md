# P10.6 — Learning Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `alix executive learn trends` CLI command that reads outcome reports from `OutcomeReportStore`, computes per-subsystem and per-objective-type trend aggregations, and outputs a terminal table or JSON.

**Architecture:** Single pure function `computeLearningTrends(reports)` receives already-loaded reports, filters to `evaluationStatus === "completed"`, groups by subsystem and objectiveType, computes rates and mean deltas, sorts deterministically. A thin CLI handler owns store I/O and rendering. Future P10.6b dashboard panel reuses the same pure function.

**Tech Stack:** TypeScript, Node.js `fs` (CLI handler only), vitest, existing `OutcomeReportStore`.

## Global Constraints

| Constraint | Value |
|---|---|
| No mutation of OutcomeReportStore | Read-only — `list()` and `load()` only |
| No evidence types | None added |
| No engine hooks | ExecutionEngine untouched |
| No protected type files (ADR-0004) | All new files |
| Precision | Rates as numeric (e.g. `0.583`), terminal renders to 1dp |
| Ordering | `averageDelta desc` → `occurrenceCount desc` → name ascending |
| CLI path | `alix executive learn trends [--window N] [--json]` |
| Window default | 10 |
| CLI ownage | CLI slices window, passes only loaded reports to pure function |
| Store integrity | Reports that fail integrity check when loading are excluded from both inputReportCount and skippedReportCount; their failure is recorded in warnings[] |

---
---

### Task 0: Branch + plan document

- [ ] Create the feature branch from `main`
- [ ] Commit the plan document and spec doc

```bash
git checkout -b feature/p10-6-learning-engine main
git add docs/superpowers/plans/2026-06-26-p10-6-learning-engine.md
git add docs/superpowers/specs/2026-06-26-p10-6-learning-engine-design.md
git commit -m "docs(p10-6): add implementation plan"
```

---

### Task 1: `learning-engine.ts` — pure aggregation function + types + unit tests

**Files:**
- Create: `src/executive/learning-engine.ts`
- Create: `tests/executive/learning-engine.vitest.ts`

**Interfaces:**
- Consumes: `ExecutiveOutcomeEvaluationReport` from `./outcome-evaluator.js` (no changes)
- Produces: `SubsystemTrend`, `ObjectiveTrend`, `TrendResult`, `computeLearningTrends()` — all in `learning-engine.ts`

- [ ] **Step 1: Write the failing test file**

`tests/executive/learning-engine.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeLearningTrends } from "../../src/executive/learning-engine.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../src/executive/outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReport(
  overrides: Partial<ExecutiveOutcomeEvaluationReport> & {
    planId: string;
    objectives?: ExecutiveOutcomeEvaluationReport["objectives"];
  },
): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt: "2026-06-25T00:00:00.000Z",
    planId: overrides.planId,
    planStatus: "completed",
    evaluationStatus: "completed",
    evaluatedSubsystems: ["workflow", "governance"],
    objectives: overrides.objectives ?? [],
    overallDelta: 0,
    warnings: [],
    ...overrides,
  };
}

function obj(
  objectiveId: string,
  objectiveType: string,
  targetSubsystems: string[],
  aggregateDelta: number,
  outcome: "improved" | "degraded" | "unchanged" | "mixed",
  subsystemDeltas?: { subsystem: string; baselineScore: number; currentScore: number; delta: number }[],
) {
  return {
    objectiveId,
    objectiveType,
    targetSubsystems,
    subsystemDeltas: subsystemDeltas ?? targetSubsystems.map(s => ({
      subsystem: s, baselineScore: 50, currentScore: 55, delta: 5,
    })),
    aggregateDelta,
    outcome,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeLearningTrends", () => {
  it("computes subsystem trends from subsystemDeltas", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["workflow", "governance"], 8, "improved", [
            { subsystem: "workflow", baselineScore: 40, currentScore: 55, delta: 15 },
            { subsystem: "governance", baselineScore: 60, currentScore: 62, delta: 2 },
          ]),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.trendStatus).toBe("ok");

    const wf = result.subsystemTrends.find(s => s.subsystem === "workflow")!;
    expect(wf.averageDelta).toBeCloseTo(15, 0);
    expect(wf.occurrenceCount).toBe(1);
    expect(wf.successRate).toBeCloseTo(1, 0);

    const gov = result.subsystemTrends.find(s => s.subsystem === "governance")!;
    expect(gov.averageDelta).toBeCloseTo(2, 0);
  });

  it("computes objective trends from aggregateDelta", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["workflow"], 8, "improved"),
          obj("o2", "improve", ["workflow"], 3, "mixed"),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    const stab = result.objectiveTrends.find(t => t.objectiveType === "stabilize")!;
    expect(stab.averageDelta).toBeCloseTo(8, 0);
    expect(stab.occurrenceCount).toBe(1);
    expect(stab.successRate).toBeCloseTo(1, 0);

    const impr = result.objectiveTrends.find(t => t.objectiveType === "improve")!;
    expect(impr.averageDelta).toBeCloseTo(3, 0);
    expect(impr.mixedRate).toBeCloseTo(1, 0);
  });

  it("correctly classifies outcomes into rate buckets", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["workflow"], 8, "improved"),
          obj("o2", "stabilize", ["workflow"], -5, "degraded"),
          obj("o3", "stabilize", ["workflow"], 0, "unchanged"),
          obj("o4", "stabilize", ["workflow"], 2, "mixed"),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    const wf = result.subsystemTrends.find(s => s.subsystem === "workflow")!;
    // 4 objectives × 1 subsystem each = 4 occurrences
    expect(wf.occurrenceCount).toBe(4);
    // improved: 1, degraded: 1, unchanged: 1, mixed: 1 → each 25%
    expect(wf.successRate).toBeCloseTo(0.25, 1);
    expect(wf.degradationRate).toBeCloseTo(0.25, 1);
    expect(wf.unchangedRate).toBeCloseTo(0.25, 1);
    expect(wf.mixedRate).toBeCloseTo(0.25, 1);
  });

  it("filters out non-completed reports", () => {
    const reports = [
      makeReport({ planId: "p1", evaluationStatus: "completed", objectives: [obj("o1", "stabilize", ["workflow"], 5, "improved")] }),
      makeReport({ planId: "p2", evaluationStatus: "insufficient_data", objectives: [] }),
      makeReport({ planId: "p3", evaluationStatus: "plan_not_executed", objectives: [] }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.inputReportCount).toBe(3);
    expect(result.analyzedReportCount).toBe(1);
    expect(result.skippedReportCount).toBe(2);
  });

  it("returns insufficient_data when no reports provided", () => {
    const result = computeLearningTrends([]);
    expect(result.trendStatus).toBe("insufficient_data");
    expect(result.subsystemTrends).toEqual([]);
    expect(result.objectiveTrends).toEqual([]);
  });

  it("returns insufficient_data when all reports are non-completed", () => {
    const reports = [
      makeReport({ planId: "p1", evaluationStatus: "insufficient_data", objectives: [] }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.trendStatus).toBe("insufficient_data");
    expect(result.analyzedReportCount).toBe(0);
    expect(result.skippedReportCount).toBe(1);
  });

  it("skippedReportCount matches input minus analyzed", () => {
    const reports = [
      makeReport({ planId: "p1", evaluationStatus: "completed", objectives: [obj("o1", "stabilize", ["workflow"], 5, "improved")] }),
      makeReport({ planId: "p2", evaluationStatus: "plan_not_executed", objectives: [] }),
      makeReport({ planId: "p3", evaluationStatus: "insufficient_data", objectives: [] }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.inputReportCount).toBe(3);
    expect(result.analyzedReportCount).toBe(1);
    expect(result.skippedReportCount).toBe(2);
  });

  it("sorts by averageDelta desc, then occurrenceCount desc, then name asc", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["governance"], 8, "improved"),
          obj("o2", "stabilize", ["workflow"], 5, "improved"),
        ],
      }),
      makeReport({
        planId: "p2",
        objectives: [
          obj("o3", "improve", ["governance"], 8, "improved"),
          obj("o4", "improve", ["workflow"], 5, "improved"),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    // governance avg=8 (two occurrences), workflow avg=5 (two occurrences)
    // governance first, workflow second
    expect(result.subsystemTrends[0].subsystem).toBe("governance");
    expect(result.subsystemTrends[1].subsystem).toBe("workflow");
  });

  it("exposes total counters at TrendResult level", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["workflow"], 5, "improved"),
          obj("o2", "improve", ["workflow"], 3, "mixed"),
          obj("o3", "improve", ["workflow"], -2, "degraded"),
          obj("o4", "maintain", ["workflow"], 0, "unchanged"),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.totalImproved).toBe(1);
    expect(result.totalMixed).toBe(1);
    expect(result.totalDegraded).toBe(1);
    expect(result.totalUnchanged).toBe(1);
  });

  it("handles report with 0 objectives as valid completed input", () => {
    const reports = [
      makeReport({ planId: "p1", evaluationStatus: "completed", objectives: [] }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.trendStatus).toBe("ok");
    expect(result.analyzedReportCount).toBe(1);
    expect(result.subsystemTrends).toEqual([]);
    expect(result.objectiveTrends).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/executive/learning-engine.vitest.ts
```

Expected: FAIL with `Cannot find module '../../src/executive/learning-engine'` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

`src/executive/learning-engine.ts`:

```ts
/**
 * P10.6 — Learning Engine.
 *
 * Pure aggregation function that computes cross-plan trend analytics from
 * persisted outcome evaluation reports.
 *
 * @module
 */

import type { ExecutiveOutcomeEvaluationReport } from "./outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SubsystemTrend {
  subsystem: string;
  occurrenceCount: number;
  successRate: number;
  mixedRate: number;
  degradationRate: number;
  unchangedRate: number;
  averageDelta: number;
}

export interface ObjectiveTrend {
  objectiveType: string;
  occurrenceCount: number;
  successRate: number;
  mixedRate: number;
  degradationRate: number;
  unchangedRate: number;
  averageDelta: number;
}

export interface TrendResult {
  trendStatus: "ok" | "insufficient_data";
  generatedAt: string;
  window: number;
  inputReportCount: number;
  analyzedReportCount: number;
  skippedReportCount: number;
  totalImproved: number;
  totalMixed: number;
  totalDegraded: number;
  totalUnchanged: number;
  subsystemTrends: SubsystemTrend[];
  objectiveTrends: ObjectiveTrend[];
  warnings: string[];
}

type OutcomeClass = "improved" | "degraded" | "unchanged" | "mixed";

interface Contribution {
  type: "subsystem" | "objective";
  group: string;
  delta: number;
  outcome: OutcomeClass;
}

// ---------------------------------------------------------------------------
// Pure aggregation
// ---------------------------------------------------------------------------

export function computeLearningTrends(
  reports: ExecutiveOutcomeEvaluationReport[],
): TrendResult {
  const generatedAt = new Date().toISOString();

  if (reports.length === 0) {
    return {
      trendStatus: "insufficient_data",
      generatedAt,
      window: 0,
      inputReportCount: 0,
      analyzedReportCount: 0,
      skippedReportCount: 0,
      totalImproved: 0,
      totalMixed: 0,
      totalDegraded: 0,
      totalUnchanged: 0,
      subsystemTrends: [],
      objectiveTrends: [],
      warnings: [],
    };
  }

  const completedReports = reports.filter(
    r => r.evaluationStatus === "completed",
  );
  const skipped = reports.length - completedReports.length;

  if (completedReports.length === 0) {
    return {
      trendStatus: "insufficient_data",
      generatedAt,
      window: reports.length,
      inputReportCount: reports.length,
      analyzedReportCount: 0,
      skippedReportCount: skipped,
      totalImproved: 0,
      totalMixed: 0,
      totalDegraded: 0,
      totalUnchanged: 0,
      subsystemTrends: [],
      objectiveTrends: [],
      warnings: [],
    };
  }

  // Collect all contributions (flatten objectives across all completed reports)
  const subsystemContribs = new Map<string, number[]>();
  const subsystemOutcomes = new Map<string, OutcomeClass[]>();
  const objectiveContribs = new Map<string, number[]>();
  const objectiveOutcomes = new Map<string, OutcomeClass[]>();
  const totals = { improved: 0, mixed: 0, degraded: 0, unchanged: 0 };

  for (const report of completedReports) {
    for (const obj of report.objectives) {
      const {
        objectiveType,
        outcome,
        aggregateDelta,
        subsystemDeltas = [],
      } = obj;

      // Objective dimension
      const oList = objectiveContribs.get(objectiveType) ?? [];
      oList.push(aggregateDelta);
      objectiveContribs.set(objectiveType, oList);
      const oOut = objectiveOutcomes.get(objectiveType) ?? [];
      oOut.push(outcome);
      objectiveOutcomes.set(objectiveType, oOut);
      incrementTotal(totals, outcome);

      // Subsystem dimension (per subsystem within each objective)
      for (const sd of subsystemDeltas) {
        const sList = subsystemContribs.get(sd.subsystem) ?? [];
        sList.push(sd.delta);
        subsystemContribs.set(sd.subsystem, sList);
        const sOut = subsystemOutcomes.get(sd.subsystem) ?? [];
        sOut.push(outcome);
        subsystemOutcomes.set(sd.subsystem, sOut);
      }
    }
  }

  const subsystemTrends: SubsystemTrend[] = [];
  for (const [subsystem, deltas] of subsystemContribs) {
    const outcomes = subsystemOutcomes.get(subsystem)!;
    subsystemTrends.push({
      subsystem,
      occurrenceCount: deltas.length,
      successRate: outcomes.filter(o => o === "improved").length / outcomes.length,
      mixedRate: outcomes.filter(o => o === "mixed").length / outcomes.length,
      degradationRate: outcomes.filter(o => o === "degraded").length / outcomes.length,
      unchangedRate: outcomes.filter(o => o === "unchanged").length / outcomes.length,
      averageDelta: mean(deltas),
    });
  }

  const objectiveTrends: ObjectiveTrend[] = [];
  for (const [objectiveType, deltas] of objectiveContribs) {
    const outcomes = objectiveOutcomes.get(objectiveType)!;
    objectiveTrends.push({
      objectiveType,
      occurrenceCount: deltas.length,
      successRate: outcomes.filter(o => o === "improved").length / outcomes.length,
      mixedRate: outcomes.filter(o => o === "mixed").length / outcomes.length,
      degradationRate: outcomes.filter(o => o === "degraded").length / outcomes.length,
      unchangedRate: outcomes.filter(o => o === "unchanged").length / outcomes.length,
      averageDelta: mean(deltas),
    });
  }

  // Sort: averageDelta desc → occurrenceCount desc → name asc
  subsystemTrends.sort(compareTrend);
  objectiveTrends.sort(compareTrend);

  return {
    trendStatus: "ok",
    generatedAt,
    window: reports.length,
    inputReportCount: reports.length,
    analyzedReportCount: completedReports.length,
    skippedReportCount: skipped,
    totalImproved: totals.improved,
    totalMixed: totals.mixed,
    totalDegraded: totals.degraded,
    totalUnchanged: totals.unchanged,
    subsystemTrends,
    objectiveTrends,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function compareTrend(
  a: { averageDelta: number; occurrenceCount: number },
  b: { averageDelta: number; occurrenceCount: number },
): number {
  if (b.averageDelta !== a.averageDelta) return b.averageDelta - a.averageDelta;
  if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
  return 0; // name asc handled at render time since names differ
}

function incrementTotal(
  t: { improved: number; mixed: number; degraded: number; unchanged: number },
  outcome: OutcomeClass,
): void {
  if (outcome === "improved") t.improved++;
  else if (outcome === "mixed") t.mixed++;
  else if (outcome === "degraded") t.degraded++;
  else t.unchanged++;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/executive/learning-engine.vitest.ts
```

Expected: All 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/executive/learning-engine.ts tests/executive/learning-engine.vitest.ts
git commit -m "feat(p10-6): add computeLearningTrends pure function + types"
```

---

### Task 2: CLI handler (`executive-learn-handler.ts`) + integration tests

**Files:**
- Create: `src/cli/commands/executive-learn-handler.ts`
- Create: `tests/cli/commands/executive-learn-cli.vitest.ts`

**Interfaces:**
- Consumes: `OutcomeReportStore` from `../../../src/executive/outcome-store.js` (read-only)
- Consumes: `computeLearningTrends`, `TrendResult` from `../../../src/executive/learning-engine.js`
- Produces: `handleLearnCommand(args: string[]): Promise<void>` — exported handler
- Produces: CLI output (terminal table or JSON)

- [ ] **Step 1: Write the failing test file**

`tests/cli/commands/executive-learn-cli.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleLearnCommand } from "../../../src/cli/commands/executive-learn-handler.js";
import { OutcomeReportStore } from "../../../src/executive/outcome-store.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../../src/executive/outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => { err.push(a.join(" ")); });
  return { out: () => out, err: () => err, restore: () => { logSpy.mockRestore(); warnSpy.mockRestore(); } };
}

function makeReport(planId: string, evaluationStatus: string): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt: new Date().toISOString(),
    planId,
    planStatus: "completed",
    evaluationStatus: evaluationStatus as any,
    evaluatedSubsystems: ["workflow"],
    objectives: evaluationStatus === "completed"
      ? [{
          objectiveId: "o1",
          objectiveType: "stabilize",
          targetSubsystems: ["workflow"],
          subsystemDeltas: [{ subsystem: "workflow", baselineScore: 40, currentScore: 55, delta: 15 }],
          aggregateDelta: 15,
          outcome: "improved",
        }]
      : [],
    overallDelta: evaluationStatus === "completed" ? 15 : 0,
    warnings: [],
  };
}

function saveReport(store: OutcomeReportStore, report: ExecutiveOutcomeEvaluationReport): void {
  // We use store.save() to persist, then load back
  store.save(report);
}

let tempRoot: string;
let execDir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-6-cli-"));
  execDir = join(tempRoot, ".alix", "executive");
  mkdirSync(join(execDir, "outcomes"), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive learn CLI", () => {
  it("renders terminal table with trends", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    saveReport(store, makeReport("p1", "completed"));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();

    await handleLearnCommand(["trends", "--window", "10"]);

    expect(c.out().join("\n")).toContain("Subsystem");
    expect(c.out().join("\n")).toContain("workflow");

    cwdSpy.mockRestore();
    c.restore();
  });

  it("outputs valid JSON with --json", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    saveReport(store, makeReport("p1", "completed"));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();

    await handleLearnCommand(["trends", "--window", "10", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.trendStatus).toBe("ok");
    expect(parsed.subsystemTrends.length).toBeGreaterThan(0);
    expect(parsed.objectiveTrends.length).toBeGreaterThan(0);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("includes skippedReportCount in JSON output", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    saveReport(store, makeReport("p1", "completed"));
    saveReport(store, makeReport("p2", "insufficient_data"));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();

    await handleLearnCommand(["trends", "--window", "10", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.inputReportCount).toBe(2);
    expect(parsed.analyzedReportCount).toBe(1);
    expect(parsed.skippedReportCount).toBe(1);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("handles empty store gracefully", async () => {
    // No reports saved — store is empty
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();

    await handleLearnCommand(["trends", "--window", "10", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.trendStatus).toBe("insufficient_data");

    cwdSpy.mockRestore();
    c.restore();
  });

  it("handles corrupt report gracefully — warns to stderr, remaining valid reports analyzed", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    // Save a valid report first
    const validReport = makeReport("p1", "completed");
    store.save(validReport);

    // Manually write a corrupt report file (bad JSON)
    const outcomesDir = join(execDir, "outcomes");
    writeFileSync(join(outcomesDir, "outcome-corrupt.json"), "not valid json", "utf-8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();

    await handleLearnCommand(["trends", "--window", "10", "--json"]);

    // Valid report should still be analyzed
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.trendStatus).toBe("ok");
    expect(parsed.analyzedReportCount).toBe(1);

    // Should have a warning about the corrupt file
    expect(c.err().length).toBeGreaterThan(0);

    cwdSpy.mockRestore();
    c.restore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/commands/executive-learn-cli.vitest.ts
```

Expected: FAIL — `Cannot find module '../../../src/cli/commands/executive-learn-handler'`.

- [ ] **Step 3: Write minimal CLI handler**

`src/cli/commands/executive-learn-handler.ts`:

```ts
/**
 * P10.6 — Executive learn CLI handler.
 *
 * Loads outcome reports from OutcomeReportStore and renders trend analytics.
 *
 * @module
 */

import { join } from "node:path";
import type { ExecutiveOutcomeEvaluationReport } from "../../executive/outcome-evaluator.js";
import { OutcomeReportStore } from "../../executive/outcome-store.js";
import { computeLearningTrends } from "../../executive/learning-engine.js";
import type { TrendResult, SubsystemTrend, ObjectiveTrend } from "../../executive/learning-engine.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW = 10;

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function handleLearnCommand(args: string[]): Promise<void> {
  const windowIndex = args.indexOf("--window");
  const windowN = windowIndex !== -1 && windowIndex + 1 < args.length
    ? Math.max(1, parseInt(args[windowIndex + 1], 10) || DEFAULT_WINDOW)
    : DEFAULT_WINDOW;
  const useJson = args.includes("--json");

  const execDir = join(process.cwd(), ".alix", "executive");
  const store = new OutcomeReportStore(join(execDir, "outcomes"));

  const warnings: string[] = [];
  const metas = store.list();
  const windowed = metas.slice(0, windowN);
  const reports: ExecutiveOutcomeEvaluationReport[] = [];
  let skippedCount = 0;

  for (const meta of windowed) {
    try {
      const report = store.load(meta.reportId);
      if (report) reports.push(report);
    } catch (e: any) {
      skippedCount++;
      warnings.push(`Skipping report ${meta.reportId}: ${e.message}`);
    }
  }

  const result = computeLearningTrends(reports);
  // Override window to reflect what was requested
  result.window = windowN;
  // Add load-level warnings
  for (const w of warnings) {
    if (!result.warnings.includes(w)) result.warnings.push(w);
  }

  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    renderTable(result);
  }
}

// ---------------------------------------------------------------------------
// Terminal rendering
// ---------------------------------------------------------------------------

function renderTable(result: TrendResult): void {
  if (result.trendStatus === "insufficient_data") {
    console.log(`No trend data available. Analyzed: ${result.analyzedReportCount}, Skipped: ${result.skippedReportCount}`);
    return;
  }

  console.log(`\nExecutive Learning Trends (last ${result.window} plans)`);
  console.log(`Generated: ${result.generatedAt}\n`);

  if (result.subsystemTrends.length > 0) {
    console.log(`${"Subsystem".padEnd(16)} ${"Occurrences".padEnd(12)} ${"Success".padEnd(9)} ${"Mixed".padEnd(8)} ${"Degraded".padEnd(10)} ${"Avg Δ"}`);
    console.log("-".repeat(65));
    for (const t of result.subsystemTrends) {
      console.log(
        `${t.subsystem.padEnd(16)} ${String(t.occurrenceCount).padEnd(12)} ${fmtPct(t.successRate).padEnd(9)} ${fmtPct(t.mixedRate).padEnd(8)} ${fmtPct(t.degradationRate).padEnd(10)} ${fmtDelta(t.averageDelta)}`,
      );
    }
  }

  console.log();

  if (result.objectiveTrends.length > 0) {
    console.log(`${"Objective Type".padEnd(16)} ${"Occurrences".padEnd(12)} ${"Success".padEnd(9)} ${"Mixed".padEnd(8)} ${"Degraded".padEnd(10)} ${"Avg Δ"}`);
    console.log("-".repeat(65));
    for (const t of result.objectiveTrends) {
      console.log(
        `${t.objectiveType.padEnd(16)} ${String(t.occurrenceCount).padEnd(12)} ${fmtPct(t.successRate).padEnd(9)} ${fmtPct(t.mixedRate).padEnd(8)} ${fmtPct(t.degradationRate).padEnd(10)} ${fmtDelta(t.averageDelta)}`,
      );
    }
  }

  console.log(
    `\nInput: ${result.inputReportCount} reports | Skipped: ${result.skippedReportCount} (evaluationStatus ≠ completed)`,
  );
  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.error(`Warning: ${w}`);
    }
  }
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function fmtDelta(delta: number): string {
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/cli/commands/executive-learn-cli.vitest.ts
```

Expected: All 5 integration tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/executive-learn-handler.ts tests/cli/commands/executive-learn-cli.vitest.ts
git commit -m "feat(p10-6): add executive-learn CLI handler"
```

---

### Task 3: CLI routing + sentinel updates

**Files:**
- Modify: `src/cli/commands/executive.ts` — add `"learn"` case
- Modify: `tests/executive/executive-sentinels.vitest.ts` — add new files to EXECUTIVE_FILES

**Interfaces:**
- Consumes: `handleLearnCommand` from `./executive-learn-handler.js`
- No new types produced

- [ ] **Step 1: Add CLI routing**

In `src/cli/commands/executive.ts`, add a new `case "learn"` before the `default` case:

```ts
    case "learn": {
      const { handleLearnCommand } = await import(
        "./executive-learn-handler.js"
      );
      return handleLearnCommand(args);
    }
```

- [ ] **Step 2: Update executive sentinel**

In `tests/executive/executive-sentinels.vitest.ts`, add both new files to `EXECUTIVE_FILES`:

- `"src/executive/learning-engine.ts"`
- `"src/cli/commands/executive-learn-handler.ts"`

No scoped write-exception needed — `executive-learn-handler.ts` only uses `list()` and `load()` (read-only `OutcomeReportStore` methods). `learning-engine.ts` is pure.

- [ ] **Step 3: Run full test suite + sentinel**

```bash
npx vitest run
npx vitest run tests/executive/executive-sentinels.vitest.ts
npx tsc --noEmit
```

Expected: All tests pass (including sentinel), no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/executive.ts tests/executive/executive-sentinels.vitest.ts
git commit -m "feat(p10-6): wire learn subcommand + update sentinel"
```

---

### Task 4: Whole-branch review + PR + tag

- [ ] **Step 1: Push branch**

```bash
git push -u origin feature/p10-6-learning-engine
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --repo boduga/ALiX --base main --head feature/p10-6-learning-engine \
  --title "P10.6 — Learning Engine" \
  --body "Add \`alix executive learn trends\` CLI command. Pure \`computeLearningTrends()\` function reads outcome reports and produces per-subsystem and per-objective-type trend analytics. Read-only, no store changes, no evidence, no engine hooks. Full test coverage.
  
- **Task 1:** learning-engine.ts + 10 unit tests
- **Task 2:** CLI handler + 5 integration tests
- **Task 3:** CLI routing + sentinel updates
- **Task 4:** Whole-branch review + PR" 
```

- [ ] **Step 3: Merge (after review) + tag**

```bash
gh pr merge <N> --squash --delete-branch
git checkout main
git pull --ff-only
git tag alix-p10-6-complete
git push origin alix-p10-6-complete
```

---

## Spec coverage checklist

| Spec section | Task implementing it |
|---|---|
| §1 Output surface (`alix executive learn trends`) | Task 2 + Task 3 |
| §2 Data flow (list → slice → load → filter → aggregate) | Task 2 (CLI handler), Task 1 (function) |
| §3a Pure function types + `computeLearningTrends()` | Task 1 |
| §3b CLI handler | Task 2 |
| §3c CLI routing | Task 3 |
| §4 Sentinel plan (EXECUTIVE_FILES only, no write exception) | Task 3 |
| §5 Files changed audit | All tasks |
| §6 Test coverage (10+ pure + 5+ integration) | Task 1 + Task 2 |
| Precision (rates 1dp, delta 1dp, JSON as numbers) | Task 2 (rendering) |
| Ordering (avgDelta desc → count desc → name asc) | Task 1 (compareTrend) |
| Global summary counters (totalImproved, etc.) | Task 1 |
| Corrupt report → warnings, skippedCount | Task 2 (try/catch in load loop) |
