# P10.2 — Executive Objective Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ExecutiveObjective Engine — a pure-function layer that consumes P10.0 health, P10.1 priorities, and P9.6 investigations to produce 0–8 strategic objectives (one per subsystem).

**Architecture:** 1 new source file (types + pure generator), 1 new test file, 2 modified CLI files. All additive — no schema changes to existing types, no new store, no mutation path. Objectives computed ephemerally each dashboard run. Renderer grows from 2 panels to 4.

**Tech Stack:** TypeScript, Vitest, Node.js.

## Global Constraints

- No schema changes to P10.0 (`ExecutiveHealthReport`), P10.1 (`ExecutivePriorityReport`), or P9.6 (`InvestigationRecommendation`) types.
- No new store — objectives are computed fresh each dashboard run.
- No mutation/apply path.
- `generatedAt` on `ExecutiveObjectiveReport` must come from `healthReport.generatedAt` (not `new Date()`).
- At most one objective per subsystem (0–8 total).
- `derivedFrom.priorityReportGeneratedAt` uses `priorityReport.generatedAt` (P10.1 has no `id` field).
- All existing tests must pass.

---

### Task 1: objective-engine.ts — Types + pure generator

**Files:**
- Create: `src/executive/objective-engine.ts`
- Create: `tests/executive/objective-engine.vitest.ts`

**Interfaces:**
- Produces: `ExecutiveObjectiveType`, `ExecutiveObjectiveStatus`, `ExecutiveObjective`, `ExecutiveObjectiveReport`, `buildObjectiveReport()`

- [ ] **Step 1: Write the failing tests**

Create `tests/executive/objective-engine.vitest.ts`:

```typescript
/**
 * P10.2 — Executive Objective Engine tests.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { buildObjectiveReport } from "../../src/executive/objective-engine.js";
import type { ExecutiveHealthReport } from "../../src/executive/objective-engine.js"; // re-exported from executive-health
import type { ExecutivePriorityReport, ExecutivePriorityEntry } from "../../src/executive/objective-engine.js";
import type { InvestigationRecommendation } from "../../src/governance/investigation-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePriorityEntry(overrides: Partial<ExecutivePriorityEntry> = {}): ExecutivePriorityEntry {
  return {
    subsystem: "governance",
    healthScore: 65,
    healthDeficit: 35,
    trendScore: 25,
    blastRadius: 100,
    priorityScore: 65.0,
    factorBreakdown: [
      { name: "Health Deficit", weight: 0.6, value: 35 },
      { name: "Trend", weight: 0.25, value: 25 },
      { name: "Blast Radius", weight: 0.15, value: 100 },
    ],
    summary: "governance score 65, priority 65.0",
    ...overrides,
  };
}

function makeHealthReport(overrides: Partial<ExecutiveHealthReport> = {}): ExecutiveHealthReport {
  return {
    schemaVersion: "p10.0.0",
    generatedAt: "2026-06-24T12:00:00.000Z",
    windowDays: 90,
    overallScore: 75,
    rankedSubsystems: [
      { subsystem: "governance", score: 65, summary: "Governance health", status: "warning", topIssues: ["Chain coverage dropping"] },
      { subsystem: "security", score: 92, summary: "Security health", status: "healthy", topIssues: [] },
      { subsystem: "adaptation", score: 78, summary: "Adaptation health", status: "warning", topIssues: ["Success rate declining"] },
      { subsystem: "learning", score: 85, summary: "Learning health", status: "healthy", topIssues: [] },
      { subsystem: "memory", score: 88, summary: "Memory health", status: "healthy", topIssues: [] },
      { subsystem: "tools", score: 70, summary: "Tools health", status: "warning", topIssues: ["Tool reliability"] },
      { subsystem: "workflow", score: 82, summary: "Workflow health", status: "healthy", topIssues: [] },
      { subsystem: "agents", score: 90, summary: "Agent health", status: "healthy", topIssues: [] },
    ],
    ...overrides,
  };
}

function makePriorityReport(overrides: Partial<ExecutivePriorityReport> = {}): ExecutivePriorityReport {
  return {
    schemaVersion: "p10.1.0",
    generatedAt: "2026-06-24T12:00:00.000Z",
    windowDays: 90,
    priorities: [
      makePriorityEntry({ subsystem: "governance", healthScore: 65, priorityScore: 65.0 }),
      makePriorityEntry({ subsystem: "tools", healthScore: 70, priorityScore: 55.0 }),
      makePriorityEntry({ subsystem: "adaptation", healthScore: 78, priorityScore: 50.0 }),
      makePriorityEntry({ subsystem: "learning", healthScore: 85, priorityScore: 40.0 }),
      makePriorityEntry({ subsystem: "memory", healthScore: 88, priorityScore: 35.0 }),
      makePriorityEntry({ subsystem: "workflow", healthScore: 82, priorityScore: 30.0 }),
      makePriorityEntry({ subsystem: "agents", healthScore: 90, priorityScore: 25.0 }),
      makePriorityEntry({ subsystem: "security", healthScore: 92, priorityScore: 20.0 }),
    ],
    ...overrides,
  };
}

function makeInvestigation(overrides: Partial<InvestigationRecommendation> = {}): InvestigationRecommendation {
  return {
    id: "inv-001",
    kind: "chain_restoration",
    status: "open",
    severity: "high",
    source: "drift",
    sourceArtifactId: "drift-001",
    evidenceRefs: [],
    title: "Test investigation",
    description: "Test",
    operatorGuidance: "Investigate",
    createdAt: "2026-06-24T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildObjectiveReport", () => {
  it("returns at most one objective per subsystem (0–8)", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    expect(report.objectives.length).toBeLessThanOrEqual(8);
    const subsystems = report.objectives.map((o) => o.targetSubsystems[0]);
    const unique = new Set(subsystems);
    expect(unique.size).toBe(report.objectives.length);
  });

  it("assigns stabilize type to subsystems with score < 80 and high priority", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    const gov = report.objectives.find((o) => o.targetSubsystems[0] === "governance");
    expect(gov).toBeDefined();
    expect(gov!.objectiveType).toBe("stabilize");
  });

  it("assigns investigate type when investigations exist for a subsystem", () => {
    const health = makeHealthReport();
    // Make governance high enough score so it doesn't qualify for stabilize
    health.rankedSubsystems[0] = { subsystem: "governance", score: 85, summary: "ok", status: "healthy", topIssues: [] };
    const priority = makePriorityReport();
    priority.priorities[0] = makePriorityEntry({ subsystem: "governance", healthScore: 85, priorityScore: 40 });
    const investigations = [
      makeInvestigation({ id: "inv-gov", sourceArtifactId: "gov-drift" }),
    ];

    const report = buildObjectiveReport(health, priority, investigations);
    const gov = report.objectives.find((o) => o.targetSubsystems[0] === "governance");
    expect(gov).toBeDefined();
    expect(gov!.objectiveType).toBe("investigate");
    expect(gov!.supportingInvestigations).toContain("inv-gov");
  });

  it("assigns improve type to healthy subsystems (score >= 80) without investigations", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    const learning = report.objectives.find((o) => o.targetSubsystems[0] === "learning");
    expect(learning).toBeDefined();
    expect(learning!.objectiveType).toBe("improve");
  });

  it("assigns maintain type to subsystems with score >= 90, no investigations, stable", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    const security = report.objectives.find((o) => o.targetSubsystems[0] === "security");
    expect(security).toBeDefined();
    expect(security!.objectiveType).toBe("maintain");
  });

  it("computes objectiveScore using the 4-component weighted formula", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    const gov = report.objectives.find((o) => o.targetSubsystems[0] === "governance");
    expect(gov).toBeDefined();
    expect(gov!.objectiveScore).toBeGreaterThan(0);
    expect(gov!.objectiveScore).toBeLessThanOrEqual(100);
    // governance: priorityScore=65, healthImpact=35, persistenceScore=25, investigationPressure=0
    // expected: 65*0.4 + 35*0.3 + 25*0.2 + 0*0.1 = 26 + 10.5 + 5 + 0 = 41.5
    expect(gov!.objectiveScore).toBeCloseTo(41.5, 1);
  });

  it("separates priorityScore (from P10.1) from objectiveScore (computed by P10.2)", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    const obj = report.objectives[0];
    expect(obj.priorityScore).toBeDefined();
    expect(obj.objectiveScore).toBeDefined();
    expect(obj.priorityScore).not.toEqual(obj.objectiveScore);
  });

  it("includes derivedFrom provenance with priorityReportGeneratedAt and investigationIds", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    const obj = report.objectives[0];
    expect(obj.derivedFrom).toBeDefined();
    expect(obj.derivedFrom.priorityReportGeneratedAt).toBe("2026-06-24T12:00:00.000Z");
    expect(Array.isArray(obj.derivedFrom.investigationIds)).toBe(true);
  });

  it("sorts objectives by objectiveScore descending", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    for (let i = 1; i < report.objectives.length; i++) {
      expect(report.objectives[i - 1].objectiveScore).toBeGreaterThanOrEqual(report.objectives[i].objectiveScore);
    }
  });

  it("sets generatedAt from healthReport.generatedAt (not fresh Date)", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    expect(report.generatedAt).toBe("2026-06-24T12:00:00.000Z");
  });

  it("sets schemaVersion to p10.2.0", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    expect(report.schemaVersion).toBe("p10.2.0");
  });

  it("has status proposed on all new objectives", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    for (const obj of report.objectives) {
      expect(obj.status).toBe("proposed");
    }
  });

  it("includes evidenceRefs on every objective", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    for (const obj of report.objectives) {
      expect(Array.isArray(obj.evidenceRefs)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/executive/objective-engine.vitest.ts`
Expected: FAIL — "Cannot find module" (module not yet implemented)

- [ ] **Step 3: Write the objective-engine.ts implementation**

Create `src/executive/objective-engine.ts`:

```typescript
/**
 * P10.2 — Executive Objective Engine.
 *
 * Pure function layer that consumes P10.0 health, P10.1 priorities, and P9.6
 * investigations to produce 0–8 strategic ExecutiveObjective records.
 *
 * Core invariants:
 *  - At most one objective per subsystem.
 *  - No store access — objectives computed fresh each dashboard run.
 *  - No mutation/apply path.
 *
 * @module
 */

import type { ExecutiveHealthReport } from "./executive-health.js";
import type { ExecutivePriorityReport, ExecutivePriorityEntry } from "./priority-engine.js";
import type { InvestigationRecommendation } from "../governance/investigation-types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExecutiveObjectiveType =
  | "stabilize"
  | "investigate"
  | "improve"
  | "maintain";

export type ExecutiveObjectiveStatus =
  | "proposed"
  | "accepted"
  | "active"
  | "completed"
  | "superseded";

export interface ExecutiveObjective {
  id: string;
  title: string;
  description: string;
  objectiveType: ExecutiveObjectiveType;
  status: ExecutiveObjectiveStatus;

  /** Inherited from P10.1 — executive urgency. */
  priorityScore: number;
  /** Computed by P10.2 — strategic importance. */
  objectiveScore: number;

  rationale: string;
  evidenceRefs: string[];
  suggestedActions: string[];

  /** Subsystem(s) this objective targets. */
  targetSubsystems: string[];

  /** P9.6 investigation ids that support this objective. */
  supportingInvestigations: string[];

  /** Explicit provenance — for explainability. */
  derivedFrom: {
    priorityReportGeneratedAt: string;
    investigationIds: string[];
  };

  blockers: string[];
  generatedAt: string;
}

export interface ExecutiveObjectiveReport {
  schemaVersion: "p10.2.0";
  generatedAt: string;
  windowDays: number;
  /** Sorted by objectiveScore descending. 0–8 entries. */
  objectives: ExecutiveObjective[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STABILIZE_THRESHOLD = 80;
const PERSISTENCE_WINDOWS = 3; // Number of windows to consider "persistent"

// ---------------------------------------------------------------------------
// Objective scoring
// ---------------------------------------------------------------------------

interface ObjectiveScoreInputs {
  priorityScore: number;       // from P10.1
  healthScore: number;         // from P10.0
  persistenceScore: number;    // trend component from P10.1
  investigationCount: number;  // count of open investigations
}

function computeObjectiveScore(inputs: ObjectiveScoreInputs): number {
  const healthImpact = 100 - inputs.healthScore;
  const investigationPressure = Math.min(inputs.investigationCount * 10, 100);

  return Math.round(
    inputs.priorityScore * 0.40
    + healthImpact * 0.30
    + inputs.persistenceScore * 0.20
    + investigationPressure * 0.10,
  );
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function shortId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36).slice(-6);
  return `${prefix}-${ts}-${rand}`;
}

function classifyObjectiveType(
  healthScore: number,
  priorityScore: number,
  topPriorityScore: number,
  investigationCount: number,
): { type: ExecutiveObjectiveType; rationale: string } {
  // stabilize: health < threshold AND priority in top 3
  if (healthScore < STABILIZE_THRESHOLD && priorityScore >= topPriorityScore * 0.6) {
    return {
      type: "stabilize",
      rationale: `Subsystem health is ${healthScore} (below ${STABILIZE_THRESHOLD}) with elevated priority. Requires immediate stabilization.`,
    };
  }

  // investigate: has open investigations
  if (investigationCount > 0) {
    return {
      type: "investigate",
      rationale: `${investigationCount} open investigation(s) require operator diagnosis and remediation.`,
    };
  }

  // improve: healthy but room for growth
  if (healthScore >= STABILIZE_THRESHOLD && healthScore < 90) {
    return {
      type: "improve",
      rationale: `Subsystem health is ${healthScore} — stable with measurable opportunity for improvement.`,
    };
  }

  // maintain: everything healthy
  return {
    type: "maintain",
    rationale: `Subsystem health is ${healthScore} with no active issues. Maintain current trajectory.`,
  };
}

// ---------------------------------------------------------------------------
// Objective builder
// ---------------------------------------------------------------------------

function buildObjectiveForSubsystem(
  subsystem: string,
  healthScore: number,
  priorityEntry: ExecutivePriorityEntry,
  investigations: InvestigationRecommendation[],
  topPriorityScore: number,
  generatedAt: string,
): ExecutiveObjective {
  const subsystemInvestigations = investigations.filter(
    (inv) => inv.status === "open" && (
      inv.sourceArtifactId.includes(subsystem) ||
      subsystem.includes(inv.kind.replace("_", ""))
    ),
  );

  const { type, rationale } = classifyObjectiveType(
    healthScore,
    priorityEntry.priorityScore,
    topPriorityScore,
    subsystemInvestigations.length,
  );

  const objectiveScore = computeObjectiveScore({
    priorityScore: priorityEntry.priorityScore,
    healthScore,
    persistenceScore: priorityEntry.trendScore,
    investigationCount: subsystemInvestigations.length,
  });

  // Build a subjective but descriptive action list
  const suggestedActions = buildSuggestedActions(type, subsystem, healthScore);

  return {
    id: shortId("obj"),
    title: `${capitalize(type)} ${capitalizeFirst(subsystem)}`,
    description: `${capitalize(type)} objective for ${subsystem} (score: ${healthScore}). ${rationale}`,
    objectiveType: type,
    status: "proposed" as ExecutiveObjectiveStatus,
    priorityScore: priorityEntry.priorityScore,
    objectiveScore,
    rationale,
    evidenceRefs: [priorityEntry.summary],
    suggestedActions,
    targetSubsystems: [subsystem],
    supportingInvestigations: subsystemInvestigations.map((i) => i.id),
    derivedFrom: {
      priorityReportGeneratedAt: generatedAt,
      investigationIds: subsystemInvestigations.map((i) => i.id),
    },
    blockers: [],
    generatedAt,
  };
}

function buildSuggestedActions(type: ExecutiveObjectiveType, subsystem: string, _score: number): string[] {
  void _score;
  switch (type) {
    case "stabilize":
      return [
        `Investigate root causes of ${subsystem} degradation`,
        `Review recent changes affecting ${subsystem}`,
        `Create remediation proposals for ${subsystem}`,
      ];
    case "investigate":
      return [
        `Triage open ${subsystem} investigations`,
        `Assign ownership to responsible team`,
        `Track investigation resolution progress`,
      ];
    case "improve":
      return [
        `Identify optimization opportunities in ${subsystem}`,
        `Review ${subsystem} metrics for improvement areas`,
        `Consider automation or configuration updates`,
      ];
    case "maintain":
      return [
        `Continue monitoring ${subsystem} health`,
        `Run regular ${subsystem} health checks`,
        `Document current ${subsystem} state as baseline`,
      ];
  }
}

// ---------------------------------------------------------------------------
// buildObjectiveReport — top-level generator
// ---------------------------------------------------------------------------

/**
 * Pure function: consume P10.0 health, P10.1 priorities, and P9.6 investigations
 * to produce an ExecutiveObjectiveReport with 0–8 objectives (at most one per subsystem).
 *
 * Objectives are classified as stabilize / investigate / improve / maintain,
 * scored by the 4-component weighted formula, and sorted by objectiveScore descending.
 */
export function buildObjectiveReport(
  healthReport: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
  investigations: InvestigationRecommendation[],
): ExecutiveObjectiveReport {
  const generatedAt = healthReport.generatedAt;
  const topPriorityScore = priorityReport.priorities[0]?.priorityScore ?? 0;

  const objectives: ExecutiveObjective[] = [];

  for (const sub of healthReport.rankedSubsystems) {
    const priorityEntry = priorityReport.priorities.find(
      (p) => p.subsystem === sub.subsystem,
    );
    if (!priorityEntry) continue;

    const obj = buildObjectiveForSubsystem(
      sub.subsystem,
      sub.score,
      priorityEntry,
      investigations,
      topPriorityScore,
      generatedAt,
    );

    objectives.push(obj);
  }

  // Sort by objectiveScore descending
  objectives.sort((a, b) => b.objectiveScore - a.objectiveScore);

  return {
    schemaVersion: "p10.2.0",
    generatedAt,
    windowDays: healthReport.windowDays,
    objectives,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/executive/objective-engine.vitest.ts`
Expected: PASS (all ~12 tests)

- [ ] **Step 5: Run tsc**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/executive/objective-engine.ts tests/executive/objective-engine.vitest.ts
git commit -m "feat(p10.2): add Executive Objective Engine types + pure generator"
```

---

### Task 2: Dashboard renderer — add Objectives panel

**Files:**
- Modify: `src/cli/commands/executive-dashboard-renderer.ts`

**Interfaces:**
- Consumes: `ExecutiveObjectiveReport` from `objective-engine.js`
- Produces: Updated `renderExecutiveDashboard` with 4th panel

- [ ] **Step 1: Add import and update signature**

Add import at the top of `executive-dashboard-renderer.ts`:

```typescript
import type { ExecutiveObjectiveReport } from "../../executive/objective-engine.js";
```

Update the function signature:

```typescript
export function renderExecutiveDashboard(
  report: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
  objectiveReport: ExecutiveObjectiveReport,
  opts: RenderOptions = {},
): void {
```

- [ ] **Step 2: Update the JSON output and text output**

Update the JSON block:

```typescript
if (opts.jsonMode) {
  console.log(JSON.stringify({
    health: report,
    priority: priorityReport,
    objectives: objectiveReport,
  }, null, 2));
  return;
}
```

Add the Objectives panel after `renderPriorities`:

```typescript
renderHealthSummary(report, priorityReport);
console.log("");
renderPriorities(priorityReport);
console.log("");
renderObjectives(objectiveReport);    // NEW
console.log("=".repeat(78));
```

- [ ] **Step 3: Add the renderObjectives function**

Add after the `renderPriorities` function:

```typescript
function renderObjectives(objectiveReport: ExecutiveObjectiveReport): void {
  console.log(`\n[2] EXECUTIVE OBJECTIVES (${objectiveReport.objectives.length})`);
  if (objectiveReport.objectives.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const obj of objectiveReport.objectives) {
    const typeColor = obj.objectiveType === "stabilize" ? RED
      : obj.objectiveType === "investigate" ? YELLOW
      : obj.objectiveType === "improve" ? CYAN
      : GREEN;
    const typeIcon = obj.objectiveType === "stabilize" ? "🔴"
      : obj.objectiveType === "investigate" ? "🟡"
      : obj.objectiveType === "improve" ? "🔵"
      : "🟢";
    console.log(
      `\n  ${typeIcon} ${typeColor}${capitalize(obj.objectiveType)}${RESET}: ${obj.title}`,
    );
    console.log(`     Score: ${obj.objectiveScore} | Priority: ${obj.priorityScore} | Target: ${obj.targetSubsystems.join(", ")}`);
    if (obj.supportingInvestigations.length > 0) {
      console.log(`     Investigations: ${obj.supportingInvestigations.length} open`);
    }
  }
}
```

Add necessary constants and helpers at the top if not already present. The file already has `RESET`, `BOLD`, `DIM`, `GREEN`, `YELLOW`, `RED`, `CYAN`. Ensure `capitalize` exists or add it.

- [ ] **Step 4: Update import and exports**

Make sure `ExecutiveObjectiveReport` is imported and the `renderObjectives` helper is accessible.

- [ ] **Step 5: Run tsc**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/executive-dashboard-renderer.ts
git commit -m "feat(p10.2): add Objectives panel to executive dashboard renderer"
```

---

### Task 3: Dashboard handler — integrate objective engine + P9.6 investigations

**Files:**
- Modify: `src/cli/commands/executive-dashboard-handler.ts`

**Interfaces:**
- Consumes: `buildObjectiveReport`, `InvestigationStore`, `GovernanceStore`, `listCompatibleInvestigations`

- [ ] **Step 1: Update imports**

Add to the top of `executive-dashboard-handler.ts`:

```typescript
import { buildObjectiveReport } from "../../executive/objective-engine.js";
import { GovernanceStore } from "../../governance/governance-store.js";
import { InvestigationStore } from "../../governance/investigation-store.js";
import { listCompatibleInvestigations } from "../../governance/investigation-compat.js";
```

- [ ] **Step 2: Update the runDashboard function**

After the trendStore.save(healthReport) call, add:

```typescript
  // P10.2: Load P9.6 investigations and build objective report
  const govStore = new GovernanceStore(join(cwd, ".alix", "governance"));
  const invStore = new InvestigationStore(join(cwd, ".alix", "governance"));
  const investigations = await listCompatibleInvestigations(govStore, invStore);
  const objectiveReport = buildObjectiveReport(healthReport, priorityReport, investigations);

  // Render all 3 reports
  renderExecutiveDashboard(healthReport, priorityReport, objectiveReport, { jsonMode });
```

Also update the render call parameter to pass the new objective report.

- [ ] **Step 3: Run tsc**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/executive-dashboard-handler.ts
git commit -m "feat(p10.2): integrate objective engine + P9.6 investigations into dashboard handler"
```

---

### Task 4: CLI tests — update JSON assertions

**Files:**
- Modify: `tests/cli/commands/executive-dashboard-cli.vitest.ts`

- [ ] **Step 1: Update the JSON test**

Read the existing JSON test (around line 49). Update it to also check the new objectives field:

```typescript
it("emits valid JSON in --json mode", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const { runDashboard } = await import("../../../src/cli/commands/executive-dashboard-handler.js");
  await runDashboard(["--json"]);
  const out = log.mock.calls.map((c: unknown[]) => String(c[0])).join("");
  log.mockRestore();
  const parsed = JSON.parse(out);
  expect(parsed.health.schemaVersion).toBe("p10.0.0");
  expect(parsed.health.rankedSubsystems).toBeDefined();
  expect(parsed.health.rankedSubsystems.length).toBe(8);
  expect(parsed.priority.schemaVersion).toBe("p10.1.0");
  expect(parsed.priority.priorities.length).toBe(8);
  expect(parsed.objectives.schemaVersion).toBe("p10.2.0");
  expect(Array.isArray(parsed.objectives.objectives)).toBe(true);
});
```

The existing test already checks `parsed.health` and `parsed.priority`. We're adding `parsed.objectives` assertions.

- [ ] **Step 2: Update the "renders 3 panel headers" test to expect 4**

The existing test checks for `EXECUTIVE DASHBOARD`, `EXECUTIVE HEALTH SUMMARY`, and `EXECUTIVE PRIORITIES`. Add a check for `EXECUTIVE OBJECTIVES`:

```typescript
it("renders 4 panel headers in text mode", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const { runDashboard } = await import("../../../src/cli/commands/executive-dashboard-handler.js");
  await runDashboard([]);
  const out = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
  log.mockRestore();
  expect(out).toContain("EXECUTIVE DASHBOARD");
  expect(out).toContain("EXECUTIVE HEALTH SUMMARY");
  expect(out).toContain("EXECUTIVE PRIORITIES");
  expect(out).toContain("EXECUTIVE OBJECTIVES");
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/cli/commands/executive-dashboard-cli.vitest.ts`
Expected: PASS

- [ ] **Step 4: Run full suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add tests/cli/commands/executive-dashboard-cli.vitest.ts
git commit -m "test(p10.2): update CLI tests for 4-panel executive dashboard"
```

---

### Task 5: Sentinel verification + full suite

**Files:**
- Verify: `tests/executive/executive-sentinels.vitest.ts` doesn't need changes

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All existing tests pass

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 3: Update progress ledger**

Append to `.superpowers/sdd/progress.md`:

```markdown
## P10.2 — Executive Objective Engine subagent-driven progress

Branch: feature/p10-2-executive-objective-engine
Plan: docs/superpowers/plans/2026-06-24-p10-2-executive-objective-engine.md

Task 1: complete (objective-engine.ts + tests)
Task 2: complete (renderer Objectives panel)
Task 3: complete (handler integration)
Task 4: complete (CLI tests updated)
Task 5: complete (sentinel verification + full suite)
```

## Self-Review

**Spec coverage check:**
- `ExecutiveObjective` type with separate `priorityScore` / `objectiveScore` ✅ (Task 1)
- `ExecutiveObjectiveType` with 4 strategies ✅ (Task 1)
- `ExecutiveObjectiveStatus` with 5 lifecycle states ✅ (Task 1)
- `derivedFrom` provenance with `priorityReportGeneratedAt` ✅ (Task 1)
- At most one objective per subsystem ✅ (Task 1 — forEach loops over rankedSubsystems, one per entry)
- Classification logic: stabilize > investigate > improve > maintain ✅ (Task 1)
- `objectiveScore` formula using 4-component weighted formula ✅ (Task 1 — computeObjectiveScore)
- `generatedAt` from healthReport (not fresh Date) ✅ (Task 1)
- Objectives sorted by objectiveScore descending ✅ (Task 1)
- Dashboard renders 4 panels ✅ (Task 2)
- CLI `--json` includes all 4 reports ✅ (Task 2, updated in Task 4)
- No existing schema changes ✅ (imports only)
- No new store ✅ (computed ephemerally)

**No placeholders found.** All steps have complete code and exact commands.

**Type consistency:** `ExecutiveObjectiveReport` flows from Task 1 → Task 2 (renderer) → Task 3 (handler) → Task 4 (tests) consistently. `ExecutiveObjective` type is defined in `objective-engine.ts` and consumed by all tasks.
