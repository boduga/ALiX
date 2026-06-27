# P10.8b — Recommendation Effectiveness + ProposalEffectiveness Join Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Join `EffectivenessStore` into the recommendation effectiveness analyzer so applied proposals show whether they were assessed as keep/revert/investigate.

**Architecture:** Pure `applyEffectivenessData()` function enriches `RecommendationEntry[]` with an orthogonal `effectivenessOutcome` field. The existing `computeRecommendationEffectiveness()` gains effectiveness counters and two new metrics (`effectivenessRate`, `effectivenessCoverage`). The CLI handler reads the effectiveness directory with per-file try/catch (isolating single corrupt entries), then passes the map to the pure function. No new files, no new stores, no sentinel changes.

**Tech Stack:** TypeScript, Node.js fs (readdirSync/readFileSync), vitest, existing `EffectivenessStore` directory structure.

## Global Constraints

- Read-only: no writes to any store, no mutations of persisted recommendations, no proposal creation.
- `effectivenessOutcome` is orthogonal to `RecommendationDisposition` — the main 8 dispositions stay unchanged.
- `effectivenessRate = appliedKeep / (appliedKeep + appliedRevert + appliedInvestigate)` — excludes `appliedNoData` from denominator.
- `effectivenessCoverage = assessed / (assessed + appliedNoData)` — measures assessment thoroughness.
- `applied` field in `SignalCalibration` stays as total applied — effectiveness fields are additive counters.
- `no_data` = proposal was applied but no effectiveness report exists in store.
- Per-file readdirSync + try/catch for effectiveness store: one corrupt entry warns + skips, doesn't degrade the whole join.
- Graceful degradation: if effectiveness directory is missing or empty, all applied recs get `no_data`.
- No sentinel changes needed — both modified files are already in `EXECUTIVE_FILES`.

---

### Task 1: Pure function — `EffectivenessOutcome` type + `applyEffectivenessData()` + extended aggregation

**Files:**
- Modify: `src/executive/recommendation-effectiveness.ts`
- Test: `tests/executive/recommendation-effectiveness.vitest.ts`

**Interfaces:**
- Consumes: existing `RecommendationEntry`, `SignalCalibration`, `EffectivenessResult`, `computeRecommendationEffectiveness()`.
- Produces: `EffectivenessOutcome` type, `applyEffectivenessData()` pure function, extended `RecommendationEntry`, extended `SignalCalibration`, extended `computeRecommendationEffectiveness()`.

- [ ] **Step 1: Write failing tests for `applyEffectivenessData`**

Add to the end of `tests/executive/recommendation-effectiveness.vitest.ts` — writes tests before the function exists:

```ts
import { applyEffectivenessData } from "../../src/executive/recommendation-effectiveness.js";
import type { EffectivenessOutcome } from "../../src/executive/recommendation-effectiveness.js";

describe("applyEffectivenessData", () => {
  const baseEntry = (over: Partial<RecommendationEntry> = {}): RecommendationEntry => ({
    reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 0,
    subsystem: "wf", signal: "degrading_trend", severity: "high",
    signalConfidence: 0.88, recommendation: "x", ageDays: 1,
    disposition: "applied", proposalId: "p1",
    ...over,
  });

  it("sets effectivenessOutcome for applied entries with proposalId in map", () => {
    const map = new Map<string, EffectivenessOutcome>([["p1", "keep"]]);
    const result = applyEffectivenessData([baseEntry()], map);
    expect(result[0].effectivenessOutcome).toBe("keep");
  });

  it("leaves non-applied entries untouched", () => {
    const entry = baseEntry({ disposition: "stale", proposalId: undefined });
    const result = applyEffectivenessData([entry], new Map());
    expect(result[0].effectivenessOutcome).toBeUndefined();
  });

  it("applied entry with proposalId NOT in map → no_data", () => {
    const result = applyEffectivenessData([baseEntry()], new Map());
    expect(result[0].effectivenessOutcome).toBe("no_data");
  });

  it("applied entry with no proposalId → no effectivenessOutcome", () => {
    const entry = baseEntry({ proposalId: undefined });
    const result = applyEffectivenessData([entry], new Map());
    expect(result[0].effectivenessOutcome).toBeUndefined();
  });

  it("empty entries array → empty array", () => {
    const result = applyEffectivenessData([], new Map());
    expect(result).toEqual([]);
  });

  it("empty map → all applied recs get no_data", () => {
    const result = applyEffectivenessData(
      [baseEntry(), baseEntry({ recIndex: 1, proposalId: "p2" })],
      new Map(),
    );
    expect(result[0].effectivenessOutcome).toBe("no_data");
    expect(result[1].effectivenessOutcome).toBe("no_data");
  });
});
```

- [ ] **Step 2: Run tests to verify `applyEffectivenessData` tests fail**

```bash
npx vitest run tests/executive/recommendation-effectiveness.vitest.ts --reporter=verbose 2>&1 | head -30
```
Expected: FAIL — `applyEffectivenessData is not a function`

- [ ] **Step 3: Write failing tests for effectiveness-aware `computeRecommendationEffectiveness`**

Add after the `applyEffectivenessData` describe block:

```ts
describe("computeRecommendationEffectiveness — effectiveness metrics (P10.8b)", () => {
  function entry(over: Partial<RecommendationEntry> = {}): RecommendationEntry {
    return {
      reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 0,
      subsystem: "wf", signal: "degrading_trend", severity: "high",
      signalConfidence: 0.88, recommendation: "x", ageDays: 1,
      disposition: "applied", proposalId: "p1",
      ...over,
    };
  }

  it("tallies appliedKeep/Revert/Investigate/NoData per signal", () => {
    const entries: RecommendationEntry[] = [
      entry({ proposalId: "p1", effectivenessOutcome: "keep" }),
      entry({ proposalId: "p2", recIndex: 1, effectivenessOutcome: "revert" }),
      entry({ proposalId: "p3", recIndex: 2, effectivenessOutcome: "keep" }),
      entry({ proposalId: "p4", recIndex: 3, effectivenessOutcome: "no_data" }),
      entry({ proposalId: "p5", recIndex: 4, effectivenessOutcome: "investigate" }),
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const cal = result.signalCalibration[0];
    expect(cal.applied).toBe(5);
    expect(cal.appliedKeep).toBe(2);
    expect(cal.appliedRevert).toBe(1);
    expect(cal.appliedInvestigate).toBe(1);
    expect(cal.appliedNoData).toBe(1);
  });

  it("effectivenessRate excludes no_data from denominator", () => {
    const entries: RecommendationEntry[] = [
      entry({ effectivenessOutcome: "keep" }),
      entry({ recIndex: 1, effectivenessOutcome: "revert" }),
      entry({ recIndex: 2, effectivenessOutcome: "no_data" }),
      entry({ recIndex: 3, effectivenessOutcome: "no_data" }),
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const cal = result.signalCalibration[0];
    expect(cal.effectivenessRate).toBe(0.5); // 1/2 assessed
  });

  it("effectivenessCoverage includes no_data in denominator", () => {
    const entries: RecommendationEntry[] = [
      entry({ effectivenessOutcome: "keep" }),
      entry({ recIndex: 1, effectivenessOutcome: "no_data" }),
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const cal = result.signalCalibration[0];
    expect(cal.effectivenessCoverage).toBe(0.5); // 1/2
  });

  it("effectivenessRate is 0 when no assessed recs", () => {
    const entries: RecommendationEntry[] = [
      entry({ effectivenessOutcome: "no_data" }),
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const cal = result.signalCalibration[0];
    expect(cal.effectivenessRate).toBe(0);
  });

  it("effectivenessCoverage is 0 when applied is 0", () => {
    const entries: RecommendationEntry[] = [
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 0,
        subsystem: "wf", signal: "degrading_trend", severity: "high",
        signalConfidence: 0.88, recommendation: "x", ageDays: 1,
        disposition: "stale" },
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const cal = result.signalCalibration[0];
    expect(cal.applied).toBe(0);
    expect(cal.effectivenessRate).toBe(0);
    expect(cal.effectivenessCoverage).toBe(0);
  });

  it("all applied recs have effectiveness data → coverage 1.00", () => {
    const entries: RecommendationEntry[] = [
      entry({ effectivenessOutcome: "keep" }),
      entry({ recIndex: 1, effectivenessOutcome: "revert" }),
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const cal = result.signalCalibration[0];
    expect(cal.effectivenessCoverage).toBe(1.0);
  });
});
```

- [ ] **Step 4: Run tests to verify all new tests fail**

```bash
npx vitest run tests/executive/recommendation-effectiveness.vitest.ts --reporter=verbose 2>&1 | head -40
```
Expected: FAIL — new tests fail because `applyEffectivenessData` and new `SignalCalibration` fields don't exist yet.

- [ ] **Step 5: Implement — add type, interface changes, pure function, and aggregation changes**

All implementation changes go into `src/executive/recommendation-effectiveness.ts`:

**(a) Add `EffectivenessOutcome` type after `ProposalStatus` on line 28:**
```ts
/** P10.8b: effectiveness outcome from ProposalEffectivenessReport.recommendation. */
export type EffectivenessOutcome = "keep" | "revert" | "investigate" | "no_data";
```

**(b) Add `effectivenessOutcome` field to `RecommendationEntry` after `disposition`:**
```ts
  /** P10.8b: effectiveness outcome. Only present when disposition === "applied". */
  effectivenessOutcome?: EffectivenessOutcome;
```

**(c) Add effectiveness fields to `SignalCalibration` after `applied: number;`:**
```ts
  // P10.8b: effectiveness breakdown of applied recommendations
  appliedKeep: number;
  appliedRevert: number;
  appliedInvestigate: number;
  appliedNoData: number;
  /** appliedKeep / (appliedKeep + appliedRevert + appliedInvestigate), [0..1], 2-decimal. */
  effectivenessRate: number;
  /** assessed / (assessed + appliedNoData), [0..1], 2-decimal. */
  effectivenessCoverage: number;
```

**(d) Add `applyEffectivenessData()` after `classifyRecommendation`:**
```ts
/**
 * Enrich recommendation entries with effectiveness outcome data from
 * ProposalEffectivenessReport. Pure: returns new array, does not mutate input.
 */
export function applyEffectivenessData(
  entries: readonly RecommendationEntry[],
  outcomeByProposalId: ReadonlyMap<string, EffectivenessOutcome>,
): RecommendationEntry[] {
  return entries.map((entry) => {
    if (entry.disposition === "applied" && entry.proposalId !== undefined) {
      const outcome = outcomeByProposalId.get(entry.proposalId);
      return { ...entry, effectivenessOutcome: outcome ?? "no_data" };
    }
    return { ...entry, effectivenessOutcome: undefined };
  });
}
```

**(e) Initialize effectiveness counters in `SignalCalibration` initializer** (lines 151-160), add after `actionRate: 0`:
```ts
        appliedKeep: 0, appliedRevert: 0,
        appliedInvestigate: 0, appliedNoData: 0,
        effectivenessRate: 0, effectivenessCoverage: 0,
```

**(f) Add effectiveness tallying after the `switch (entry.disposition)` block breaks** (after line 175):
```ts
    // P10.8b: effectiveness tallying
    if (entry.disposition === "applied" && entry.effectivenessOutcome) {
      switch (entry.effectivenessOutcome) {
        case "keep":        cal.appliedKeep++; break;
        case "revert":      cal.appliedRevert++; break;
        case "investigate": cal.appliedInvestigate++; break;
        case "no_data":     cal.appliedNoData++; break;
      }
    }
```

**(g) Compute effectiveness metrics after actionRate** (before `signalCalibration.push(cal)`):
```ts
    const assessedCount = cal.appliedKeep + cal.appliedRevert + cal.appliedInvestigate;
    cal.effectivenessRate = assessedCount > 0
      ? Math.round((cal.appliedKeep / assessedCount) * 100) / 100
      : 0;
    cal.effectivenessCoverage = (assessedCount + cal.appliedNoData) > 0
      ? Math.round((assessedCount / (assessedCount + cal.appliedNoData)) * 100) / 100
      : 0;
```

- [ ] **Step 6: Run tests to verify all new tests pass**

```bash
npx vitest run tests/executive/recommendation-effectiveness.vitest.ts --reporter=verbose 2>&1 | tail -30
```
Expected: PASS — 11 new tests plus existing tests all green.

- [ ] **Step 7: Run the full test suite to verify no regressions**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```
Expected: PASS — existing CLI tests may need `SignalCalibration` JSON assertions updated if they check exact object shapes (not just specific field values).

- [ ] **Step 8: Fix any test fixtures that assert exact `SignalCalibration` shape**

The `executive-effectiveness-cli.vitest.ts` tests assert individual fields like `cal.awaitingReview` and `cal.bridgedCount` — those work fine because `JSON.parse` includes all fields including the new zeros. Only fix if a test does `toEqual({...})` on a calibration object. Search:

```bash
grep -n 'toEqual\|toStrictEqual' tests/cli/commands/executive-effectiveness-cli.vitest.ts tests/executive/recommendation-effectiveness.vitest.ts
```
If any match on a `SignalCalibration` or `EffectivenessResult` literal, add the new fields.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/executive/recommendation-effectiveness.ts tests/executive/recommendation-effectiveness.vitest.ts
git commit -m "feat(p10-8b): add EffectivenessOutcome type, applyEffectivenessData(), extended SignalCalibration

- New EffectivenessOutcome type (keep/revert/investigate/no_data)
- New pure applyEffectivenessData() — orthogonal to classifyRecommendation
- RecommendationEntry gains optional effectivenessOutcome
- SignalCalibration gains appliedKeep/Revert/Investigate/NoData counters
- Two new metrics: effectivenessRate (excludes no_data) + effectivenessCoverage
- computeRecommendationEffectiveness tallies effectiveness in per-signal loop
- 11 new tests: 6 applyEffectivenessData + 5 effectiveness metrics

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: CLI handler — effectiveness store load + terminal render

**Files:**
- Modify: `src/cli/commands/executive-effectiveness-handler.ts`
- Test: `tests/cli/commands/executive-effectiveness-cli.vitest.ts`

**Interfaces:**
- Consumes: `EffectivenessOutcome` from `recommendation-effectiveness.ts`, `applyEffectivenessData()` pure function, `EffectivenessStore` directory at `.alix/adaptation/effectiveness/`.
- Produces: Updated `handleEffectivenessCommand()` that loads effectiveness data and renders effectiveness columns.

- [ ] **Step 1: Add imports to the handler**

Add to the imports at the top of `src/cli/commands/executive-effectiveness-handler.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  applyEffectivenessData,
  EFFECTIVENESS_NO_DATA,
  type EffectivenessOutcome,
} from "../../executive/recommendation-effectiveness.js";
```

(The `classifyRecommendation` and `computeRecommendationEffectiveness` imports already exist.)

- [ ] **Step 2: Load effectiveness data (after proposal loading, before classification)**

Find the section in `handleEffectivenessCommand` where `entries` array is built (currently after the `proposalStatusMap` is populated, around line 161). Right before `const entries: RecommendationEntry[] = []`, insert:

```ts
  // P10.8b: load effectiveness data from effectiveness store
  const effectivenessDir = join(cwd, ".alix", "adaptation", "effectiveness");
  const outcomeMap = new Map<string, EffectivenessOutcome>();
  try {
    if (existsSync(effectivenessDir)) {
      const files = readdirSync(effectivenessDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = readFileSync(join(effectivenessDir, file), "utf-8");
          const report = JSON.parse(raw);
          // Map ProposalEffectivenessReport.recommendation to EffectivenessOutcome
          outcomeMap.set(report.proposalId, report.recommendation);
        } catch (e: any) {
          console.warn(`Skipping corrupt effectiveness report: ${file} — ${e.message}`);
        }
      }
    }
  } catch {
    // Directory inaccessible — outcomeMap stays empty, all applied recs get no_data
  }
```

- [ ] **Step 3: Call `applyEffectivenessData()` after building entries, before aggregation**

After the `entries` array is populated (currently right before `const result = computeRecommendationEffectiveness(...)`), insert:

```ts
  // P10.8b: enrich entries with effectiveness outcome data
  const enrichedEntries = applyEffectivenessData(entries, outcomeMap);
```

Then change the aggregation call from:
```ts
const result = computeRecommendationEffectiveness(entries, thresholdDays, generatedAt);
```
to:
```ts
const result = computeRecommendationEffectiveness(enrichedEntries, thresholdDays, generatedAt);
```

- [ ] **Step 4: Update terminal render — add effectiveness columns**

Replace the `renderTable` function (currently lines 230-269) with the updated version:

```ts
function renderTable(result: EffectivenessResult): void {
  if (result.effectivenessStatus === EFFECTIVENESS_NO_DATA) {
    console.log("No recommendation effectiveness data available.");
    return;
  }

  console.log(`\nRecommendation Effectiveness Intelligence`);
  console.log(`Generated: ${result.generatedAt}`);
  console.log(`Stale threshold: ${result.staleThresholdDays} days`);
  console.log(
    `Reports: ${result.reportCount} | Total recommendations: ${result.totalRecommendations}\n`,
  );

  // Check if any signal has applied recommendations (show effectiveness columns only then)
  const hasEffectiveness = result.signalCalibration.some((c) => c.applied > 0);

  if (result.signalCalibration.length > 0) {
    if (hasEffectiveness) {
      console.log(
        `${"Signal".padEnd(24)} ${"Total".padEnd(6)} ${"Unrev".padEnd(6)} ` +
          `${"Stale".padEnd(6)} ${"Await".padEnd(6)} ${"Appr".padEnd(6)} ` +
          `${"Applied".padEnd(8)} ${"Rej".padEnd(5)} ${"Fail".padEnd(5)} ` +
          `${"Miss".padEnd(5)} ${"Kept".padEnd(5)} ${"Rvt".padEnd(5)} ` +
          `${"Inv".padEnd(5)} ${"NoD".padEnd(5)} ${"EffRt".padEnd(6)} ${"Cov".padEnd(5)}`,
      );
      console.log("-".repeat(115));
      for (const cal of result.signalCalibration) {
        const effRate = cal.applied > 0 && (cal.appliedKeep + cal.appliedRevert + cal.appliedInvestigate) > 0
          ? `${(cal.effectivenessRate * 100).toFixed(0)}%`
          : "—";
        const cov = cal.applied > 0
          ? `${(cal.effectivenessCoverage * 100).toFixed(0)}%`
          : "—";
        console.log(
          `${cal.signal.padEnd(24)} ${String(cal.total).padEnd(6)} ` +
            `${String(cal.unreviewed).padEnd(6)} ${String(cal.stale).padEnd(6)} ` +
            `${String(cal.awaitingReview).padEnd(6)} ${String(cal.approvedPendingApply).padEnd(6)} ` +
            `${String(cal.applied).padEnd(8)} ${String(cal.rejected).padEnd(5)} ` +
            `${String(cal.failed).padEnd(5)} ${String(cal.proposalMissing).padEnd(5)} ` +
            `${String(cal.appliedKeep).padEnd(5)} ${String(cal.appliedRevert).padEnd(5)} ` +
            `${String(cal.appliedInvestigate).padEnd(5)} ${String(cal.appliedNoData).padEnd(5)} ` +
            `${effRate.padEnd(6)} ${cov.padEnd(5)}`,
        );
      }
    } else {
      // P10.8a-compatible output — no effectiveness columns
      console.log(
        `${"Signal".padEnd(24)} ${"Total".padEnd(6)} ${"Unrev".padEnd(6)} ` +
          `${"Stale".padEnd(6)} ${"Await".padEnd(6)} ${"Appr".padEnd(6)} ` +
          `${"Applied".padEnd(8)} ${"Rej".padEnd(5)} ${"Fail".padEnd(5)} ` +
          `${"Miss".padEnd(5)} ${"Bridged".padEnd(8)} ${"Action Rate"}`,
      );
      console.log("-".repeat(100));
      for (const cal of result.signalCalibration) {
        console.log(
          `${cal.signal.padEnd(24)} ${String(cal.total).padEnd(6)} ` +
            `${String(cal.unreviewed).padEnd(6)} ${String(cal.stale).padEnd(6)} ` +
            `${String(cal.awaitingReview).padEnd(6)} ${String(cal.approvedPendingApply).padEnd(6)} ` +
            `${String(cal.applied).padEnd(8)} ${String(cal.rejected).padEnd(5)} ` +
            `${String(cal.failed).padEnd(5)} ${String(cal.proposalMissing).padEnd(5)} ` +
            `${String(cal.bridgedCount).padEnd(8)} ` +
            `${(cal.actionRate * 100).toFixed(0)}%`,
        );
      }
    }
  }

  if (result.loadWarnings.length > 0) {
    for (const w of result.loadWarnings) {
      console.error(`Warning: ${w}`);
    }
  }
}
```

- [ ] **Step 5: Write failing CLI tests for effectiveness**

Add new test cases at the end of `tests/cli/commands/executive-effectiveness-cli.vitest.ts`, before the closing `});`:

```ts
import { writeFileSync, mkdirSync } from "node:fs";
import type { ProposalEffectivenessReport } from "../../../src/adaptation/effectiveness-types.js";

describe("executive effectiveness CLI — P10.8b effectiveness outcome", () => {
  /** Seed raw JSON files matching ProposalEffectivenessReport shape, not via store API. */
  function seedEffectiveness(reports: ProposalEffectivenessReport[]) {
    const dir = join(tempRoot, ".alix", "adaptation", "effectiveness");
    mkdirSync(dir, { recursive: true });
    for (const r of reports) {
      writeFileSync(join(dir, `${r.proposalId}.json`), JSON.stringify(r, null, 2), "utf-8");
    }
  }

  function makeEffReport(proposalId: string, recommendation: "keep" | "revert" | "investigate"): ProposalEffectivenessReport {
    return {
      proposalId,
      assessedAt: new Date().toISOString(),
      appliedAt: new Date().toISOString(),
      windowDays: 7,
      metricsBefore: { workflowsAborted: 10, workflowsBlocked: 2, unresolvedCapabilities: 5, capabilitiesRequested: 20, totalLoops: 50, totalSkillGaps: 3, totalContextWarnings: 1, totalRerouteWarnings: 0, reviewApprovalRate: 0.8 },
      metricsAfter: { workflowsAborted: 5, workflowsBlocked: 1, unresolvedCapabilities: 2, capabilitiesRequested: 15, totalLoops: 45, totalSkillGaps: 1, totalContextWarnings: 0, totalRerouteWarnings: 0, reviewApprovalRate: 0.9 },
      primary: null,
      dataSufficient: true,
      recommendation,
      reason: "effectiveness assessment",
    };
  }

  it("terminal table shows effectiveness columns when applied recs exist", async () => {
    const proposal: AdaptationProposal = {
      id: "eff-prop-1", createdAt: new Date().toISOString(), status: "applied",
      action: "create_improvement_issue", target: { kind: "issue", title: "test" },
      payload: {}, sourceRecommendationType: "trend", sourceConfidence: 0.8,
      evidenceFingerprints: [], reason: "test",
    };
    mkdirSync(join(adaptationDir, "proposals"), { recursive: true });
    const props = new ProposalStore(join(adaptationDir, "proposals"));
    await props.save(proposal);

    const rec = makeExecRec({ proposalId: "eff-prop-1" });
    const saved = persist(makeReport([rec]));

    seedEffectiveness([makeEffReport("eff-prop-1", "keep")]);

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--report", saved.id]);
    const output = c.out().join("\n");
    expect(output).toMatch(/Kept/);
    expect(output).toMatch(/Rvt/);
    expect(output).toMatch(/EffRt/);
    expect(output).toMatch(/Cov/);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("terminal table hides effectiveness columns when no applied recs", async () => {
    const saved = persist(makeReport([makeExecRec({ subsystem: "alpha", signal: "improving_trend" })]));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--report", saved.id]);
    const output = c.out().join("\n");
    expect(output).not.toMatch(/Kept/);
    expect(output).toMatch(/Bridged/);  // P10.8a-compatible output
    cwdSpy.mockRestore();
    c.restore();
  });

  it("JSON output includes effectivenessOutcome and calibration fields", async () => {
    const proposal: AdaptationProposal = {
      id: "eff-prop-2", createdAt: new Date().toISOString(), status: "applied",
      action: "create_improvement_issue", target: { kind: "issue", title: "test" },
      payload: {}, sourceRecommendationType: "trend", sourceConfidence: 0.8,
      evidenceFingerprints: [], reason: "test",
    };
    mkdirSync(join(adaptationDir, "proposals"), { recursive: true });
    const props = new ProposalStore(join(adaptationDir, "proposals"));
    await props.save(proposal);

    const rec = makeExecRec({ proposalId: "eff-prop-2" });
    const saved = persist(makeReport([rec]));
    seedEffectiveness([makeEffReport("eff-prop-2", "keep")]);

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.recommendations[0].effectivenessOutcome).toBe("keep");
    const cal = parsed.signalCalibration[0];
    expect(cal.appliedKeep).toBe(1);
    expect(cal.effectivenessRate).toBe(1.0);
    expect(cal.effectivenessCoverage).toBe(1.0);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("effectiveness store missing → graceful no_data", async () => {
    // Don't seed any effectiveness files — directory doesn't exist
    const proposal: AdaptationProposal = {
      id: "eff-prop-3", createdAt: new Date().toISOString(), status: "applied",
      action: "create_improvement_issue", target: { kind: "issue", title: "test" },
      payload: {}, sourceRecommendationType: "trend", sourceConfidence: 0.8,
      evidenceFingerprints: [], reason: "test",
    };
    mkdirSync(join(adaptationDir, "proposals"), { recursive: true });
    const props = new ProposalStore(join(adaptationDir, "proposals"));
    await props.save(proposal);
    const saved = persist(makeReport([makeExecRec({ proposalId: "eff-prop-3" })]));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.recommendations[0].effectivenessOutcome).toBe("no_data");
    const cal = parsed.signalCalibration[0];
    expect(cal.appliedNoData).toBe(1);
    expect(cal.effectivenessRate).toBe(0);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("some proposals have effectiveness data, some don't → correct split", async () => {
    const pKeep: AdaptationProposal = {
      id: "eff-p-keep", createdAt: new Date().toISOString(), status: "applied",
      action: "create_improvement_issue", target: { kind: "issue", title: "test" },
      payload: {}, sourceRecommendationType: "trend", sourceConfidence: 0.8,
      evidenceFingerprints: [], reason: "test",
    };
    const pNoData: AdaptationProposal = {
      id: "eff-p-nodata", createdAt: new Date().toISOString(), status: "applied",
      action: "create_improvement_issue", target: { kind: "issue", title: "test" },
      payload: {}, sourceRecommendationType: "trend", sourceConfidence: 0.8,
      evidenceFingerprints: [], reason: "test",
    };
    mkdirSync(join(adaptationDir, "proposals"), { recursive: true });
    const props = new ProposalStore(join(adaptationDir, "proposals"));
    await props.save(pKeep);
    await props.save(pNoData);

    const saved = persist(makeReport([
      makeExecRec({ proposalId: "eff-p-keep" }),
      makeExecRec({ proposalId: "eff-p-nodata", subsystem: "alpha" }),
    ]));

    seedEffectiveness([makeEffReport("eff-p-keep", "keep")]);  // no seed for pNoData

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.recommendations[0].effectivenessOutcome).toBe("keep");
    expect(parsed.recommendations[1].effectivenessOutcome).toBe("no_data");
    cwdSpy.mockRestore();
    c.restore();
  });
});
```

- [ ] **Step 6: Run CLI tests to verify they fail**

```bash
npx vitest run tests/cli/commands/executive-effectiveness-cli.vitest.ts --reporter=verbose 2>&1 | head -30
```
Expected: FAIL — handler doesn't have the effectiveness store read or updated render yet.

- [ ] **Step 7: Run full suite to catch any remaining test fixture issues**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```
Expected: PASS — all tests green. The full suite includes the sentinel test (56 tests now since we added 11 new pure function tests).

- [ ] **Step 8: Commit Task 2**

```bash
git add src/cli/commands/executive-effectiveness-handler.ts tests/cli/commands/executive-effectiveness-cli.vitest.ts
git commit -m "feat(p10-8b): CLI handler — effectiveness store load + enriched render

- Load effectiveness data via per-file readdirSync with isolated try/catch
- Call applyEffectivenessData() before computeRecommendationEffectiveness()
- Terminal render: effectiveness columns (Kept/Rvt/Inv/NoD/EffRt/Cov) when
  any signal has applied recs; graceful fallback to P10.8a-compatible output
- JSON output includes effectivenessOutcome on entries + new calibration fields
- 5 new CLI tests: terminal columns, JSON fields, missing store, mixed data

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Verify sentinel + full suite + final review

**Files:**
- Check: `tests/executive/executive-sentinels.vitest.ts` (no changes needed)

- [ ] **Step 1: Run the full test suite to confirm everything passes**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```
Expected: PASS — all 1900+ tests green, 0 failures.

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit 2>&1
```
Expected: clean exit, no type errors.

- [ ] **Step 3: Verify sentinel passes with new code**

```bash
npx vitest run tests/executive/executive-sentinels.vitest.ts --reporter=verbose 2>&1
```
Expected: PASS — all sentinel tests (no new files added, both modified files already in EXECUTIVE_FILES).

- [ ] **(No commit needed)** No sentinel files changed — verification is recorded in the final review/PR body.

---

## Self-Review

- **Spec coverage:**
  - ✅ `EffectivenessOutcome` type (keep/revert/investigate/no_data) — Task 1, Step 1
  - ✅ `applyEffectivenessData()` pure function — Task 1, Step 4
  - ✅ `RecommendationEntry.effectivenessOutcome` — Task 1, Step 2
  - ✅ `SignalCalibration` extended with `appliedKeep`/`appliedRevert`/`appliedInvestigate`/`appliedNoData`/`effectivenessRate`/`effectivenessCoverage` — Task 1, Steps 3-7
  - ✅ `effectivenessRate` excludes `no_data` from denominator — Task 1, Step 7 (verified by test)
  - ✅ `effectivenessCoverage` includes `no_data` in denominator — Task 1, Step 7 (verified by test)
  - ✅ Per-file readdirSync with isolated try/catch — Task 2, Step 2
  - ✅ Graceful degradation (missing/empty store) — Task 2, Step 5 (test)
  - ✅ Terminal render with effectiveness columns — Task 2, Step 4
  - ✅ Backward-compatible output (no applied recs → P10.8a format) — Task 2, Step 4
  - ✅ No sentinel changes needed — Task 3

- **Placeholder scan:** No TBD, TODO, incomplete sections, or vague requirements.
- **Type consistency:** `EffectivenessOutcome` used consistently across all tasks. `applyEffectivenessData` returns `RecommendationEntry[]`. SignalCalibration fields named consistently.
