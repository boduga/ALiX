# P5.3 — Proposal Effectiveness Intelligence Design Spec (SDS)

> **Status:** Draft — awaiting review.
> **Plan:** `docs/superpowers/plans/2026-06-19-p5-3-proposal-effectiveness-intelligence.md` (to be written after SDS approval)
> **Risk level:** LOW — pure read + compute. No mutations, no state changes, no applier modifications.

## Core question

> Across many adaptations, what kinds of changes actually improve ALiX?

P5.2b measures individual proposals — one keep/revert/investigate verdict at a time.
P5.3 aggregates across *all* proposals to answer: which adaptation strategies work best for this system?

## Hard governance boundary (non-negotiable)

```
P5.3 learns patterns.
P5.3 does NOT mutate.
P5.3 does NOT auto-generate proposals.
P5.3 does NOT approve or apply anything.
P5.3 is read-only analysis over stored evidence.
```

An IntelligenceReport may *inform* human decisions. It never makes them. A future P5.4 (Proposal Prioritization) or later phase may use these patterns to influence routing — but P5.3 itself is pure observation.

## Summary of design decisions

| Decision | Choice |
|---|---|
| Analysis scope | All completed proposals (applied, failed, rejected, reverted) |
| Data volatility | Persisted as JSON files under `.alix/adaptation/intelligence/` for historical comparison |
| Output format | Machine-readable IntelligenceReport (auto-saved to file) + human-readable CLI table + optional `--json` stdout |
| Mutation | Zero. Reads from ProposalStore + EvidenceStore. Writes only the IntelligenceReport file to the intelligence directory. |
| Auto-generation of proposals | Out of scope. P5.3 does not create proposals. |
| CLI name | `alix adaptation intelligence` |

## Architecture

```
ProposalEffectivenessAgent
  ├─ ProposalLifecycleAnalyzer        — Load + classify all proposals
  ├─ EffectivenessTrendAnalyzer       — Analyze keep/revert/investigate rates
  ├─ RevertSignalAnalyzer             — Compare advisory revert vs actual revert
  ├─ ConfidenceCalibrationAnalyzer    — Map sourceConfidence → outcome rates
  ├─ BucketAggregator                 — Group stats by each bucket dimension
  └─ IntelligenceReport               — Synthesized cross-proposal analysis
```

### Component responsibilities

**ProposalEffectivenessAgent** — Entry point. Orchestrates the pipeline:
1. Load all proposals from ProposalStore (optionally filtered by date range).
2. Load all effectiveness reports from EffectivenessStore.
3. Load relevant evidence events (adaptation_effectiveness, adaptation_snapshot_taken, adaptation_revert_failed) from EvidenceStore.
4. Delegate to analyzers.
5. Assemble and return IntelligenceReport.
6. Print human-readable summary to stdout.

Pure function chain — no side effects beyond reads. The Agent exists as a class but is more akin to a ReportGenerator than an autonomous agent; it runs synchronously in the CLI command and returns its result.

**ProposalLifecycleAnalyzer**
- Loads proposals from ProposalStore.
- For each proposal, enriches it with:
  - Its effectiveness report (if one exists) from EffectivenessStore.
  - Its revert status (was it the target of a revert_proposal that was applied?).
  - Its lifecycle timestamps (created → approved → applied → reverted).
- Filters proposals with sufficient data (enriched proposals with at least `appliedAt` or `failedAt` or `rejectedAt`).
- Returns an array of `EnrichedProposal` combining the raw proposal + derived metadata.

**EffectivenessTrendAnalyzer**
- Receives enriched proposals grouped by each bucket dimension.
- For each bucket, computes:
  - Total proposals in bucket.
  - Keep count + keep rate.
  - Revert (advisory) count + rate.
  - Investigate count + rate.
  - Apply failure count + rate.
  - Approval rate (approved / (approved + rejected + pending)).
  - Median time-to-approval (hours from `createdAt` to `approvedAt`).
  - Median time-to-apply (hours from `approvedAt` to `appliedAt`).
  - Mean sourceConfidence (for the recommendations that lead to proposals in this bucket).
- Flags a bucket as `insufficient_data` if count < configurable threshold (default: 5 proposals).

**ConfidenceCalibrationAnalyzer**
- Groups all assessed proposals by `sourceConfidence` ranges (buckets of width 0.1: `0.0-0.1`, `0.1-0.2`, ..., `0.9-1.0`).
- For each confidence bucket, computes:
  - Total proposals in bucket.
  - Keep count + keep rate.
  - Advisory revert count + rate.
  - Apply failure count + rate.
  - Actual revert count + rate.
- Produces a `ConfidenceCalibration` table that maps confidence ranges to actual outcome rates:
  ```
  Confidence      Keep    Revert (advised)   Apply Failure
  0.9-1.0         92%     5%                  3%
  0.8-0.9         83%     12%                 5%
  0.7-0.8         61%     25%                14%
  0.6-0.7         40%     45%                15%
  ```
- This becomes the empirical foundation for P5.4 proposal prioritization (higher-confidence proposals that historically underperform should be reviewed) and future confidence-threshold tuning in P5.2c.
- Flags as `insufficientData: true` for any bucket where `totalProposals < MINIMUM_BUCKET_SIZE`.

**RevertSignalAnalyzer**
- For proposals that have an effectiveness report recommending `"revert"`:
  - Did a revert_proposal exist targeting this proposal?
  - Was that revert_proposal approved?
  - Was that revert_proposal applied?
- For proposals that were actually reverted:
  - What was their effectiveness recommendation? (keep, revert, investigate, or no report)
- Computes:
  - Advisory revert rate (effectiveness recommends revert / total assessed).
  - Actual revert rate (applied revert proposals / total proposals with snapshots).
  - Gap: proposals where effectiveness said "revert" but no revert was created.
  - Precision: proposals that were actually reverted where effectiveness also said "revert".
- This signal is critical: it tells us whether human judgment aligns with the effectiveness model, and where the model may be over- or under-recommending revert.

**BucketAggregator**
- Takes enriched proposals and groups them by each bucket dimension.
- For each dimension, delegates to EffectivenessTrendAnalyzer for per-bucket stats.
- Produces a `BucketSet` containing:
  - The dimension name (e.g. `"byAction"`, `"byTargetKind"`, `"byProvenance"`, `"bySourceRecommendationType"`).
  - An array of buckets, each with the dimension value, the aggregated stats, and an `insufficientData` flag.
- A proposal may appear in multiple bucket dimensions (it is simultaneously an `update_agent_card` action, an `agent_card` target, and a `manual` provenance). This is expected and correct — each dimension is an independent lens.

**IntelligenceReport**
- Final output shape combining all analysis.
- Contains metadata (generatedAt, totalProposalsAnalyzed, dateRange, dataWindow) and all bucket sets.
- Output as a typed interface so downstream consumers (future P5.4, P5.5, other agents) can consume it programmatically.

## The 10 design questions

### 1. What inputs are analyzed?

| Source | What is read | Purpose |
|---|---|---|
| ProposalStore | All proposals (optionally filtered by date) | Lifecycle data per proposal |
| EffectivenessStore | All effectiveness reports | Per-proposal keep/revert/investigate verdict |
| EvidenceStore | `adaptation_effectiveness` events | Cross-reference effectiveness assessments |
| EvidenceStore | `adaptation_snapshot_taken` events | Confirm which proposals have snapshots (revertable pool) |
| EvidenceStore | `adaptation_revert_failed` events | Count revert failures per bucket |
| EvidenceStore | `adaptation_proposed/approved/applied/failed` events | Lifecycle timing, approval rate |

The Agent loads all proposals, then for each proposal loads its effectiveness report (if any) and queries evidence events keyed by proposalId.

**Input filtering:**
- `--since <ISO8601>` — only analyze proposals created after this timestamp.
- `--until <ISO8601>` — only analyze proposals created before this timestamp.
- `--min-confidence <n>` — only include proposals where `sourceConfidence >= n`.
- Omitted → analyze all proposals in the store.

### 2. What buckets are used?

| Bucket dimension | Source field | Example values |
|---|---|---|
| `byAction` | `proposal.action` | `create_agent_card`, `update_agent_card`, `add_capability`, `adjust_skill_definition`, `create_improvement_issue`, `suggest_routing_weight`, `revert_proposal` |
| `byTargetKind` | `proposal.target.kind` | `agent_card`, `skill`, `capability`, `issue`, `routing_weight`, `revert` |
| `bySourceRecommendationType` | `proposal.sourceRecommendationType` | `capability_gap`, `agent_card_update`, `routing_adjustment`, `skill_revision`, `effectiveness_revert`, `manual_revert`, `guided_adaptation`, etc. |
| `byProvenance` | `proposal.provenance` | `manual`, `auto` (undefined → `manual`) |
| `byCapability` | `proposal.payload.capability` or `proposal.target.capability` | Any capability string extracted from proposals that carry one |
| `byOutcome` | `proposal.status` + derived revert signal | `applied`, `rejected`, `failed`, `reverted`, `pending`, `approved` |

**Note on `byCapability`**: Not all proposals carry a capability reference. Proposals for `create_improvement_issue` or `routing_weight` typically do; others may not. This bucket will naturally have fewer entries and higher `insufficient_data` rates, especially early on. This is expected.

**Note on `byOutcome`**: This dimension answers "which proposals ended in what terminal state?" It is the first-class outcome analysis bucket — essential for P5.4 prioritization, which will use outcome rates to score proposal types. The `reverted` outcome is derived: a proposal is "reverted" if a `revert_proposal` targeting it was applied (its stored `status` may still be `applied`, but an applied revert makes it reverted-in-effect). `pending` and `approved` are non-terminal but included to surface stuck proposals (long-time pending = bottleneck signal).

### 3. What metrics define success?

Each bucket reports:

| Metric | Definition | Always present? |
|---|---|---|
| `totalProposals` | Count of proposals in this bucket | Yes |
| `keepCount` / `keepRate` | Proposals with effectiveness "keep" / total assessed | Yes (may be 0) |
| `advisoryRevertCount` / `advisoryRevertRate` | Proposals with effectiveness "revert" / total assessed | Yes (may be 0) |
| `investigateCount` / `investigateRate` | Proposals with effectiveness "investigate" / total assessed | Yes (may be 0) |
| `notAssessedCount` / `notAssessedRate` | Proposals without an effectiveness report / total in bucket | Yes |
| `applyFailureCount` / `applyFailureRate` | Proposals with status "failed" / total in bucket | Yes (may be 0) |
| `rejectionCount` / `rejectionRate` | Proposals with status "rejected" / total in bucket | Yes (may be 0) |
| `approvalRate` | Proposals with status "approved" or "applied" / (approved + rejected + pending) | Yes |
| `actualRevertCount` / `actualRevertRate` | Proposals that were actually reverted (a revert_proposal targeting them was applied) / total with snapshots | Yes (may be 0) |
| `medianTimeToApprovalHours` | Median hours from `createdAt` to `approvedAt` (approved proposals only) | No — absent if no approved proposals in bucket |
| `medianTimeToApplyHours` | Median hours from `approvedAt` to `appliedAt` (applied proposals only) | No — absent if no applied proposals in bucket |
| `meanSourceConfidence` | Mean of `proposal.sourceConfidence` across all proposals in bucket | Yes |
| `revertGap` | Advisory revert count — actual revert count (positive means unaddressed reverts) | Yes |
| `revertPrecision` | Actual reverts where effectiveness also said revert / total actual reverts (if any) | No — absent if no actual reverts |

**Success heuristic**: A bucket is "healthy" when `keepRate` is high, `advisoryRevertRate` is low, `applyFailureRate` is low, and `revertPrecision` is high (when humans revert, they're reverting what the model said was bad).

### 4. What counts as insufficient data?

A bucket is marked `insufficientData: true` when `totalProposals < MINIMUM_BUCKET_SIZE`.

Default `MINIMUM_BUCKET_SIZE = 5`. Configurable via `--min-bucket-size <n>` CLI flag.

Rationale: Below 5 proposals, per-bucket statistics are dominated by individual variance and may be misleading. The first many runs on a fresh ALiX instance will produce mostly `insufficient_data` buckets — this is valid output and tells the operator "not enough adaptations in this category yet to draw conclusions."

The `insufficientData` flag is per-bucket, not per-dimension. A dimension like `byAction` may have:
- `update_agent_card`: 12 proposals — sufficient data ✅
- `create_agent_card`: 3 proposals — insufficient data ⚠️
- `revert_proposal`: 1 proposal — insufficient data ⚠️

### 5. How are reverted proposals treated?

Reverted proposals have special handling in three ways:

**a) They are flagged in the EnrichedProposal.**
Each enriched proposal carries `wasReverted: boolean` (true if a `revert_proposal` targeting this proposal was applied) and `revertProposalId: string | null`.

**b) They are included in the primary bucket analysis.**
A reverted proposal still counts toward the bucket's `totalProposals`. Its effectiveness assessment (if any) still counts toward keep/revert/investigate rates. This is intentional: a proposal that was applied and then reverted still contributed to the system's experience and should be counted.

**c) A dedicated "revert signal" section in the report.**
Beyond per-bucket revert metrics, the report includes a top-level `revertSignalAnalysis` section:
```ts
revertSignalAnalysis: {
  totalAdvisoryReverts: number;    // proposals where effectiveness said "revert"
  totalActualReverts: number;      // proposals actually reverted
  totalUnactedReverts: number;     // advisory revert but no actual revert
  revertPrecision: number | null;  // actualReverts where effectiveness also said revert / actualReverts
  topUnactedRevertBuckets: Array<{ dimension: string; value: string; count: number }>;
    // which buckets have the most unacted reverts?
}
```

**d) Effectiveness reports on reverted proposals are preserved.**
If a proposal was assessed as "keep" by effectiveness but the human later reverted it, that is interesting signal. The report surfaces these as `humansOverruledCount`: proposals where effectiveness recommendation and human action (revert) diverged.

### 6. What report shape is produced?

```ts
interface IntelligenceReport {
  /** When this report was generated. */
  generatedAt: string;  // ISO 8601
  /** Total proposals considered (before bucketing). */
  totalProposalsAnalyzed: number;
  /** Date range of proposals analyzed. */
  dataWindow: {
    oldestProposalCreatedAt: string;
    newestProposalCreatedAt: string;
    oldestEffectivenessAssessedAt: string | null;
  };
  /** Summary — first thing a human reads. */
  executiveSummary: string;  // natural language, 3-5 sentences
  /** Per-dimension bucket sets. */
  buckets: {
    byAction: BucketSet;
    byTargetKind: BucketSet;
    bySourceRecommendationType: BucketSet;
    byProvenance: BucketSet;
    byCapability: BucketSet;
    byOutcome: BucketSet;
  };
  /** Confidence calibration — maps sourceConfidence ranges to outcome rates. */
  confidenceCalibration: ConfidenceCalibration;
  /** Revert signal analysis (top-level, not per-bucket). */
  revertSignalAnalysis: RevertSignalAnalysis;
  /** Buckets with the highest keep rate (for quick reference). */
  topPerforming: Array<{ dimension: string; value: string; keepRate: number; total: number }>;
  /** Buckets with the lowest keep rate (for quick reference). */
  lowestPerforming: Array<{ dimension: string; value: string; keepRate: number; total: number }>;
}

interface BucketSet {
  dimension: string;
  buckets: BucketStat[];
  totalInDimension: number;
  insufficientDataCount: number;  // how many buckets fell below MINIMUM_BUCKET_SIZE
}

interface BucketStat {
  value: string;                  // the bucket value (e.g. "update_agent_card")
  totalProposals: number;
  insufficientData: boolean;      // true when totalProposals < MINIMUM_BUCKET_SIZE
  // Metrics (only populated when insufficientData is false, for clarity)
  keepCount?: number;
  keepRate?: number;              // 0-1
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
  humansOverruledCount?: number;  // proposals effectiveness said keep but human reverted
}

interface RevertSignalAnalysis {
  totalAdvisoryReverts: number;
  totalActualReverts: number;
  totalUnactedReverts: number;
  revertPrecision: number | null;
  topUnactedRevertBuckets: Array<{ dimension: string; value: string; count: number }>;
  humansOverruledCount: number;
}

interface ConfidenceCalibration {
  /** Confidence buckets of width 0.1 from 0.0 to 1.0. */
  buckets: ConfidenceBucket[];
  /** Total proposals used in calibration (must match total assessed). */
  totalAssessed: number;
  /** Raw Spearman correlation between confidence and keep rate, if computable. */
  confidenceOutcomeCorrelation: number | null;
}

interface ConfidenceBucket {
  /** Range label e.g. "0.9-1.0", "0.8-0.9". */
  range: string;
  /** Lower bound (inclusive). */
  rangeLow: number;
  /** Upper bound (exclusive for all except 1.0 is inclusive). */
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
```

### 7. What CLI command exposes it?

```
alix adaptation intelligence
alix adaptation intelligence --since 2026-01-01
alix adaptation intelligence --until 2026-06-01
alix adaptation intelligence --since 2026-03-01 --until 2026-06-01
alix adaptation intelligence --min-bucket-size 3
alix adaptation intelligence --json
```

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--since` | ISO 8601 or date | All | Analyze proposals created after this date |
| `--until` | ISO 8601 or date | All | Analyze proposals created before this date |
| `--min-bucket-size` | number | 5 | Minimum proposals for a bucket to have sufficient data |
| `--json` | boolean | false | Output raw IntelligenceReport as JSON instead of formatted table |
| `--min-confidence` | number | 0 | Only analyze proposals with sourceConfidence >= this value |

**Default output (terminal):**
The human-readable output shows:
1. **Executive summary** — 3-5 sentence natural language finding.
2. **Per-dimension tables** — one section per bucket dimension.
3. **Revert signal analysis** — dedicated section.
4. **Top / lowest performing buckets** — quick reference.

Each table shows: `Bucket | Total | Keep | Revert (advised) | Reverted (actual) | Failed | Approval Rate | Median TTA (hrs)`. Insufficient-data buckets are shown with a `⚠️` marker and `—` for metric columns.

**Auto-save:**
The report is automatically saved to `.alix/adaptation/intelligence/<generatedAt-iso>.json` (ISO timestamp safe for filenames, with `:` replaced by `-`). The `generatedAt` field in the report serves as the filename key. This enables future comparison of Report N vs Report N-1.

**JSON output (`--json`):**
Dumps the full IntelligenceReport as JSON to stdout for programmatic consumption by editors, agents, or future P5.4+ components. Note: the report is already auto-saved to the intelligence directory; `--json` is for piping to external tools.

### 8. What evidence is recorded?

**Zero new evidence types.** P5.3 records no evidence events. However, the IntelligenceReport is **persisted as a JSON file** under `.alix/adaptation/intelligence/` for historical comparison.

```
.alix/adaptation/intelligence/
 ├─ 2026-06-19T23-30-00.json
 ├─ 2026-06-20T10-00-00.json
 └─ ...
```

This is NOT evidence — it is a persisted analysis artifact. The distinction matters:
- Evidence (in EvidenceStore) is an append-only, fingerprint-verified chain of events.
- IntelligenceReports are standalone JSON files that can be compared over time.

**Why persist?** P5.4 and P5.5 will need trend analysis — comparing Report N vs Report N-1 to answer questions like "are agent-card changes improving over time?" Ephemeral reports make this impossible. Persisted reports at known paths enable future diff-and-compare logic without coupling to the evidence chain.

**Why not evidence events?** Adding an "intelligence report generated" evidence event would pollute the evidence chain with analysis noise. Reports are analysis artifacts, not system events. The evidence chain preserves what happened; the intelligence directory preserves what was learned from it.

However, the IntelligenceReport *reads* from the existing evidence stores extensively — see Q1. This means the quality of the report depends on the richness of existing evidence.

### 9. What recommendations may it produce?

P5.3 produces **findings**, not recommendations. A finding is a statement like:

- "Agent-card changes have an 82% keep rate — this adaptation strategy is effective."
- "Skill-definition changes have a 63% keep rate — this adaptation strategy has room for improvement."
- "Capability-gap proposals have a 91% keep rate — this is the most reliable adaptation strategy."
- "Routing proposals have insufficient data (3 proposals) — collect more before drawing conclusions."
- "5 proposals had effectiveness 'revert' but no revert proposal was created — these may need human attention."
- "Proposals with provenance 'auto' have a lower approval rate than 'manual' (45% vs 72%) — auto-generated proposals may need better filtering or higher confidence thresholds."

These findings are embedded in the `executiveSummary` text and can be derived from the structured `BucketStat` data. There is no formal "recommendation" type in P5.3.

**Explicitly: P5.3 does NOT generate AdaptationProposals.** Adding "generate proposals from intelligence findings" would be P5.4 or later. The governance boundary is: learn patterns, do not mutate.

### 10. What is explicitly out of scope?

| Feature | Rationale |
|---|---|
| Auto-generating proposals from intelligence findings | Belongs in P5.4 (Proposal Prioritization) or later. P5.3 is read-only. |
| Persisting IntelligenceReport as evidence | Reports are persisted as JSON files under `.alix/adaptation/intelligence/` (not evidence events). |
| Real-time / live dashboard | P5.3 is point-in-time snapshot analysis. A future observability layer could offer dashboards. |
| Cross-instance or cross-system learning | P5.3 analyzes one ALiX instance. Federated learning is far future. |
| Modifying bucket thresholds based on history | Thresholds are static (`MINIMUM_BUCKET_SIZE`). Adaptive thresholds belong in a later phase. |
| Agent-level recommendations ("assign this proposal type to agent X") | That is capability routing, not intelligence. P4.7 handles routing. |
| Confidence intervals or statistical significance | Could be added later. P5.3 uses simple descriptive statistics. |
| Historical trend over time (delta between two intelligence reports) | A future phase could compare snapshots. P5.3 is one point in time. |
| Proposal ranking or prioritization | P5.4 territory — "given limited human attention, which proposals should be approved first?" |

## File structure (reference — for implementation plan)

| File | Role | Action |
|---|---|---|
| `src/adaptation/intelligence-types.ts` | IntelligenceReport, BucketStat, BucketSet, RevertSignalAnalysis, EnrichedProposal types | **Create** |
| `src/adaptation/proposal-lifecycle-analyzer.ts` | Load + enrich proposals with lifecycle metadata | **Create** |
| `src/adaptation/effectiveness-trend-analyzer.ts` | Compute per-bucket success metrics | **Create** |
| `src/adaptation/revert-signal-analyzer.ts` | Compare advisory revert vs actual revert | **Create** |
| `src/adaptation/confidence-calibration-analyzer.ts` | Map sourceConfidence ranges to outcome rates | **Create** |
| `src/adaptation/bucket-aggregator.ts` | Group proposals by each dimension, compute per-bucket stats | **Create** |
| `src/adaptation/intelligence-reporter.ts` | Orchestrate analyzers, assemble IntelligenceReport, generate executive summary, persist to disk | **Create** |
| `src/adaptation/intelligence-store.ts` | Save/load/list IntelligenceReport files under `.alix/adaptation/intelligence/` | **Create** |
| `src/cli/commands/adaptation.ts` | Add `intelligence` subcommand | **Modify** |
| Tests | Per component + CLI integration | **Create** |

## Expected first-run behavior

On a fresh ALiX instance with few proposals, the first `alix adaptation intelligence` run will produce a report like:

```
=== ALiX Adaptation Intelligence Report ===
Generated: 2026-06-19T23:30:00.000Z
Proposals analyzed: 7
Data window: 2026-06-18T10:00:00Z — 2026-06-19T23:30:00Z

Executive Summary:
Only 7 proposals have been completed so far. Most buckets have insufficient data
to draw reliable conclusions (minimum: 5 proposals per bucket). The system is in
its early adaptation phase. Continue accumulating proposals; actionable patterns
will emerge as the dataset grows. No buckets currently meet the threshold for
reliable trend analysis.

--- byAction ---
⚠️  create_agent_card       3 proposals — insufficient data
⚠️  update_agent_card       4 proposals — insufficient data
All other buckets: 0 proposals.

--- byTargetKind ---
⚠️  agent_card              7 proposals — insufficient data
All other buckets: 0 proposals.

...

Revert Signal Analysis:
No effectiveness assessments found. No revert proposals found.
Collect more adaptation data before analysing revert patterns.
```

This is valid and useful output. It tells the operator:
1. The system is early in its lifecycle.
2. No meaningful patterns can be extracted yet.
3. Continue operating normally; patterns will emerge.

As the proposal count grows, buckets will cross the `MINIMUM_BUCKET_SIZE` threshold and begin reporting actionable metrics. The first bucket to cross the threshold will likely be `byAction: update_agent_card` or `byTargetKind: agent_card`, since those are the most common adaptation actions.

## Interaction with existing P5 phases

| Phase | Relationship |
|---|---|
| P5.0 Reflection | IntelligenceReport uses reflection data indirectly via effectiveness reports (which use ReflectionMetrics) |
| P5.1 Guided Adaptation | Proposals from P5.1 are the primary data source for byProvenance = "manual" |
| P5.2b Effectiveness | Effectiveness reports are the primary input for keep/revert/investigate rates |
| P5.2c Auto-Generation | Proposals from P5.2c are the primary data source for byProvenance = "auto" |
| P5.2d Batch Approval | Time-to-approval metrics reflect batch approval efficiency |
| P5.2e Executable Revert | RevertSignalAnalyzer depends on revert_proposal lifecycle data from P5.2e |

## Future extensions (explicitly deferred)

- **P5.4 Proposal Prioritization** — Use intelligence report to rank proposal types by expected value.
- **P5.5 Agent Generation** — Use intelligence to suggest new agent cards for high-success adaptation strategies.
- **Comparative intelligence** — Diff two IntelligenceReports to show trends over time (e.g. "keep rate for skill changes improved from 60% to 75%").
- **Recommendation-to-proposal confidence calibration** — Adjust `minConfidence` in AutomaticProposalGenerator based on historical keep rates per recommendation type.
