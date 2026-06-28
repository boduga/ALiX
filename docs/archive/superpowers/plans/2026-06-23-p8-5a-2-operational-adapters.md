# P8.5a.2 — Operational Learning Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the dormant P8 stack to live P7.5p data via 3 pure adapters + a single-writer `alix learning refresh` orchestrator. First phase that populates `LearningStore` with real calibration signals. Retires the `lens_scores_not_persisted` sentinel.

**Architecture:** Pure adapters (read source stores → call pure builders → return `AdapterResult`) → orchestrator (the sole `LearningStore` writer). Adapter Purity Invariant is sentinel-enforced. Refresh is append-only.

**Tech Stack:** TypeScript, vitest, the 3 P8.5a.0-protected builders, the 3 P7.5p stores, `OutcomeStore`, `LearningStore`.

## Global Constraints

- **Adapters are pure.** Each adapter reads stores + calls a builder + returns `AdapterResult`. Adapters MUST NOT import `LearningStore`, `ProposalStore`, `ApprovalGate`, `AdaptationProposalStore`, any applier, or `AutomaticProposalGenerator`. Sentinel-enforced.
- **The orchestrator is the sole `LearningStore` writer** in this phase. It writes ONLY signals/profiles; never creates proposals, never calls `ApprovalGate`, never mutates `ProposalStore`.
- **`refresh` is append-only.** Running it twice against identical data produces 2× records. Dedup is the consumer's concern (P9), enabled by a single shared `generatedAt` per run.
- **Adapters are independent.** An empty source store yields an empty `AdapterResult`, never an error. No adapter blocks another.
- **`fidelity` is honest.** P8.1/P8.2 = `"high"` (recorded observations); P8.3 = `"low"` (`concernsRaised` inferred from `recommendedVerdict`).
- **6 protected type files remain byte-identical** to the P8.5a.0 baseline (incl. `outcome-types.ts`, `learning-types.ts`). NO type-file changes. `AdapterResult`/`AdapterDiagnostics` are NEW types in a new file (`adapter-diagnostics.ts`).
- **`learning-store.ts`, the 3 builders, the 3 P7.5p stores, `OutcomeStore`** are read-only from adapters — untouched.
- **`alix learning refresh` is explicit + opt-in.** No auto-refresh, no scheduled refresh.

---

## Task 1: P8.5a.2a — Recommendation adapter + shared diagnostics types

**Files:**
- Create: `src/learning/adapter-diagnostics.ts`
- Create: `src/learning/recommendation-calibration-adapter.ts`
- Create: `tests/learning/recommendation-calibration-adapter.vitest.ts`

**Interfaces:**
- Consumes: `OutcomeStore` (reads `OutcomeRecord`, including real `confidence` from P7.5p.1), `RecommendationCalibrationBuilder`
- Produces: `AdapterResult` (the shared type), `RecommendationCalibrationAdapter.calibrate()`

- [ ] **Step 1.1: Write the shared diagnostics types**

Create `src/learning/adapter-diagnostics.ts`:

```ts
/**
 * P8.5a.2 — Shared adapter result + diagnostics types.
 *
 * Every calibration adapter returns AdapterResult so the learning-refresh
 * orchestrator can summarize uniformly. The diagnostics give operators
 * visibility into what was read, processed, excluded, and at what fidelity —
 * WITHOUT needing the P8.5b dashboard.
 *
 * Pure data types, no storage dependencies.
 *
 * @module
 */

import type { LearningSignal, CalibrationProfile } from "./learning-types.js";

export type AdapterName = "recommendation" | "risk" | "governance";

export interface AdapterDiagnostics {
  /** Which adapter produced this. */
  adapter: AdapterName;
  /** Source records read in the window (e.g. outcomes, or risk scores). */
  sourceRecordsRead: number;
  /** Records that contributed to an observation fed to the builder. */
  processed: number;
  /** Records excluded, keyed by reason (e.g. { missingConfidence: 12, noOutcome: 4 }). */
  excludedReasons: Record<string, number>;
  /** Data fidelity: "high" for recorded observations, "low" for inferred (P8.3 concernsRaised). */
  fidelity: "high" | "low";
  notes?: string[];
}

export interface AdapterResult {
  signals: LearningSignal[];
  profiles: CalibrationProfile[];
  diagnostics: AdapterDiagnostics;
}
```

- [ ] **Step 1.2: Write the recommendation adapter**

Create `src/learning/recommendation-calibration-adapter.ts`. **Read `src/learning/recommendation-calibration-builder.ts` first** to confirm the exact `calibrate(buckets, sourceReportId, generatedAt)` signature and `CalibrationResult` shape (it returns `{ signals, profiles }`).

```ts
/**
 * P8.5a.2a — Recommendation calibration adapter (P8.1).
 *
 * Pure: reads OutcomeStore, buckets by OutcomeRecord.confidence (the REAL
 * recommendation confidence populated by P7.5p.1), feeds the pure
 * RecommendationCalibrationBuilder, and returns an AdapterResult. Never
 * writes to LearningStore — the orchestrator is the sole writer.
 *
 * Adapter Purity Invariant: this file imports NO mutation surface
 * (LearningStore/ProposalStore/ApprovalGate/appliers). Sentinel-enforced.
 *
 * @module
 */

import type { OutcomeRecord } from "../adaptation/outcome-types.js";
import type { OutcomeStore } from "../adaptation/outcome-store.js";
import { RecommendationCalibrationBuilder } from "./recommendation-calibration-builder.js";
import type { ConfidenceBucketObservation } from "./recommendation-calibration-builder.js";
import type { AdapterResult } from "./adapter-diagnostics.js";

export interface RecommendationAdapterOptions {
  windowDays?: number;       // default 30
  generatedAt?: string;      // injected for determinism in tests; orchestrator passes the run's shared ts
}

// 5 fixed confidence buckets.
const BUCKETS: { label: string; lo: number; hi: number; midpoint: number }[] = [
  { label: "0.0-0.2", lo: 0.0, hi: 0.2, midpoint: 0.1 },
  { label: "0.2-0.4", lo: 0.2, hi: 0.4, midpoint: 0.3 },
  { label: "0.4-0.6", lo: 0.4, hi: 0.6, midpoint: 0.5 },
  { label: "0.6-0.8", lo: 0.6, hi: 0.8, midpoint: 0.7 },
  { label: "0.8-1.0", lo: 0.8, hi: 1.0, midpoint: 0.9 },
];

export class RecommendationCalibrationAdapter {
  constructor(
    private readonly outcomeStore: OutcomeStore,
    private readonly builder = new RecommendationCalibrationBuilder(),
  ) {}

  async calibrate(opts?: RecommendationAdapterOptions): Promise<AdapterResult> {
    const windowDays = opts?.windowDays ?? 30;
    const generatedAt = opts?.generatedAt ?? new Date().toISOString();

    const outcomes = await this.outcomeStore.queryByWindow(windowDays);

    // Bucket by confidence. Outcomes with confidence === undefined are excluded
    // (they predate P7.5p.1 or had no recommendation) — bucketing undefined is meaningless.
    const counts: Record<string, { total: number; success: number }> = {};
    for (const b of BUCKETS) counts[b.label] = { total: 0, success: 0 };
    let processed = 0;
    let excludedMissingConfidence = 0;

    for (const o of outcomes) {
      if (o.confidence === undefined || o.confidence === null) {
        excludedMissingConfidence += 1;
        continue;
      }
      const bucket = BUCKETS.find((b) => o.confidence! >= b.lo && o.confidence! < b.hi)
        ?? BUCKETS[BUCKETS.length - 1]; // 1.0 lands in the last bucket
      counts[bucket.label].total += 1;
      if (o.outcome === "success") counts[bucket.label].success += 1;
      processed += 1;
    }

    const buckets: ConfidenceBucketObservation[] = BUCKETS.map((b) => ({
      bucketLabel: b.label,
      bucketMidpoint: b.midpoint,
      totalCount: counts[b.label].total,
      successCount: counts[b.label].success,
    }));

    const sourceReportId = `recommendation-accuracy-window-${windowDays}`;
    const built = this.builder.calibrate(buckets, sourceReportId, generatedAt);

    return {
      signals: built.signals,
      profiles: built.profiles,
      diagnostics: {
        adapter: "recommendation",
        sourceRecordsRead: outcomes.length,
        processed,
        excludedReasons: excludedMissingConfidence > 0
          ? { missingConfidence: excludedMissingConfidence }
          : {},
        fidelity: "high",
      },
    };
  }
}
```

- [ ] **Step 1.3: Write the recommendation adapter tests**

Create `tests/learning/recommendation-calibration-adapter.vitest.ts`. Use an in-memory `OutcomeStore` via `vi.spyOn(process, "cwd")` + a temp dir, OR construct `OutcomeStore` with an explicit `storeDir` and `append` fixtures directly. Read `tests/adaptation/risk-score-store.vitest.ts` for the temp-dir pattern. Tests:

1. **Empty store → empty AdapterResult** with `processed: 0`, `signals: []`, `profiles: []`, no crash.
2. **Excludes `confidence === undefined`** — seed outcomes with and without confidence; assert `excludedReasons.missingConfidence` is correct and undefined-confidence outcomes don't count toward any bucket.
3. **Buckets correctly** — seed outcomes with known confidences (e.g. 5 at 0.85 all success, 5 at 0.85 all failure); assert the `0.8-1.0` bucket has the right `totalCount`/`successCount`.
4. **Produces signals for overconfident bucket** — seed a bucket where observed success rate is well below the midpoint (e.g. 10 at 0.9 confidence, 2 success → overconfident); assert an `overconfidence` signal is returned.
5. **`fidelity: "high"`** in diagnostics.
6. **Pure** — adapter does not write to LearningStore (it has no LearningStore reference; this is also covered by the sentinel test in Task 4).

- [ ] **Step 1.4: Run tests + commit**

Run: `npx vitest run tests/learning/recommendation-calibration-adapter.vitest.ts`
Expected: all passing.
Commit: `feat(p8.5a.2a): recommendation calibration adapter + shared diagnostics`

---

## Task 2: P8.5a.2b — Risk adapter

**Files:**
- Create: `src/learning/risk-calibration-adapter.ts`
- Create: `tests/learning/risk-calibration-adapter.vitest.ts`

**Interfaces:**
- Consumes: `RiskScoreStore`, `OutcomeStore`, `RiskCalibrationBuilder`
- Produces: `AdapterResult` from risk calibration

- [ ] **Step 2.1: Write the risk adapter**

Create `src/learning/risk-calibration-adapter.ts`. **Read `src/learning/risk-calibration-builder.ts` first** to confirm: `RiskOutcomeObservation { proposalId, dimensions: DimensionScore[], outcome }`, `DimensionScore { dimension, score }`, and the exact `calibrate(observations, sourceReportId, generatedAt)` return shape (`RiskCalibrationResult`). Map the builder's result fields into `AdapterResult`.

```ts
/**
 * P8.5a.2b — Risk calibration adapter (P8.2).
 *
 * Pure: joins RiskScoreStore × OutcomeStore by proposalId, converts
 * RiskScore.dimensions to DimensionScore[], feeds the pure
 * RiskCalibrationBuilder, returns AdapterResult. Never writes to LearningStore.
 *
 * Adapter Purity Invariant: no mutation-surface imports. Sentinel-enforced.
 *
 * @module
 */

import type { RiskScoreStore } from "../adaptation/risk-score-store.js";
import type { OutcomeStore } from "../adaptation/outcome-store.js";
import { RiskCalibrationBuilder } from "./risk-calibration-builder.js";
import type { RiskOutcomeObservation, DimensionScore } from "./risk-calibration-builder.js";
import type { AdapterResult } from "./adapter-diagnostics.js";
import type { RiskDimension } from "../adaptation/risk-score-types.js";

export class RiskCalibrationAdapter {
  constructor(
    private readonly riskStore: RiskScoreStore,
    private readonly outcomeStore: OutcomeStore,
    private readonly builder = new RiskCalibrationBuilder(),
  ) {}

  async calibrate(opts?: { windowDays?: number; generatedAt?: string }): Promise<AdapterResult> {
    const windowDays = opts?.windowDays ?? 30;
    const generatedAt = opts?.generatedAt ?? new Date().toISOString();

    const riskScores = await this.riskStore.queryByWindow(windowDays);
    const outcomes = await this.outcomeStore.queryByWindow(windowDays);

    // Index outcomes by subjectId (= proposalId) for the join.
    const outcomeByProposal = new Map<string, string>();
    for (const o of outcomes) outcomeByProposal.set(o.subjectId, o.outcome);

    const observations: RiskOutcomeObservation[] = [];
    let excludedNoOutcome = 0;

    for (const risk of riskScores) {
      const proposalId = risk.id.replace(/^risk-/, ""); // RiskScore.id === "risk-<proposalId>"
      const outcome = outcomeByProposal.get(proposalId);
      if (outcome === undefined) {
        excludedNoOutcome += 1;
        continue;
      }
      const dimensions: DimensionScore[] = (Object.keys(risk.dimensions) as RiskDimension[]).map(
        (d) => ({ dimension: d, score: risk.dimensions[d] }),
      );
      observations.push({ proposalId, dimensions, outcome });
    }

    const sourceReportId = `risk-calibration-window-${windowDays}`;
    const built = this.builder.calibrate(observations, sourceReportId, generatedAt);

    return {
      signals: built.signals,
      // Map the builder's result fields; read the exact RiskCalibrationResult shape.
      // If it carries profiles, pass them through; otherwise [].
      profiles: (built as { profiles?: unknown }).profiles ?? [],
      diagnostics: {
        adapter: "risk",
        sourceRecordsRead: riskScores.length,
        processed: observations.length,
        excludedReasons: excludedNoOutcome > 0 ? { noOutcome: excludedNoOutcome } : {},
        fidelity: "high",
      },
    };
  }
}
```

**Note to implementer:** confirm whether `RiskCalibrationResult` includes `profiles`. The `as { profiles?: unknown }` cast above is a placeholder — if the builder returns profiles, pass them directly; if not, `profiles: []`. Read the builder source to decide. Prefer a clean direct mapping over the cast.

- [ ] **Step 2.2: Write the risk adapter tests**

Create `tests/learning/risk-calibration-adapter.vitest.ts`. Tests:

1. **Empty stores → empty AdapterResult**, no crash.
2. **Join by proposalId** — seed `RiskScore` for `prop-1` + matching `OutcomeRecord` (subjectId `prop-1`); assert one observation is produced with the right `dimensions`.
3. **Excludes risk scores with no outcome** (`excludedReasons.noOutcome`).
4. **`dimensions` converted** from `Record<RiskDimension, number>` to `DimensionScore[]` with all 5 dimensions.
5. **`fidelity: "high"`**.
6. **Independent of recommendation store** (this adapter doesn't read it — sanity).

- [ ] **Step 2.3: Run tests + commit**

Run: `npx vitest run tests/learning/risk-calibration-adapter.vitest.ts tests/learning/recommendation-calibration-adapter.vitest.ts`
Commit: `feat(p8.5a.2b): risk calibration adapter`

---

## Task 3: P8.5a.2c — Governance adapter + retire sentinel

**Files:**
- Create: `src/learning/governance-calibration-adapter.ts`
- Create: `tests/learning/governance-calibration-adapter.vitest.ts`
- Modify: `src/cli/commands/decision.ts` — retire the `lens_scores_not_persisted` sentinel

**Interfaces:**
- Consumes: `GovernanceReviewStore`, `OutcomeStore`, `LensCalibrationBuilder`, `GovernanceCalibrationBuilder`
- Produces: `AdapterResult` from governance calibration (fidelity `"low"`)

- [ ] **Step 3.1: Write the governance adapter**

Create `src/learning/governance-calibration-adapter.ts`. **Read `src/learning/governance-calibration-builder.ts` + `src/learning/lens-calibration-builder.ts` first** to confirm: `LensObservation { lens, verdict, outcome, concernsRaised }`, `LensCalibrationBuilder.build(observations, { windowDays?, generatedAt? })` → `LensCalibrationReport`, `GovernanceCalibrationBuilder.build(report, sourceReportId, generatedAt)` → `{ signals, profiles }`.

```ts
/**
 * P8.5a.2c — Governance calibration adapter (P8.3).
 *
 * Pure: joins GovernanceReviewStore × OutcomeStore by proposalId, derives
 * LensObservation[] from review.lensScores × outcome, feeds LensCalibrationBuilder
 * then GovernanceCalibrationBuilder, returns AdapterResult. Never writes to
 * LearningStore.
 *
 * concernsRaised is INFERRED (1 if recommendedVerdict is a warning verdict,
 * 0 otherwise) — hence fidelity: "low". A future P9+ telemetry phase can
 * replace this with real per-lens counts.
 *
 * Adapter Purity Invariant: no mutation-surface imports. Sentinel-enforced.
 *
 * @module
 */

import type { GovernanceReviewStore } from "../adaptation/governance-review-store.js";
import type { OutcomeStore } from "../adaptation/outcome-store.js";
import type { GovernanceVerdict } from "../adaptation/governance-review-types.js";
import { LensCalibrationBuilder } from "./lens-calibration-builder.js";
import type { LensObservation } from "./lens-calibration-builder.js";
import { GovernanceCalibrationBuilder } from "./governance-calibration-builder.js";
import type { AdapterResult } from "./adapter-diagnostics.js";

function isWarningVerdict(v: GovernanceVerdict): boolean {
  return v === "agree_with_concerns" || v === "challenge";
}

export class GovernanceCalibrationAdapter {
  constructor(
    private readonly reviewStore: GovernanceReviewStore,
    private readonly outcomeStore: OutcomeStore,
    private readonly lensBuilder = new LensCalibrationBuilder(),
    private readonly govBuilder = new GovernanceCalibrationBuilder(),
  ) {}

  async calibrate(opts?: { windowDays?: number; generatedAt?: string }): Promise<AdapterResult> {
    const windowDays = opts?.windowDays ?? 30;
    const generatedAt = opts?.generatedAt ?? new Date().toISOString();

    const reviews = await this.reviewStore.queryByWindow(windowDays);
    const outcomes = await this.outcomeStore.queryByWindow(windowDays);

    const outcomeByProposal = new Map<string, string>();
    for (const o of outcomes) outcomeByProposal.set(o.subjectId, o.outcome);

    const observations: LensObservation[] = [];
    let excludedNoOutcome = 0;

    for (const review of reviews) {
      const outcome = outcomeByProposal.get(review.proposalId);
      if (outcome === undefined) {
        excludedNoOutcome += 1;
        continue;
      }
      for (const ls of review.lensScores) {
        observations.push({
          lens: ls.lens,
          verdict: ls.recommendedVerdict,
          outcome,
          concernsRaised: isWarningVerdict(ls.recommendedVerdict) ? 1 : 0, // LOW_FIDELITY inference
        });
      }
    }

    const lensReport = this.lensBuilder.build(observations, { windowDays, generatedAt });
    const sourceReportId = `governance-calibration-window-${windowDays}`;
    const built = this.calibrate(lensReport, sourceReportId, generatedAt);

    return {
      signals: built.signals,
      profiles: built.profiles,
      diagnostics: {
        adapter: "governance",
        sourceRecordsRead: reviews.length,
        processed: observations.length,
        excludedReasons: excludedNoOutcome > 0 ? { noOutcome: excludedNoOutcome } : {},
        fidelity: "low",
        notes: ["concernsRaised inferred from recommendedVerdict (1=warning, 0=otherwise)"],
      },
    };
  }
}
```

- [ ] **Step 3.2: Write the governance adapter tests**

Create `tests/learning/governance-calibration-adapter.vitest.ts`. Tests:

1. **Empty stores → empty AdapterResult**, no crash, `fidelity: "low"`.
2. **Derives LensObservation per lensScore** — seed a review with 4 lensScores; assert 4 observations (one per lens).
3. **`concernsRaised` heuristic** — lensScores with `agree_with_concerns`/`challenge` → `concernsRaised: 1`; `agree`/`insufficient_information` → `0`.
4. **Excludes reviews with no outcome** (`excludedReasons.noOutcome`).
5. **`fidelity: "low"`** + the inference note present in diagnostics.
6. **Joins by proposalId** — review for prop-A + outcome for prop-A link; review for prop-B with no outcome is excluded.

- [ ] **Step 3.3: Retire the `lens_scores_not_persisted` sentinel**

In `src/cli/commands/decision.ts`, find the `lens_scores_not_persisted` sentinel (around line 1158 — grep for it). It currently returns a static object. Replace it with a live run of the `GovernanceCalibrationAdapter`:

- Instantiate `GovernanceReviewStore` + `OutcomeStore` + `GovernanceCalibrationAdapter`.
- Run `adapter.calibrate({ windowDays })`.
- The lens-calibration CLI path now returns the live `LensCalibrationReport` (the adapter internally produces it via `LensCalibrationBuilder`). 
- **Decision:** the adapter's `calibrate()` returns `AdapterResult` (signals/profiles), but the lens-calibration CLI wants the `LensCalibrationReport` itself. Two options — pick (a):
  - **(a)** The CLI constructs `LensCalibrationBuilder` directly, builds observations from the stores via a small shared helper, and returns the report. (Avoids exposing the internal report through AdapterResult.)
  - **(b)** Expose the `LensCalibrationReport` on `AdapterResult` for governance only.
  - **Recommendation: (a)** — keep `AdapterResult` uniform (signals/profiles only). The sentinel-replacement path calls `LensCalibrationBuilder.build()` directly on observations derived the same way as the adapter. Factor the observation-derivation into a tiny pure helper if duplication appears; otherwise inline.

Read the exact current sentinel code before editing. Update the CLI message to reflect that lens scores ARE now persisted (P7.5p.3) and the report is live. Keep the CLI read-only (no LearningStore write here — the report is computed on demand; the orchestrator in Task 4 is what writes signals to LearningStore).

- [ ] **Step 3.4: Write the sentinel-retirement test**

Add a test (in `tests/cli/commands/` or extend an existing decision CLI test) asserting: running the lens-calibration CLI path against a seeded `GovernanceReviewStore` + `OutcomeStore` returns a live `LensCalibrationReport` (not the `lens_scores_not_persisted` sentinel object). Grep the codebase to confirm no remaining `lens_scores_not_persisted` string.

- [ ] **Step 3.5: Run tests + commit**

Run: `npx vitest run tests/learning/governance-calibration-adapter.vitest.ts tests/learning/risk-calibration-adapter.vitest.ts tests/learning/recommendation-calibration-adapter.vitest.ts`
Confirm `tsc --noEmit` clean.
Commit: `feat(p8.5a.2c): governance calibration adapter + retire lens sentinel`

---

## Task 4: P8.5a.2d — `alix learning refresh` orchestrator + purity sentinel

**Files:**
- Modify: `src/cli/commands/learning.ts` — add `refresh` subcommand (the sole LearningStore writer)
- Create: `tests/cli/commands/learning-refresh.vitest.ts`
- Create: `tests/learning/adapter-purity-sentinels.vitest.ts`

**Interfaces:**
- Consumes: the 3 adapters, `LearningStore`, all 3 P7.5p stores + `OutcomeStore`
- Produces: the `refresh` subcommand; the purity-invariant sentinel test

- [ ] **Step 4.1: Add the `refresh` subcommand**

In `src/cli/commands/learning.ts`, add a `case "refresh":` to the `subcommand` switch (alongside `report`/`propose`). Implement `runLearningRefresh(args)`:

```ts
async function runLearningRefresh(args: string[]): Promise<void> {
  // Parse --window (default 30), --adapter (recommendation|risk|governance|all), --dry-run, --json
  // Single shared generatedAt for the whole run (enables P9 run-identity reconstruction):
  const generatedAt = new Date().toISOString();
  const refreshRunId = `refresh:${generatedAt}`;

  // Instantiate stores (no-arg constructors resolve process.cwd() + .alix/<dir>)
  const outcomeStore = new OutcomeStore(join(process.cwd(), OUTCOMES_DIR));
  const recAdapter = new RecommendationCalibrationAdapter(outcomeStore);
  const riskAdapter = new RiskCalibrationAdapter(new RiskScoreStore(), outcomeStore);
  const govAdapter = new GovernanceCalibrationAdapter(new GovernanceReviewStore(), outcomeStore);

  // AdapterRegistry pattern (refinement): iterate a heterogeneous map of
  // CalibrationAdapter implementations rather than an if/else chain. Future
  // adapters (P7.5p.4 routing, telemetry, evidence, ...) drop in as a
  // single map entry — no orchestrator changes.
  const adapters: Record<AdapterName, CalibrationAdapter> = {
    recommendation: new RecommendationCalibrationAdapter(outcomeStore),
    risk:           new RiskCalibrationAdapter(new RiskScoreStore(), outcomeStore),
    governance:     new GovernanceCalibrationAdapter(new GovernanceReviewStore(), outcomeStore),
  };
  const which = parsed.adapter ?? "all";
  const selected: CalibrationAdapter[] =
    which === "all" ? Object.values(adapters) : [adapters[which as AdapterName]];
  const results: AdapterResult[] = [];
  for (const a of selected) {
    results.push(await a.calibrate({ windowDays: parsed.window, generatedAt }));
  }

  // --dry-run: print preview, write nothing
  if (parsed.dryRun) { /* print summary, return */ }

  // Sole writer: append signals + profiles to LearningStore (best-effort)
  const learningStore = new LearningStore(join(process.cwd(), LEARNING_DIR));
  for (const r of results) {
    for (const s of r.signals) await learningStore.appendSignal(s).catch(log);
    for (const p of r.profiles) await learningStore.appendProfile(p).catch(log);
  }

  // Print summary with refreshRunId + per-adapter diagnostics (see SDS example)
}
```

**Boundary checks (sentinel-style, in this file):** `learning.ts` may import `LearningStore` (it's the writer), `OutcomeStore`, the 3 P7.5p stores, and the 3 adapters. It MUST NOT import `ApprovalGate`, appliers, `AutomaticProposalGenerator`, or `ProposalStore` mutation paths. (`learning.ts` already creates proposals in the `propose` subcommand — that's the existing P8.7 path; `refresh` itself does not propose.)

Confirm `OUTCOMES_DIR` and `LEARNING_DIR` constants exist (grep); if `LEARNING_DIR` is not defined, define it as `join(".alix", "learning")` to match `LearningStore`'s convention.

- [ ] **Step 4.2: Write the purity-invariant sentinel test**

Create `tests/learning/adapter-purity-sentinels.vitest.ts`. Mirror the P8.5a.0 Evidence Chain import sentinel. Read the 3 adapter files as text and assert none contain a forbidden import:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ADAPTER_FILES = [
  "src/learning/recommendation-calibration-adapter.ts",
  "src/learning/risk-calibration-adapter.ts",
  "src/learning/governance-calibration-adapter.ts",
];

const FORBIDDEN_IMPORTS = [
  "LearningStore",
  "ProposalStore",
  "ApprovalGate",
  "AdaptationProposalStore",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  "AutomaticProposalGenerator",
];

describe("adapter purity invariant (P8.5a.2)", () => {
  for (const file of ADAPTER_FILES) {
    it(`${file} imports no mutation surface`, () => {
      const src = readFileSync(file, "utf-8");
      // Check import statements only (avoid matching comments/strings loosely).
      const importLines = src.split("\n").filter((l) => l.trim().startsWith("import"));
      for (const forbidden of FORBIDDEN_IMPORTS) {
        for (const line of importLines) {
          expect(line).not.toContain(forbidden);
        }
      }
    });
  }

  it("adapters expose only a calibrate() public method (no write helpers)", () => {
    // Optional structural check: each adapter class prototype has calibrate and
    // no append/write/save/persist methods.
  });
});
```

- [ ] **Step 4.3: Write the orchestrator integration tests**

Create `tests/cli/commands/learning-refresh.vitest.ts`. Use temp-dir `process.cwd()` mocking. Tests:

1. **End-to-end** — seed all 3 stores + outcomes; run `refresh`; assert signals/profiles appended to `.alix/learning/signals.jsonl` + `profiles.jsonl`.
2. **`--dry-run`** writes nothing (assert files absent or unchanged).
3. **`--adapter risk`** runs only risk (assert only risk-domain signals present, or count matches).
4. **Append-only idempotency** — run `refresh` twice against identical seeded data; assert 2× the signal/profile lines. Assert both runs' records share their respective `generatedAt` (run 1 records share ts1, run 2 records share ts2).
5. **Partial source availability** — seed ONLY the recommendation store (risk + governance empty); run `refresh`; assert it succeeds, recommendation signals present, risk/governance empty, no crash.
6. **Empty source** — seed nothing; run `refresh`; assert it succeeds, writes nothing.
7. **Summary printed** with `refresh:<ts>` run id and per-adapter diagnostics (capture stdout or assert the run-id is emitted).
8. **Mixed Fidelity Refresh** — seed all 3 stores populated; run `refresh --adapter all`; assert each result's `diagnostics.fidelity` is correct: `recommendation` and `risk` = `"high"`, `governance` = `"low"`.
9. **Registry extensibility** — instantiate a fake 4th adapter that satisfies `CalibrationAdapter`; verify it can be added to the map and iterated by the same loop.

- [ ] **Step 4.4: Run the full focused suite + verify scope**

Run the full focused suite: all 3 adapter tests + purity sentinel + learning-refresh + the P7.5p regression suite + the invariance test.
Run `git diff main --stat -- 'src/learning/*-types.ts' 'src/adaptation/*-types.ts'` — MUST be empty (zero type-file changes).
Run `npx tsc --noEmit` — clean.

- [ ] **Step 4.5: Commit**

Commit: `feat(p8.5a.2d): alix learning refresh orchestrator + purity sentinel`

---

## Task 5: Final whole-branch review + PR

- [ ] **Step 5.1: Run the full test suite** (`npm test`). Pre-existing CI failures on main remain pre-existing; confirm no NEW failures in the P8.5a.2 files.
- [ ] **Step 5.2: `gitnexus_detect_changes()`** — confirm scope is P8.5a.2; LOW risk; no affected mutation processes.
- [ ] **Step 5.3: Open PR** — `feature/p8.5a.2-operational-adapters` → `main`, title "P8.5a.2: Operational Learning Adapters". Body: 4 commits, pure adapters + single-writer orchestrator, purity sentinel, diagnostics + fidelity, append-only refresh with run-identity, sentinel retirement, zero type changes, what it unlocks (first real LearningStore population; P9 now has data).
- [ ] **Step 5.4: Await review + merge** (`gh pr merge <N> --squash --delete-branch`), tag `alix-p8-5a-2-complete`.

---

## Notes

- **No type-file changes.** `AdapterResult`/`AdapterDiagnostics` are NEW types in a NEW file (`adapter-diagnostics.ts`), which is not a protected file. The 6 protected type files + `learning-store.ts` are untouched.
- **`generatedAt` is the run-identity key.** All signals/profiles from one refresh share one `generatedAt`; P9 reconstructs `refresh:<ts>` from it. No schema change.
- **`OUTCOMES_DIR` / `LEARNING_DIR`** — grep `src/cli/commands/` for the existing constants; reuse them. `LearningStore`'s dir is `.alix/learning` (its constructor takes a `storeDir`).
- **Builder return shapes vary** — rec/gov return `{signals, profiles}`; risk returns `RiskCalibrationResult` (confirm whether it includes profiles). Map each into `AdapterResult` honestly; never fabricate profiles.
- **Sentinel retirement shape change** — the lens-calibration CLI previously returned a `lens_scores_not_persisted` sentinel object; it now returns a live `LensCalibrationReport`. Document this in the PR body. No consumer should depend on the sentinel string (it self-described as "not persisted").
- **CI failures on main are pre-existing** (`capabilities.test.js`, `chat-modes.test.js`, extensions, `context-events.test.js`). P8.5a.2 touches none of those paths.
