# P5.3 — Proposal Effectiveness Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
> **Plan home:** `docs/superpowers/plans/2026-06-19-p5-3-proposal-effectiveness-intelligence.md`
> **SDS:** `docs/superpowers/specs/2026-06-19-p5-3-proposal-effectiveness-intelligence-design.md`

**Goal:** Aggregate across all proposals to answer "what kinds of changes actually improve ALiX?" — building organizational learning from individual proposal effectiveness data.

**Risk:** LOW — pure read + compute + save report. No mutations, no state changes, no applier modifications, no evidence writes. Zero blast radius.

## Global Constraints

- **P5.3 learns patterns. P5.3 does NOT mutate.** No proposals created, no approvals, no applies, no evidence writes. The IntelligenceReporter writes only the report JSON file to `.alix/adaptation/intelligence/` — that is the only write path.
- **No auto-generation of proposals.** The intelligence report may *inform* human decisions. It never creates proposals.
- **No new evidence types.** Reports are persisted as JSON files under `.alix/adaptation/intelligence/`, distinct from the evidence chain.
- **All components are pure compute.** They read from ProposalStore, EffectivenessStore, EvidenceStore and return structured data. No side effects.
- **Insufficient data is valid output.** First runs will produce mostly "insufficient data" buckets. This is correct and useful.
- **Run `gitnexus_impact` before editing any indexed symbol** — especially `proposal-store.ts`, `evidence-store.ts`, `effectiveness-store.ts`, and `adaptation.ts`.
- **Do not touch** the 5 pre-existing uncommitted files (`AGENTS.md`, `CLAUDE.md`, `planning-agent.ts`, 2 `tests/workflow/agents/` test files).

## Architecture diagram

```
ProposalStore ──┐
EffectivenessStore ─┤
EvidenceStore ────┤ ── ProposalLifecycleAnalyzer ──┐
                  │                                  │
                  └── enrich each proposal with:      │
                       effectiveness report          │
                       revert status                 │
                       lifecycle timestamps          │
                                                      │
                                                      ├── BucketAggregator ───┐
                                                      │    groups by:         │
                                                      │      action           │
                                                      │      targetKind       │
                                                      │      sourceType       │
                                                      │      provenance       │
                                                      │      capability       │
                                                      │      outcome          │
                                                      │                       │
EffectivenessTrendAnalyzer ◄──────────────────────────┘                       │
  per-bucket: keep rate, revert rate,                                         │
  failure rate, approval rate, time metrics                                   │
                                                                              │
RevertSignalAnalyzer ◄────────────────────────────────────────────────────────┤
  advisory vs actual revert, humansOverruled                                  │
                                                                              │
ConfidenceCalibrationAnalyzer ◄──────────────────────────────────────────────┤
  sourceConfidence 0.0-1.0 → actual outcome                                      │
                                                                              │
                                                                              ├── IntelligenceReporter
                                                                              │    assemble report
                                                                              │    generate executive summary
                                                                              │    persist to .alix/adaptation/intelligence/
                                                                              │
                                                                              ▼
                                                                         IntelligenceReport
```

## File Structure

| File | Action |
|---|---|
| `src/adaptation/intelligence-types.ts` | **Create** — IntelligenceReport, BucketSet, BucketStat, RevertSignalAnalysis, ConfidenceCalibration, ConfidenceBucket, EnrichedProposal |
| `src/adaptation/intelligence-store.ts` | **Create** — save/load/list report files under `.alix/adaptation/intelligence/` |
| `src/adaptation/proposal-lifecycle-analyzer.ts` | **Create** — load + enrich proposals with lifecycle data |
| `src/adaptation/effectiveness-trend-analyzer.ts` | **Create** — per-bucket keep/revert/investigate rates |
| `src/adaptation/revert-signal-analyzer.ts` | **Create** — advisory vs actual revert analysis |
| `src/adaptation/confidence-calibration-analyzer.ts` | **Create** — confidence → outcome bucketing |
| `src/adaptation/bucket-aggregator.ts` | **Create** — group by each dimension, compute stats |
| `src/adaptation/intelligence-reporter.ts` | **Create** — orchestrate, assemble, persist report |
| `src/cli/commands/adaptation.ts` | **Modify** — add `intelligence` subcommand |
| Tests | Per task |

## Task 1: Intelligence types + report schema

**Files:**
- Create: `src/adaptation/intelligence-types.ts`
- Test: `tests/adaptation/intelligence-types.vitest.ts`

**Interfaces to define:**

```ts
interface EnrichedProposal {
  proposal: AdaptationProposal;
  effectivenessReport: ProposalEffectivenessReport | null;
  wasReverted: boolean;
  revertProposalId: string | null;
  outcome: "applied" | "rejected" | "failed" | "reverted" | "pending" | "approved";
  timeToApprovalHours: number | null;
  timeToApplyHours: number | null;
}

interface BucketStat {
  value: string;
  totalProposals: number;
  insufficientData: boolean;
  keepCount?: number;
  keepRate?: number;
  advisoryRevertCount?: number;
  advisoryRevertRate?: number;
  investigateCount?: number;
  investigateRate?: number;
  notAssessedCount?: number;
  notAssessedRate?: number;
  applyFailureCount?: number;
  applyFailureRate?: number;
  rejectionCount?: number;
  rejectionRate?: number;
  approvalRate?: number;
  actualRevertCount?: number;
  actualRevertRate?: number;
  medianTimeToApprovalHours?: number;
  medianTimeToApplyHours?: number;
  meanSourceConfidence?: number;
  humansOverruledCount?: number;
}

interface BucketSet {
  dimension: string;
  buckets: BucketStat[];
  totalInDimension: number;
  insufficientDataCount: number;
}

interface RevertSignalAnalysis {
  totalAdvisoryReverts: number;
  totalActualReverts: number;
  totalUnactedReverts: number;
  revertPrecision: number | null;
  topUnactedRevertBuckets: Array<{ dimension: string; value: string; count: number }>;
  humansOverruledCount: number;
}

interface ConfidenceBucket {
  range: string;
  rangeLow: number;
  rangeHigh: number;
  totalProposals: number;
  insufficientData: boolean;
  keepCount?: number;
  keepRate?: number;
  advisoryRevertCount?: number;
  advisoryRevertRate?: number;
  applyFailureCount?: number;
  applyFailureRate?: number;
  actualRevertCount?: number;
  actualRevertRate?: number;
}

interface ConfidenceCalibration {
  buckets: ConfidenceBucket[];
  totalAssessed: number;
  confidenceOutcomeCorrelation: number | null;
}

interface IntelligenceReport {
  generatedAt: string;
  totalProposalsAnalyzed: number;
  dataWindow: {
    oldestProposalCreatedAt: string;
    newestProposalCreatedAt: string;
    oldestEffectivenessAssessedAt: string | null;
  };
  executiveSummary: string;
  buckets: {
    byAction: BucketSet;
    byTargetKind: BucketSet;
    bySourceRecommendationType: BucketSet;
    byProvenance: BucketSet;
    byCapability: BucketSet;
    byOutcome: BucketSet;
  };
  confidenceCalibration: ConfidenceCalibration;
  revertSignalAnalysis: RevertSignalAnalysis;
  topPerforming: Array<{ dimension: string; value: string; keepRate: number; total: number }>;
  lowestPerforming: Array<{ dimension: string; value: string; keepRate: number; total: number }>;
}

/** Default minimum proposals before a bucket reports stats. */
export const MINIMUM_BUCKET_SIZE = 5;
```

**Step 0:** Impact analysis on `intelligence-types.ts` (new file — no index needed).
**Step 1-5:** TDD. Test: construct each interface, verify defaults, verify MINIMUM_BUCKET_SIZE constant. Simple structural tests.

## Task 2: IntelligenceStore persistence

**Files:**
- Create: `src/adaptation/intelligence-store.ts`
- Test: `tests/adaptation/intelligence-store.vitest.ts`

**Behavior:**
- Directory: `.alix/adaptation/intelligence/` (relative to cwd).
- Filename: `<generatedAt-iso-with-colons-replaced>.json` (e.g., `2026-06-19T23-30-00.json`).
- Methods:
  - `save(report: IntelligenceReport): Promise<void>` — ensures directory exists, writes JSON.
  - `load(filename: string): Promise<IntelligenceReport | null>` — reads specific report by filename.
  - `list(): Promise<string[]>` — returns sorted (newest first) filenames in the directory.
  - `loadLatest(): Promise<IntelligenceReport | null>` — convenience: loads the most recent report.

**Step 0:** Impact analysis — new file, no index needed.
**Step 1-5:** TDD. Test: save completes, load round-trips, list returns filenames, loadLatest returns most recent. Cleanup temp dirs.

## Task 3: ProposalLifecycleAnalyzer

**Files:**
- Create: `src/adaptation/proposal-lifecycle-analyzer.ts`
- Test: `tests/adaptation/proposal-lifecycle-analyzer.vitest.ts`

**Behavior:**
```ts
class ProposalLifecycleAnalyzer {
  constructor(
    private readonly proposalStore: ProposalStore,
    private readonly effectivenessStore: EffectivenessStore,
    private readonly evidenceStore: EvidenceStore
  ) {}

  async analyze(opts?: {
    since?: string;         // ISO 8601
    until?: string;         // ISO 8601
    minConfidence?: number;
  }): Promise<EnrichedProposal[]>
}
```

For each proposal loaded from ProposalStore:
1. Load its effectiveness report from EffectivenessStore (keyed by proposalId).
2. Query EvidenceStore for `adaptation_snapshot_taken` events to confirm snapshot existence.
3. Query EvidenceStore for `adaptation_revert_failed` events (failure signal).
4. Determine revert status: scan all proposals for `action === "revert_proposal"` where `target.sourceProposalId === thisProposal.id`, then check if that revert proposal was applied. If so, `wasReverted = true`.
5. Compute outcome: based on `proposal.status` and `wasReverted`:
   - If `wasReverted` → `"reverted"` (overrides stored status).
   - Otherwise, map `proposal.status` → `"applied"`, `"failed"`, `"rejected"`, `"pending"`, `"approved"`.
6. Compute `timeToApprovalHours` (if `approvedAt` and `createdAt` exist).
7. Compute `timeToApplyHours` (if `appliedAt` and `approvedAt` exist).
8. Filter by `since`/`until`/`minConfidence` if provided.

Performance: The evidence query for revert status is the most expensive step. For a small number of proposals (<100), a naive query per proposal is fine. Return early if no proposals match.

**Step 0:** Impact analysis on `ProposalStore.load/list`, `EffectivenessStore.load/list`, `EvidenceStore.query`.
**Step 1-5:** TDD. Test: enrich applied proposal, enrich reverted proposal, enrichment with null effectiveness, filtering by since/until/minConfidence, empty store returns empty array.

## Task 4: EffectivenessTrendAnalyzer

**Files:**
- Create: `src/adaptation/effectiveness-trend-analyzer.ts`
- Test: `tests/adaptation/effectiveness-trend-analyzer.vitest.ts`

**Behavior:**
```ts
class EffectivenessTrendAnalyzer {
  analyze(proposals: EnrichedProposal[], minBucketSize?: number): BucketStat[]
}
```

Takes a set of enriched proposals (already scoped to a bucket dimension value) and computes:
- `totalProposals`, `keepCount` + `keepRate`, `advisoryRevertCount` + `advisoryRevertRate`
- `investigateCount` + `investigateRate`, `notAssessedCount` + `notAssessedRate`
- `applyFailureCount` + `applyFailureRate`, `rejectionCount` + `rejectionRate`
- `approvalRate`, `actualRevertCount` + `actualRevertRate`
- `medianTimeToApprovalHours` (compute sorted middle of all non-null values)
- `medianTimeToApplyHours` (same)
- `meanSourceConfidence`
- `humansOverruledCount` (proposals where effectiveness = keep but wasReverted = true)

All rate calculations: `count / totalProposals` (0-1).

`optionalCounts`: If `insufficientData` is true (totalProposals < minBucketSize), set all metric fields to undefined.

This analyzer is called per-bucket-value by the BucketAggregator. It has no concept of "bucket dimension" — it receives a flat array and returns one BucketStat.

**Step 0:** Impact analysis — new file, no index needed.
**Step 1-5:** TDD. Test: all-keep bucket, mixed keep/revert bucket, insufficient data bucket, single proposal bucket, bucket with failed proposals, bucket with time-based metrics, empty proposal list.

## Task 5: RevertSignalAnalyzer

**Files:**
- Create: `src/adaptation/revert-signal-analyzer.ts`
- Test: `tests/adaptation/revert-signal-analyzer.vitest.ts`

**Behavior:**
```ts
class RevertSignalAnalyzer {
  analyze(proposals: EnrichedProposal[], buckets: {
    byAction: BucketSet,
    // ... other bucket sets from BucketAggregator
  }, minBucketSize?: number): RevertSignalAnalysis
}
```

Computes top-level revert analysis:
1. `totalAdvisoryReverts` — count of proposals with effectiveness report recommending "revert".
2. `totalActualReverts` — count where `wasReverted === true`.
3. `totalUnactedReverts` — `totalAdvisoryReverts - totalActualReverts` (capped at 0).
4. `revertPrecision` — if `totalActualReverts > 0`, the fraction of actual reverts where effectiveness also said "revert". Otherwise null.
5. `topUnactedRevertBuckets` — scan each BucketSet, find buckets with the highest count of unacted reverts. Return top 5 across all dimensions.
6. `humansOverruledCount` — proposals where effectiveness said "keep" but `wasReverted === true`.

**Step 0:** Impact analysis — new file, no index needed.
**Step 1-5:** TDD. Test: all signals with mixed data, empty proposals, no effectiveness reports, perfect alignment (every advisory revert was acted on), human overruled proposals.

## Task 6: ConfidenceCalibrationAnalyzer

**Files:**
- Create: `src/adaptation/confidence-calibration-analyzer.ts`
- Test: `tests/adaptation/confidence-calibration-analyzer.vitest.ts`

**Behavior:**
```ts
class ConfidenceCalibrationAnalyzer {
  analyze(proposals: EnrichedProposal[], minBucketSize?: number): ConfidenceCalibration
}
```

1. Filter to proposals that have an effectiveness report (assessed proposals).
2. For each proposal, extract `sourceConfidence`.
3. Bucket into 10 ranges: 0.0-0.1, 0.1-0.2, ..., 0.9-1.0.
   - `rangeLow` inclusive, `rangeHigh` exclusive except for 1.0 which includes 1.0.
4. For each confidence bucket, compute metrics using EffectivenessTrendAnalyzer patterns:
   - `keepCount` + `keepRate`
   - `advisoryRevertCount` + `advisoryRevertRate`
   - `applyFailureCount` + `applyFailureRate`
   - `actualRevertCount` + `actualRevertRate`
5. `totalAssessed` = total proposals used in calibration.
6. `confidenceOutcomeCorrelation` — compute Spearman rank correlation between confidence values and keep outcomes (binary: keep=1, non-keep=0). Return null if < 10 data points or if all values are in one bucket.

**Step 0:** Impact analysis — new file, no index needed.
**Step 1-5:** TDD. Test: uniform confidence (all 0.9+), wide confidence spread, insufficient data in all buckets, single proposal assessed, proposals with exact range boundary values (0.0, 0.5, 0.9, 1.0), correlation returns null for small datasets.

## Task 7: BucketAggregator

**Files:**
- Create: `src/adaptation/bucket-aggregator.ts`
- Test: `tests/adaptation/bucket-aggregator.vitest.ts`

**Behavior:**
```ts
class BucketAggregator {
  constructor(
    private readonly trendAnalyzer: EffectivenessTrendAnalyzer
  ) {}

  aggregate(proposals: EnrichedProposal[], opts?: {
    minBucketSize?: number;
  }): {
    byAction: BucketSet;
    byTargetKind: BucketSet;
    bySourceRecommendationType: BucketSet;
    byProvenance: BucketSet;
    byCapability: BucketSet;
    byOutcome: BucketSet;
  }
}
```

For each dimension:
1. Group enriched proposals by the dimension's key.
2. For each group, call `EffectivenessTrendAnalyzer.analyze(group, minBucketSize)` → `BucketStat`.
3. Assemble into `BucketSet`:
   - `dimension` = the dimension name (e.g., "byAction").
   - `buckets` = sorted alphabetically by value.
   - `totalInDimension` = sum of all bucket totalProposals.
   - `insufficientDataCount` = count of buckets with `insufficientData === true`.

**Special handling for `byCapability`:**
- Extract from `proposal.payload.capability` or `proposal.target.capability`.
- Proposals without a capability field are grouped under `"(none)"`.
- The `"(none)"` bucket is flagged as `insufficientData` if it falls below the threshold (it will be noisy, which is fine).

**Special handling for `byOutcome`:**
- Use the computed `EnrichedProposal.outcome` (not raw proposal.status).
- Includes proposed revert proposals (their outcome will be "reverted" — derived from the effect, not the revert proposal's own status).

**Step 0:** Impact analysis — new file, no index needed.
**Step 1-5:** TDD. Test: basic grouping across all dimensions, proposals in multiple buckets, empty proposals list, single proposal, capability extraction, outcome grouping includes reverted.

## Task 8: IntelligenceReporter

**Files:**
- Create: `src/adaptation/intelligence-reporter.ts`
- Test: `tests/adaptation/intelligence-reporter.vitest.ts`

**Behavior:**
```ts
class IntelligenceReporter {
  constructor(
    private readonly lifecycleAnalyzer: ProposalLifecycleAnalyzer,
    private readonly bucketAggregator: BucketAggregator,
    private readonly revertSignalAnalyzer: RevertSignalAnalyzer,
    private readonly confidenceCalibrationAnalyzer: ConfidenceCalibrationAnalyzer,
    private readonly intelligenceStore: IntelligenceStore,
  ) {}

  async generateReport(opts?: {
    since?: string;
    until?: string;
    minConfidence?: number;
    minBucketSize?: number;
  }): Promise<IntelligenceReport>
}
```

Orchestration:
1. Call `lifecycleAnalyzer.analyze(opts)` → enriched proposals.
2. Call `bucketAggregator.aggregate(enrichedProposals, opts)` → bucket sets.
3. Call `revertSignalAnalyzer.analyze(enrichedProposals, bucketSets)` → RevertSignalAnalysis.
4. Call `confidenceCalibrationAnalyzer.analyze(enrichedProposals)` → ConfidenceCalibration.
5. Compute `dataWindow` from enriched proposals (min createdAt, max createdAt).
6. Compute `topPerforming` — iterate all bucket sets, find top 5 by keepRate (excluding insufficient-data buckets).
7. Compute `lowestPerforming` — iterate all bucket sets, find bottom 5 by keepRate.
8. Generate `executiveSummary` — natural language summary (3-5 sentences):
   - Total proposals analyzed + data window.
   - Which dimensions have sufficient data (and which don't).
   - Notable findings from top/lowest performing buckets.
   - Revert signal headline (are reverts being acted on?).
   - Confidence calibration headline (does confidence correlate with outcome?).
   Early-data variant: "Only N proposals have sufficient data. Most buckets are below the minimum threshold. Continue accumulating adaptation history."
9. Assemble into IntelligenceReport.
10. Persist via `intelligenceStore.save(report)`.
11. Return the report.

The `executiveSummary` is generated programmatically from structured data — no LLM call. Use a template that fills in metrics. This keeps P5.3 deterministic and fast.

**Step 0:** Impact analysis — new file, no index needed.
**Step 1-5:** TDD. Test: full pipeline with seeded data, early-data pipeline returns insufficient_data buckets, executive summary generation, top/lowest performing computation, report persistence is called.

## Task 9: CLI: alix adaptation intelligence

**Files:**
- Modify: `src/cli/commands/adaptation.ts`
- Test: `tests/cli/commands/adaptation-intelligence.vitest.ts`

**Subcommand:** `alix adaptation intelligence`

```ts
case "intelligence":
  await runIntelligence(cwd, store, evidenceStore, rest);
  return;
```

`runIntelligence(cwd, store, evidenceStore, args)`:
1. Parse flags: `--since`, `--until`, `--min-bucket-size`, `--json`, `--min-confidence`.
2. Wire up component instances:
   - `EffectivenessStore` (`.alix/adaptation/effectiveness/`).
   - `ProposalLifecycleAnalyzer` (proposalStore, effectivenessStore, evidenceStore).
   - `EffectivenessTrendAnalyzer` (new).
   - `BucketAggregator` (trendAnalyzer).
   - `RevertSignalAnalyzer` (new).
   - `ConfidenceCalibrationAnalyzer` (new).
   - `IntelligenceStore` (`.alix/adaptation/intelligence/`).
   - `IntelligenceReporter` (all of the above).
3. Call `reporter.generateReport({ since, until, minConfidence, minBucketSize })`.
4. If `--json`: print JSON.stringify(report, null, 2) to stdout.
5. Else: print formatted tables to stdout:
   - Report header: generatedAt, totalProposals, dataWindow.
   - Executive summary section.
   - For each dimension: table showing buckets and their key metrics.
     - Insufficient-data buckets shown with `⚠️` marker and `—` for metrics.
   - Revert signal analysis section.
   - Confidence calibration section (table).
   - Top / lowest performing buckets section.
6. Update `printUsage`.

**Table Layout (default terminal):**
```
=== Adaptation Intelligence Report ===
Generated: 2026-06-19T23:30:00.000Z | Proposals: 47 | Window: 2026-06-01 — 2026-06-19

Executive Summary:
...

--- byAction ---
Bucket                Total  Keep   Rvrt(A) Rvrt(!) Failed  Approve Med-TTA
update_agent_card     18     83%    11%     5%      5%      94%     2.3h
add_capability        7      71%    14%     0%      14%     85%     4.1h
create_agent_card     4⚠️    —      —       —       —       —       —
...
```

**CLI flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--since` | ISO string | all | Analyze proposals created after this date |
| `--until` | ISO string | all | Analyze proposals created before this date |
| `--min-bucket-size` | number | 5 | Minimum proposals for sufficient data |
| `--json` | boolean | false | Output raw report as JSON to stdout |
| `--min-confidence` | number | 0 | Minimum sourceConfidence filter |

**Step 0:** Impact analysis on `handleAdaptationCommand`. Expected LOW — additive.
**Step 1-5:** TDD. Test: CLI returns formatted output, `--json` outputs valid JSON, `--since`/`--until` filtering, insufficient-data warning in output, report is auto-saved, usage is printed on no args.

## Task 10: Full verification + PR

```bash
npx vitest run tests/adaptation/intelligence-* tests/cli/commands/adaptation-intelligence* --config vitest.config.mts
npx vitest run --config vitest.config.mts    # full suite
npx tsc --noEmit
gitnexus_detect_changes
```

**Verify:**
- All intelligence components return correct data with seeded test stores.
- CLI output formatting is readable.
- `--json` output matches IntelligenceReport type.
- Auto-save creates file under `.alix/adaptation/intelligence/`.
- Executive summary reads naturally for both data-rich and data-poor scenarios.
- Confidence calibration correlation returns null for small datasets.
- No evidence events are created (query evidence store after running report — should be zero new records).

**Push + PR:**
- Branch: `feature/p5.3-proposal-effectiveness-intelligence`.
- Commit messages: `P5.3.N: <component name>` per task.
- PR title: `P5.3: Proposal Effectiveness Intelligence — cross-proposal learning from adaptation history`.
- Tag on merge: `alix-p5.3-complete`.

## Verification (end-to-end)

```bash
# Seed some test proposals (via test helper)
# Seed effectiveness reports for some of them
# Run: alix adaptation intelligence
# Confirm: report is produced, tables printed
# Confirm: .alix/adaptation/intelligence/<timestamp>.json exists
# Run: alix adaptation intelligence --json
# Confirm: valid JSON with full IntelligenceReport shape
# Run: alix adaptation intelligence --since 2099-01-01
# Confirm: "No proposals found in date range" message
# Confirm: evidence store has zero new events
```

## Summary of governance boundary

| Capability | P5.3 boundary |
|---|---|
| Read proposals | ✅ Yes — from ProposalStore |
| Read effectiveness reports | ✅ Yes — from EffectivenessStore |
| Read evidence events | ✅ Yes — from EvidenceStore |
| Write IntelligenceReport | ✅ Yes — to `.alix/adaptation/intelligence/` |
| Create proposals | ❌ No — governance invariant |
| Create evidence events | ❌ No — governance invariant |
| Mutate appliers, cards, skills | ❌ No — governance invariant |
| Approve, reject, apply | ❌ No — governance invariant |
| Call any LLM | ❌ No — all deterministic compute |
