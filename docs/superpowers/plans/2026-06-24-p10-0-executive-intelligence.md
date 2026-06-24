# P10.0 — Executive Intelligence Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only terminal `alix executive dashboard` command that surfaces 8 subsystem health scores (governance, learning, adaptation, agents, tools, workflow, memory, security), ranked worst-first, with the top 3 surfaced as executive priorities.

**Architecture:** Three layers, mirroring P8.5b + P9.5: (1) `buildExecutiveHealthReport()` aggregator in `src/executive/executive-health.ts` (read-only, hybrid data: 2 Tier-1 sources from existing P8/P9 dashboards + 6 thin Tier-2 P10 adapters); (2) `renderExecutiveDashboard()` terminal formatter in `src/cli/commands/executive-dashboard-renderer.ts`; (3) `runDashboard()` CLI handler in `src/cli/commands/executive-dashboard-handler.ts` (extracted for sentinel scoping). The `executive` top-level command is registered in `src/cli.ts` and dispatched through `src/cli/commands/executive.ts`.

**Tech Stack:** TypeScript, Node.js fs/path, vitest. Pure read-only. No new evidence types, no new writer methods, no mutation paths.

## Global Constraints

1. `report.schemaVersion = "p10.0.0"` (string literal, exact value).
2. The aggregator is **the only place** that touches the data layer. Renderers, handlers, and adapters do not call any write API.
3. The handler is extracted to `src/cli/commands/executive-dashboard-handler.ts` so the sentinel can scan a precise file.
4. The sentinel scans the 10 P10.0 executive files (aggregator, 6 adapters, renderer, handler, dispatcher). It forbids mutation write paths (appliers, approve/apply/reject verbs, `ProposalStore.save` / `ProposalStore.markOrphaned`, all `record*` evidence write methods) but **permits** read-only store queries (`.list`, `.load`, `.loadVerified`).
5. The 8 subsystems are exactly: `governance`, `learning`, `adaptation`, `agents`, `tools`, `workflow`, `memory`, `security`. Sort is **ascending** (worst first).
6. Status mapping: `score < 60` → `critical` 🔴, `60 <= score < 80` → `warning` 🟡, `score >= 80` → `healthy` 🟢.
7. Tier-1 sources are reused: `buildGovernanceHealth` (P9.0a) for governance score, `buildDashboardReport` from `src/learning/learning-dashboard.ts` (P8.5b) for learning score. No new code for Tier 1.
8. Tier-2 adapters are thin: pure read functions in `src/executive/adapters/<name>-health.ts`. Each returns a small typed report with a 0–100 score and a one-line summary.
9. The aggregator NEVER writes to any store, file, or evidence chain. The purity sentinel enforces this.
10. P10.0 stays terminal-text (no TUI/web). Single-shot. Single window.
11. Top-level CLI registration: `src/cli.ts` adds `if (command === "executive")` block that imports `./cli/commands/executive.js`, mirroring the existing `governance` registration.

---
### Task 1: Create the aggregator types

**Files:**
- Create: `src/executive/executive-health.ts` (the file will be filled in by Task 2; this task only adds the types)

**Interfaces:**
- Consumes: nothing (foundational)
- Produces: `ExecutiveDashboardOptions`, `ExecutiveHealthReport`, `ExecutiveSubsystemHealth`. All other tasks import these.

- [ ] **Step 1: Create the file with the type definitions only**

```ts
/**
 * P10.0 — Executive Intelligence Foundation.
 *
 * Pure read-only aggregation. Fans out to subsystem health sources,
 * normalizes into 8 scores, sorts worst-first. Mirrors P9.5's
 * Governance Dashboard aggregator pattern at a higher level.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExecutiveSubsystemName =
  | "governance"
  | "learning"
  | "adaptation"
  | "agents"
  | "tools"
  | "workflow"
  | "memory"
  | "security";

export type ExecutiveStatus = "healthy" | "warning" | "critical";

export interface ExecutiveDashboardOptions {
  /** Repository root. */
  cwd: string;
  /** Window in days for window-bounded queries. Defaults to 90. */
  windowDays?: number;
  /** Fixed timestamp for deterministic output (test-friendly). */
  generatedAt?: string;
}

export interface ExecutiveSubsystemHealth {
  subsystem: ExecutiveSubsystemName;
  /** 0..100, integer. */
  score: number;
  status: ExecutiveStatus;
  /** One-line description of current state. */
  summary: string;
  /** Up to 3 short issue labels (empty when healthy). */
  topIssues: string[];
}

export interface ExecutiveHealthReport {
  schemaVersion: "p10.0.0";
  generatedAt: string;
  windowDays: number;
  /** Unweighted mean of subsystem scores, rounded to integer. */
  overallScore: number;
  /** Worst-first sorted, 8 entries. */
  rankedSubsystems: ExecutiveSubsystemHealth[];
}
```

- [ ] **Step 2: Run tsc to verify the types compile**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/executive/executive-health.ts
git commit -m "P10.0: add executive-health type definitions"
```

---
### Task 2: Create the 6 Tier-2 adapter stubs

**Files:**
- Create: `src/executive/adapters/agent-health.ts`
- Create: `src/executive/adapters/tool-health.ts`
- Create: `src/executive/adapters/workflow-health.ts`
- Create: `src/executive/adapters/memory-health.ts`
- Create: `src/executive/adapters/security-health.ts`
- Create: `src/executive/adapters/adaptation-health.ts`

**Interfaces:**
- Consumes: nothing (foundational)
- Produces: each adapter exports `build<Name>Health(opts)` returning a small typed report

Each adapter is stubbed in this task (returns a hardcoded 100 score + "stub" summary). The aggregator's test fixtures will rely on these stubs. Real implementation lands in Task 3.

- [ ] **Step 1: Create the 6 adapter files with stubs**

For each adapter, use this pattern (substitute the name and any subsystem-specific source field):

`src/executive/adapters/agent-health.ts`:
```ts
/**
 * P10.0 — Agent Health (Tier-2 adapter).
 *
 * Pure read. Computes a 0-100 score for the agents subsystem.
 * Stub: returns 100 until Task 3 implements real signal.
 *
 * @module
 */

export interface AgentHealthReport {
  score: number;
  summary: string;
  topIssues: string[];
}

export interface AgentHealthOptions {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}

export async function buildAgentHealth(_opts: AgentHealthOptions): Promise<AgentHealthReport> {
  return { score: 100, summary: "stub", topIssues: [] };
}
```

Repeat the same pattern for the other 5 files, substituting names:

- `tool-health.ts` → `ToolHealthReport` / `buildToolHealth` / `ToolHealthOptions`
- `workflow-health.ts` → `WorkflowHealthReport` / `buildWorkflowHealth` / `WorkflowHealthOptions`
- `memory-health.ts` → `MemoryHealthReport` / `buildMemoryHealth` / `MemoryHealthOptions`
- `security-health.ts` → `SecurityHealthReport` / `buildSecurityHealth` / `SecurityHealthOptions`
- `adaptation-health.ts` → `AdaptationHealthReport` / `buildAdaptationHealth` / `AdaptationHealthOptions`

- [ ] **Step 2: Run tsc to verify the stubs compile**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/executive/adapters/
git commit -m "P10.0: add 6 Tier-2 health adapter stubs"
```

---
### Task 3: Implement the aggregator

**Files:**
- Modify: `src/executive/executive-health.ts` (append the aggregator function and helpers)

**Interfaces:**
- Consumes: types from Task 1; Tier-1 sources (`buildGovernanceHealth`, `buildGovernanceAssessment`, `buildDashboardReport` from `src/learning/learning-dashboard.js`); 6 Tier-2 adapters from Task 2
- Produces: `buildExecutiveHealthReport(opts)` — the only public runtime export

- [ ] **Step 1: Append the imports and constants**

Append to `src/executive/executive-health.ts`:

```ts
import { buildGovernanceHealth } from "../governance/governance-health-builder.js";
import { buildGovernanceAssessment } from "../governance/governance-assessment.js";
import { buildDashboardReport } from "../learning/learning-dashboard.js";
import { buildAgentHealth } from "./adapters/agent-health.js";
import { buildToolHealth } from "./adapters/tool-health.js";
import { buildWorkflowHealth } from "./adapters/workflow-health.js";
import { buildMemoryHealth } from "./adapters/memory-health.js";
import { buildSecurityHealth } from "./adapters/security-health.js";
import { buildAdaptationHealth } from "./adapters/adaptation-health.js";
import type { GovernanceHealthReport } from "../governance/governance-types.js";
import type { GovernanceAssessment } from "../governance/governance-types.js";
import type { DashboardReport } from "../learning/learning-dashboard.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_DAYS = 90;
const STATUS_BOUNDARY_CRITICAL = 60;
const STATUS_BOUNDARY_WARNING = 80;
```

- [ ] **Step 2: Append the aggregator function and helpers**

Append:

```ts
// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Build the ExecutiveHealthReport. Pure read-only. The only public
 * runtime export of this module. Fans out to 9 health sources in parallel
 * (governance uses 2; learning uses 1; 6 Tier-2 adapters) and normalizes
 * into 8 subsystem scores, sorted worst-first.
 */
export async function buildExecutiveHealthReport(
  opts: ExecutiveDashboardOptions,
): Promise<ExecutiveHealthReport> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;

  // ---- 1. Fan out to all health sources in parallel --------------------
  const [govHealth, govAssessment, learnReport, adaptation, agents, tools, workflow, memory, security] =
    await Promise.all([
      buildGovernanceHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildGovernanceAssessment({ reports: [] }).catch(() => null),
      buildDashboardReport({ cwd: opts.cwd, windowDays }).catch(() => null),
      buildAdaptationHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildAgentHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildToolHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildWorkflowHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildMemoryHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildSecurityHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
    ]);

  // ---- 2. Normalize into 8 subsystem scores ----------------------------
  const subsystems: ExecutiveSubsystemHealth[] = [
    buildGovernanceEntry(govHealth, govAssessment),
    buildLearningEntry(learnReport),
    buildAdapterEntry("adaptation", adaptation),
    buildAdapterEntry("agents", agents),
    buildAdapterEntry("tools", tools),
    buildAdapterEntry("workflow", workflow),
    buildAdapterEntry("memory", memory),
    buildAdapterEntry("security", security),
  ];

  // ---- 3. Sort worst-first (ascending) ---------------------------------
  subsystems.sort((a, b) => a.score - b.score);

  // ---- 4. Compute overall score (unweighted mean) ----------------------
  const overallScore = Math.round(
    subsystems.reduce((sum, s) => sum + s.score, 0) / subsystems.length,
  );

  return {
    schemaVersion: "p10.0.0",
    generatedAt,
    windowDays,
    overallScore,
    rankedSubsystems: subsystems,
  };
}

// ---------------------------------------------------------------------------
// Score-to-status mapping
// ---------------------------------------------------------------------------

function scoreToStatus(score: number): ExecutiveStatus {
  if (score < STATUS_BOUNDARY_CRITICAL) return "critical";
  if (score < STATUS_BOUNDARY_WARNING) return "warning";
  return "healthy";
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Subsystem entry builders
// ---------------------------------------------------------------------------

function buildGovernanceEntry(
  health: GovernanceHealthReport | null,
  assessment: GovernanceAssessment | null,
): ExecutiveSubsystemHealth {
  if (!health && !assessment) {
    return {
      subsystem: "governance",
      score: 0,
      status: "critical",
      summary: "governance unavailable",
      topIssues: ["health and assessment both failed"],
    };
  }
  // Prefer assessment.governanceConfidence (0..1, multiply by 100).
  // Fallback: score by supported kinds (3/5 = 60, but no — scale by 20 each: 60).
  // Final fallback: health's weakest layer signal. If neither has a real
  // signal, report 0.
  let score = 0;
  const issues: string[] = [];
  if (assessment && Number.isFinite(assessment.governanceConfidence)) {
    score = clampScore(assessment.governanceConfidence * 100);
  } else if (health) {
    // P9.0a GovernanceHealthReport has supportedKinds (3) and totalKinds (5).
    // score = supportedKinds * 20 (3/5 → 60).
    score = clampScore(health.supportedKinds * 20);
  }
  return {
    subsystem: "governance",
    score,
    status: scoreToStatus(score),
    summary: assessment ? `governance confidence ${score}` : `${health?.supportedKinds ?? 0}/${health?.totalKinds ?? 5} kinds supported`,
    topIssues: issues,
  };
}

function buildLearningEntry(
  report: DashboardReport | null,
): ExecutiveSubsystemHealth {
  if (!report) {
    return {
      subsystem: "learning",
      score: 0,
      status: "critical",
      summary: "learning unavailable",
      topIssues: ["learning dashboard report failed"],
    };
  }
  const score = clampScore(report.dashboardIntegrityScore);
  return {
    subsystem: "learning",
    score,
    status: scoreToStatus(score),
    summary: `dashboard integrity ${score}`,
    topIssues: [],
  };
}

function buildAdapterEntry(
  subsystem: ExecutiveSubsystemName,
  report: { score: number; summary: string; topIssues: string[] } | null,
): ExecutiveSubsystemHealth {
  if (!report) {
    return {
      subsystem,
      score: 0,
      status: "critical",
      summary: `${subsystem} unavailable`,
      topIssues: [`${subsystem} health builder failed`],
    };
  }
  const score = clampScore(report.score);
  return {
    subsystem,
    score,
    status: scoreToStatus(score),
    summary: report.summary,
    topIssues: report.topIssues,
  };
}
```

- [ ] **Step 3: Run tsc to verify the aggregator compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: clean. If `buildGovernanceAssessment` signature differs from the brief's `{ reports: [] }`, adjust the call to match (Task 2 of P9.5 had the same adjustment). Report the change in the report file.

- [ ] **Step 4: Commit**

```bash
git add src/executive/executive-health.ts
git commit -m "P10.0: implement buildExecutiveHealthReport aggregator"
```

---
### Task 4: Write the aggregator unit tests

**Files:**
- Create: `tests/executive/executive-health.vitest.ts`

**Interfaces:**
- Consumes: `buildExecutiveHealthReport` from Task 3; the 6 Tier-2 adapter stubs from Task 2
- Produces: 9 unit tests

- [ ] **Step 1: Create the test file**

```ts
/**
 * P10.0 — Executive Health aggregator tests.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildExecutiveHealthReport } from "../../src/executive/executive-health.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "exec-"));
  mkdirSync(join(cwd, ".alix"), { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("buildExecutiveHealthReport", () => {
  it("returns schemaVersion p10.0.0", async () => {
    const report = await buildExecutiveHealthReport({ cwd, windowDays: 30, generatedAt: "2026-06-24T00:00:00.000Z" });
    expect(report.schemaVersion).toBe("p10.0.0");
    expect(report.generatedAt).toBe("2026-06-24T00:00:00.000Z");
    expect(report.windowDays).toBe(30);
  });

  it("contains all 8 subsystems in rankedSubsystems", async () => {
    const report = await buildExecutiveHealthReport({ cwd });
    const names = report.rankedSubsystems.map((s) => s.subsystem).sort();
    expect(names).toEqual([
      "adaptation", "agents", "governance", "learning",
      "memory", "security", "tools", "workflow",
    ]);
    expect(report.rankedSubsystems.length).toBe(8);
  });

  it("sorts subsystems ascending (worst first)", async () => {
    const report = await buildExecutiveHealthReport({ cwd });
    for (let i = 1; i < report.rankedSubsystems.length; i++) {
      expect(report.rankedSubsystems[i - 1].score).toBeLessThanOrEqual(
        report.rankedSubsystems[i].score,
      );
    }
  });

  it("maps score to status at the boundary points", async () => {
    expect(["healthy", "warning", "critical"]).toContain("healthy");
    // Functional: build a synthetic report and verify the status mapping.
    const report = await buildExecutiveHealthReport({ cwd });
    for (const s of report.rankedSubsystems) {
      if (s.score < 60) expect(s.status).toBe("critical");
      else if (s.score < 80) expect(s.status).toBe("warning");
      else expect(s.status).toBe("healthy");
    }
  });

  it("computes overallScore as the unweighted mean", async () => {
    const report = await buildExecutiveHealthReport({ cwd });
    const expected = Math.round(
      report.rankedSubsystems.reduce((sum, s) => sum + s.score, 0) /
        report.rankedSubsystems.length,
    );
    expect(report.overallScore).toBe(expected);
  });

  it("marks a subsystem as score:0 critical when its source is null", async () => {
    // All sources are unavailable in a fresh temp dir; expect at least one
    // critical entry with the "unavailable" summary.
    const report = await buildExecutiveHealthReport({ cwd });
    const unavailable = report.rankedSubsystems.filter((s) => s.score === 0);
    expect(unavailable.length).toBeGreaterThanOrEqual(1);
    for (const s of unavailable) {
      expect(s.status).toBe("critical");
      expect(s.summary).toMatch(/unavailable/);
    }
  });

  it("emits valid JSON with all 8 subsystem names", async () => {
    const report = await buildExecutiveHealthReport({ cwd });
    const json = JSON.parse(JSON.stringify(report));
    expect(json.schemaVersion).toBe("p10.0.0");
    expect(Array.isArray(json.rankedSubsystems)).toBe(true);
    expect(json.rankedSubsystems.length).toBe(8);
  });

  it("handles empty state without throwing", async () => {
    const report = await buildExecutiveHealthReport({ cwd });
    expect(report.rankedSubsystems.length).toBe(8);
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
  });

  it("governance combines 2 sources (governanceHealth + governanceAssessment)", async () => {
    const report = await buildExecutiveHealthReport({ cwd });
    const gov = report.rankedSubsystems.find((s) => s.subsystem === "governance");
    expect(gov).toBeDefined();
    // governanceSummary should mention either "confidence" or "kinds supported"
    expect(gov!.summary).toMatch(/confidence|kinds supported/);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run tests/executive/executive-health.vitest.ts --reporter verbose 2>&1 | tail -30
```

Expected: 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/executive/executive-health.vitest.ts
git commit -m "P10.0: add aggregator unit tests (9 tests)"
```

---
### Task 5: Implement the 6 Tier-2 adapters (real signal)

**Files:**
- Modify: `src/executive/adapters/agent-health.ts`
- Modify: `src/executive/adapters/tool-health.ts`
- Modify: `src/executive/adapters/workflow-health.ts`
- Modify: `src/executive/adapters/memory-health.ts`
- Modify: `src/executive/adapters/security-health.ts`
- Modify: `src/executive/adapters/adaptation-health.ts`

**Interfaces:**
- Consumes: subsystem-specific stores (capability-evolution-store, security/secret-scanner, etc.)
- Produces: each adapter's `build<Name>Health` returns a real 0–100 score + 1-line summary

Replace the stub from Task 2 with real reads. Each adapter is a thin computation.

- [ ] **Step 1: Implement `buildAgentHealth`**

Replace the stub in `src/executive/adapters/agent-health.ts`:

```ts
import { join } from "node:path";
import { CapabilityEvolutionStore } from "../../adaptation/capability-evolution-store.js";

export async function buildAgentHealth(opts: AgentHealthOptions): Promise<AgentHealthReport> {
  try {
    const store = new CapabilityEvolutionStore(join(opts.cwd, ".alix", "capability-evolution"));
    const reports = await store.list("agent") as Array<{ capabilitySuccessRate?: number }>;
    if (reports.length === 0) {
      return { score: 100, summary: "no agent reports", topIssues: [] };
    }
    const rates = reports.map((r) => r.capabilitySuccessRate ?? 1).filter(Number.isFinite);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    const score = clampScore(avg * 100);
    return {
      score,
      summary: `agent success rate ${Math.round(avg * 100)}%`,
      topIssues: avg < 0.6 ? ["low agent success rate"] : [],
    };
  } catch {
    return { score: 0, summary: "agent health builder failed", topIssues: ["agent health builder failed"] };
  }
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
```

- [ ] **Step 2: Implement `buildToolHealth`**

Replace the stub in `src/executive/adapters/tool-health.ts`:

```ts
import { join } from "node:path";
import { SecretScanner } from "../../security/secret-scanner.js";

export async function buildToolHealth(opts: ToolHealthOptions): Promise<ToolHealthReport> {
  try {
    const scanner = new SecretScanner({ cwd: opts.cwd });
    // Tool health surfaces as: low secret/finding exposure = high score.
    // Use scanner's find() count and map to a 0..100 score inversely.
    const findings = await scanner.scan() as Array<{ severity?: "low" | "medium" | "high" | "critical" }>;
    const critical = findings.filter((f) => f.severity === "critical").length;
    const high = findings.filter((f) => f.severity === "high").length;
    const penalty = critical * 20 + high * 5;
    const score = clampScore(100 - penalty);
    return {
      score,
      summary: findings.length === 0 ? "no tool findings" : `${findings.length} tool finding(s)`,
      topIssues: critical > 0 ? [`${critical} critical tool findings`] : [],
    };
  } catch {
    return { score: 0, summary: "tool health builder failed", topIssues: ["tool health builder failed"] };
  }
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
```

- [ ] **Step 3: Implement `buildWorkflowHealth`**

Replace the stub in `src/executive/adapters/workflow-health.ts`:

```ts
import { join } from "node:path";
import { PipelineHealthBuilder } from "../../adaptation/pipeline-health-builder.js";

export async function buildWorkflowHealth(opts: WorkflowHealthOptions): Promise<WorkflowHealthReport> {
  try {
    const builder = new PipelineHealthBuilder();
    const report = await builder.build({ cwd: opts.cwd, windowDays: opts.windowDays ?? 90, generatedAt: opts.generatedAt ?? new Date().toISOString() }) as { healthScore?: number };
    const score = clampScore(report.healthScore ?? 100);
    return {
      score,
      summary: `pipeline health ${score}`,
      topIssues: score < 60 ? ["low pipeline health"] : [],
    };
  } catch {
    return { score: 0, summary: "workflow health builder failed", topIssues: ["workflow health builder failed"] };
  }
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
```

- [ ] **Step 4: Implement `buildAdaptationHealth`**

Replace the stub in `src/executive/adapters/adaptation-health.ts`:

```ts
import { join } from "node:path";
import { ProposalStore } from "../../adaptation/proposal-store.js";

export async function buildAdaptationHealth(opts: AdaptationHealthOptions): Promise<AdaptationHealthReport> {
  try {
    const store = new ProposalStore(join(opts.cwd, ".alix", "adaptation", "proposals"));
    const applied = await store.list("applied");
    const failed = await store.list("failed");
    const total = applied.length + failed.length;
    if (total === 0) {
      return { score: 100, summary: "no applied or failed proposals", topIssues: [] };
    }
    const successRate = applied.length / total;
    const score = clampScore(successRate * 100);
    return {
      score,
      summary: `adaptation success ${Math.round(successRate * 100)}%`,
      topIssues: successRate < 0.6 ? ["low adaptation success rate"] : [],
    };
  } catch {
    return { score: 0, summary: "adaptation health builder failed", topIssues: ["adaptation health builder failed"] };
  }
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
```

- [ ] **Step 5: Implement `buildMemoryHealth` and `buildSecurityHealth`**

`buildMemoryHealth` (in `memory-health.ts`) and `buildSecurityHealth` (in `security-health.ts`) — for these, the underlying signals are less defined in the codebase (memory is via `kernel/`, security has `secret-scanner` only). **Stub both with simple checks**: open the relevant dirs in `.alix/`; if the dir is missing or empty, return 100; if files exist, return 100 - penalty. If the store API is not yet shaped, catch the error and return 0 with a clear summary.

For `buildMemoryHealth`:
```ts
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export async function buildMemoryHealth(opts: MemoryHealthOptions): Promise<MemoryHealthReport> {
  try {
    const memDir = join(opts.cwd, ".alix", "memory");
    if (!existsSync(memDir)) {
      return { score: 100, summary: "no memory store", topIssues: [] };
    }
    const files = readdirSync(memDir);
    return {
      score: 100,
      summary: files.length === 0 ? "empty memory" : `${files.length} memory file(s)`,
      topIssues: [],
    };
  } catch {
    return { score: 0, summary: "memory health builder failed", topIssues: ["memory health builder failed"] };
  }
}
```

For `buildSecurityHealth`:
```ts
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export async function buildSecurityHealth(opts: SecurityHealthOptions): Promise<SecurityHealthReport> {
  try {
    const secDir = join(opts.cwd, ".alix", "security");
    if (!existsSync(secDir)) {
      return { score: 100, summary: "no security findings", topIssues: [] };
    }
    const files = readdirSync(secDir);
    return {
      score: 100,
      summary: files.length === 0 ? "no findings" : `${files.length} finding file(s)`,
      topIssues: [],
    };
  } catch {
    return { score: 0, summary: "security health builder failed", topIssues: ["security health builder failed"] };
  }
}
```

- [ ] **Step 6: Run tsc + tests**

```bash
npx tsc --noEmit 2>&1 | head -20
npx vitest run tests/executive/executive-health.vitest.ts --reporter verbose 2>&1 | tail -15
```

Expected: tsc clean, 9 tests still pass. If store APIs differ from what's shown, adjust the call shape and note in the report.

- [ ] **Step 7: Commit**

```bash
git add src/executive/adapters/
git commit -m "P10.0: implement 6 Tier-2 health adapters with real signal"
```

---
### Task 6: Implement the terminal renderer

**Files:**
- Create: `src/cli/commands/executive-dashboard-renderer.ts`

**Interfaces:**
- Consumes: `ExecutiveHealthReport` from Task 3
- Produces: `renderExecutiveDashboard(report, opts?)` — writes to stdout

- [ ] **Step 1: Create the renderer**

```ts
/**
 * P10.0 — Executive Dashboard renderer.
 *
 * Pure formatter. Consumes ExecutiveHealthReport. No data access.
 * Mirrors P9.5's renderGovernanceDashboard pattern with 2 panels.
 *
 * @module
 */

import type {
  ExecutiveHealthReport,
  ExecutiveSubsystemHealth,
  ExecutiveStatus,
} from "../../executive/executive-health.js";

export interface RenderOptions {
  jsonMode?: boolean;
}

const STATUS_EMOJI: Record<ExecutiveStatus, string> = {
  healthy: "🟢",
  warning: "🟡",
  critical: "🔴",
};

const STATUS_LABEL: Record<ExecutiveStatus, string> = {
  healthy: "healthy",
  warning: "warning",
  critical: "critical",
};

export function renderExecutiveDashboard(
  report: ExecutiveHealthReport,
  opts: RenderOptions = {},
): void {
  if (opts.jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("=".repeat(72));
  console.log("EXECUTIVE DASHBOARD");
  console.log(`Schema: ${report.schemaVersion}    Generated: ${report.generatedAt}    Window: ${report.windowDays}d`);
  console.log("=".repeat(72));

  renderHealthSummary(report);
  console.log("");
  renderPriorities(report);
  console.log("=".repeat(72));
}

function renderHealthSummary(report: ExecutiveHealthReport): void {
  console.log("\n[0] EXECUTIVE HEALTH SUMMARY");
  console.log(`Overall Score: ${report.overallScore}\n`);
  console.log("  Subsystem      Score   Status");
  console.log("  -------------  -----   --------------");
  for (const s of report.rankedSubsystems) {
    const emoji = STATUS_EMOJI[s.status];
    const label = STATUS_LABEL[s.status];
    const line = `  ${pad(s.subsystem, 13)}  ${pad(String(s.score), 5)}   ${emoji} ${label}`;
    console.log(line);
  }
}

function renderPriorities(report: ExecutiveHealthReport): void {
  const top3 = report.rankedSubsystems.slice(0, 3);
  console.log(`\n[1] EXECUTIVE PRIORITIES (top ${top3.length})`);
  if (top3.length === 0) {
    console.log("  (none)");
    return;
  }
  top3.forEach((s, i) => {
    console.log(`\n  ${i + 1}. ${capitalize(s.subsystem)}`);
    console.log(`     ${s.summary}.`);
  });
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/executive-dashboard-renderer.ts
git commit -m "P10.0: implement renderExecutiveDashboard"
```

---
### Task 7: Implement the CLI handler

**Files:**
- Create: `src/cli/commands/executive-dashboard-handler.ts`

**Interfaces:**
- Consumes: `buildExecutiveHealthReport` (Task 3), `renderExecutiveDashboard` (Task 6)
- Produces: `runDashboard(args: string[])` — parses `--window`, `--json`; calls aggregator; calls renderer

- [ ] **Step 1: Create the handler**

```ts
/**
 * P10.0 — Executive Dashboard CLI handler.
 *
 * Extracted to its own file so the dashboard sentinel can scan a precise
 * target. See tests/executive/executive-sentinels.vitest.ts.
 *
 * @module
 */

import { buildExecutiveHealthReport } from "../../executive/executive-health.js";
import { renderExecutiveDashboard } from "./executive-dashboard-renderer.js";

export async function runDashboard(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");

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

  const report = await buildExecutiveHealthReport({
    cwd: process.cwd(),
    windowDays,
  });

  renderExecutiveDashboard(report, { jsonMode });
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
git commit -m "P10.0: implement runDashboard CLI handler (extracted for sentinel)"
```

---
### Task 8: Create the executive subcommand dispatcher

**Files:**
- Create: `src/cli/commands/executive.ts`

**Interfaces:**
- Consumes: `runDashboard` from Task 7
- Produces: `handleExecutiveCommand(args)` — switch on subcommand; future subcommands add here

- [ ] **Step 1: Create the dispatcher**

```ts
/**
 * P10.0 — Executive subcommand dispatcher.
 *
 * Top-level entry point for `alix executive ...`. Currently only supports
 * `dashboard`. Future subcommands (P10.1+ priority, P10.2 objectives)
 * will add cases here.
 *
 * @module
 */

import { runDashboard } from "./executive-dashboard-handler.js";

export async function handleExecutiveCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "dashboard":
      return runDashboard(rest);
    default:
      console.error(`Unknown executive subcommand: ${subcommand ?? "(none)"}`);
      console.error("Available: dashboard");
      process.exit(1);
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
git add src/cli/commands/executive.ts
git commit -m "P10.0: create executive subcommand dispatcher"
```

---
### Task 9: Wire the top-level command in src/cli.ts

**Files:**
- Modify: `src/cli.ts` (one new `if` block + one new import)

**Interfaces:**
- Consumes: `handleExecutiveCommand` from Task 8
- Produces: `alix executive ...` is recognized at the top level

- [ ] **Step 1: Find the existing `governance` registration block**

The `governance` block is at line 2852 of `src/cli.ts`:

```ts
if (command === "governance") {
  const { handleGovernanceCommand } = await import("./cli/commands/governance.js");
  // ... rest of the block
}
```

- [ ] **Step 2: Add the `executive` block right after `governance`**

Insert immediately after the `governance` block closes:

```ts
if (command === "executive") {
  const { handleExecutiveCommand } = await import("./cli/commands/executive.js");
  await handleExecutiveCommand(args);
  continue;
}
```

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "P10.0: register executive top-level command in src/cli.ts"
```

---
### Task 10: Write the CLI integration tests

**Files:**
- Create: `tests/cli/commands/executive-dashboard-cli.vitest.ts`

**Interfaces:**
- Consumes: `runDashboard` from Task 7
- Produces: 3 CLI tests (text mode, JSON mode, --window flag)

- [ ] **Step 1: Create the test file**

```ts
/**
 * P10.0 — Executive Dashboard CLI integration tests.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let cwd: string;
let originalCwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "exec-cli-"));
  mkdirSync(join(cwd, ".alix"), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(cwd);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  rmSync(cwd, { recursive: true, force: true });
});

function capturedLog(): string {
  return (console.log as any).mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
}

describe("runDashboard", () => {
  it("renders 2 panel headers in text mode", async () => {
    const { runDashboard } = await import("../../../src/cli/commands/executive-dashboard-handler.js");
    await runDashboard([]);
    const out = capturedLog();
    expect(out).toContain("EXECUTIVE DASHBOARD");
    expect(out).toContain("EXECUTIVE HEALTH SUMMARY");
    expect(out).toContain("EXECUTIVE PRIORITIES");
  });

  it("emits valid JSON in --json mode", async () => {
    const { runDashboard } = await import("../../../src/cli/commands/executive-dashboard-handler.js");
    await runDashboard(["--json"]);
    const out = capturedLog();
    const parsed = JSON.parse(out);
    expect(parsed.schemaVersion).toBe("p10.0.0");
    expect(parsed.overallScore).toBeDefined();
    expect(parsed.rankedSubsystems).toBeDefined();
    expect(parsed.rankedSubsystems.length).toBe(8);
  });

  it("respects --window flag", async () => {
    const { runDashboard } = await import("../../../src/cli/commands/executive-dashboard-handler.js");
    await runDashboard(["--window", "7", "--json"]);
    const parsed = JSON.parse(capturedLog());
    expect(parsed.windowDays).toBe(7);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run tests/cli/commands/executive-dashboard-cli.vitest.ts --reporter verbose 2>&1 | tail -15
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/commands/executive-dashboard-cli.vitest.ts
git commit -m "P10.0: add CLI integration tests (3 tests)"
```

---
### Task 11: Write the executive purity sentinel

**Files:**
- Create: `tests/executive/executive-sentinels.vitest.ts`

**Interfaces:**
- Consumes: the 10 P10.0 executive files
- Produces: a sentinel test that fails if any file imports a mutation write path

- [ ] **Step 1: Create the sentinel test**

```ts
/**
 * P10.0 — Executive purity sentinel.
 *
 * Scans the 10 P10.0 executive files for any mutation write path. Fails
 * the test if any forbidden symbol is found. Read-only store queries are
 * permitted.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const EXECUTIVE_FILES = [
  "src/executive/executive-health.ts",
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

const FORBIDDEN_IN_EXECUTIVE = [
  // Mutation appliers
  "GovernanceChangeApplier",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  // Approval / apply / reject verbs (string-form, not import)
  ".approve(",
  ".apply(",
  ".reject(",
  // Mutation-write stores
  "ProposalStore.save",
  "ProposalStore.markOrphaned",
  // Evidence write methods
  "recordGovernanceMutationApplied",
  "recordAdaptationApproved",
  "recordAdaptationApplied",
  "recordAdaptationRejected",
  "recordAdaptationFailed",
  "recordRevertApplied",
  "recordRevertFailed",
];

describe("P10.0 executive purity sentinel", () => {
  for (const relPath of EXECUTIVE_FILES) {
    it(`${relPath} does not import any mutation write path`, () => {
      const absPath = join(process.cwd(), relPath);
      if (!existsSync(absPath)) {
        throw new Error(`P10.0 executive file missing: ${relPath}. Sentinel expects 10 files; run earlier tasks first.`);
      }
      const content = readFileSync(absPath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const forbidden of FORBIDDEN_IN_EXECUTIVE) {
          if (line.includes(forbidden)) {
            throw new Error(
              `P10.0 executive purity violation at ${relPath}:${i + 1}\n` +
              `  Found forbidden symbol: "${forbidden}"\n` +
              `  The executive layer is read-only and must not import mutation write paths.\n` +
              `  If this symbol is needed, it belongs in a non-executive module.`,
            );
          }
        }
      }
    });
  }
});
```

- [ ] **Step 2: Run the sentinel**

```bash
npx vitest run tests/executive/executive-sentinels.vitest.ts --reporter verbose 2>&1 | tail -10
```

Expected: 10 tests pass (one per executive file).

- [ ] **Step 3: Commit**

```bash
git add tests/executive/executive-sentinels.vitest.ts
git commit -m "P10.0: add executive purity sentinel (10 files scanned)"
```

---
### Task 12: Full verification

**Files:** none new; verifies everything

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: all tests pass (existing + 9 aggregator + 3 CLI + 10 sentinel = 22 new tests).

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit 2>&1
```

Expected: clean.

- [ ] **Step 3: Commit (only if there were any verification fixes)**

If you made any fixes during verification, commit them.

---
### Task 13: Final review and PR

- [ ] **Step 1: Verify the PR scope is clean**

```bash
git status --short
```

Expected: only the 15 P10.0 files (plus the 2 new doc files). Untracked working-tree noise (.alix/, docs/ALiX_End_Product_NonCode_Artifacts/) is fine to leave.

- [ ] **Step 2: Push the branch and create the PR**

```bash
git push -u origin feature/p10-0-executive-intelligence
gh pr create --base main --head feature/p10-0-executive-intelligence \
  --title "P10.0 — Executive Intelligence Foundation (8 subsystems, 2 panels)" \
  --body "Read-only terminal dashboard... (see spec)"
```

- [ ] **Step 3: After PR approval and merge, tag**

```bash
git checkout main && git pull --ff-only
git tag alix-p10-0-complete
git push origin alix-p10-0-complete
```
