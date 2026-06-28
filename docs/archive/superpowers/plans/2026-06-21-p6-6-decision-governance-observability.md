# P6.6a — Decision Pipeline Health Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `alix decision status` — a read-only health report summarizing the P6 decision pipeline from existing stores. No new storage, no new evidence types, no writes.

**Architecture:** PipelineHealthCollector handles all I/O (reads stores, builds DecisionContexts, returns PipelineHealthInput). PipelineHealthBuilder is pure — takes PipelineHealthInput, returns PipelineHealthReport deterministically. CLI calls Collector → Builder. Same purity pattern as P6.0a–P6.3.

**Tech Stack:** TypeScript (NodeNext), vitest

## Global Constraints

- **NodeNext module resolution:** All cross-file imports MUST use `.js` extension (e.g., `./decision-types.js`)
- **No writes:** The PipelineHealthCollector NEVER writes to stores. Read-only.
- **No new evidence types:** The report reads existing events but does not create new ones.
- **Health priority order:** `attention_needed` > `degraded` > `healthy`. Worst condition wins.
- **Window scoping:** scopedProposals = pending proposals + proposals created within `--window` days. Proposals have `createdAt` but no `appliedAt` field.
- **Per-proposal error isolation:** A single `DecisionContextBuilder.build()` failure skips that proposal without failing the report.
- **ALiX/Claude boundary:** ALiX is its own autonomous adaptation system. No references to Claude Code, skills, plugins, or MCP in the code.
- **Ponytail mode active (full):** Lazy senior developer — shortest working diff, no unrequested abstractions.

## Store API Notes (verify before coding)

| API | Returns | Notes |
|-----|---------|-------|
| `proposalStore.list(status?)` | `AdaptationProposal[]` | Optional status filter. Has `createdAt`; no `appliedAt`. |
| `effectivenessStore.list()` | `ProposalEffectivenessReport[]` | Full objects — includes `id`, `recommendation`, `assessedAt`. |
| `intelligenceStore.list()` | `string[]` | Returns filenames, not objects. Use `.load(filename)` for full report. |
| `intelligenceStore.loadLatest()` | `IntelligenceReport \| null` | Convenience — loads the most recent report. |
| `evidenceStore.query({})` | `{records, total, truncated}` | `records` is `EvidenceRecord[]`; `total` is count. |

---

## File Structure

```
Create:
  src/adaptation/pipeline-health-types.ts       — PipelineHealthStatus, PipelineHealthInput, PipelineHealthReport
  src/adaptation/pipeline-health-builder.ts      — PipelineHealthBuilder (pure, deterministic)
  src/adaptation/pipeline-health-collector.ts    — PipelineHealthCollector (I/O: reads stores)
  tests/adaptation/pipeline-health-types.vitest.ts
  tests/adaptation/pipeline-health-builder.vitest.ts
  tests/adaptation/pipeline-health-collector.vitest.ts

Modify:
  src/cli/commands/decision.ts                   — Add case "status" + runStatus function
```

**Tests:**
- `tests/adaptation/pipeline-health-collector.vitest.ts` — lightweight collector tests with mock infrastructure

### Task 1: Pipeline Health Types

**Files:**
- Create: `src/adaptation/pipeline-health-types.ts`
- Test: `tests/adaptation/pipeline-health-types.vitest.ts`

**Interfaces:**
- Produces: `PipelineHealthStatus`, `PipelineHealthInput`, `PipelineHealthReport`
- Consumes: `DecisionArtifact` from `./decision-types.js`

- [ ] **Step 1: Write the failing type-shape test**

```typescript
// tests/adaptation/pipeline-health-types.vitest.ts
import { describe, it, expect } from "vitest";
import type { PipelineHealthReport, PipelineHealthInput, PipelineHealthStatus } from "../../src/adaptation/pipeline-health-types.js";

describe("PipelineHealthReport", () => {
  it("extends DecisionArtifact and has all required fields", () => {
    const report: PipelineHealthReport = {
      id: "status:2026-06-21:30d",
      subject: "Pipeline Health — Last 30 days",
      outcome: "observed",
      confidence: 1,
      reasons: ["All stores available"],
      generatedAt: "2026-06-21T00:00:00.000Z",
      windowDays: 30,
      health: "healthy",
      healthSignals: [],
      storeAvailability: {
        proposalStore: true,
        evidenceStore: true,
        effectivenessStore: true,
        intelligenceStore: true,
      },
      proposalCounts: { total: 0, pending: 0, approved: 0, applied: 0, rejected: 0, failed: 0 },
      scopedProposals: {
        total: 0,
        staleProposals: 0,
        brokenLineage: 0,
        confidence: { contextAvg: 0, sampleSize: 0 },
        dataFreshness: { newestDays: null, oldestDays: null },
      },
      effectivenessReports: 0,
      intelligenceReports: 0,
      lifecycleEvents: { total: 0, inWindow: 0 },
      strategicBrief: { available: true, confidence: 0.85, findings: 3 },
      governanceReview: { frameworkAvailable: true, liveLensExecutionAvailable: false, persistedReviews: false },
    };
    expect(report.id).toBeTruthy();
    expect(report.health).toBe("healthy");
    expect(Array.isArray(report.healthSignals)).toBe(true);
  });
});

describe("PipelineHealthStatus", () => {
  it("accepts all three health values", () => {
    const statuses: PipelineHealthStatus[] = ["healthy", "degraded", "attention_needed"];
    expect(statuses.length).toBe(3);
  });
});

describe("PipelineHealthInput", () => {
  it("has optional fields matching collector output", () => {
    const input: PipelineHealthInput = {
      proposalCounts: { total: 0, pending: 0, approved: 0, applied: 0, rejected: 0, failed: 0 },
      scopedProposalInputs: [],
      effectivenessReports: 0,
      intelligenceReports: 0,
      lifecycleEvents: { total: 0, inWindow: 0 },
      strategicBrief: { available: true, confidence: 0.85, findings: 3 },
      storeAvailability: { proposalStore: true, evidenceStore: true, effectivenessStore: true, intelligenceStore: true },
    };
    expect(input.proposalCounts.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adaptation/pipeline-health-types.vitest.ts 2>&1 | tail -10`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create pipeline-health-types.ts**

```typescript
/**
 * P6.6a — Pipeline Health Report type definitions.
 *
 * PipelineHealthReport is a read-only summary of the P6 decision-support
 * pipeline's health and activity. Produced by PipelineHealthBuilder from
 * PipelineHealthInput (assembled by PipelineHealthCollector).
 *
 * Pure data types with no storage dependencies.
 *
 * @module
 */

import type { DecisionArtifact } from "./decision-types.js";

// ---------------------------------------------------------------------------
// Health status
// ---------------------------------------------------------------------------

export type PipelineHealthStatus = "healthy" | "degraded" | "attention_needed";

// ---------------------------------------------------------------------------
// Per-scoped-proposal data for confidence averaging
// ---------------------------------------------------------------------------

export interface ScopedProposalData {
  contextConfidence: number;
  riskConfidence?: number;
  recommendationConfidence?: number;
  ageDays: number;
  lineageCompleteness: "partial" | "complete" | "broken";
  dataFreshness: { newestDays: number; oldestDays: number };
}

// ---------------------------------------------------------------------------
// PipelineHealthInput — assembled by collector, consumed by builder
// ---------------------------------------------------------------------------

export interface PipelineHealthInput {
  proposalCounts: {
    total: number;
    pending: number;
    approved: number;
    applied: number;
    rejected: number;
    failed: number;
  };

  /** Per-proposal data for scoped proposals (pending + within window). */
  scopedProposalInputs: ScopedProposalData[];

  effectivenessReports: number;
  intelligenceReports: number;

  lifecycleEvents: {
    total: number;
    inWindow: number;
  };

  strategicBrief: {
    available: boolean;
    confidence: number | null;
    findings: number;
  };

  storeAvailability: {
    proposalStore: boolean;
    evidenceStore: boolean;
    effectivenessStore: boolean;
    intelligenceStore: boolean;
  };

  /** Per-store error messages (undefined = no error). */
  storeErrors?: {
    proposalStore?: string;
    evidenceStore?: string;
    effectivenessStore?: string;
    intelligenceStore?: string;
  };
}

// ---------------------------------------------------------------------------
// PipelineHealthReport — output artifact
// ---------------------------------------------------------------------------

export interface PipelineHealthReport extends DecisionArtifact {
  windowDays: 30 | 90 | 180;
  health: PipelineHealthStatus;

  /** Structured health signals with severity. */
  healthSignals: Array<{
    severity: "info" | "warning" | "critical";
    message: string;
  }>;

  /** Per-store availability for JSON consumers. */
  storeAvailability: {
    proposalStore: boolean;
    evidenceStore: boolean;
    effectivenessStore: boolean;
    intelligenceStore: boolean;
  };

  /** Proposal lifecycle counts — all proposals. */
  proposalCounts: {
    total: number;
    pending: number;
    approved: number;
    applied: number;
    rejected: number;
    failed: number;
  };

  /** Scoped to pending proposals + those within the window. */
  scopedProposals: {
    total: number;
    staleProposals: number;
    brokenLineage: number;
    confidence: {
      contextAvg: number;
      riskAvg?: number;
      recommendationAvg?: number;
      sampleSize: number;
    };
    dataFreshness: {
      newestDays: number | null;
      oldestDays: number | null;
    };
  };

  effectivenessReports: number;
  intelligenceReports: number;

  lifecycleEvents: {
    total: number;
    inWindow: number;
  };

  strategicBrief: {
    available: boolean;
    confidence: number | null;
    findings: number;
  };

  governanceReview: {
    frameworkAvailable: true;
    liveLensExecutionAvailable: false;
    persistedReviews: false;
  };

  /** Per-store error messages (undefined = no error). */
  storeErrors?: {
    proposalStore?: string;
    evidenceStore?: string;
    effectivenessStore?: string;
    intelligenceStore?: string;
  };

  // confidence, reasons, warnings inherited from DecisionArtifact
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adaptation/pipeline-health-types.vitest.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adaptation/pipeline-health-types.ts tests/adaptation/pipeline-health-types.vitest.ts
git commit -m "feat(p6.6a): PipelineHealth types"
```

---

### Task 2: PipelineHealthBuilder (Pure Computation)

**Files:**
- Create: `src/adaptation/pipeline-health-builder.ts`
- Test: `tests/adaptation/pipeline-health-builder.vitest.ts`

**Interfaces:**
- Consumes: `PipelineHealthInput` from `./pipeline-health-types.js`
- Produces: `PipelineHealthReport` from `./pipeline-health-types.js`, `PipelineHealthBuilder.build(input, options?): PipelineHealthReport`

- [ ] **Step 1: Write failing test for deterministic builder**

```typescript
// tests/adaptation/pipeline-health-builder.vitest.ts
import { describe, it, expect } from "vitest";
import { PipelineHealthBuilder } from "../../src/adaptation/pipeline-health-builder.js";
import type { PipelineHealthInput } from "../../src/adaptation/pipeline-health-types.js";

function makeHealthyInput(overrides: Partial<PipelineHealthInput> = {}): PipelineHealthInput {
  return {
    proposalCounts: { total: 5, pending: 2, approved: 1, applied: 2, rejected: 0, failed: 0 },
    scopedProposalInputs: [
      { contextConfidence: 0.8, ageDays: 5, lineageCompleteness: "complete", dataFreshness: { newestDays: 2, oldestDays: 10 } },
      { contextConfidence: 0.9, ageDays: 3, lineageCompleteness: "complete", dataFreshness: { newestDays: 1, oldestDays: 5 } },
    ],
    effectivenessReports: 14,
    intelligenceReports: 3,
    lifecycleEvents: { total: 89, inWindow: 42 },
    strategicBrief: { available: true, confidence: 0.85, findings: 3 },
    storeAvailability: { proposalStore: true, evidenceStore: true, effectivenessStore: true, intelligenceStore: true },
    ...overrides,
  };
}

describe("PipelineHealthBuilder", () => {
  it("returns healthy for a well-functioning pipeline", () => {
    const builder = new PipelineHealthBuilder();
    const report = builder.build(makeHealthyInput(), { generatedAt: "2026-06-21T00:00:00.000Z", windowDays: 30 });
    expect(report.health).toBe("healthy");
    expect(report.windowDays).toBe(30);
    expect(report.healthSignals.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adaptation/pipeline-health-builder.vitest.ts 2>&1 | tail -10`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create PipelineHealthBuilder**

```typescript
/**
 * P6.6a — PipelineHealthBuilder: pure health computation.
 *
 * Takes PipelineHealthInput and returns a PipelineHealthReport.
 * Fully deterministic — same input in any order → same output.
 * No store access, no I/O, no side effects.
 *
 * @module
 */

import type { PipelineHealthReport, PipelineHealthInput, PipelineHealthStatus, ScopedProposalData } from "./pipeline-health-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OUTPUT_OUTCOME = "observed";
const STALE_THRESHOLD_DAYS = 30;
const LOW_CONFIDENCE_THRESHOLD = 0.3;
const VALID_WINDOWS = new Set([30, 90, 180]);

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface HealthBuilderOptions {
  generatedAt?: string;
  windowDays?: number;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class PipelineHealthBuilder {
  build(input: PipelineHealthInput, options?: HealthBuilderOptions): PipelineHealthReport {
    const generatedAt = options?.generatedAt ?? new Date().toISOString();
    const windowDays = (options?.windowDays ?? 30) as PipelineHealthReport["windowDays"];

    // Clamp to valid window values
    const validWindow = VALID_WINDOWS.has(windowDays) ? windowDays : 30;

    const scoped = this.#computeScopedProposals(input.scopedProposalInputs);
    const health = this.#computeHealth(input, scoped);
    const healthSignals = this.#computeSignals(input, scoped);

    const evidenceRefs = [
      `proposals:${input.proposalCounts.total}`,
      `effects:${input.effectivenessReports}`,
      `events:${input.lifecycleEvents.total}`,
    ];

    return {
      id: `status:${generatedAt}:${validWindow}d`,
      subject: `Pipeline Health — Last ${validWindow} days`,
      outcome: OUTPUT_OUTCOME,
      confidence: scoped.total > 0 ? Math.min(1, scoped.total / 10) : 1,
      reasons: this.#buildReasons(health, scoped, input),
      warnings: healthSignals.length > 0 ? healthSignals.map(s => s.message) : undefined,
      evidenceRefs,
      generatedAt,
      windowDays: validWindow,
      health,
      healthSignals,
      storeAvailability: { ...input.storeAvailability },
      storeErrors: input.storeErrors,
      proposalCounts: { ...input.proposalCounts },
      scopedProposals: scoped,
      effectivenessReports: input.effectivenessReports,
      intelligenceReports: input.intelligenceReports,
      lifecycleEvents: { ...input.lifecycleEvents },
      strategicBrief: { ...input.strategicBrief },
      governanceReview: { frameworkAvailable: true, liveLensExecutionAvailable: false, persistedReviews: false },
    };
  }

  #computeScopedProposals(inputs: ScopedProposalData[]): PipelineHealthReport["scopedProposals"] {
    if (inputs.length === 0) {
      return {
        total: 0,
        staleProposals: 0,
        brokenLineage: 0,
        confidence: { contextAvg: 0, riskAvg: undefined, recommendationAvg: undefined, sampleSize: 0 },
        dataFreshness: { newestDays: null, oldestDays: null },
      };
    }

    let staleCount = 0;
    let brokenCount = 0;
    let contextSum = 0;
    let riskSum = 0;
    let riskCount = 0;
    let recSum = 0;
    let recCount = 0;
    let newest = Infinity;
    let oldest = 0;

    for (const p of inputs) {
      if (p.ageDays > STALE_THRESHOLD_DAYS) staleCount++;
      if (p.lineageCompleteness === "broken") brokenCount++;
      contextSum += p.contextConfidence;
      if (p.riskConfidence !== undefined) { riskSum += p.riskConfidence; riskCount++; }
      if (p.recommendationConfidence !== undefined) { recSum += p.recommendationConfidence; recCount++; }
      if (p.dataFreshness.newestDays < newest) newest = p.dataFreshness.newestDays;
      if (p.dataFreshness.oldestDays > oldest) oldest = p.dataFreshness.oldestDays;
    }

    return {
      total: inputs.length,
      staleProposals: staleCount,
      brokenLineage: brokenCount,
      confidence: {
        contextAvg: contextSum / inputs.length,
        riskAvg: riskCount > 0 ? riskSum / riskCount : undefined,
        recommendationAvg: recCount > 0 ? recSum / recCount : undefined,
        sampleSize: inputs.length,
      },
      dataFreshness: {
        newestDays: newest === Infinity ? null : newest,
        oldestDays: oldest === 0 ? null : oldest,
      },
    };
  }

  #computeHealth(input: PipelineHealthInput, scoped: PipelineHealthReport["scopedProposals"]): PipelineHealthStatus {
    // attention_needed checks (highest priority)
    if (input.storeAvailability.proposalStore === false) return "attention_needed";
    if (scoped.brokenLineage > 0) return "attention_needed";

    // degraded checks
    if (input.storeAvailability.evidenceStore === false
        || input.storeAvailability.effectivenessStore === false
        || input.storeAvailability.intelligenceStore === false) return "degraded";
    if (scoped.staleProposals > 0) return "degraded";

    // Strategic brief unavailable with enough data
    const enoughData = scoped.total > 0
      || input.effectivenessReports > 0
      || input.intelligenceReports > 0
      || input.lifecycleEvents.total > 0;
    if (!input.strategicBrief.available && enoughData) return "degraded";

    // Low confidence with actual samples
    if (scoped.confidence.sampleSize > 0) {
      if (scoped.confidence.contextAvg < LOW_CONFIDENCE_THRESHOLD
          || (scoped.confidence.recommendationAvg !== undefined && scoped.confidence.recommendationAvg < LOW_CONFIDENCE_THRESHOLD)) return "degraded";
    }

    return "healthy";
  }

  #computeSignals(input: PipelineHealthInput, scoped: PipelineHealthReport["scopedProposals"]): PipelineHealthReport["healthSignals"] {
    const signals: PipelineHealthReport["healthSignals"] = [];

    if (scoped.total === 0) {
      signals.push({ severity: "info", message: "No proposals in window" });
    }

    if (scoped.staleProposals > 0) {
      signals.push({ severity: "warning", message: `${scoped.staleProposals} stale proposal(s) exceed ${STALE_THRESHOLD_DAYS} days without activity` });
    }

    if (scoped.brokenLineage > 0) {
      signals.push({ severity: "critical", message: `${scoped.brokenLineage} proposal(s) have broken lineage — decision context is incomplete` });
    }

    if (!input.strategicBrief.available && (scoped.total > 0 || input.effectivenessReports > 0 || input.intelligenceReports > 0 || input.lifecycleEvents.total > 0)) {
      signals.push({ severity: "warning", message: "Strategic brief unavailable — pipeline lacks long-horizon synthesis" });
    }

    if (!input.storeAvailability.proposalStore) {
      signals.push({ severity: "critical", message: "ProposalStore unavailable — cannot observe pipeline state" });
    }
    if (!input.storeAvailability.evidenceStore) {
      signals.push({ severity: "warning", message: "EvidenceStore unavailable — lifecycle events not observable" });
    }
    if (!input.storeAvailability.effectivenessStore) {
      signals.push({ severity: "warning", message: "EffectivenessStore unavailable — effectiveness data not observable" });
    }
    if (!input.storeAvailability.intelligenceStore) {
      signals.push({ severity: "warning", message: "IntelligenceStore unavailable — intelligence data not observable" });
    }

    return signals;
  }

  #buildReasons(
    health: PipelineHealthStatus,
    scoped: PipelineHealthReport["scopedProposals"],
    input: PipelineHealthInput,
  ): string[] {
    const reasons: string[] = [];
    reasons.push(`Status: ${health}`);
    reasons.push(`Proposals: ${input.proposalCounts.total} total (${input.proposalCounts.pending} pending)`);
    reasons.push(`Scoped proposals: ${scoped.total}`);
    reasons.push(`Effectiveness reports: ${input.effectivenessReports}`);
    reasons.push(`Intelligence reports: ${input.intelligenceReports}`);
    reasons.push(`Lifecycle events: ${input.lifecycleEvents.total} total (${input.lifecycleEvents.inWindow} in window)`);
    reasons.push(`Strategic brief: ${input.strategicBrief.available ? `available (${input.strategicBrief.findings} findings)` : "unavailable"}`);
    return reasons;
  }
}
```

- [ ] **Step 4: Write comprehensive builder tests and run them**

Add to `tests/adaptation/pipeline-health-builder.vitest.ts`:

```typescript
it("attention_needed when brokenLineage > 0", () => {
  const builder = new PipelineHealthBuilder();
  const input = makeHealthyInput({
    scopedProposalInputs: [
      { contextConfidence: 0.8, ageDays: 5, lineageCompleteness: "broken", dataFreshness: { newestDays: 2, oldestDays: 10 } },
    ],
  });
  const report = builder.build(input);
  expect(report.health).toBe("attention_needed");
});

it("attention_needed when ProposalStore unavailable", () => {
  const builder = new PipelineHealthBuilder();
  const input = makeHealthyInput({ storeAvailability: { ...makeHealthyInput().storeAvailability, proposalStore: false } });
  const report = builder.build(input);
  expect(report.health).toBe("attention_needed");
});

it("degraded when staleProposals > 0", () => {
  const builder = new PipelineHealthBuilder();
  const input = makeHealthyInput({
    scopedProposalInputs: [
      { contextConfidence: 0.8, ageDays: 45, lineageCompleteness: "complete", dataFreshness: { newestDays: 10, oldestDays: 40 } },
    ],
  });
  const report = builder.build(input);
  expect(report.health).toBe("degraded");
});

it("degraded when strategic brief unavailable with enough data", () => {
  const builder = new PipelineHealthBuilder();
  const input = makeHealthyInput({ strategicBrief: { available: false, confidence: null, findings: 0 } });
  const report = builder.build(input);
  expect(report.health).toBe("degraded");
});

it("degraded when non-foundational store unavailable", () => {
  const builder = new PipelineHealthBuilder();
  const input = makeHealthyInput({
    storeAvailability: { proposalStore: true, evidenceStore: false, effectivenessStore: true, intelligenceStore: true },
  });
  const report = builder.build(input);
  expect(report.health).toBe("degraded");
});

it("healthy for empty system", () => {
  const builder = new PipelineHealthBuilder();
  const input = makeHealthyInput({
    proposalCounts: { total: 0, pending: 0, approved: 0, applied: 0, rejected: 0, failed: 0 },
    scopedProposalInputs: [],
    effectivenessReports: 0,
    intelligenceReports: 0,
    lifecycleEvents: { total: 0, inWindow: 0 },
    strategicBrief: { available: true, confidence: 0, findings: 0 },
  });
  const report = builder.build(input);
  expect(report.health).toBe("healthy");
});

it("healthy when strategic brief unavailable but no data either", () => {
  const builder = new PipelineHealthBuilder();
  const empty = makeHealthyInput({
    proposalCounts: { total: 0, pending: 0, approved: 0, applied: 0, rejected: 0, failed: 0 },
    scopedProposalInputs: [],
    effectivenessReports: 0,
    intelligenceReports: 0,
    lifecycleEvents: { total: 0, inWindow: 0 },
    strategicBrief: { available: false, confidence: null, findings: 0 },
  });
  const report = builder.build(empty);
  // No data at all → healthy; brief unavailability isn't meaningful when there's nothing to observe
  expect(report.health).toBe("healthy");
});

it("is deterministic — same input produces same output", () => {
  const builder = new PipelineHealthBuilder();
  const input = makeHealthyInput();
  const r1 = builder.build(input, { generatedAt: "2026-06-21T00:00:00.000Z", windowDays: 30 });
  const r2 = builder.build(input, { generatedAt: "2026-06-21T00:00:00.000Z", windowDays: 30 });
  expect(r1.health).toBe(r2.health);
  expect(r1.healthSignals).toEqual(r2.healthSignals);
  expect(r1.scopedProposals).toEqual(r2.scopedProposals);
});

it("populates healthSignals with structured severity and message", () => {
  const builder = new PipelineHealthBuilder();
  const input = makeHealthyInput({
    scopedProposalInputs: [
      { contextConfidence: 0.8, ageDays: 45, lineageCompleteness: "broken", dataFreshness: { newestDays: 10, oldestDays: 50 } },
    ],
  });
  const report = builder.build(input);
  const severities = report.healthSignals.map(s => s.severity);
  expect(severities).toContain("warning");   // stale
  expect(severities).toContain("critical");  // broken lineage
  expect(report.healthSignals.every(s => typeof s.message === "string" && s.message.length > 0)).toBe(true);
});

it("info signal for no proposals in window", () => {
  const builder = new PipelineHealthBuilder();
  const input = makeHealthyInput({
    proposalCounts: { total: 0, pending: 0, approved: 0, applied: 0, rejected: 0, failed: 0 },
    scopedProposalInputs: [],
    effectivenessReports: 0,
    intelligenceReports: 0,
    lifecycleEvents: { total: 0, inWindow: 0 },
  });
  const report = builder.build(input);
  expect(report.healthSignals.some(s => s.severity === "info" && s.message.includes("No proposals"))).toBe(true);
});

it("stores storeAvailability and storeErrors", () => {
  const builder = new PipelineHealthBuilder();
  const input = makeHealthyInput({
    storeErrors: { evidenceStore: "Connection refused" },
  });
  const report = builder.build(input);
  expect(report.storeAvailability.proposalStore).toBe(true);
  expect(report.storeErrors?.evidenceStore).toBe("Connection refused");
});

it("windowDays is clamped to valid values", () => {
  const builder = new PipelineHealthBuilder();
  const input = makeHealthyInput();
  const report = builder.build(input, { windowDays: 45 as any });
  expect(report.windowDays).toBe(30); // clamped to default
});
```

- [ ] **Step 5: Run test to verify all pass**

Run: `npx vitest run tests/adaptation/pipeline-health-builder.vitest.ts 2>&1 | tail -20`
Expected: 12+ tests passing

- [ ] **Step 6: Commit**

```bash
git add src/adaptation/pipeline-health-builder.ts tests/adaptation/pipeline-health-builder.vitest.ts
git commit -m "feat(p6.6a): PipelineHealthBuilder pure computation"
```

---

### Task 3: PipelineHealthCollector (I/O Layer)

**Files:**
- Create: `src/adaptation/pipeline-health-collector.ts`

**Interfaces:**
- Consumes: `ProposalStore`, `EvidenceStore`, `EffectivenessStore`, `IntelligenceStore`, `DecisionContextBuilder`, `StrategicBriefBuilder`, `PipelineHealthInput` from `./pipeline-health-types.js`
- Produces: `PipelineHealthCollector.collect(windowDays): Promise<PipelineHealthInput>`

- [ ] **Step 1: Verify the builder tests pass first (dependency)**

```bash
npx vitest run tests/adaptation/pipeline-health-builder.vitest.ts 2>&1 | tail -5
```

- [ ] **Step 2: Create PipelineHealthCollector**

```typescript
/**
 * P6.6a — PipelineHealthCollector: I/O for health reports.
 *
 * Reads all P6 stores and builds the PipelineHealthInput consumed
 * by PipelineHealthBuilder. All I/O happens here — the builder stays pure.
 *
 * No writes. No new evidence events. Read-only.
 *
 * @module
 */

import type { PipelineHealthInput, ScopedProposalData } from "./pipeline-health-types.js";
import type { ProposalStore } from "./proposal-store.js";
import type { EvidenceStore } from "../security/evidence/evidence-store.js";
import type { EffectivenessStore } from "./effectiveness-store.js";
import type { IntelligenceStore } from "./intelligence-store.js";
import type { DecisionContextBuilder } from "./decision-context-builder.js";
import { RiskScoreBuilder } from "./risk-score-builder.js";
import { RecommendationEngine } from "./recommendation-engine.js";
import { StrategicBriefBuilder } from "./strategic-brief.js";
import type { StrategicBriefOptions } from "./strategic-brief-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Evidence window is derived from the requested windowDays parameter

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export interface HealthCollectorInfrastructure {
  proposalStore: ProposalStore;
  evidenceStore: EvidenceStore;
  effectivenessStore: EffectivenessStore;
  intelligenceStore: IntelligenceStore;
  contextBuilder: DecisionContextBuilder;
  riskScoreBuilder: RiskScoreBuilder;
  recommendationEngine: RecommendationEngine;
}

export class PipelineHealthCollector {
  #infra: HealthCollectorInfrastructure;

  constructor(infra: HealthCollectorInfrastructure) {
    this.#infra = infra;
  }

  async collect(windowDays: number): Promise<PipelineHealthInput> {
    const storeAvailability = {
      proposalStore: true,
      evidenceStore: true,
      effectivenessStore: true,
      intelligenceStore: true,
    };
    const storeErrors: NonNullable<PipelineHealthInput["storeErrors"]> = {};

    // 1. Load proposals
    let proposals: Array<{ id: string; status: string }> = [];
    try {
      proposals = await this.#infra.proposalStore.list();
    } catch (err) {
      storeAvailability.proposalStore = false;
      storeErrors.proposalStore = err instanceof Error ? err.message : String(err);
    }

    // Compute status counts
    const proposalCounts: PipelineHealthInput["proposalCounts"] = {
      total: proposals.length,
      pending: proposals.filter(p => p.status === "pending").length,
      approved: proposals.filter(p => p.status === "approved").length,
      applied: proposals.filter(p => p.status === "applied").length,
      rejected: proposals.filter(p => p.status === "rejected").length,
      failed: proposals.filter(p => p.status === "failed").length,
    };

    // 2. Build DecisionContexts for scoped proposals (pending + created/applied within window)
    const windowStartMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const scopedIds = proposals
      .filter(p => {
        if (p.status === "pending") return true;
        // Proposals don't have appliedAt — use createdAt only
        const createdAt = Date.parse((p as any).createdAt ?? "");
        return Number.isFinite(createdAt) && createdAt >= windowStartMs;
      })
      .map(p => p.id);

    const scopedProposalInputs: ScopedProposalData[] = [];
    for (const id of scopedIds) {
      try {
        const ctx = await this.#infra.contextBuilder.build(id);
        const risk = this.#infra.riskScoreBuilder.build(ctx);
        const recommendation = this.#infra.recommendationEngine.recommend(ctx, risk);
        scopedProposalInputs.push({
          contextConfidence: ctx.confidence,
          riskConfidence: risk.confidence,
          recommendationConfidence: recommendation.confidence,
          ageDays: ctx.ageDays,
          lineageCompleteness: ctx.lineageCompleteness,
          dataFreshness: {
            newestDays: ctx.dataFreshness.newestArtifactAgeDays,
            oldestDays: ctx.dataFreshness.oldestArtifactAgeDays,
          },
        });
      } catch {
        // Per-proposal error isolation: skip, continue
      }
    }

    // 3. Load effectiveness reports (count only)
    let effectivenessReports = 0;
    try {
      const effList = await this.#infra.effectivenessStore.list();
      effectivenessReports = effList.length;
    } catch (err) {
      storeAvailability.effectivenessStore = false;
      storeErrors.effectivenessStore = err instanceof Error ? err.message : String(err);
    }

    // 4. Load intelligence reports
    let intelligenceReports = 0;
    let intelRecords: any[] = [];
    try {
      intelRecords = await this.#infra.intelligenceStore.list();
      intelligenceReports = intelRecords.length;
    } catch (err) {
      storeAvailability.intelligenceStore = false;
      storeErrors.intelligenceStore = err instanceof Error ? err.message : String(err);
    }

    // 5. Count evidence events
    let lifecycleEventsTotal = 0;
    let lifecycleEventsInWindow = 0;
    let evRecords: any[] = [];
    try {
      const evResult = await this.#infra.evidenceStore.query({});
      lifecycleEventsTotal = evResult.total;
      evRecords = evResult.records;
      const evidenceWindowMs = windowDays * 24 * 60 * 60 * 1000;
      const windowCutoff = new Date(Date.now() - evidenceWindowMs);
      lifecycleEventsInWindow = evResult.records.filter(e => new Date(e.timestamp).getTime() >= windowCutoff.getTime()).length;
    } catch (err) {
      storeAvailability.evidenceStore = false;
      storeErrors.evidenceStore = err instanceof Error ? err.message : String(err);
    }

    // 6. Build strategic brief — available: false only on build failure.
    // Load actual intelligence and effectiveness records for meaningful findings.
    // If loading fails, the brief still runs with what's available.
    let effectivenessRecords: any[] = [];
    if (storeAvailability.effectivenessStore) {
      try { effectivenessRecords = await this.#infra.effectivenessStore.list(); } catch { /* partial */ }
    }
    let strategicBrief: PipelineHealthInput["strategicBrief"];
    try {
      const briefBuilder = new StrategicBriefBuilder();
      const briefOptions: StrategicBriefOptions = { window: windowDays as 30 | 90 | 180, generatedAt: new Date().toISOString() };
      const briefInput = {
        intelligenceReports: intelRecords,
        effectivenessReports: effectivenessRecords,
        evidenceRecords: evRecords,
      };
      const brief = briefBuilder.build(briefInput, briefOptions);
      strategicBrief = {
        available: true,
        confidence: brief.confidence,
        findings: brief.findings.length,
      };
    } catch {
      strategicBrief = { available: false, confidence: null, findings: 0 };
    }

    // Exclude unused store error keys that are falsey
    const cleanStoreErrors: PipelineHealthInput["storeErrors"] = {};
    for (const [key, val] of Object.entries(storeErrors)) {
      if (val) (cleanStoreErrors as any)[key] = val;
    }

    return {
      proposalCounts,
      scopedProposalInputs,
      effectivenessReports,
      intelligenceReports,
      lifecycleEvents: { total: lifecycleEventsTotal, inWindow: lifecycleEventsInWindow },
      strategicBrief,
      storeAvailability,
      storeErrors: Object.keys(cleanStoreErrors).length > 0 ? cleanStoreErrors : undefined,
    };
  }
}
```

- [ ] **Step 3: Write a lightweight collector test with mock infra**

```typescript
// tests/adaptation/pipeline-health-collector.vitest.ts
import { describe, it, expect, vi } from "vitest";
import { PipelineHealthCollector } from "../../src/adaptation/pipeline-health-collector.js";

function makeMockInfra(overrides: Record<string, any> = {}) {
  const defaultStore = { list: vi.fn().mockResolvedValue([]), load: vi.fn().mockResolvedValue({}) };
  return {
    proposalStore: { list: vi.fn().mockResolvedValue([{ id: "p1", status: "pending" }, { id: "p2", status: "applied" }, { id: "p3", status: "rejected" }]) },
    evidenceStore: { query: vi.fn().mockResolvedValue({ records: [{ timestamp: new Date().toISOString() }], total: 1, truncated: false }) },
    effectivenessStore: { ...defaultStore, list: vi.fn().mockResolvedValue([{ id: "e1" }]) },
    intelligenceStore: { ...defaultStore, list: vi.fn().mockResolvedValue([{ id: "i1" }]) },
    contextBuilder: {
      build: vi.fn().mockResolvedValue({
        id: "ctx", confidence: 0.8, ageDays: 5, lineageCompleteness: "complete" as const,
        dataFreshness: { newestArtifactAgeDays: 2, oldestArtifactAgeDays: 10 },
      }),
    },
    riskScoreBuilder: { build: vi.fn().mockReturnValue({ id: "risk", confidence: 0.75, overallRisk: 0.4 }) },
    recommendationEngine: { recommend: vi.fn().mockReturnValue({ id: "rec", confidence: 0.82, recommendation: "approve" }) },
    ...overrides,
  };
}

describe("PipelineHealthCollector", () => {
  it("collects pending + window-scoped proposals", async () => {
    const collector = new PipelineHealthCollector(makeMockInfra());
    const input = await collector.collect(30);
    expect(input.proposalCounts.total).toBe(3);
    expect(input.proposalCounts.pending).toBe(1);
    expect(input.scopedProposalInputs.length).toBeGreaterThanOrEqual(1);
  });

  it("includes risk and recommendation confidence", async () => {
    const collector = new PipelineHealthCollector(makeMockInfra());
    const input = await collector.collect(30);
    if (input.scopedProposalInputs.length > 0) {
      const data = input.scopedProposalInputs[0];
      expect(data.contextConfidence).toBe(0.8);
      expect(data.riskConfidence).toBe(0.75);
      expect(data.recommendationConfidence).toBe(0.82);
    }
  });

  it("skips failed context builds", async () => {
    const infra = makeMockInfra({
      contextBuilder: {
        build: vi.fn().mockRejectedValue(new Error("Store error")),
      },
    });
    const collector = new PipelineHealthCollector(infra);
    const input = await collector.collect(30);
    expect(input.scopedProposalInputs.length).toBe(0);
  });

  it("detects unavailable ProposalStore", async () => {
    const infra = makeMockInfra({
      proposalStore: { list: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) },
    });
    const collector = new PipelineHealthCollector(infra);
    const input = await collector.collect(30);
    expect(input.storeAvailability.proposalStore).toBe(false);
    expect(input.storeErrors?.proposalStore).toBe("ECONNREFUSED");
  });

  it("sets strategicBrief available when build succeeds", async () => {
    const collector = new PipelineHealthCollector(makeMockInfra());
    const input = await collector.collect(30);
    expect(input.strategicBrief.available).toBe(true);
    expect(typeof input.strategicBrief.confidence).toBe("number");
  });
});
```

- [ ] **Step 4: Run collector tests**

```bash
npx vitest run tests/adaptation/pipeline-health-collector.vitest.ts 2>&1 | tail -10
```
Expected: 5+ tests passing

- [ ] **Step 5: Run full test suite to verify no regressions**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: 930+ tests passing

- [ ] **Step 6: Commit**

```bash
git add src/adaptation/pipeline-health-collector.ts tests/adaptation/pipeline-health-collector.vitest.ts
git commit -m "feat(p6.6a): PipelineHealthCollector I/O layer"
```

---

### Task 4: CLI — `alix decision status`

**Files:**
- Modify: `src/cli/commands/decision.ts`

**Interfaces:**
- Consumes: `PipelineHealthCollector` from `../../adaptation/pipeline-health-collector.js`, `PipelineHealthBuilder` from `../../adaptation/pipeline-health-builder.js`, types from `../../adaptation/pipeline-health-types.js`

- [ ] **Step 1: Add imports and runStatus function**

After the existing imports in `src/cli/commands/decision.ts`, add:

```typescript
import { PipelineHealthCollector } from "../../adaptation/pipeline-health-collector.js";
import { PipelineHealthBuilder } from "../../adaptation/pipeline-health-builder.js";
import { RiskScoreBuilder } from "../../adaptation/risk-score-builder.js";
import { RecommendationEngine } from "../../adaptation/recommendation-engine.js";
import type { PipelineHealthReport } from "../../adaptation/pipeline-health-types.js";
```

Add `case "status":` to the switch in `handleDecisionCommand`:

```typescript
    case "status":
      await runStatus(rest);
      return;
```

Update the usage string to include `status`:

```typescript
console.error("Usage: alix decision context <proposal-id> [--json] | risk <proposal-id> [--json] | recommend <proposal-id> [--json] | queue [--json] [--limit N] | brief [--window N] [--json] | status [--window N] [--json]");
```

Add the `runStatus` function after `runBrief`:

```typescript
// ---------------------------------------------------------------------------
// runStatus — Pipeline Health Report
// ---------------------------------------------------------------------------

async function runStatus(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  const windowDays = windowIdx !== -1 && windowIdx + 1 < args.length ? parseInt(args[windowIdx + 1], 10) : 30;

  const cwd = process.cwd();
  const infra = buildDecisionInfrastructure(cwd);
  const riskScoreBuilder = new RiskScoreBuilder();
  const recommendationEngine = new RecommendationEngine();
  const collector = new PipelineHealthCollector({ ...infra, riskScoreBuilder, recommendationEngine });
  const builder = new PipelineHealthBuilder();

  const input = await collector.collect(windowDays);
  const report = builder.build(input, { windowDays: windowDays as any, generatedAt: new Date().toISOString() });

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Terminal renderer
  const healthIcon = report.health === "healthy" ? "✅" : report.health === "degraded" ? "⚠️" : "🔴";
  console.log(`Pipeline Health — Last ${report.windowDays} days: ${healthIcon} ${report.health}`);
  console.log(`═══════════════════════════════════════`);
  console.log(``);

  const p = report.proposalCounts;
  console.log(`Proposals: ${p.total} total (${p.pending} pending, ${p.applied} applied, ${p.approved} approved, ${p.rejected} rejected, ${p.failed} failed)`);

  if (report.scopedProposals.total > 0) {
    const s = report.scopedProposals;
    const stale = s.staleProposals > 0 ? `  ⚠ Stale: ${s.staleProposals} (>30 days)` : "";
    const broken = s.brokenLineage > 0 ? `  Broken lineage: ${s.brokenLineage}` : "";
    const suffix = [stale, broken].filter(Boolean).join(" | ");
    console.log(` ${suffix}`);
    console.log(``);
    console.log(`Confidence:`);
    console.log(`  Context: ${(s.confidence.contextAvg * 100).toFixed(0)}% avg (n=${s.confidence.sampleSize})`);
    if (s.confidence.riskAvg !== undefined) console.log(`  Risk: ${(s.confidence.riskAvg * 100).toFixed(0)}% avg`);
    if (s.confidence.recommendationAvg !== undefined) console.log(`  Recommendation: ${(s.confidence.recommendationAvg * 100).toFixed(0)}% avg`);
  } else {
    console.log(`  No proposals in window`);
  }
  console.log(``);

  if (report.strategicBrief.available) {
    console.log(`Strategic brief: ${report.strategicBrief.confidence !== null ? (report.strategicBrief.confidence * 100).toFixed(0) + "%" : "N/A"} (${report.strategicBrief.findings} findings)`);
  } else {
    console.log(`Strategic brief: unavailable`);
  }
  console.log(``);

  console.log(`Activity:`);
  console.log(`  Effectiveness reports: ${report.effectivenessReports}  |  Intelligence reports: ${report.intelligenceReports}`);
  console.log(`  Lifecycle events: ${report.lifecycleEvents.total} total (${report.lifecycleEvents.inWindow} in window)`);
  console.log(``);

  if (report.governanceReview.frameworkAvailable) {
    console.log(`Governance review: Framework ready (P6.5a). Lenses deferred (P6.5b).`);
  }
  console.log(``);

  if (report.healthSignals.length > 0) {
    console.log(`Signals:`);
    for (const signal of report.healthSignals) {
      const icon = signal.severity === "critical" ? "🔴" : signal.severity === "warning" ? "⚠️" : "ℹ️";
      console.log(`  ${icon} ${signal.message}`);
    }
  }
}
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run 2>&1 | tail -10
```
Expected: 935+ tests passing

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/decision.ts
git commit -m "feat(p6.6a): CLI alix decision status command"
```

---

## Self-Review Check

- **Spec coverage:**
  - [x] PipelineHealthReport artifact with all fields (Task 1)
  - [x] PipelineHealthBuilder pure computation (Task 2)
  - [x] PipelineHealthCollector I/O layer (Task 3)
  - [x] Health computation rules: attention_needed/degraded/healthy (Task 2)
  - [x] healthSignals with severity (Task 2)
  - [x] storeAvailability and storeErrors (Tasks 1, 2, 3)
  - [x] strategicBrief.available = build failure only (Tasks 2, 3)
  - [x] lifecycleEvents total/inWindow split (Tasks 2, 3)
  - [x] CLI: terminal renderer and --json (Task 4)
  - [x] Per-proposal error isolation in collector (Task 3)
  - [x] Window scoping with --window flag (Tasks 3, 4)
  - [x] No writes, no new evidence types (all tasks)
  - [x] P6.5a governanceReview hardcoded true (Task 1)
- **Placeholder scan:** Clean — no TODOs, TBDs, or fill-in-later patterns.
- **Type consistency:** `PipelineHealthInput`, `PipelineHealthReport`, `PipelineHealthBuilder`, `PipelineHealthCollector` — consistent across all 4 tasks.
