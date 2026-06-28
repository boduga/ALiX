# P5.0 — Reflection Agent: The Cognitive Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ALiX's first feedback loop — a ReflectionAgent that reads evidence, workflow state, capability resolution, and review findings to produce observations, metrics, and recommendations without mutating anything.

**Architecture:** Four analyzers implement a common `Analyzer` interface and feed into one ReflectionAgent. Each reads from a different P4.x data source using targeted queries. The ReflectionAgent composes them via the plugin pattern and produces a single ReflectionReport with observations, recommendations, and aggregate metrics.

**Tech Stack:** TypeScript (TSX/ESM), P4.4 EvidenceStore (targeted type queries), P4.5 WorkflowCoordinator + state file, P4.7 CardRegistry, P4.5 ReviewAgent evidence events.

## Global Constraints

- **No mutation.** Reflection reads data and produces reports. Never creates, modifies, or deletes agents, cards, skills, or state.
- All analyzers implement the common `Analyzer` interface.
- All queries to EvidenceStore use targeted `type` filters, not full scans.
- The ReflectionReport schema is the single output contract.
- Governance-first: recommend, never change.

---
### File Structure

| File | Role |
|------|------|
| `src/reflection/reflection-types.ts` | **Create** — ReflectionReport, Observation, Recommendation, Analyzer, metrics |
| `src/reflection/evidence-analyzer.ts` | **Create** — Targeted evidence queries by type for failure/stall patterns |
| `src/reflection/workflow-analyzer.ts` | **Create** — Reads WorkflowCoordinator state file for stall/backlog detection |
| `src/reflection/capability-analyzer.ts` | **Create** — Reads `capability_routed` / `agent_resolved` evidence for gap detection |
| `src/reflection/quality-analyzer.ts` | **Create** — Reads `review_completed` evidence for trend analysis |
| `src/reflection/reflection-agent.ts` | **Create** — Plugin-based composition of analyzers |
| `src/cli/commands/reflection.ts` | **Create** — `alix reflection report` CLI command |
| `tests/reflection/` | **Create** — 7 test files for all components |

---
## Task 1: P5.0a — ReflectionReport Schema + Analyzer Interface

**Files:**
- Create: `src/reflection/reflection-types.ts`
- Test: `tests/reflection/reflection-types.vitest.ts`

**Interfaces:**
- Produces: `ReflectionReport`, `Observation`, `Recommendation`, `ReflectionMetrics`, `AnalysisResult`, `Analyzer` interface

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import type { ReflectionReport, Observation, Analyzer, AnalysisResult } from "../../src/reflection/reflection-types.js";

describe("ReflectionReport types", () => {
  it("constructs a valid ReflectionReport with metrics", () => {
    const report: ReflectionReport = {
      generatedAt: new Date().toISOString(),
      observations: [{ type: "workflow_stall", severity: "medium", title: "Stalled", detail: "", source: "WA", count: 3 }],
      recommendations: [{ type: "capability_gap", confidence: 0.85, title: "Add UI cap", evidence: ["12 reqs"], recommendedAction: "Create" }],
      metrics: { workflowsCompleted: 5, workflowsBlocked: 3, workflowsAborted: 1, capabilitiesRequested: 10, unresolvedCapabilities: 2, reviewApprovalRate: 0.6 },
      summary: { totalObservations: 1, totalRecommendations: 1, highSeverityCount: 0 },
    };
    expect(report.metrics.workflowsCompleted).toBe(5);
    expect(report.metrics.unresolvedCapabilities).toBe(2);
  });

  it("Analyzer interface accepts typed result", () => {
    const analyzer: Analyzer = {
      name: "test",
      analyze: async () => ({ observations: [], recommendations: [] }),
    };
    expect(analyzer.name).toBe("test");
  });
});
```

- [ ] **Step 2: Create `src/reflection/reflection-types.ts`**

```typescript
export type ObservationSeverity = "high" | "medium" | "low";

export type ObservationType =
  | "workflow_stall" | "workflow_failure"
  | "capability_gap" | "routing_inefficiency"
  | "quality_decline" | "test_coverage_gap";

export interface Observation {
  type: ObservationType;
  severity: ObservationSeverity;
  title: string;
  detail: string;
  source: string;
  count: number;
}

export type RecommendationType =
  | "capability_gap" | "routing_adjustment"
  | "skill_revision" | "agent_card_update" | "process_change";

export interface Recommendation {
  type: RecommendationType;
  confidence: number;
  title: string;
  evidence: string[];
  recommendedAction: string;
}

export interface ReflectionMetrics {
  workflowsCompleted: number;
  workflowsBlocked: number;
  workflowsAborted: number;
  capabilitiesRequested: number;
  unresolvedCapabilities: number;
  reviewApprovalRate: number;
}

export interface ReflectionReport {
  generatedAt: string;
  observations: Observation[];
  recommendations: Recommendation[];
  metrics: ReflectionMetrics;
  summary: { totalObservations: number; totalRecommendations: number; highSeverityCount: number };
}

export interface AnalysisResult {
  observations: Observation[];
  recommendations: Recommendation[];
}

export interface Analyzer {
  name: string;
  analyze(): Promise<AnalysisResult>;
}
```

- [ ] **Step 3: Commit**
```bash
git add src/reflection/reflection-types.ts tests/reflection/reflection-types.vitest.ts
git commit -m "feat(p5.0a): add ReflectionReport, Analyzer interface, ReflectionMetrics"
```

---
## Task 2: P5.0b — EvidenceAnalyzer

**Files:**
- Create: `src/reflection/evidence-analyzer.ts`
- Test: `tests/reflection/evidence-analyzer.vitest.ts`

**Interfaces:**
- Consumes: `EvidenceStore` (targeted queries by type: `workflow_aborted`, `workflow_blocked`, `execution_test_failed`)
- Implements: `Analyzer`

- [ ] **Test** — seed evidence with specific types, verify targeted queries detect patterns
- [ ] **Implement** — uses `store.query({ type: "workflow_aborted" })`, `store.query({ type: "workflow_blocked" })`, `store.query({ type: "execution_test_failed" })` — targeted queries, no full scan
- [ ] **Commit**: `"feat(p5.0b): add EvidenceAnalyzer — targeted evidence queries for failure/stall patterns"`

---
## Task 3: P5.0c — WorkflowAnalyzer

**Files:**
- Create: `src/reflection/workflow-analyzer.ts`
- Test: `tests/reflection/workflow-analyzer.vitest.ts`

**Interfaces:**
- Consumes: `WorkflowCoordinator` (reads state file via `coordinator.listActive()` and `coordinator.currentState()`)
- Implements: `Analyzer`

- [ ] **Test** — create coordinator with entries in various states, verify analyzer detects stalls and backlog
- [ ] **Implement** — reads all active entries, measures time in each state, calculates stall/backlog aggregates

```typescript
export class WorkflowAnalyzer implements Analyzer {
  name = "WorkflowAnalyzer";
  constructor(private coordinator: WorkflowCoordinator) {}

  async analyze(): Promise<AnalysisResult> {
    const entries = await this.coordinator.listActive();
    const observations: Observation[] = [];
    const now = Date.now();
    const STALL_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

    // Count per-state
    const stateCounts = new Map<string, number>();
    const stalled: string[] = [];

    for (const entry of entries) {
      stateCounts.set(entry.state, (stateCounts.get(entry.state) ?? 0) + 1);
      const age = now - new Date(entry.updatedAt).getTime();
      if (age > STALL_THRESHOLD_MS) stalled.push(`#${entry.issueNumber}`);
    }

    if (stalled.length > 0) {
      observations.push({
        type: "workflow_stall",
        severity: stalled.length >= 3 ? "high" : "medium",
        title: `${stalled.length} workflow(s) stalled for over 24 hours`,
        detail: `Issues: ${stalled.join(", ")}`,
        source: this.name,
        count: stalled.length,
      });
    }

    // State backlog
    const backlogStates = ["BLOCKED", "EXECUTING", "UNDER_REVIEW"];
    for (const state of backlogStates) {
      const count = stateCounts.get(state) ?? 0;
      if (count >= 3) {
        observations.push({
          type: "workflow_stall",
          severity: "medium",
          title: `${count} workflow(s) in ${state}`,
          detail: `Accumulating in ${state} may indicate a bottleneck.`,
          source: this.name,
          count,
        });
      }
    }

    return { observations, recommendations: [] };
  }
}
```

- [ ] **Commit**: `"feat(p5.0c): add WorkflowAnalyzer — detects stalls and backlog from workflow state"`

---
## Task 4: P5.0d — CapabilityAnalyzer

**Files:**
- Create: `src/reflection/capability-analyzer.ts`
- Test: `tests/reflection/capability-analyzer.vitest.ts`

**Interfaces:**
- Consumes: `EvidenceStore` (queries `capability_routed` and `agent_resolved` events)
- Implements: `Analyzer`

- [ ] **Test** — seed `capability_routed` events with zero candidates and low-resolution entries, verify gap detection
- [ ] **Implement** — queries evidence by type; counts requested capabilities; identifies gaps where candidates === 0; derives recommendations from gap frequency

```typescript
export class CapabilityAnalyzer implements Analyzer {
  name = "CapabilityAnalyzer";
  constructor(private store: EvidenceStore) {}

  async analyze(): Promise<AnalysisResult> {
    const routed = await this.store.query({ type: "capability_routed", limit: 5000 });
    const observations: Observation[] = [];
    const recommendations: Recommendation[] = [];

    // Group by capability, track unresolved
    const requestCounts = new Map<string, number>();
    const zeroCandidateCaps = new Set<string>();

    for (const r of routed.records) {
      const cap = r.payload.capability as string;
      requestCounts.set(cap, (requestCounts.get(cap) ?? 0) + 1);
      if ((r.payload.candidates as number) === 0) {
        zeroCandidateCaps.add(cap);
      }
    }

    // Unresolved gaps
    for (const cap of zeroCandidateCaps) {
      const count = requestCounts.get(cap) ?? 0;
      if (count >= 2) {
        observations.push({
          type: "capability_gap",
          severity: count >= 5 ? "high" : "medium",
          title: `"${cap}" requested ${count} times with zero candidates`,
          detail: `No agent could handle this capability. Consider adding it to the registry.`,
          source: this.name,
          count,
        });
        recommendations.push({
          type: "capability_gap",
          confidence: Math.min(0.5 + count * 0.1, 0.95),
          title: `Add "${cap}" to agent registry`,
          evidence: [`Requested ${count} times`, "Zero agents matched"],
          recommendedAction: `Register an agent with "${cap}" capability or add it to an existing agent card`,
        });
      }
    }

    return { observations, recommendations };
  }
}
```

- [ ] **Commit**: `"feat(p5.0d): add CapabilityAnalyzer — capability gap detection from routing evidence"`

---
## Task 5: P5.0e — QualityAnalyzer

**Files:**
- Create: `src/reflection/quality-analyzer.ts`
- Test: `tests/reflection/quality-analyzer.vitest.ts`

**Interfaces:**
- Consumes: `EvidenceStore` (queries `review_completed` events — reads `findingCount` and aggregates by severity)
- Implements: `Analyzer`

- [ ] **Test** — seed `review_completed` events with varying verdicts and finding counts, verify trend detection
- [ ] **Implement** — calculates approval rate, average findings per review, flags high rejection or rising finding trends

```typescript
export class QualityAnalyzer implements Analyzer {
  name = "QualityAnalyzer";
  constructor(private store: EvidenceStore) {}

  async analyze(): Promise<AnalysisResult> {
    const reviews = await this.store.query({ type: "review_completed", limit: 5000 });
    const observations: Observation[] = [];

    if (reviews.records.length === 0) return { observations: [], recommendations: [] };

    let changesRequested = 0, rejects = 0, totalFindings = 0;
    for (const r of reviews.records) {
      const v = r.payload.verdict as string;
      if (v === "changes_requested") changesRequested++;
      if (v === "reject") rejects++;
      totalFindings += (r.payload.findingCount as number) ?? 0;
    }

    const approvalRate = (reviews.records.length - changesRequested - rejects) / reviews.records.length;
    const avgFindings = totalFindings / reviews.records.length;

    if (approvalRate < 0.5) {
      observations.push({
        type: "quality_decline",
        severity: "high",
        title: `Low approval rate: ${Math.round(approvalRate * 100)}%`,
        detail: `${changesRequested} changes requested, ${rejects} rejected. Avg ${avgFindings.toFixed(1)} findings/review.`,
        source: this.name,
        count: reviews.records.length,
      });
    } else if (approvalRate < 0.75) {
      observations.push({
        type: "quality_decline",
        severity: "medium",
        title: `Moderate rejection rate: ${Math.round((1 - approvalRate) * 100)}%`,
        detail: `Review approval rate is ${Math.round(approvalRate * 100)}% over ${reviews.records.length} reviews.`,
        source: this.name,
        count: reviews.records.length,
      });
    }

    if (avgFindings > 5) {
      observations.push({
        type: "quality_decline",
        severity: "medium",
        title: `High average findings per review: ${avgFindings.toFixed(1)}`,
        detail: `Averages over 5 findings per review may indicate systemic quality issues.`,
        source: this.name,
        count: Math.round(avgFindings),
      });
    }

    return { observations, recommendations: [] };
  }
}
```

- [ ] **Commit**: `"feat(p5.0e): add QualityAnalyzer — review trend detection from review_completed evidence"`

---
## Task 6: P5.0f — ReflectionAgent

**Files:**
- Create: `src/reflection/reflection-agent.ts`
- Test: `tests/reflection/reflection-agent.vitest.ts`

**Interfaces:**
- Consumes: `Analyzer[]` (plugin pattern), `EvidenceStore` (for metrics)
- Produces: `ReflectionAgent` class with `generateReport()` that runs all analyzers and aggregates

- [ ] **Test** — register mock analyzers, verify all run and results are aggregated
- [ ] **Implement** — supports any number of analyzers via constructor injection; runs all in parallel; collects observations, recommendations, and metrics

```typescript
export class ReflectionAgent {
  constructor(private analyzers: Analyzer[], private storeForMetrics: EvidenceStore) {}

  async generateReport(): Promise<ReflectionReport> {
    const results = await Promise.all(this.analyzers.map(a => a.analyze()));
    const allObs = results.flatMap(r => r.observations);
    const allRecs = results.flatMap(r => r.recommendations);

    // Compute metrics from evidence store
    const completed = await this.storeForMetrics.query({ type: "merge_completed", limit: 1 });
    const blocked = await this.storeForMetrics.query({ type: "workflow_blocked", limit: 1 });
    const aborted = await this.storeForMetrics.query({ type: "workflow_aborted", limit: 1 });
    const routed = await this.storeForMetrics.query({ type: "capability_routed", limit: 5000 });
    const reviews = await this.storeForMetrics.query({ type: "review_completed", limit: 5000 });

    const unresolvedRouted = routed.records.filter(r => (r.payload.candidates as number) === 0);
    const approvedReviews = reviews.records.filter(r => r.payload.verdict === "approve").length;

    return {
      generatedAt: new Date().toISOString(),
      observations: allObs,
      recommendations: allRecs,
      metrics: {
        workflowsCompleted: completed.total,
        workflowsBlocked: blocked.total,
        workflowsAborted: aborted.total,
        capabilitiesRequested: routed.total,
        unresolvedCapabilities: unresolvedRouted.length,
        reviewApprovalRate: reviews.total > 0 ? approvedReviews / reviews.total : 1,
      },
      summary: {
        totalObservations: allObs.length,
        totalRecommendations: allRecs.length,
        highSeverityCount: allObs.filter(o => o.severity === "high").length,
      },
    };
  }
}
```

- [ ] **Commit**: `"feat(p5.0f): add ReflectionAgent — plugin-based analyzer composition with metrics"`

---
## Task 7: P5.0g — CLI Command

**Files:**
- Create: `src/cli/commands/reflection.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Produces: `alix reflection report` CLI command

- [ ] **Create command** — `handleReflectionCommand()` that wires up all 4 analyzers + agent + outputs JSON report
- [ ] **Wire into cli.ts** — help text + dispatch after evidence command

---
## Verification

```bash
npx vitest run tests/reflection/ tests/workflow/ tests/cli/ tests/security/evidence/ --config vitest.config.mts
```
Expected: All tests pass.

---
## Summary

After P5.0, ALiX can answer:

- How many workflows completed, blocked, or aborted?
- Which workflows are stalled for over 24 hours?
- Which states have backlog?
- What capabilities are frequently requested but unresolved?
- What is the review approval rate?
- Are findings per review increasing?

All using targeted evidence queries — no full scans. All analyzers implement the plugin `Analyzer` interface. The ReflectionAgent composes them at runtime via constructor injection. Governance-first: observe and recommend, never mutate.
