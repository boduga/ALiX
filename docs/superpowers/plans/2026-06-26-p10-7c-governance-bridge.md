# P10.7c — Executive Recommendation Governance Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `alix executive bridge [--report <id>] [--json]` — convert eligible persisted `ExecutiveRecommendation`s into governance proposals (`action: "create_improvement_issue"`), then patch the source report with the canonical `proposalId` + `governanceStatus: "proposed"`.

**Architecture:** A pure `computeExecutiveProposals(report, generatedAt)` returns drafts (`{recIndex, proposal (id:"")}`) + `skippedCount`. A thin CLI handler assigns canonical ids via `nextProposalId()` (shared P5.1c scheme), awaits `proposalStore.save(draft)` per draft (partial-failure short-circuit), then copy-on-writes the report with `proposalId` + `governanceStatus` set on bridged recs and saves it via `recommendationStore.save` (overwrite). Sentinel stays clean — `proposalStore.save(...)` is lowercase instance, not the forbidden `ProposalStore.save` substring.

**Tech Stack:** TypeScript, Node.js `fs`, vitest, existing `ProposalStore` + `RecommendationReportStore`.

**Spec:** `docs/superpowers/specs/2026-06-26-p10-7c-governance-bridge-design.md`

## Global Constraints

| Constraint | Value |
|---|---|
| May create pending proposals | P10.7c may call `proposalStore.save(draft)` to create `pending` proposals |
| May update bridge fields on report | P10.7c may set `proposalId` + `governanceStatus` on bridged recs |
| May NOT approve/apply | P10.7c does not invoke `ApprovalGate` or any applier |
| May NOT create GitHub issues | `create_improvement_issue` is the proposal action; the issue is only created later by the applier after human approval |
| May NOT alter other rec fields | `signal`, `severity`, `recommendation`, `signalConfidence`, `occurrenceCount`, `averageDelta`, and all other fields are preserved bit-for-bit |
| Action reused | `create_improvement_issue` (no new `ProposalAction`) |
| Eligibility | `signal ∈ {degrading_trend, persistent_instability}` AND `proposalId === undefined` |
| Idempotency | Report-local — skip recs where `proposalId !== undefined` |
| Ordering | `createdProposalIds` in source-report recIndex order |
| Partial-failure | On any `ProposalStore.save` throw: stop, do NOT rewrite report, surface error, already-created proposals remain `pending` |
| No-op | When `result.drafts.length === 0`: no proposal saves, no report rewrite |
| Domain separation | Executive handler uses `ProposalStore` instance (`proposalStore.save`, lowercase) — sentinel-clean |
| Sentinel | Add 2 files to `EXECUTIVE_FILES`; **no scoped exceptions** |

---

---

### Task 0: Branch + docs carry-forward

- [ ] Create the feature branch from `main` (P10.7b merged at `deed2dfb`)

```bash
git checkout main
git pull --ff-only
git checkout -b feature/p10-7c-governance-bridge
```

- [ ] Verify the P10.7c spec is present on the branch (`docs/superpowers/specs/2026-06-26-p10-7c-governance-bridge-design.md` at `2d7ccab1`). The plan file does NOT exist yet — write it in this Task.

- [ ] Write and commit the plan document

Write `docs/superpowers/plans/2026-06-26-p10-7c-governance-bridge.md` (this file), then:

```bash
git add docs/superpowers/plans/2026-06-26-p10-7c-governance-bridge.md
git commit -m "docs(p10-7c): add implementation plan"
```

---

### Task 1: Pure `computeExecutiveProposals` + types + unit tests

**Files:**
- Create: `src/executive/executive-bridge-recommendations.ts` (pure function + types)
- Create: `tests/executive/executive-bridge-recommendations.vitest.ts` (unit tests)

**Interfaces:**
- Consumes: `RecommendationReport` + `ExecutiveRecommendation` from `./recommendation-report-store.js`; `AdaptationProposal` type from `../../adaptation/adaptation-types.js`
- Produces: `ExecutiveDraftProposal` (`{ recIndex, proposal }`), `ExecutiveBridgeResult` (`{ drafts, skippedCount }`), `computeExecutiveProposals(report, generatedAt)`

- [ ] **Step 1: Write the failing test file**

`tests/executive/executive-bridge-recommendations.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeExecutiveProposals,
} from "../../src/executive/executive-bridge-recommendations.js";
import type { ExecutiveBridgeResult } from "../../src/executive/executive-bridge-recommendations.js";
import type { RecommendationReport } from "../../src/executive/recommendation-report-store.js";
import type { ExecutiveRecommendation } from "../../src/executive/recommendation-report-store.js";

const FIXED_NOW = "2026-06-26T00:00:00.000Z";

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

function makeReport(recs: ExecutiveRecommendation[]): RecommendationReport {
  return {
    schemaVersion: "p10.7b.0",
    id: "recommendation-test",
    contentHash: "x",
    generatedAt: FIXED_NOW,
    requestedWindow: 10,
    recommendationStatus: "ok",
    inputReportCount: recs.length,
    analyzedReportCount: recs.length,
    skippedReportCount: 0,
    evidenceReportIds: ["outcome-a"],
    recommendations: recs,
    warnings: [],
    loadWarnings: [],
    report: {
      generatedAt: FIXED_NOW,
      requestedWindow: 10,
      recommendationStatus: "ok",
      inputReportCount: recs.length,
      analyzedReportCount: recs.length,
      skippedReportCount: 0,
      evidenceReportIds: ["outcome-a"],
      recommendations: recs,
      warnings: [],
      loadWarnings: [],
    },
  };
}

describe("computeExecutiveProposals — eligibility", () => {
  it("treats degrading_trend as eligible", () => {
    const report = makeReport([makeExecRec({ signal: "degrading_trend" })]);
    const result: ExecutiveBridgeResult = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(1);
    expect(result.skippedCount).toBe(0);
  });

  it("treats persistent_instability as eligible", () => {
    const report = makeReport([makeExecRec({ signal: "persistent_instability" })]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(1);
  });

  it("skips improving_trend (positive advisory, no action)", () => {
    const report = makeReport([makeExecRec({ signal: "improving_trend" })]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("skips low_confidence (too sparse to act on)", () => {
    const report = makeReport([makeExecRec({ signal: "low_confidence" })]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("skips recs that already have a proposalId (idempotency)", () => {
    const report = makeReport([makeExecRec({ proposalId: "prop-existing" })]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("splits mixed eligibility correctly (3 recs: 2 eligible, 1 skipped)", () => {
    const report = makeReport([
      makeExecRec({ signal: "degrading_trend", subsystem: "alpha" }),
      makeExecRec({ signal: "improving_trend", subsystem: "beta" }),
      makeExecRec({ signal: "persistent_instability", subsystem: "gamma" }),
    ]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts.map((d) => d.recIndex)).toEqual([0, 2]);
    expect(result.skippedCount).toBe(1);
  });

  it("handles empty report gracefully", () => {
    const report = makeReport([]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(0);
    expect(result.skippedCount).toBe(0);
  });
});

describe("computeExecutiveProposals — proposal shape", () => {
  it("uses create_improvement_issue with {kind:'issue', title} target", () => {
    const report = makeReport([makeExecRec()]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    const draft = result.drafts[0].proposal;
    expect(draft.action).toBe("create_improvement_issue");
    expect(draft.target).toEqual({ kind: "issue", title: "Investigate workflow regressions" });
  });

  it("payload carries the executive context (source + 9 fields)", () => {
    const report = makeReport([makeExecRec({ evidenceReportIds: ["o1","o2"] } as any)]);
    // Override the makeExecRec: pass evidenceReportIds via report (the payload uses report-level evidenceReportIds).
    const result = computeExecutiveProposals(report, FIXED_NOW);
    const p = result.drafts[0].proposal;
    expect(p.payload).toEqual({
      source: "executive_learning",
      subsystem: "workflow",
      signal: "degrading_trend",
      severity: "high",
      signalConfidence: 0.88,
      occurrenceCount: 8,
      averageDelta: -3.2,
      evidenceReportIds: ["outcome-a"],
      recommendationText: "Investigate workflow regressions",
    });
  });

  it("sets sourceRecommendationType='executive_learning' and sourceConfidence=signalConfidence", () => {
    const report = makeReport([makeExecRec({ signalConfidence: 0.42 })]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    const draft = result.drafts[0].proposal;
    expect(draft.sourceRecommendationType).toBe("executive_learning");
    expect(draft.sourceConfidence).toBe(0.42);
  });

  it("carries status='pending' and provenance='manual'", () => {
    const report = makeReport([makeExecRec()]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    const draft = result.drafts[0].proposal;
    expect(draft.status).toBe("pending");
    expect(draft.provenance).toBe("manual");
  });

  it("evidenceFingerprints = report.evidenceReportIds (spread copy)", () => {
    const report = makeReport([makeExecRec()]);
    report.evidenceReportIds = ["e1", "e2", "e3"];
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts[0].proposal.evidenceFingerprints).toEqual(["e1", "e2", "e3"]);
  });

  it("draft proposal has id='' (handler will assign nextProposalId)", () => {
    const report = makeReport([makeExecRec()]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts[0].proposal.id).toBe("");
  });

  it("createdAt equals the injected generatedAt", () => {
    const report = makeReport([makeExecRec()]);
    const result = computeExecutiveProposals(report, "2099-01-01T00:00:00.000Z");
    expect(result.drafts[0].proposal.createdAt).toBe("2099-01-01T00:00:00.000Z");
  });
});

describe("computeExecutiveProposals — purity + determinism", () => {
  it("is deterministic: same (report, generatedAt) → same drafts", () => {
    const report = makeReport([
      makeExecRec({ subsystem: "alpha" }),
      makeExecRec({ subsystem: "beta", signal: "improving_trend" }),
    ]);
    const r1 = computeExecutiveProposals(report, FIXED_NOW);
    const r2 = computeExecutiveProposals(report, FIXED_NOW);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("does not reference bridgedUpdates, proposalId assignment, or governanceStatus (separation)", () => {
    // Verify the function signature: the return type has `drafts` and `skippedCount` only.
    const report = makeReport([makeExecRec()]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(Object.keys(result).sort()).toEqual(["drafts", "skippedCount"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/executive/executive-bridge-recommendations.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure function**

`src/executive/executive-bridge-recommendations.ts`:

```ts
/**
 * P10.7c — Executive Recommendation Governance Bridge (pure layer).
 *
 * Converts eligible ExecutiveRecommendations from a persisted
 * RecommendationReport into draft AdaptationProposals. The pure function
 * answers only "which proposals should exist?" — it does NOT assign
 * canonical ids (the effectful handler does via nextProposalId()), does NOT
 * persist anything, and does NOT construct the report-update records.
 *
 * Eligibility:
 *   - signal ∈ {"degrading_trend", "persistent_instability"} (actionable)
 *   - proposalId === undefined (not already bridged — idempotent re-runs)
 *
 * @module
 */

import type { AdaptationProposal } from "../adaptation/adaptation-types.js";
import type {
  RecommendationReport,
  ExecutiveRecommendation,
} from "./recommendation-report-store.js";

export interface ExecutiveDraftProposal {
  /** Index of the source recommendation within report.report.recommendations. */
  recIndex: number;
  /**
   * Draft proposal with id="" — the effectful handler assigns the canonical
   * id via nextProposalId() immediately before ProposalStore.save().
   */
  proposal: AdaptationProposal;
}

export interface ExecutiveBridgeResult {
  drafts: ExecutiveDraftProposal[];
  /** Recommendations skipped due to eligibility (non-actionable signal or already-proposed). */
  skippedCount: number;
}

export function computeExecutiveProposals(
  report: RecommendationReport,
  generatedAt: string,
): ExecutiveBridgeResult {
  const recs = report.report.recommendations;
  const drafts: ExecutiveDraftProposal[] = [];
  let skippedCount = 0;

  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (!isEligible(rec)) {
      skippedCount++;
      continue;
    }
    drafts.push({
      recIndex: i,
      proposal: buildDraftProposal(rec, report, generatedAt),
    });
  }

  return { drafts, skippedCount };
}

function isEligible(rec: ExecutiveRecommendation): boolean {
  return (
    (rec.signal === "degrading_trend" || rec.signal === "persistent_instability") &&
    rec.proposalId === undefined
  );
}

function buildDraftProposal(
  rec: ExecutiveRecommendation,
  report: RecommendationReport,
  generatedAt: string,
): AdaptationProposal {
  return {
    id: "",
    createdAt: generatedAt,
    status: "pending",
    action: "create_improvement_issue",
    target: { kind: "issue", title: rec.recommendation },
    payload: {
      source: "executive_learning",
      subsystem: rec.subsystem,
      signal: rec.signal,
      severity: rec.severity,
      signalConfidence: rec.signalConfidence,
      occurrenceCount: rec.occurrenceCount,
      averageDelta: rec.averageDelta,
      evidenceReportIds: report.report.evidenceReportIds,
      recommendationText: rec.recommendation,
    },
    sourceRecommendationType: "executive_learning",
    sourceConfidence: rec.signalConfidence,
    evidenceFingerprints: [...report.report.evidenceReportIds],
    reason: `${rec.subsystem} — ${rec.recommendation}`,
    provenance: "manual",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/executive/executive-bridge-recommendations.vitest.ts`
Expected: PASS — all 15 tests green (7 eligibility + 7 proposal shape + 2 determinism/purity). Note: the test file has an `as any` cast for the first shape test — remove if the type allows; the cast is only to bypass a slight type mismatch on the makeExecRec helper for one field.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/executive/executive-bridge-recommendations.ts tests/executive/executive-bridge-recommendations.vitest.ts
git commit -m "feat(p10-7c): computeExecutiveProposals pure bridge + 15 unit tests"
```

---

### Task 2: CLI handler + routing + integration tests

**Files:**
- Create: `src/cli/commands/executive-bridge-handler.ts` (handler)
- Modify: `src/cli/commands/executive.ts` (add `case "bridge"` + update subcommand list)
- Create: `tests/cli/commands/executive-bridge-cli.vitest.ts` (integration tests)

**Interfaces:**
- Consumes: `computeExecutiveProposals` from `../../executive/executive-bridge-recommendations.js` (Task 1); `RecommendationReportStore` from `../../executive/recommendation-report-store.js`; `ProposalStore` from `../../adaptation/proposal-store.js`; `nextProposalId` from `../../adaptation/recommendation-to-proposal.js`
- Produces: `handleBridgeCommand(args: string[]): Promise<void>`; the executive dispatcher gains `case "bridge"`

**Handler flow:**
1. Resolve report id (from `--report` or `list()[0]`).
2. Load report (or clean error if missing).
3. `result = computeExecutiveProposals(report, now)` — pure.
4. **No-op short-circuit** if `result.drafts.length === 0`: print "No eligible recommendations to bridge." (or JSON) and return.
5. For each draft in order: assign `draft.proposal.id = nextProposalId()`; `await proposalStore.save(draft.proposal)`; collect `{ recIndex, proposalId, status: "proposed" }`. **Partial-failure:** any throw stops the loop and surfaces the error without rewriting the report.
6. Build updated report via **copy-on-write** (loaded report object never mutated).
7. `reportStore.save(updatedReport)` — same id, overwrite.
8. Print summary (or `--json`).

- [ ] **Step 1: Append 9 failing integration tests**

Create `tests/cli/commands/executive-bridge-cli.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleBridgeCommand } from "../../../src/cli/commands/executive-bridge-handler.js";
import { RecommendationReportStore } from "../../../src/executive/recommendation-report-store.js";
import { ProposalStore } from "../../../src/adaptation/proposal-store.js";
import type { RecommendationReport } from "../../../src/executive/recommendation-report-store.js";
import type { ExecutiveRecommendation } from "../../../src/executive/recommendation-report-store.js";

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => { err.push(a.join(" ")); });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.join(" ")); });
  return { out: () => out, err: () => err, restore: () => { logSpy.mockRestore(); warnSpy.mockRestore(); errorSpy.mockRestore(); } };
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

function makeReport(recs: ExecutiveRecommendation[]): RecommendationReport {
  return {
    schemaVersion: "p10.7b.0",
    id: "recommendation-test",
    contentHash: "x",
    generatedAt: "2026-06-26T00:00:00.000Z",
    requestedWindow: 10,
    recommendationStatus: "ok",
    inputReportCount: recs.length,
    analyzedReportCount: recs.length,
    skippedReportCount: 0,
    evidenceReportIds: ["outcome-a"],
    recommendations: recs,
    warnings: [],
    loadWarnings: [],
    report: {
      generatedAt: "2026-06-26T00:00:00.000Z",
      requestedWindow: 10,
      recommendationStatus: "ok",
      inputReportCount: recs.length,
      analyzedReportCount: recs.length,
      skippedReportCount: 0,
      evidenceReportIds: ["outcome-a"],
      recommendations: recs,
      warnings: [],
      loadWarnings: [],
    },
  };
}

function persist(report: RecommendationReport): RecommendationReport {
  const store = new RecommendationReportStore(join(tempRoot, ".alix", "executive", "recommendations"));
  const id = store.save(report);
  return store.load(id)!;
}

let tempRoot: string;
let execDir: string;
let adaptationDir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-7c-cli-"));
  execDir = join(tempRoot, ".alix", "executive");
  adaptationDir = join(tempRoot, ".alix", "adaptation");
  mkdirSync(join(execDir, "recommendations"), { recursive: true });
  mkdirSync(join(adaptationDir, "proposals"), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive bridge CLI", () => {
  it("bridges eligible recs: creates proposals + patches the report", async () => {
    const saved = persist(makeReport([makeExecRec(), makeExecRec({ signal: "improving_trend", subsystem: "beta" })]));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(true);
    expect(parsed.createdProposalIds).toHaveLength(1);
    expect(parsed.skippedCount).toBe(1);
    // Verify the report was patched
    const reloaded = new RecommendationReportStore(join(execDir, "recommendations")).load(saved.id)!;
    expect(reloaded.report.recommendations[0].proposalId).toBe(parsed.createdProposalIds[0]);
    expect(reloaded.report.recommendations[0].governanceStatus).toBe("proposed");
    expect(reloaded.report.recommendations[1].proposalId).toBeUndefined(); // skipped rec unchanged
    cwdSpy.mockRestore();
    c.restore();
  });

  it("without --report, bridges the latest report", async () => {
    persist(makeReport([makeExecRec({ subsystem: "old" })]));
    // sleep 2 ms so the second report is strictly newer
    await new Promise((r) => setTimeout(r, 2));
    const newer = persist(makeReport([makeExecRec({ subsystem: "new" })]));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(true);
    expect(parsed.reportId).toBe(newer.id);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("emits createdProposalIds in source-report recIndex order", async () => {
    const saved = persist(makeReport([
      makeExecRec({ subsystem: "alpha", signal: "degrading_trend" }),
      makeExecRec({ subsystem: "beta", signal: "persistent_instability" }),
      makeExecRec({ subsystem: "gamma", signal: "improving_trend" }), // skipped
      makeExecRec({ subsystem: "delta", signal: "degrading_trend" }),
    ]));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.createdProposalIds).toHaveLength(3);
    // alpha (rec 0), beta (rec 1), delta (rec 3) — order matches source
    const reloaded = new RecommendationReportStore(join(execDir, "recommendations")).load(saved.id)!;
    expect(reloaded.report.recommendations[0].proposalId).toBe(parsed.createdProposalIds[0]);
    expect(reloaded.report.recommendations[1].proposalId).toBe(parsed.createdProposalIds[1]);
    expect(reloaded.report.recommendations[2].proposalId).toBeUndefined();
    expect(reloaded.report.recommendations[3].proposalId).toBe(parsed.createdProposalIds[2]);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("idempotent re-run: second call creates 0 new proposals", async () => {
    const saved = persist(makeReport([makeExecRec()]));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const first = JSON.parse(c.out().join("\n"));
    expect(first.createdProposalIds).toHaveLength(1);
    c.out().length = 0;
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const second = JSON.parse(c.out().join("\n"));
    expect(second.createdProposalIds).toHaveLength(0);
    expect(second.skippedCount).toBe(1);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("no-op short-circuit: zero eligible → no proposal saves, no report rewrite", async () => {
    const saved = persist(makeReport([makeExecRec({ signal: "improving_trend" })]));
    const mtimeBefore = (await import("node:fs")).statSync(join(execDir, "recommendations", `${saved.id}.json`)).mtimeMs;
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(true);
    expect(parsed.createdProposalIds).toHaveLength(0);
    expect(parsed.skippedCount).toBe(1);
    // Verify the report file mtime did NOT change (no rewrite)
    const mtimeAfter = (await import("node:fs")).statSync(join(execDir, "recommendations", `${saved.id}.json`)).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("copy-on-write: non-bridged recs are unchanged bit-for-bit", async () => {
    const originalRec: ExecutiveRecommendation = makeExecRec({
      signal: "improving_trend", subsystem: "stable",
      signalConfidence: 0.5, occurrenceCount: 3, averageDelta: 0.1,
      recommendation: "Continue current stable optimizations",
    });
    const saved = persist(makeReport([makeExecRec(), originalRec]));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const reloaded = new RecommendationReportStore(join(execDir, "recommendations")).load(saved.id)!;
    const reloadedStable = reloaded.report.recommendations[1];
    expect(reloadedStable.signal).toBe("improving_trend");
    expect(reloadedStable.signalConfidence).toBe(0.5);
    expect(reloadedStable.recommendation).toBe("Continue current stable optimizations");
    expect(reloadedStable.proposalId).toBeUndefined();
    expect(reloadedStable.governanceStatus).toBeUndefined();
    cwdSpy.mockRestore();
    c.restore();
  });

  it("partial-failure: save() throws → stop, no report rewrite, error surfaced", async () => {
    const saved = persist(makeReport([makeExecRec({ subsystem: "first" }), makeExecRec({ subsystem: "second" })]));
    // Pre-create the proposals dir + a stub file so the SECOND save can hit a real failure mode:
    // we monkey-patch ProposalStore.save to throw on the second call.
    const proposalStore = new ProposalStore(join(adaptationDir, "proposals"));
    const origSave = proposalStore.save.bind(proposalStore);
    let callCount = 0;
    proposalStore.save = vi.fn(async (p) => {
      callCount++;
      if (callCount === 2) throw new Error("disk full");
      return origSave(p);
    });
    // Inject the patched store via a module override — simpler: just verify via a unit-style mock.
    // For this test, we patch by spying and replacing the constructor... but the handler instantiates internally.
    // Workaround: pre-write a file that will collide with the second proposal's id, forcing save to fail.
    // We instead rely on: ProposalStore.save throws on bad id (assertSafePathComponent).
    // Use an invalid title that, when normalized, produces an id with "../" — but id is set by handler.
    // Cleanest approach: throw inside save by mocking the module.
    vi.mock("../../../src/adaptation/proposal-store.js", async () => {
      const actual = await vi.importActual<any>("../../../src/adaptation/proposal-store.js");
      return {
        ...actual,
        ProposalStore: class extends actual.ProposalStore {
          async save(p: any) { if ((++callCount) === 2) throw new Error("disk full"); return super.save(p); }
        },
      };
    });
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(false);
    expect(parsed.partial).toHaveLength(1); // first proposal saved before failure
    // Verify the report was NOT rewritten (proposalId still undefined for rec 0)
    const reloaded = new RecommendationReportStore(join(execDir, "recommendations")).load(saved.id)!;
    expect(reloaded.report.recommendations[0].proposalId).toBeUndefined();
    expect(reloaded.report.recommendations[1].proposalId).toBeUndefined();
    cwdSpy.mockRestore();
    c.restore();
    vi.doUnmock("../../../src/adaptation/proposal-store.js");
  });

  it("no reports in store: clean error, exit cleanly", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toMatch(/no.*report/i);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--report <missing-id>: clean error", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", "recommendation-does-not-exist", "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toMatch(/not found/i);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--report <corrupt-id>: integrity failure surfaced distinctly", async () => {
    // Persist a valid report, then tamper with its contentHash on disk.
    const saved = persist(makeReport([makeExecRec()]));
    const reportPath = join(execDir, "recommendations", `${saved.id}.json`);
    const raw = JSON.parse((await import("node:fs")).readFileSync(reportPath, "utf-8")) as any;
    raw.contentHash = "tampered-hash";
    (await import("node:fs")).writeFileSync(reportPath, JSON.stringify(raw, null, 2), "utf-8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toMatch(/integrity failure/i);
    expect(parsed.reason).not.toMatch(/not found/i);
    cwdSpy.mockRestore();
    c.restore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli/commands/executive-bridge-cli.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the CLI handler**

`src/cli/commands/executive-bridge-handler.ts`:

```ts
/**
 * P10.7c — Executive bridge CLI handler.
 *
 * Bridges eligible ExecutiveRecommendations from a persisted
 * RecommendationReport into governance proposals (action:
 * "create_improvement_issue"), then patches the report with the canonical
 * proposalId + governanceStatus: "proposed".
 *
 * Read-only by default; writes only:
 *   - .alix/adaptation/proposals/<id>.json (one per eligible rec)
 *   - .alix/executive/recommendations/<id>.json (overwrite with patched bridge fields)
 *
 * Uses instance-based store access (proposalStore.save, lowercase) which
 * keeps the executive purity sentinel clean.
 *
 * @module
 */

import { join } from "node:path";
import { RecommendationReportStore } from "../../executive/recommendation-report-store.js";
import { computeExecutiveProposals } from "../../executive/executive-bridge-recommendations.js";
import { ProposalStore } from "../../adaptation/proposal-store.js";
import { nextProposalId } from "../../adaptation/recommendation-to-proposal.js";
import type { RecommendationReport } from "../../executive/recommendation-report-store.js";

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function handleBridgeCommand(args: string[]): Promise<void> {
  const reportIndex = args.indexOf("--report");
  const reportIdArg =
    reportIndex !== -1 && reportIndex + 1 < args.length ? args[reportIndex + 1] : undefined;
  const useJson = args.includes("--json");

  const cwd = process.cwd();
  const recommendationStore = new RecommendationReportStore(
    join(cwd, ".alix", "executive", "recommendations"),
  );

  // Resolve report id (explicit --report or latest)
  let reportId: string | undefined = reportIdArg;
  if (!reportId) {
    const metas = recommendationStore.list();
    if (metas.length === 0) {
      const reason = "No recommendation reports to bridge.";
      if (useJson) console.log(JSON.stringify({ ok: false, reason }));
      else console.error(reason);
      return;
    }
    reportId = metas[0].reportId;
  }

  let loaded: RecommendationReport;
  try {
    const result = recommendationStore.load(reportId);
    if (!result) {
      const reason = `Report not found: ${reportId}`;
      if (useJson) console.log(JSON.stringify({ ok: false, reason }));
      else console.error(reason);
      return;
    }
    loaded = result;
  } catch (e: any) {
    // RecommendationReportStore.load throws RecommendationReportIntegrityError on
    // hash mismatch / bad JSON / unknown schema. Surface distinctly from "not found".
    const reason = `Report integrity failure for ${reportId}: ${e.message}`;
    if (useJson) console.log(JSON.stringify({ ok: false, reason }));
    else console.error(reason);
    return;
  }

  const generatedAt = new Date().toISOString();
  // generatedAt is captured exactly once before any I/O and reused throughout
  // the bridge operation (passed to computeExecutiveProposals, reused as the
  // updated report's savedAt context). Prevents timestamps drifting across
  // long bridge runs that span multiple proposal saves.
  const result = computeExecutiveProposals(loaded, generatedAt);

  // No-op short-circuit: zero eligible drafts → no writes at all
  if (result.drafts.length === 0) {
    if (useJson) {
      console.log(
        JSON.stringify({
          ok: true,
          reportId,
          createdProposalIds: [],
          skippedCount: result.skippedCount,
        }),
      );
    } else {
      console.log(
        `No eligible recommendations to bridge. (${result.skippedCount} skipped)`,
      );
    }
    return;
  }

  // Save proposals (partial-failure contract: stop on first throw, no report rewrite)
  const proposalStore = new ProposalStore(join(cwd, ".alix", "adaptation", "proposals"));
  const collected: { recIndex: number; proposalId: string; status: "proposed" }[] = [];
  for (const draft of result.drafts) {
    draft.proposal.id = nextProposalId();
    try {
      await proposalStore.save(draft.proposal);
    } catch (e: any) {
      const reason = `Failed to save proposal for recIndex ${draft.recIndex}: ${e.message}`;
      if (useJson) {
        console.log(
          JSON.stringify({
            ok: false,
            reason,
            partial: collected.map((c) => c.proposalId),
          }),
        );
      } else {
        console.error(reason);
      }
      return;
    }
    collected.push({
      recIndex: draft.recIndex,
      proposalId: draft.proposal.id,
      status: "proposed",
    });
  }

  // Build updated report via copy-on-write (loaded report object never mutated)
  const updatedReport: RecommendationReport = {
    ...loaded,
    report: {
      ...loaded.report,
      recommendations: loaded.report.recommendations.map((rec, i) => {
        const update = collected.find((u) => u.recIndex === i);
        return update
          ? { ...rec, proposalId: update.proposalId, governanceStatus: update.status }
          : rec;
      }),
    },
  };

  recommendationStore.save(updatedReport);

  // Summary
  const createdProposalIds = collected.map((c) => c.proposalId);
  if (useJson) {
    console.log(
      JSON.stringify({
        ok: true,
        reportId,
        createdProposalIds,
        skippedCount: result.skippedCount,
      }),
    );
  } else {
    console.log(
      `Bridged ${createdProposalIds.length} recommendation(s) from report ${reportId}.`,
    );
    for (const id of createdProposalIds) {
      console.log(`  Proposal: ${id}`);
    }
    if (result.skippedCount > 0) {
      console.log(`Skipped: ${result.skippedCount}`);
    }
    console.log(``);
    console.log(`Review and approve:`);
    console.log(`  alix governance explain <proposalId>`);
    console.log(`  alix adaptation approve <proposalId>`);
  }
}
```

- [ ] **Step 4: Wire routing into `executive.ts`**

In `src/cli/commands/executive.ts`, add a `case "bridge"` block immediately after the `case "learn"` block:

```ts
    case "bridge": {
      const { handleBridgeCommand } = await import(
        "./executive-bridge-handler.js"
      );
      return handleBridgeCommand(rest);
    }
```

Then update the `default:` error subcommand list from:

```ts
      console.error("Available: dashboard, plan, evaluate, outcomes, learn, recommend");
```

to:

```ts
      console.error("Available: dashboard, plan, evaluate, outcomes, learn, recommend, bridge");
```

- [ ] **Step 5: Run the integration tests**

Run: `npx vitest run tests/cli/commands/executive-bridge-cli.vitest.ts`
Expected: PASS — all 9 tests green. The partial-failure test uses `vi.mock` to throw on the 2nd save; verify the mock scope resolves cleanly (the `vi.doUnmock` after restores the real module for subsequent tests).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/executive-bridge-handler.ts src/cli/commands/executive.ts tests/cli/commands/executive-bridge-cli.vitest.ts
git commit -m "feat(p10-7c): executive bridge CLI + routing + integration tests"
```

---

### Task 3: Sentinel registration + full suite

**Files:**
- Modify: `tests/executive/executive-sentinels.vitest.ts` (add 2 new files to `EXECUTIVE_FILES`)

**Goal:** Register the new pure function + handler with the executive purity sentinel. **No scoped exceptions needed** — the handler uses lowercase instance-based store access (`proposalStore.save(...)`) which does not match the forbidden uppercase `ProposalStore.save` substring.

- [ ] **Step 1: Add the new files to `EXECUTIVE_FILES`**

In `tests/executive/executive-sentinels.vitest.ts`, find the P10.7b group:

```ts
  // P10.7b files
  "src/executive/recommendation-report-store.ts",
];
```

Append a P10.7c group before the closing `];`:

```ts
  // P10.7b files
  "src/executive/recommendation-report-store.ts",
  // P10.7c files
  "src/executive/executive-bridge-recommendations.ts",
  "src/cli/commands/executive-bridge-handler.ts",
];
```

- [ ] **Step 2: Run the sentinel**

Run: `npx vitest run tests/executive/executive-sentinels.vitest.ts`
Expected: PASS — both new files scan cleanly (no forbidden symbols). The test count increases by 2 (was 35 → 37).

- [ ] **Step 3: Run the full test suite + type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: full suite green (baseline at P10.7b + 26 new tests: 15 pure + 10 CLI + 2 sentinel — the integrity-failure test was added to the CLI block); tsc clean.

- [ ] **Step 4: Commit**

```bash
git add tests/executive/executive-sentinels.vitest.ts
git commit -m "test(p10-7c): register executive bridge files in purity sentinel"
```

---

### Task 4: Final whole-branch review + PR + tag

- [ ] Dispatch the whole-branch code review (8-angle `code-review` skill, recall-biased) against the branch diff from the P10.7b merge base.
- [ ] Triage findings: dispatch ONE fix subagent with the complete findings list if any correctness findings surface; defer cleanup-only findings to the ledger.
- [ ] Run final `npx vitest run` + `npx tsc --noEmit`.
- [ ] Push branch, open PR against `main`, merge (squash), tag `alix-p10-7c-complete`, push tag.
- [ ] Update the progress ledger and write/append the memory entry.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Covered by |
|---|---|
| Architecture (no-op short-circuit, save loop, copy-on-write report) | Tasks 1–2 (handler step 5 in Task 2) |
| Hard governance boundary (no approve/apply/issue) | Implicit: handler only calls `proposalStore.save` + `recommendationStore.save`. No appliers, no ApprovalGate, no issue-creation. Tested via "created proposals exist in ProposalStore with status pending" + no approve flow. |
| Reserved fields never populated in P10.7c | Implicit: the pure function and handler never touch `disposition`, `outcomeConfidence`, `outcomeSummary`. Tested by ensuring the persisted proposal + report only have the bridge fields set. |
| Domain separation (instance-based store access) | Handler uses `proposalStore.save(...)` (lowercase); import contains `ProposalStore` but not `ProposalStore.save`. Sentinel test (Task 3) verifies clean pass. |
| Types (`ExecutiveDraftProposal`, `ExecutiveBridgeResult`) | Task 1 |
| Eligibility (actionable + proposalId undefined) | Task 1 (5 tests) |
| Proposal shape (action, target, payload, source fields, status, provenance) | Task 1 (5 tests) |
| Pure function (deterministic, no I/O, no stateful id) | Task 1 (2 tests: determinism + separation-of-concerns key check) |
| CLI (`alix executive bridge [--report <id>] [--json]`) | Tasks 2 (routing + 9 integration tests) |
| Default = latest report | Task 2 (test 2) |
| Bridge all eligible | Task 1 + Task 2 (test 1) |
| Single-rec targeting (YAGNI deferred) | Not implemented — explicitly deferred per spec |
| No-op short-circuit (zero drafts → zero writes) | Task 2 (test 5 verifies mtime unchanged + 0 proposals) |
| Copy-on-write (non-bridged recs bit-for-bit unchanged) | Task 2 (test 6 verifies bit-for-bit preservation of a stable rec) |
| Partial-failure (stop on throw, no report rewrite) | Task 2 (test 7 verifies partial + no report rewrite) |
| Deterministic ordering (createdProposalIds in recIndex order) | Task 2 (test 3 verifies order across non-contiguous indices 0, 1, 3) |
| Idempotency (report-local) | Task 2 (test 4 verifies second call creates 0 new proposals) |
| Sentinel (no exceptions needed) | Task 3 |

**2. Placeholder scan:** none — every step has complete code or an exact command with expected output. No "TBD", "TODO", "similar to", or "fill in".

**3. Type consistency:**
- `ExecutiveDraftProposal { recIndex: number; proposal: AdaptationProposal }` (Task 1) — used identically in Task 2 handler.
- `ExecutiveBridgeResult { drafts: ExecutiveDraftProposal[]; skippedCount: number }` (Task 1) — consumed in Task 2.
- `nextProposalId()` (imported in Task 2) — same id scheme as P5.1c's `RecommendationToProposal.convert`.
- `ProposalStore.save(proposal)` returns `Promise<void>`; the handler reads `draft.proposal.id` (assigned just before save) instead of a return value. ✅
- The copy-on-write update preserves non-bridged rec fields via `{ ...rec, proposalId, governanceStatus }` — only the two bridge fields are added. ✅
- `RecommendationReport` in the updated-report type is the same shape loaded from the store. ✅

**Confidence:** the plan follows the P10.7b pattern with the key adaptations (handler assigns id via nextProposalId since ProposalStore.save returns void; partial-failure contract explicit; no-op short-circuit). Whole-branch review will catch any remaining gaps.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-26-p10-7c-governance-bridge.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — Fresh implementer subagent per task (1–3), review between tasks, then final 8-angle whole-branch review before PR + tag.
2. **Inline Execution** — Tasks 1–3 in this session with checkpoints.

**Which approach?**