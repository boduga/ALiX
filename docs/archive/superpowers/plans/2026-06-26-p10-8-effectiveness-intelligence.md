# P10.8 — Recommendation Effectiveness Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `alix executive recommendation-effectiveness [--since <days>] [--threshold <days>] [--report <id>] [--json]` — a read-only analyzer that classifies every executive recommendation by what happened to it (bridged? proposal applied? rejected? stale?), then calibrates per-signal action rates. Answers "do operators act on this signal type?"

**Architecture:** A pure `classifyRecommendation(input, staleThresholdDays)` maps a single rec to one of 8 evidence-based dispositions. A pure `computeRecommendationEffectiveness(entries, ...)` aggregates per-signal calibration from pre-classified entries. A thin CLI handler owns store I/O (loads reports from `RecommendationReportStore`, loads proposals from `ProposalStore`), computes age from real time, calls both pure functions, and renders terminal/JSON. No writes, no proposals, no engine hooks.

**Tech Stack:** TypeScript, Node.js `fs` (CLI handler only), vitest, existing `RecommendationReportStore`, `ProposalStore`.

**Spec:** `docs/superpowers/specs/2026-06-26-p10-8-effectiveness-intelligence-design.md`

## Global Constraints

| Constraint | Value |
|---|---|
| No writes | P10.8a does NOT write to any store. It does NOT populate `disposition`/`outcomeConfidence`/`outcomeSummary` on persisted recommendations. |
| No proposals created, approved, or applied | P10.8a does NOT call `ProposalStore.save` or any applier/gate. |
| No evaluation | P10.8a does NOT call outcome evaluation or calibration machinery. |
| Outcome signal | Proposal lifecycle status only (`ProposalStore.load`). `EffectivenessStore` and `OutcomeReportStore` are NOT joined in P10.8a. |
| Dispositions (8) | `unreviewed` / `stale` / `awaiting_review` / `approved_pending_apply` / `applied` / `rejected` / `failed` / `proposal_missing` |
| No inferred `ignored` | The word "ignored" implies human intent the data model cannot observe. Reserved for future explicit dismiss action. |
| `ageDays` computed by CLI | Pure functions receive `ageDays` as a number, not a timestamp. Keeps tests deterministic. |
| `proposalStatus` fetched by CLI | Handler catches `null` (not found) and throws (corrupt) from `ProposalStore.load`, passes `null` for both → disposition `proposal_missing` + `loadWarnings` entry. |
| `--since <days>` | Time-based (not count-based), distinct from P10.6's `--window`. |
| CLI | `alix executive recommendation-effectiveness [--since <days>] [--threshold <days>] [--report <id>] [--json]` |
| Sentinel | 2 new files in `EXECUTIVE_FILES`, no scoped exceptions. Handler uses `ProposalStore.load(...)` (read-only) — sentinel-clean. |

---

---

### Task 0: Branch + docs carry-forward

- [ ] Create the feature branch from `main` (P10.7c merged at `992364ca`, PR #131 at `9f54e95c`)

```bash
git checkout main
git pull --ff-only
git checkout -b feature/p10-8-effectiveness-intelligence
```

- [ ] The P10.8 spec is already on `main` at `acbb2615`. The plan file does NOT exist yet — write it in this step.

- [ ] Write and commit the plan document

After writing `docs/superpowers/plans/2026-06-26-p10-8-effectiveness-intelligence.md` (this file), run:

```bash
git add docs/superpowers/plans/2026-06-26-p10-8-effectiveness-intelligence.md
git commit -m "docs(p10-8): add implementation plan"
```

---

### Task 1: Pure `classifyRecommendation` + `computeRecommendationEffectiveness` + types + unit tests

**Files:**
- Create: `src/executive/recommendation-effectiveness.ts` (types + both pure functions)
- Create: `tests/executive/recommendation-effectiveness.vitest.ts` (unit tests)

**Interfaces:**
- Consumes: nothing from other P10.x files (all types defined locally; `RecommendationDisposition` matches what the CLI handler will map to)
- Produces: `RecommendationDisposition`, `RecommendationEntry`, `SignalCalibration`, `EffectivenessResult`, `EFFECTIVENESS_OK`, `EFFECTIVENESS_NO_DATA`, `classifyRecommendation(input, staleThresholdDays?)`, `computeRecommendationEffectiveness(entries, staleThresholdDays, generatedAt)`, `sortRecommendations(entries)`

- [ ] **Step 1: Write the failing test file**

`tests/executive/recommendation-effectiveness.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  classifyRecommendation,
  computeRecommendationEffectiveness,
  EFFECTIVENESS_OK,
  EFFECTIVENESS_NO_DATA,
} from "../../src/executive/recommendation-effectiveness.js";
import type { ClassifyInput, RecommendationEntry } from "../../src/executive/recommendation-effectiveness.js";

const GENERATED_AT = "2026-06-26T00:00:00.000Z";
// Helper: make a basic classify input
function cInput(over: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    subsystem: "workflow",
    signal: "degrading_trend",
    severity: "high",
    signalConfidence: 0.88,
    recommendation: "Investigate workflow regressions",
    ageDays: 1,
    ...over,
  };
}

describe("classifyRecommendation — unbridged (no proposalId)", () => {
  it("returns unreviewed when age < threshold", () => {
    // age 1 < threshold 7
    expect(classifyRecommendation(cInput({ ageDays: 1 }))).toBe("unreviewed");
  });

  it("returns stale when age >= threshold", () => {
    // age 7 >= threshold 7 → stale (boundary)
    expect(classifyRecommendation(cInput({ ageDays: 7 }))).toBe("stale");
    expect(classifyRecommendation(cInput({ ageDays: 14 }))).toBe("stale");
  });

  it("respects custom threshold", () => {
    expect(classifyRecommendation(cInput({ ageDays: 3 }), 3)).toBe("stale");
    expect(classifyRecommendation(cInput({ ageDays: 2 }), 3)).toBe("unreviewed");
  });
});

describe("classifyRecommendation — bridged (with proposalId)", () => {
  it("returns awaiting_review when proposal is pending", () => {
    expect(classifyRecommendation(cInput({ proposalId: "p1", proposalStatus: "pending" }))).toBe("awaiting_review");
  });

  it("returns approved_pending_apply when proposal is approved", () => {
    expect(classifyRecommendation(cInput({ proposalId: "p1", proposalStatus: "approved" }))).toBe("approved_pending_apply");
  });

  it("returns applied when proposal is applied", () => {
    expect(classifyRecommendation(cInput({ proposalId: "p1", proposalStatus: "applied" }))).toBe("applied");
  });

  it("returns rejected when proposal is rejected", () => {
    expect(classifyRecommendation(cInput({ proposalId: "p1", proposalStatus: "rejected" }))).toBe("rejected");
  });

  it("returns failed when proposal is failed", () => {
    expect(classifyRecommendation(cInput({ proposalId: "p1", proposalStatus: "failed" }))).toBe("failed");
  });

  it("returns proposal_missing when proposalStatus is null (load returned null)", () => {
    expect(classifyRecommendation(cInput({ proposalId: "p1", proposalStatus: null }))).toBe("proposal_missing");
  });

  it("remains unreviewed/stale when proposalId is undefined regardless of proposalStatus", () => {
    // proposalId undefined → unbridged branch; proposalStatus is ignored
    expect(classifyRecommendation(cInput({ proposalId: undefined, proposalStatus: "applied" }))).toBe("unreviewed");
  });
});

describe("computeRecommendationEffectiveness", () => {
  it("returns no_data for empty entries", () => {
    const result = computeRecommendationEffectiveness([], 7, GENERATED_AT);
    expect(result.effectivenessStatus).toBe(EFFECTIVENESS_NO_DATA);
    expect(result.signalCalibration).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  it("correctly tallies per-signal dispositions", () => {
    const entries: RecommendationEntry[] = [
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 0, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "applied" },
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 1, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "rejected" },
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 2, subsystem: "routing", signal: "persistent_instability", severity: "medium", signalConfidence: 0.55, recommendation: "y", ageDays: 1, disposition: "stale" },
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    expect(result.effectivenessStatus).toBe(EFFECTIVENESS_OK);
    expect(result.totalRecommendations).toBe(3);
    expect(result.signalCalibration).toHaveLength(2);

    const deg = result.signalCalibration.find((s) => s.signal === "degrading_trend")!;
    expect(deg.total).toBe(2);
    expect(deg.applied).toBe(1);
    expect(deg.rejected).toBe(1);
    expect(deg.bridgedCount).toBe(2);  // applied + rejected = 2
    expect(deg.actionRate).toBe(1.0);  // 2/2

    const per = result.signalCalibration.find((s) => s.signal === "persistent_instability")!;
    expect(per.total).toBe(1);
    expect(per.stale).toBe(1);
    expect(per.bridgedCount).toBe(0);
    expect(per.actionRate).toBe(0.0);  // 0/1
  });

  it("includes proposal_missing in bridgedCount", () => {
    const entries: RecommendationEntry[] = [
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 0, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "proposal_missing", proposalId: "p1" },
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const deg = result.signalCalibration[0];
    expect(deg.proposalMissing).toBe(1);
    expect(deg.bridgedCount).toBe(1); // proposal_missing counted as bridged
    expect(deg.actionRate).toBe(1.0); // 1/1
  });

  it("populates loadWarnings from proposal_missing entries", () => {
    const entries: RecommendationEntry[] = [
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 2, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "proposal_missing", proposalId: "p1" },
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    expect(result.loadWarnings).toContain(
      'proposal not found: p1 (rec index 2 in report r1)',
    );
  });
});

describe("sortRecommendations", () => {
  it("sorts newest-first by generatedAt, then recIndex asc within same timestamp", () => {
    // Note: computeRecommendationEffectiveness calls sort internally; test via the result
    const entries: RecommendationEntry[] = [
      { reportId: "r2", generatedAt: "2026-06-20T00:00:00.000Z", recIndex: 0, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "applied" },
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 1, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "rejected" },
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 0, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "applied" },
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    expect(result.recommendations.map((r) => `${r.generatedAt}:${r.recIndex}`)).toEqual([
      "2026-06-26T00:00:00.000Z:0",
      "2026-06-26T00:00:00.000Z:1",
      "2026-06-20T00:00:00.000Z:0",
    ]);
  });
});

describe("computeRecommendationEffectiveness — determinism", () => {
  it("injected generatedAt stamps the result", () => {
    const result = computeRecommendationEffectiveness([], 7, "2099-09-09T00:00:00.000Z");
    expect(result.generatedAt).toBe("2099-09-09T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/executive/recommendation-effectiveness.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the pure functions**

`src/executive/recommendation-effectiveness.ts`:

```ts
/**
 * P10.8 — Recommendation Effectiveness Intelligence.
 *
 * Pure functions that classify executive recommendations by their disposition
 * (what happened to them — bridged? rejected? stale?) and compute per-signal
 * calibration aggregates.
 *
 * Read-only: no I/O, no mutation, no proposals. The CLI handler (not this
 * module) owns store reads and age computation.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RecommendationDisposition =
  | "unreviewed"
  | "stale"
  | "awaiting_review"
  | "approved_pending_apply"
  | "applied"
  | "rejected"
  | "failed"
  | "proposal_missing";

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "failed";

export interface ClassifyInput {
  subsystem: string;
  signal: string;
  severity: string;
  signalConfidence: number;
  recommendation: string;
  proposalId?: string;
  /** The proposal's status from ProposalStore.load, or null if not found / corrupt. */
  proposalStatus?: ProposalStatus | null;
  /** Days since the source report was generated (only affects unreviewed/stale). */
  ageDays: number;
}

export interface RecommendationEntry {
  reportId: string;
  generatedAt: string;
  recIndex: number;
  subsystem: string;
  signal: string;
  severity: string;
  signalConfidence: number;
  recommendation: string;
  proposalId?: string;
  disposition: RecommendationDisposition;
  ageDays: number;
}

export interface SignalCalibration {
  signal: string;
  total: number;
  unreviewed: number;
  stale: number;
  awaitingReview: number;
  approvedPendingApply: number;
  applied: number;
  rejected: number;
  failed: number;
  proposalMissing: number;
  /** Sum of all 6 bridged states (awaitingReview + approvedPendingApply + applied + rejected + failed + proposalMissing). */
  bridgedCount: number;
  /** bridgedCount / total, [0..1], 2-decimal rounded. */
  actionRate: number;
}

export const EFFECTIVENESS_OK = "ok";
export const EFFECTIVENESS_NO_DATA = "no_data";

export interface EffectivenessResult {
  effectivenessStatus: typeof EFFECTIVENESS_OK | typeof EFFECTIVENESS_NO_DATA;
  generatedAt: string;
  staleThresholdDays: number;
  reportCount: number;
  totalRecommendations: number;
  signalCalibration: SignalCalibration[];
  recommendations: RecommendationEntry[];
  loadWarnings: string[];
}

// ---------------------------------------------------------------------------
// Default constants
// ---------------------------------------------------------------------------

const DEFAULT_STALE_THRESHOLD_DAYS = 7;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyRecommendation(
  input: ClassifyInput,
  staleThresholdDays: number = DEFAULT_STALE_THRESHOLD_DAYS,
): RecommendationDisposition {
  // Unbridged branch (no proposalId)
  if (input.proposalId === undefined) {
    return input.ageDays < staleThresholdDays ? "unreviewed" : "stale";
  }

  // Bridged branch — proposalStatus
  if (input.proposalStatus === null || input.proposalStatus === undefined) {
    return "proposal_missing";
  }

  switch (input.proposalStatus) {
    case "pending":  return "awaiting_review";
    case "approved": return "approved_pending_apply";
    case "applied":  return "applied";
    case "rejected": return "rejected";
    case "failed":   return "failed";
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function computeRecommendationEffectiveness(
  entries: RecommendationEntry[],
  staleThresholdDays: number,
  generatedAt: string,
): EffectivenessResult {
  const sorted = sortRecommendations(entries);

  if (entries.length === 0) {
    return {
      effectivenessStatus: EFFECTIVENESS_NO_DATA,
      generatedAt,
      staleThresholdDays,
      reportCount: 0,
      totalRecommendations: 0,
      signalCalibration: [],
      recommendations: [],
      loadWarnings: [],
    };
  }

  // Per-signal tallies
  const signalMap = new Map<string, SignalCalibration>();

  for (const entry of sorted) {
    let cal = signalMap.get(entry.signal);
    if (!cal) {
      cal = {
        signal: entry.signal,
        total: 0,
        unreviewed: 0, stale: 0,
        awaitingReview: 0, approvedPendingApply: 0,
        applied: 0, rejected: 0, failed: 0,
        proposalMissing: 0,
        bridgedCount: 0,
        actionRate: 0,
      };
      signalMap.set(entry.signal, cal);
    }

    cal.total++;

    switch (entry.disposition) {
      case "unreviewed":              cal.unreviewed++; break;
      case "stale":                    cal.stale++; break;
      case "awaiting_review":          cal.awaitingReview++; cal.bridgedCount++; break;
      case "approved_pending_apply":   cal.approvedPendingApply++; cal.bridgedCount++; break;
      case "applied":                  cal.applied++; cal.bridgedCount++; break;
      case "rejected":                 cal.rejected++; cal.bridgedCount++; break;
      case "failed":                   cal.failed++; cal.bridgedCount++; break;
      case "proposal_missing":         cal.proposalMissing++; cal.bridgedCount++; break;
    }
  }

  // Compute actionRate per signal
  const signalCalibration: SignalCalibration[] = [];
  for (const cal of signalMap.values()) {
    cal.actionRate = cal.total > 0
      ? Math.round((cal.bridgedCount / cal.total) * 100) / 100
      : 0;
    signalCalibration.push(cal);
  }

  // Collect loadWarnings from proposal_missing entries
  const loadWarnings: string[] = [];
  for (const entry of sorted) {
    if (entry.disposition === "proposal_missing" && entry.proposalId) {
      loadWarnings.push(
        `proposal not found: ${entry.proposalId} (rec index ${entry.recIndex} in report ${entry.reportId})`,
      );
    }
  }

  // Report count as distinct reportIds
  const reportIds = new Set(entries.map((e) => e.reportId));

  return {
    effectivenessStatus: EFFECTIVENESS_OK,
    generatedAt,
    staleThresholdDays,
    reportCount: reportIds.size,
    totalRecommendations: entries.length,
    signalCalibration,
    recommendations: sorted,
    loadWarnings,
  };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function sortRecommendations(entries: RecommendationEntry[]): RecommendationEntry[] {
  return [...entries].sort((a, b) => {
    const dateCmp = b.generatedAt.localeCompare(a.generatedAt);
    if (dateCmp !== 0) return dateCmp;
    const reportCmp = a.reportId.localeCompare(b.reportId);
    if (reportCmp !== 0) return reportCmp;
    return a.recIndex - b.recIndex;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/executive/recommendation-effectiveness.vitest.ts`
Expected: PASS — all ~15 tests green.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/executive/recommendation-effectiveness.ts tests/executive/recommendation-effectiveness.vitest.ts
git commit -m "feat(p10-8): classifyRecommendation + computeRecommendationEffectiveness + 15 unit tests"
```

---

### Task 2: CLI handler + routing + integration tests

**Files:**
- Create: `src/cli/commands/executive-effectiveness-handler.ts` (handler)
- Modify: `src/cli/commands/executive.ts` (add `case "recommendation-effectiveness"` + update subcommand list)
- Create: `tests/cli/commands/executive-effectiveness-cli.vitest.ts` (integration tests)

**Interfaces:**
- Consumes: `classifyRecommendation` + `computeRecommendationEffectiveness` + types from `../../executive/recommendation-effectiveness.js` (Task 1); `RecommendationReportStore` from `../../executive/recommendation-report-store.js`; `ProposalStore` from `../../adaptation/proposal-store.js`
- Produces: `handleEffectivenessCommand(args: string[]): Promise<void>`

**Handler flow:**
1. Parse flags: `--since <days>` (default 30), `--threshold <days>` (default 7), `--report <id>`, `--json`.
2. Load recommendation reports: all (filtered by `--since`) or a single `--report`.
3. For each report, iterate its `report.report.recommendations`, compute `ageDays = (now - report.report.generatedAt) / 86400000`.
4. For each bridged rec (`proposalId !== undefined`): `ProposalStore.load` → status or null (catch null/throw → null).
5. Call `classifyRecommendation(input)` for each rec → `RecommendationEntry`.
6. Call `computeRecommendationEffectiveness(entries, threshold, now)` → `EffectivenessResult`.
7. Render terminal tables or JSON.

- [ ] **Step 1: Append 7 failing integration tests**

Create `tests/cli/commands/executive-effectiveness-cli.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleEffectivenessCommand } from "../../../src/cli/commands/executive-effectiveness-handler.js";
import { RecommendationReportStore } from "../../../src/executive/recommendation-report-store.js";
import { ProposalStore } from "../../../src/adaptation/proposal-store.js";
import type { RecommendationReport } from "../../../src/executive/recommendation-report-store.js";
import type { ExecutiveRecommendation } from "../../../src/executive/recommendation-report-store.js";

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => { err.push(a.join(" ")); });
  return { out: () => out, err: () => err, restore: () => { logSpy.mockRestore(); warnSpy.mockRestore(); } };
}

function makeExecRec(over: Partial<ExecutiveRecommendation> = {}): ExecutiveRecommendation {
  return {
    subsystem: "workflow",
    signal: "degrading_trend",
    severity: "high",
    recommendation: "Investigate workflow regressions",
    signalConfidence: 0.88,
    occurrenceCount: 8,
    averageDelta: -3.2,
    ...over,
  };
}

function persistReport(
  storeDir: string,
  recs: ExecutiveRecommendation[],
  generatedAt: string,
): string {
  const store = new RecommendationReportStore(storeDir);
  const id = store.save({
    generatedAt,
    requestedWindow: 10,
    recommendationStatus: "ok",
    inputReportCount: recs.length,
    analyzedReportCount: recs.length,
    skippedReportCount: 0,
    evidenceReportIds: [],
    recommendations: recs,
    warnings: [],
    loadWarnings: [],
  });
  return store.load(id)!.id;
}

let tempRoot: string;
let execDir: string;
let adaptationDir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-8-cli-"));
  execDir = join(tempRoot, ".alix", "executive", "recommendations");
  adaptationDir = join(tempRoot, ".alix", "adaptation", "proposals");
  mkdirSync(execDir, { recursive: true });
  mkdirSync(adaptationDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive recommendation-effectiveness CLI", () => {
  it("renders terminal tables with calibration + per-rec detail", async () => {
    persistReport(execDir, [makeExecRec()], "2026-06-26T00:00:00.000Z");
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--since", "60"]);
    const out = c.out().join("\n");
    expect(out).toContain("degrading_trend");
    expect(out).toContain("Signal");
    expect(out).toContain("Total");
    expect(out).toContain("unreviewed");
    cwdSpy.mockRestore();
    c.restore();
  });

  it("outputs valid JSON with --json", async () => {
    persistReport(execDir, [makeExecRec()], "2026-06-26T00:00:00.000Z");
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--since", "60", "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.effectivenessStatus).toBe("ok");
    expect(Array.isArray(parsed.signalCalibration)).toBe(true);
    expect(parsed.signalCalibration.length).toBeGreaterThan(0);
    expect(parsed.signalCalibration[0]).toHaveProperty("actionRate");
    expect(Array.isArray(parsed.recommendations)).toBe(true);
    expect(parsed.recommendations[0]).toHaveProperty("disposition");
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--since filters reports by age", async () => {
    // Two reports: one recent, one old
    persistReport(execDir, [makeExecRec({ subsystem: "new" })], "2026-06-26T00:00:00.000Z");
    persistReport(execDir, [makeExecRec({ subsystem: "old" })], "2026-06-01T00:00:00.000Z");
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    // since=10: only reports within last 10 days
    await handleEffectivenessCommand(["--since", "10", "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    parsed.recommendations.forEach((rec: any) => {
      expect(rec.ageDays).toBeLessThanOrEqual(10);
    });
    // "old" report (25 days old) should be excluded
    expect(parsed.recommendations.some((r: any) => r.subsystem === "old")).toBe(false);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--threshold custom stale boundary", async () => {
    // One report, one unbridged rec, 5 days old. threshold=3 → stale, threshold=7 → unreviewed
    persistReport(execDir, [makeExecRec({ proposalId: undefined })], "2026-06-25T00:00:00.000Z");
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--since", "10", "--threshold", "3", "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.recommendations[0].disposition).toBe("stale"); // ageDays ~= 5 ≥ 3
    cwdSpy.mockRestore();
    c.restore();
  });

  it("bridged rec with proposal_missing gets flagged in loadWarnings", async () => {
    // Bridge a rec to proposalId "p1", but do NOT persist the proposal
    persistReport(execDir, [makeExecRec({ proposalId: "p1" })], "2026-06-26T00:00:00.000Z");
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--since", "60", "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.recommendations[0].disposition).toBe("proposal_missing");
    expect(parsed.loadWarnings.length).toBeGreaterThan(0);
    expect(parsed.loadWarnings[0]).toMatch(/proposal not found: p1/);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("no reports in store → clean no_data result", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--since", "60", "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.effectivenessStatus).toBe("no_data");
    expect(parsed.signalCalibration).toEqual([]);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("corrupt report excluded, valid report still analyzed", async () => {
    // Write a valid report
    persistReport(execDir, [makeExecRec({ subsystem: "valid" })], "2026-06-26T00:00:00.000Z");
    // Write a corrupt report file directly
    writeFileSync(join(execDir, "recommendation-corrupt.json"), "not valid json", "utf-8");
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--since", "60", "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.effectivenessStatus).toBe("ok");
    expect(parsed.recommendations.length).toBeGreaterThan(0);
    expect(parsed.recommendations[0].subsystem).toBe("valid");
    cwdSpy.mockRestore();
    c.restore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli/commands/executive-effectiveness-cli.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the CLI handler**

`src/cli/commands/executive-effectiveness-handler.ts`:

```ts
/**
 * P10.8 — Executive recommendation-effectiveness CLI handler.
 *
 * Loads recommendation reports from RecommendationReportStore, loads
 * corresponding proposal lifecycle statuses from ProposalStore, classifies
 * each recommendation into one of 8 dispositions, and renders per-signal
 * calibration + per-rec drill-down.
 *
 * Read-only: only calls store.load() and store.list(). No writes.
 *
 * @module
 */

import { join } from "node:path";
import type {
  ClassifyInput,
  RecommendationEntry,
  EffectivenessResult,
} from "../../executive/recommendation-effectiveness.js";
import {
  classifyRecommendation,
  computeRecommendationEffectiveness,
  EFFECTIVENESS_OK,
} from "../../executive/recommendation-effectiveness.js";
import { RecommendationReportStore } from "../../executive/recommendation-report-store.js";
import { ProposalStore } from "../../adaptation/proposal-store.js";
import type { ProposalStatus } from "../../adaptation/proposal-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SINCE_DAYS = 30;
const DEFAULT_THRESHOLD_DAYS = 7;
const MS_PER_DAY = 86400000;

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function handleEffectivenessCommand(args: string[]): Promise<void> {
  const sinceIndex = args.indexOf("--since");
  const sinceDays = sinceIndex !== -1 && sinceIndex + 1 < args.length
    ? Math.max(1, parseInt(args[sinceIndex + 1], 10) || DEFAULT_SINCE_DAYS)
    : DEFAULT_SINCE_DAYS;

  const thresholdIndex = args.indexOf("--threshold");
  const thresholdDays = thresholdIndex !== -1 && thresholdIndex + 1 < args.length
    ? Math.max(1, parseInt(args[thresholdIndex + 1], 10) || DEFAULT_THRESHOLD_DAYS)
    : DEFAULT_THRESHOLD_DAYS;

  const reportIndex = args.indexOf("--report");
  const reportIdArg =
    reportIndex !== -1 && reportIndex + 1 < args.length ? args[reportIndex + 1] : undefined;

  const useJson = args.includes("--json");

  const now = new Date().toISOString();
  const nowMs = Date.now();

  const cwd = process.cwd();
  const recommendationStore = new RecommendationReportStore(
    join(cwd, ".alix", "executive", "recommendations"),
  );
  const proposalStore = new ProposalStore(
    join(cwd, ".alix", "adaptation", "proposals"),
  );

  // Resolve reports
  let reports: { reportId: string; report: any }[] = [];
  if (reportIdArg) {
    const loaded = recommendationStore.load(reportIdArg);
    if (loaded) reports.push({ reportId: reportIdArg, report: loaded });
  } else {
    const metas = recommendationStore.list();
    const cutoffMs = nowMs - sinceDays * MS_PER_DAY;
    for (const meta of metas) {
      const generatedAtMs = new Date(meta.generatedAt).getTime();
      if (generatedAtMs < cutoffMs) continue;
      const loaded = recommendationStore.load(meta.reportId);
      if (loaded) reports.push({ reportId: meta.reportId, report: loaded });
    }
  }

  // Build classified entries
  const entries: RecommendationEntry[] = [];
  const loadWarnings: string[] = [];

  for (const { reportId, report: loaded } of reports) {
    const recs = loaded.report.recommendations;
    const reportGeneratedAt = loaded.report.generatedAt;
    const ageMs = nowMs - new Date(reportGeneratedAt).getTime();
    const ageDays = Math.floor(ageMs / MS_PER_DAY);

    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      let proposalStatus: ProposalStatus | null | undefined = undefined;

      if (rec.proposalId !== undefined) {
        try {
          const p = await proposalStore.load(rec.proposalId);
          proposalStatus = p?.status ?? null;
        } catch {
          proposalStatus = null;
        }
      }

      const disposition = classifyRecommendation({
        subsystem: rec.subsystem,
        signal: rec.signal,
        severity: rec.severity,
        signalConfidence: rec.signalConfidence,
        recommendation: rec.recommendation,
        proposalId: rec.proposalId,
        proposalStatus,
        ageDays,
      }, thresholdDays);

      if (disposition === "proposal_missing" && rec.proposalId) {
        loadWarnings.push(
          `proposal not found: ${rec.proposalId} (rec index ${i} in report ${reportId})`,
        );
      }

      entries.push({
        reportId,
        generatedAt: reportGeneratedAt,
        recIndex: i,
        subsystem: rec.subsystem,
        signal: rec.signal,
        severity: rec.severity,
        signalConfidence: rec.signalConfidence,
        recommendation: rec.recommendation,
        proposalId: rec.proposalId,
        disposition,
        ageDays,
      });
    }
  }

  const result: EffectivenessResult = computeRecommendationEffectiveness(
    entries,
    thresholdDays,
    now,
  );

  // Merge any CLI-level loadWarnings (the function also collects proposal_missing)
  for (const w of loadWarnings) {
    if (!result.loadWarnings.includes(w)) result.loadWarnings.push(w);
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

function renderTable(result: EffectivenessResult): void {
  if (result.effectivenessStatus === "no_data") {
    console.log("No recommendation data available.");
    console.log(`Effectiveness status: no_data`);
    return;
  }

  console.log(`\nRecommendation Effectiveness (last ${result.staleThresholdDays}+ days)`);
  console.log(
    `Generated: ${result.generatedAt.slice(0, 10)} | ` +
    `Stale threshold: ${result.staleThresholdDays} days | ` +
    `${result.reportCount} reports, ${result.totalRecommendations} recommendations\n`,
  );

  // Per-signal calibration table
  console.log(
    `${"Signal".padEnd(24)} ${"Total".padEnd(6)} ${"Bridged".padEnd(8)} ` +
    `${"Await".padEnd(6)} ${"A-Pend".padEnd(7)} ${"Applied".padEnd(8)} ` +
    `${"Reject".padEnd(7)} ${"Failed".padEnd(7)} ${"PMiss".padEnd(6)} ` +
    `${"Unrev".padEnd(6)} ${"Stale".padEnd(6)} ActionR`,
  );
  console.log("-".repeat(100));
  for (const cal of result.signalCalibration) {
    console.log(
      `${cal.signal.padEnd(24)} ${String(cal.total).padEnd(6)} ${String(cal.bridgedCount).padEnd(8)} ` +
      `${String(cal.awaitingReview).padEnd(6)} ${String(cal.approvedPendingApply).padEnd(7)} ` +
      `${String(cal.applied).padEnd(8)} ${String(cal.rejected).padEnd(7)} ${String(cal.failed).padEnd(7)} ` +
      `${String(cal.proposalMissing).padEnd(6)} ${String(cal.unreviewed).padEnd(6)} ${String(cal.stale).padEnd(6)} ` +
      `${cal.actionRate.toFixed(2)}`,
    );
  }

  console.log(`\nPer-recommendation detail:`);
  console.log(
    `${"Report".padEnd(18)} ${"Generated".padEnd(11)} ${"Subsystem".padEnd(16)} ` +
    `${"Signal".padEnd(22)} ${"Disp".padEnd(20)} Age  proposalId`,
  );
  console.log("-".repeat(100));
  for (const entry of result.recommendations) {
    const reportShort = entry.reportId.length > 16 ? entry.reportId.slice(0, 14) + ".." : entry.reportId;
    const genDate = entry.generatedAt.slice(0, 10);
    const pid = entry.proposalId ?? "—";
    console.log(
      `${reportShort.padEnd(18)} ${genDate.padEnd(11)} ${entry.subsystem.padEnd(16)} ` +
      `${entry.signal.padEnd(22)} ${entry.disposition.padEnd(20)} ` +
      `${String(entry.ageDays).padEnd(4)} ${pid}`,
    );
  }

  if (result.loadWarnings.length > 0) {
    console.error(`\nWarnings (${result.loadWarnings.length}):`);
    for (const w of result.loadWarnings) {
      console.error(`  ${w}`);
    }
  }
}
```

- [ ] **Step 4: Wire routing into `executive.ts`**

In `src/cli/commands/executive.ts`, add after `case "bridge"`:

```ts
    case "recommendation-effectiveness": {
      const { handleEffectivenessCommand } = await import(
        "./executive-effectiveness-handler.js"
      );
      return handleEffectivenessCommand(rest);
    }
```

Update the `default:` subcommand list to include `recommendation-effectiveness`.

- [ ] **Step 5: Run the integration tests**

Run: `npx vitest run tests/cli/commands/executive-effectiveness-cli.vitest.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/executive-effectiveness-handler.ts src/cli/commands/executive.ts tests/cli/commands/executive-effectiveness-cli.vitest.ts
git commit -m "feat(p10-8): recommendation-effectiveness CLI + routing + integration tests"
```

---

### Task 3: Sentinel registration + full suite

**Files:**
- Modify: `tests/executive/executive-sentinels.vitest.ts` (add 2 new files to `EXECUTIVE_FILES`)

**Goal:** Register the pure function + handler with the executive purity sentinel. No scoped exceptions needed. The handler uses `ProposalStore.load(...)` (read-only instance method), not the forbidden `ProposalStore.save`.

- [ ] **Step 1: Add the new files to `EXECUTIVE_FILES`**

In `tests/executive/executive-sentinels.vitest.ts`, find the P10.7c group and append:

```ts
  // P10.7c files
  "src/executive/executive-bridge-recommendations.ts",
  "src/cli/commands/executive-bridge-handler.ts",
  // P10.8 files
  "src/executive/recommendation-effectiveness.ts",
  "src/cli/commands/executive-effectiveness-handler.ts",
];
```

- [ ] **Step 2: Run the sentinel**

Run: `npx vitest run tests/executive/executive-sentinels.vitest.ts`
Expected: PASS — both new files clean. Test count increases by 2 (was 35 → 37).

- [ ] **Step 3: Run the full test suite + type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: full suite green (baseline at P10.7c + ~15 pure + ~7 CLI + 2 sentinel = ~2087); tsc clean.

- [ ] **Step 4: Commit**

```bash
git add tests/executive/executive-sentinels.vitest.ts
git commit -m "test(p10-8): register recommendation-effectiveness files in purity sentinel"
```

---

### Task 4: Final whole-branch review + PR + tag

- [ ] Dispatch the whole-branch code review (8-angle `code-review` skill, recall-biased) against the branch diff from the P10.7c merge base.
- [ ] Triage findings.
- [ ] Run final `npx vitest run` + `npx tsc --noEmit`.
- [ ] Push branch, open PR against `main`, merge (squash), tag `alix-p10-8a-complete`, push tag.
- [ ] Update the progress ledger and write/append the memory entry.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Covered by |
|---|---|
| Architecture (2 pure functions + CLI handler, read-only) | Tasks 1–2 |
| 8 dispositions (unreviewed, stale, awaiting_review, approved_pending_apply, applied, rejected, failed, proposal_missing) | Task 1 (8 classify tests) |
| No inferred `ignored` | Implicit: not in the disposition union |
| `ageDays` computed by CLI | Task 2 handler computes `ageMs / MS_PER_DAY` |
| `proposalStatus` fetched by handler, nulled on throw/missing | Task 2 try/catch → null + Task 1 `proposal_missing` test |
| `recIndex` on RecommendationEntry | Task 1 type; Task 2 handler sets it |
| Per-signal calibration + per-rec drill-down | Task 1 aggregation + Task 2 render |
| `bridgedCount` includes `proposal_missing` | Task 1 test |
| `actionRate = bridgedCount / total`, 2-decimal | Task 1 aggregation + test |
| `effectivenessStatus: "ok" | "no_data"` | Task 1 empty-entries test + Typ |
| Load warnings for missing proposals | Task 1 aggregation test + Task 2 warn test |
| `--since` time-based (not count-based) | Task 2 handler + CLI test |
| Sort: newest-first by generatedAt, recIndex asc within report | Task 1 sort test + Task 2 handler |
| CLI flags: `--since`, `--threshold`, `--report`, `--json` | Task 2 handler + 7 tests |
| Sentinel (no exceptions) | Task 3 |

**2. Placeholder scan:** none — every step has complete code or an exact command.

**3. Type consistency:**
- `ClassifyInput` maps 1:1 from `ExecutiveRecommendation` fields (subsystem, signal, severity, signalConfidence, recommendation, proposalId) — correct. ✅
- `RecommendationEntry` carries all fields the render table uses (reportId, generatedAt, subsystem, signal, disposition, ageDays, proposalId) — correct. ✅
- `ProposalStatus` is locally defined (matching the 5 values from `adaptation-types.ts`) — correct. ✅
- `computeRecommendationEffectiveness` returns `EffectivenessResult` with the full shape (effectivenessStatus, generatedAt, signalCalibration, recommendations, loadWarnings) — correct. ✅
- Sort function produces stable `generatedAt desc → recIndex asc` — correct. ✅

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-26-p10-8-effectiveness-intelligence.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — Fresh implementer subagent per task (1–3), review between tasks, then final 8-angle whole-branch review before PR + tag.
2. **Inline Execution** — Tasks 1–3 in this session with checkpoints.

**Which approach?**