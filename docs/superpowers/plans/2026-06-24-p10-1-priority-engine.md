# P10.1 — Weighted Priority Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weighted priority engine that transforms P10.0 raw health scores into ranked executive priority scores using three factors (health deficit, trend, blast radius) via an extensible `PriorityFactor[]` model.

**Architecture:** New `priority-engine.ts` consumes `ExecutiveHealthReport` (P10.0) + optional trend snapshot and produces `ExecutivePriorityReport`. New `trend-store.ts` persists subsystem score snapshots to `.alix/executive/trends.jsonl` (append-only, derived state). The handler calls the priority engine after the health aggregator and passes both reports to the renderer. The renderer adds a priority column to the display.

**Tech Stack:** TypeScript, Node.js fs/path, vitest. TrendStore is the only new write path. No P10.0 schema changes. No sentinel regression.

## Global Constraints

1. `priorityReport.schemaVersion = "p10.1.0"` (string literal, exact value).
2. `ExecutivePriorityEntry` and `ExecutivePriorityReport` are **separate** from `ExecutiveSubsystemHealth` / `ExecutiveHealthReport` (P10.0 types remain unchanged).
3. The priority engine uses an extensible `PriorityFactor[]` model: `priorityScore = Σ(weight × value)`.
4. P10.1 registered factors: Health Deficit (weight 0.60), Trend (weight 0.25), Blast Radius (weight 0.15).
5. `TREND_SENSITIVITY = 5` — a named constant, not a magic number.
6. `BLAST_RADIUS` is a static record: `{ governance: 100, security: 90, learning: 75, memory: 70, adaptation: 65, workflow: 60, agents: 50, tools: 40 }`.
7. TrendStore is **derived state (cache)**. If `trends.jsonl` is missing, `loadLatest()` returns null, trendScore defaults to 25. No correctness loss.
8. TrendStore is the only approved P10.1 write path. The existing P10 sentinel is extended with a scoped exception for `trend-store.ts`.
9. Renderer signature becomes: `renderExecutiveDashboard(healthReport, priorityReport, opts?)`.
10. Dashboard never recomputes priority. It renders both reports.

---

### Task 1: Create the priority engine

**Files:**
- Create: `src/executive/priority-engine.ts`

**Interfaces:**
- Consumes: `ExecutiveHealthReport` + `ExecutiveTrendSnapshot | null` from trend store
- Produces: `computePriorityScore()`, `computeExecutivePriorities()`, `PriorityFactor`, `ExecutivePriorityEntry`, `ExecutivePriorityReport`

- [ ] **Step 1: Create the type definitions and engine**

```ts
/**
 * P10.1 — Weighted Priority Engine.
 *
 * Transforms P10.0 health scores into weighted executive priority scores.
 * Uses an extensible PriorityFactor[] model: priorityScore = Σ(weight × value).
 *
 * @module
 */

import type { ExecutiveHealthReport, ExecutiveSubsystemName } from "./executive-health.js";
import type { ExecutiveTrendSnapshot } from "./trend-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TREND_SENSITIVITY = 5;

const BLAST_RADIUS: Record<ExecutiveSubsystemName, number> = {
  governance: 100,
  security:    90,
  learning:    75,
  memory:      70,
  adaptation:  65,
  workflow:    60,
  agents:      50,
  tools:       40,
};

const P10_1_FACTORS: PriorityFactorDef[] = [
  { name: "Health Deficit", weight: 0.60 },
  { name: "Trend",          weight: 0.25 },
  { name: "Blast Radius",   weight: 0.15 },
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PriorityFactorDef {
  /** Human-readable factor name. */
  name: string;
  /** Relative weight in the composite. All factor weights sum to 1.0. */
  weight: number;
}

export interface ComputedPriorityFactor {
  name: string;
  weight: number;
  /** Computed 0..100 value for this factor. */
  value: number;
}

export interface ExecutivePriorityEntry {
  subsystem: ExecutiveSubsystemName;
  /** 0..100, from P10.0 health report. */
  healthScore: number;
  /** 100 - healthScore. */
  healthDeficit: number;
  /** 0..100, derived from trend delta. */
  trendScore: number;
  /** 0..100, from BLAST_RADIUS table. */
  blastRadius: number;
  /**
   * Weighted composite: Σ(weight × value) across all registered factors.
   * Weighted by P10_1_FACTORS. Higher = higher priority.
   */
  priorityScore: number;
  /** Per-factor breakdown for display. */
  factorBreakdown: ComputedPriorityFactor[];
  /** One-line summary. */
  summary: string;
}

export interface ExecutivePriorityReport {
  schemaVersion: "p10.1.0";
  generatedAt: string;
  windowDays: number;
  /** Sorted descending by priorityScore (highest priority first). */
  priorities: ExecutivePriorityEntry[];
}

// ---------------------------------------------------------------------------
// Priority engine
// ---------------------------------------------------------------------------

/**
 * Pure function: compute a single priority score from its three factors.
 * Factory pattern: given input values, returns the weighted composite.
 * P10.1 uses equal factor list but P10.2+ may register custom factors.
 */
export function computePriorityScore(
  healthDeficit: number,
  trendScore: number,
  blastRadius: number,
): number {
  const values = [healthDeficit, trendScore, blastRadius];
  let composite = 0;
  for (let i = 0; i < P10_1_FACTORS.length; i++) {
    composite += P10_1_FACTORS[i].weight * values[i];
  }
  return composite;
}

/**
 * Derive trendScore from a prior snapshot delta.
 * If no prior snapshot, trendScore defaults to 25 (neutral-low).
 */
export function computeTrendScore(
  currentScore: number,
  priorScore: number | undefined,
): number {
  if (priorScore === undefined) return 25;
  const delta = currentScore - priorScore;
  return clampValue(50 - delta * TREND_SENSITIVITY);
}

/**
 * Build the full ExecutivePriorityReport from a P10.0 health report
 * and an optional prior trend snapshot.
 */
export function buildPriorityReport(
  healthReport: ExecutiveHealthReport,
  priorSnapshot: ExecutiveTrendSnapshot | null,
): ExecutivePriorityReport {
  const generatedAt = new Date().toISOString();
  const entries: ExecutivePriorityEntry[] = healthReport.rankedSubsystems.map((sub) => {
    const healthDeficit = 100 - sub.score;
    const priorScore = priorSnapshot?.subsystemScores[sub.subsystem];
    const trendScore = computeTrendScore(sub.score, priorScore);
    const blastRadius = BLAST_RADIUS[sub.subsystem];
    const priorityScore = computePriorityScore(healthDeficit, trendScore, blastRadius);

    return {
      subsystem: sub.subsystem,
      healthScore: sub.score,
      healthDeficit,
      trendScore,
      blastRadius,
      priorityScore,
      factorBreakdown: [
        { name: "Health Deficit", weight: 0.60, value: healthDeficit },
        { name: "Trend",          weight: 0.25, value: trendScore },
        { name: "Blast Radius",   weight: 0.15, value: blastRadius },
      ],
      summary: `${sub.subsystem} score ${sub.score}, priority ${priorityScore.toFixed(1)}`,
    };
  });

  // Sort descending by priorityScore (highest priority first)
  entries.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    schemaVersion: "p10.1.0",
    generatedAt,
    windowDays: healthReport.windowDays,
    priorities: entries,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampValue(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
```

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean (0 errors). If errors about importing types from health report, verify the types are exported from executive-health.ts.

- [ ] **Step 3: Commit**

```bash
git add src/executive/priority-engine.ts
git commit -m "P10.1: create priority engine with factor-based scoring"
```

---
### Task 2: Create the trend store

**Files:**
- Create: `src/executive/trend-store.ts`

**Interfaces:**
- Consumes: `ExecutiveHealthReport` from P10.0
- Produces: `ExecutiveTrendSnapshot`, `ExecutiveTrendStore` class with `loadLatest()` + `save()` methods

- [ ] **Step 1: Create the trend store**

```ts
/**
 * P10.1 — Executive Trend Store.
 *
 * Append-only snapshot store for subsystem health scores over time.
 * TrendStore is DERIVED STATE (cache). If trends.jsonl is missing or
 * deleted, the priority engine defaults to trendScore=25 and the
 * system continues without correctness loss.
 *
 * @module
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExecutiveHealthReport, ExecutiveSubsystemName } from "./executive-health.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExecutiveTrendSnapshot {
  id: string;
  generatedAt: string;
  windowDays: number;
  subsystemScores: Record<ExecutiveSubsystemName, number>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const TRENDS_FILE = "trends.jsonl";

export class ExecutiveTrendStore {
  constructor(private readonly dir: string) {}

  /**
   * Load the most recent trend snapshot. Returns null if no snapshots exist
   * (first run, or trends.jsonl was deleted/recreated).
   */
  async loadLatest(): Promise<ExecutiveTrendSnapshot | null> {
    const path = join(this.dir, TRENDS_FILE);
    if (!existsSync(path)) return null;

    const content = readFileSync(path, "utf-8").trim();
    if (!content) return null;

    // JSONL: one JSON object per line. The last non-empty line is the most recent.
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return null;

    const lastLine = lines[lines.length - 1];
    try {
      return JSON.parse(lastLine) as ExecutiveTrendSnapshot;
    } catch {
      return null;
    }
  }

  /**
   * Append a new trend snapshot derived from the current health report.
   * The snapshot captures each subsystem's current score for future trend
   * comparisons.
   */
  async save(report: ExecutiveHealthReport): Promise<ExecutiveTrendSnapshot> {
    const dirPath = this.dir;
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    const snapshot: ExecutiveTrendSnapshot = {
      id: `exec-trend-${report.generatedAt}`,
      generatedAt: report.generatedAt,
      windowDays: report.windowDays,
      subsystemScores: {} as Record<ExecutiveSubsystemName, number>,
    };

    for (const sub of report.rankedSubsystems) {
      snapshot.subsystemScores[sub.subsystem] = sub.score;
    }

    const path = join(dirPath, TRENDS_FILE);
    appendFileSync(path, JSON.stringify(snapshot) + "\n", "utf-8");
    return snapshot;
  }
}
```

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/executive/trend-store.ts
git commit -m "P10.1: create ExecutiveTrendStore (append-only, derived state)"
```

---
### Task 3: Write the priority engine unit tests

**Files:**
- Create: `tests/executive/priority-engine.vitest.ts`

**Interfaces:**
- Consumes: `computePriorityScore`, `computeTrendScore`, `buildPriorityReport`, `ExecutivePriorityReport` from Task 1
- Produces: 8 unit tests

- [ ] **Step 1: Create the test file**

```ts
/**
 * P10.1 — Priority Engine unit tests.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  computePriorityScore,
  computeTrendScore,
  buildPriorityReport,
} from "../../src/executive/priority-engine.js";
import type { ExecutiveHealthReport } from "../../src/executive/executive-health.js";
import type { ExecutiveTrendSnapshot } from "../../src/executive/trend-store.js";

function makeHealthReport(
  overrides?: Partial<ExecutiveHealthReport>,
): ExecutiveHealthReport {
  return {
    schemaVersion: "p10.0.0",
    generatedAt: "2026-06-24T00:00:00.000Z",
    windowDays: 90,
    overallScore: 78,
    rankedSubsystems: [
      { subsystem: "tools", score: 54, status: "critical", summary: "tools at 54", topIssues: [] },
      { subsystem: "memory", score: 68, status: "warning", summary: "memory at 68", topIssues: [] },
      { subsystem: "learning", score: 76, status: "warning", summary: "learning at 76", topIssues: [] },
      { subsystem: "workflow", score: 79, status: "warning", summary: "workflow at 79", topIssues: [] },
      { subsystem: "agents", score: 82, status: "healthy", summary: "agents at 82", topIssues: [] },
      { subsystem: "adaptation", score: 88, status: "healthy", summary: "adaptation at 88", topIssues: [] },
      { subsystem: "governance", score: 91, status: "healthy", summary: "governance at 91", topIssues: [] },
      { subsystem: "security", score: 95, status: "healthy", summary: "security at 95", topIssues: [] },
    ],
    ...overrides,
  };
}

function makeSnapshot(
  scores: Record<string, number>,
): ExecutiveTrendSnapshot {
  return {
    id: "exec-trend-test",
    generatedAt: "2026-06-23T00:00:00.000Z",
    windowDays: 90,
    subsystemScores: scores as any,
  };
}

describe("computePriorityScore", () => {
  it("returns expected composite for known inputs", () => {
    // healthDeficit=46, trendScore=100, blastRadius=40 (tools)
    // 46*0.60 + 100*0.25 + 40*0.15 = 27.6 + 25 + 6 = 58.6
    const result = computePriorityScore(46, 100, 40);
    expect(result).toBeCloseTo(58.6, 1);
  });

  it("returns 0 when all factors are 0", () => {
    expect(computePriorityScore(0, 0, 0)).toBe(0);
  });

  it("returns 100 when all factors are 100", () => {
    expect(computePriorityScore(100, 100, 100)).toBe(100);
  });
});

describe("computeTrendScore", () => {
  it("returns 100 for sharp decline (delta = -25)", () => {
    expect(computeTrendScore(55, 80)).toBe(100);
  });

  it("returns 50 for stable (delta = 0)", () => {
    expect(computeTrendScore(80, 80)).toBe(50);
  });

  it("returns 0 for strong improvement (delta = +15)", () => {
    expect(computeTrendScore(95, 80)).toBe(0);
  });

  it("returns 25 when no prior snapshot exists", () => {
    expect(computeTrendScore(80, undefined)).toBe(25);
  });
});

describe("buildPriorityReport", () => {
  it("returns schemaVersion p10.1.0 and 8 entries", () => {
    const health = makeHealthReport();
    const report = buildPriorityReport(health, null);
    expect(report.schemaVersion).toBe("p10.1.0");
    expect(report.priorities.length).toBe(8);
  });

  it("sorts entries descending by priorityScore", () => {
    const health = makeHealthReport();
    const report = buildPriorityReport(health, null);
    for (let i = 1; i < report.priorities.length; i++) {
      expect(report.priorities[i - 1].priorityScore).toBeGreaterThanOrEqual(
        report.priorities[i].priorityScore,
      );
    }
  });

  it("includes factorBreakdown with 3 entries per subsystem", () => {
    const health = makeHealthReport();
    const report = buildPriorityReport(health, null);
    for (const entry of report.priorities) {
      expect(entry.factorBreakdown.length).toBe(3);
      const names = entry.factorBreakdown.map((f) => f.name);
      expect(names).toContain("Health Deficit");
      expect(names).toContain("Trend");
      expect(names).toContain("Blast Radius");
    }
  });

  it("computes healthDeficit = 100 - score", () => {
    const health = makeHealthReport();
    const report = buildPriorityReport(health, null);
    const tools = report.priorities.find((p) => p.subsystem === "tools");
    expect(tools?.healthDeficit).toBe(46);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run tests/executive/priority-engine.vitest.ts --reporter verbose 2>&1 | tail -20
```

Expected: all tests pass (8-9).

- [ ] **Step 3: Commit**

```bash
git add tests/executive/priority-engine.vitest.ts
git commit -m "P10.1: add priority engine unit tests"
```

---
### Task 4: Write the trend store unit tests

**Files:**
- Create: `tests/executive/trend-store.vitest.ts`

**Interfaces:**
- Consumes: `ExecutiveTrendStore` from Task 2
- Produces: 4 unit tests

- [ ] **Step 1: Create the test file**

```ts
/**
 * P10.1 — Trend Store unit tests.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExecutiveTrendStore } from "../../src/executive/trend-store.js";
import type { ExecutiveHealthReport } from "../../src/executive/executive-health.js";

function makeHealthReport(generatedAt: string): ExecutiveHealthReport {
  return {
    schemaVersion: "p10.0.0",
    generatedAt,
    windowDays: 90,
    overallScore: 78,
    rankedSubsystems: [
      { subsystem: "tools", score: 54, status: "critical", summary: "t", topIssues: [] },
      { subsystem: "governance", score: 91, status: "healthy", summary: "g", topIssues: [] },
      { subsystem: "security", score: 95, status: "healthy", summary: "s", topIssues: [] },
      { subsystem: "learning", score: 76, status: "warning", summary: "l", topIssues: [] },
      { subsystem: "adaptation", score: 88, status: "healthy", summary: "a", topIssues: [] },
      { subsystem: "agents", score: 82, status: "healthy", summary: "ag", topIssues: [] },
      { subsystem: "workflow", score: 79, status: "warning", summary: "w", topIssues: [] },
      { subsystem: "memory", score: 68, status: "warning", summary: "m", topIssues: [] },
    ],
  };
}

describe("ExecutiveTrendStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "trend-store-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loadLatest returns null on empty store", async () => {
    const store = new ExecutiveTrendStore(dir);
    expect(await store.loadLatest()).toBeNull();
  });

  it("save then loadLatest returns the same snapshot", async () => {
    const store = new ExecutiveTrendStore(dir);
    const report = makeHealthReport("2026-06-24T00:00:00.000Z");
    const saved = await store.save(report);
    expect(saved.id).toContain("exec-trend-");
    expect(saved.subsystemScores.tools).toBe(54);

    const loaded = await store.loadLatest();
    expect(loaded).not.toBeNull();
    expect(loaded!.subsystemScores.tools).toBe(54);
    expect(loaded!.generatedAt).toBe("2026-06-24T00:00:00.000Z");
  });

  it("loadLatest returns the most recent snapshot", async () => {
    const store = new ExecutiveTrendStore(dir);
    await store.save(makeHealthReport("2026-06-23T00:00:00.000Z"));
    await store.save(makeHealthReport("2026-06-24T00:00:00.000Z"));
    const loaded = await store.loadLatest();
    expect(loaded).not.toBeNull();
    expect(loaded!.generatedAt).toBe("2026-06-24T00:00:00.000Z");
  });

  it("round-trip preserves all 8 subsystem scores", async () => {
    const store = new ExecutiveTrendStore(dir);
    const report = makeHealthReport("2026-06-24T00:00:00.000Z");
    await store.save(report);
    const loaded = await store.loadLatest();
    expect(Object.keys(loaded!.subsystemScores).length).toBe(8);
    expect(loaded!.subsystemScores.tools).toBe(54);
    expect(loaded!.subsystemScores.governance).toBe(91);
    expect(loaded!.subsystemScores.security).toBe(95);
    expect(loaded!.subsystemScores.learning).toBe(76);
    expect(loaded!.subsystemScores.adaptation).toBe(88);
    expect(loaded!.subsystemScores.agents).toBe(82);
    expect(loaded!.subsystemScores.workflow).toBe(79);
    expect(loaded!.subsystemScores.memory).toBe(68);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run tests/executive/trend-store.vitest.ts --reporter verbose 2>&1 | tail -15
```

Expected: all tests pass (4).

- [ ] **Step 3: Commit**

```bash
git add tests/executive/trend-store.vitest.ts
git commit -m "P10.1: add trend store unit tests"
```

---
### Task 5: Modify the renderer to show priority

**Files:**
- Modify: `src/cli/commands/executive-dashboard-renderer.ts`

**Interfaces:**
- Consumes: `ExecutivePriorityReport` from Task 1
- Produces: Updated `renderExecutiveDashboard(healthReport, priorityReport, opts?)`

- [ ] **Step 1: Add the priority import and update the signature**

At the top of `src/cli/commands/executive-dashboard-renderer.ts`, add:

```ts
import type { ExecutivePriorityReport, ExecutiveSubsystemName } from "../../executive/priority-engine.js";
```

Update the function signature from:

```ts
export function renderExecutiveDashboard(
  report: ExecutiveHealthReport,
  opts: RenderOptions = {},
): void {
```

To:

```ts
export function renderExecutiveDashboard(
  report: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
  opts: RenderOptions = {},
): void {
```

- [ ] **Step 2: Update `renderHealthSummary` to show priority column**

Replace the existing `renderHealthSummary` function with one that reads from both reports:

```ts
function renderHealthSummary(
  healthReport: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
): void {
  console.log("\n[0] EXECUTIVE HEALTH SUMMARY");
  console.log(`Overall Score: ${healthReport.overallScore}\n`);
  console.log("  Subsystem      Score   Trend   Blast   Pri      Status");
  console.log("  -------------  -----   -----   -----   ------   --------------");
  for (const entry of priorityReport.priorities) {
    const status = healthReport.rankedSubsystems.find(
      (s) => s.subsystem === entry.subsystem,
    )?.status ?? "unknown";
    const emoji = STATUS_EMOJI[status as ExecutiveStatus] ?? "-";
    console.log(
      `  ${pad(entry.subsystem, 13)}  ${pad(String(entry.healthScore), 5)}  ${pad(String(entry.trendScore), 5)}  ${pad(String(entry.blastRadius), 5)}  ${pad(entry.priorityScore.toFixed(1), 6)}   ${emoji} ${status}`,
    );
  }
}
```

- [ ] **Step 3: Update `renderPriorities` to use priority report**

Replace the existing `renderPriorities` function:

```ts
function renderPriorities(priorityReport: ExecutivePriorityReport): void {
  const top3 = priorityReport.priorities.slice(0, 3);
  console.log(`\n[1] EXECUTIVE PRIORITIES (top ${top3.length})`);
  if (top3.length === 0) {
    console.log("  (none)");
    return;
  }
  top3.forEach((entry, i) => {
    console.log(`\n  ${i + 1}. ${capitalize(entry.subsystem)}`);
    console.log(`     Score: ${entry.healthScore} | Trend: ${entry.trendScore} | Blast: ${entry.blastRadius} | Pri: ${entry.priorityScore.toFixed(1)}`);
  });
}
```

- [ ] **Step 4: Update the main `renderExecutiveDashboard` function body**

Replace the function body that calls the helpers to pass both reports:

```ts
export function renderExecutiveDashboard(
  report: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
  opts: RenderOptions = {},
): void {
  if (opts.jsonMode) {
    console.log(JSON.stringify({ health: report, priority: priorityReport }, null, 2));
    return;
  }

  console.log("=".repeat(78));
  console.log("EXECUTIVE DASHBOARD");
  console.log(`Schema: ${report.schemaVersion}    Generated: ${report.generatedAt}    Window: ${report.windowDays}d`);
  console.log("=".repeat(78));

  renderHealthSummary(report, priorityReport);
  console.log("");
  renderPriorities(priorityReport);
  console.log("=".repeat(78));
}
```

- [ ] **Step 5: Run tsc**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean. Any type errors should be resolved by the import and signature updates.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/executive-dashboard-renderer.ts
git commit -m "P10.1: add priority column and trend/blast/pri to executive dashboard"
```

---
### Task 6: Modify the handler to run priority engine

**Files:**
- Modify: `src/cli/commands/executive-dashboard-handler.ts`

**Interfaces:**
- Consumes: `buildExecutiveHealthReport` (P10.0), `buildPriorityReport` (Task 1), `ExecutiveTrendStore` (Task 2), `renderExecutiveDashboard` (Task 5)
- Produces: Updated `runDashboard` that computes and persists priorities

- [ ] **Step 1: Add imports and call priority engine after aggregator**

Replace the content of `src/cli/commands/executive-dashboard-handler.ts`:

```ts
/**
 * P10.0 + P10.1 — Executive Dashboard CLI handler.
 *
 * Extracted to its own file so the dashboard sentinel can scan a precise
 * target. This handler coordinates the P10.0 health aggregator, the P10.1
 * priority engine, and the TrendStore.
 *
 * @module
 */

import { join } from "node:path";
import { buildExecutiveHealthReport } from "../../executive/executive-health.js";
import { buildPriorityReport } from "../../executive/priority-engine.js";
import { ExecutiveTrendStore } from "../../executive/trend-store.js";
import { renderExecutiveDashboard } from "./executive-dashboard-renderer.js";

const EXECUTIVE_DIR = join(".alix", "executive");

export async function runDashboard(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const cwd = process.cwd();

  let windowDays = 90;
  const windowIdx = args.indexOf("--window");
  if (windowIdx !== -1) {
    if (windowIdx + 1 >= args.length) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  // P10.0: Build health report
  const healthReport = await buildExecutiveHealthReport({ cwd, windowDays });

  // P10.1: Load prior trend snapshot
  const trendStore = new ExecutiveTrendStore(join(cwd, EXECUTIVE_DIR));
  const priorSnapshot = await trendStore.loadLatest();

  // P10.1: Build priority report
  const priorityReport = buildPriorityReport(healthReport, priorSnapshot);

  // P10.1: Persist current scores as a trend snapshot for future runs
  await trendStore.save(healthReport);

  // Render both reports
  renderExecutiveDashboard(healthReport, priorityReport, { jsonMode });
}
```

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/executive-dashboard-handler.ts
git commit -m "P10.1: integrate priority engine + TrendStore into dashboard handler"
```

---
### Task 7: Extend the purity sentinel

**Files:**
- Modify: `tests/executive/executive-sentinels.vitest.ts`

**Interfaces:**
- Consumes: the existing 10-file sentinel from P10.0
- Produces: Updated sentinel that adds the 2 new P10.1 files (priority-engine.ts, trend-store.ts) with a scoped write exception for trend-store.ts

- [ ] **Step 1: Read the existing sentinel file and add P10.1 files**

Add the 2 new P10.1 files to `EXECUTIVE_FILES`:

```ts
const EXECUTIVE_FILES = [
  "src/executive/executive-health.ts",
  "src/executive/priority-engine.ts",
  "src/executive/trend-store.ts",
  "src/executive/adapters/agent-health.ts",
  "src/executive/adapters/tool-health.ts",
  "src/executive/adapters/workflow-health.ts",
  "src/executive/adapters/memory-health.ts",
  "src/executive/adapters/security-health.ts",
  "src/executive/adapters/adaptation-health.ts",
  "src/cli/commands/executive-dashboard-renderer.ts",
  "src/cli/commands/executive-dashboard-handler.ts",
  "src/cli/commands/executive.ts",
];
```

Add a scoped write exception for the TrendStore's `save` method. The exception is implemented by exempting a specific file from the write-API substring check — but only for the `save` method. Use a precise check:

```ts
// Scoped write exception: trend-store.ts:save is the only approved write path
function checkLine(line: string, forbidden: string[], relPath: string, lineNum: number): void {
  for (const f of forbidden) {
    if (line.includes(f)) {
      // Allow trend-store.ts to call writeFileSync / mkdirSync / appendFileSync
      if (relPath === "src/executive/trend-store.ts" && (f === "writeFileSync" || f === "mkdirSync" || f === "appendFileSync")) {
        continue;
      }
      throw new Error(
        `P10.0 executive purity violation at ${relPath}:${lineNum}\n` +
        `  Found forbidden symbol: "${f}"\n` +
        `  The executive layer is read-only and must not import mutation write paths.\n` +
        `  TrendStore is the only approved exception (trend-store.ts).`,
      );
    }
  }
}
```

Add the fs write functions to `FORBIDDEN_IN_EXECUTIVE` (since they weren't needed for the P10.0 files):

```ts
const FORBIDDEN_IN_EXECUTIVE = [
  // ... existing entries ...
  "writeFileSync",
  "mkdirSync",
  "appendFileSync",
];
```

- [ ] **Step 2: Run the sentinel**

```bash
npx vitest run tests/executive/executive-sentinels.vitest.ts --reporter verbose 2>&1 | tail -10
```

Expected: 12 tests pass (2 new from P10.1). The `trend-store.ts` test passes because its `writeFileSync`/`mkdirSync`/`appendFileSync` calls are explicitly allowed.

- [ ] **Step 3: Commit**

```bash
git add tests/executive/executive-sentinels.vitest.ts
git commit -m "P10.1: extend purity sentinel with scoped TrendStore exception"
```

---
### Task 8: Full verification

**Files:** none new; verifies everything

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: all tests pass (existing + 8 priority + 4 trend + 2 sentinel = 14 new tests).

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit 2>&1
```

Expected: clean.

- [ ] **Step 3: Commit (only if there were verification fixes)**

If you made fixes during verification, commit them.

---
### Task 9: Final review and PR

- [ ] **Step 1: Verify the PR scope is clean**

```bash
git status --short
```

Expected: only the P10.1 files. Untracked working-tree noise (.alix/, docs/ALiX_End_Product_NonCode_Artifacts/) is fine to leave.

- [ ] **Step 2: Push and create the PR**

```bash
git push -u origin feature/p10-1-priority-engine
gh pr create --base main --head feature/p10-1-priority-engine \
  --title "P10.1 — Weighted Priority Engine (trend + blast radius)" \
  --body "Priority engine with extensible PriorityFactor[] model..."
```

- [ ] **Step 3: After PR approval and merge, tag**

```bash
git checkout main && git pull --ff-only
git tag alix-p10-1-complete
git push origin alix-p10-1-complete
```
