# P5.4 — Proposal Prioritization Design Spec (SDS)

> **Status:** Draft — awaiting review.
> **Plan:** `docs/superpowers/plans/2026-06-19-p5-4-proposal-prioritization.md` (to be written after SDS approval)
> **Risk level:** LOW — pure read + compute + save report. No mutations, no state changes, no applier modifications.

## Core question

> Given 100 pending proposals and limited human attention, which proposals should be reviewed first?

P5.3 answers "what kinds of changes work?" — strategic memory.
P5.4 answers "what should I look at right now?" — decision influence.

This is the bridge between learning and action. Still human-gated. Still advisory. But now intelligence directs attention.

## Hard governance boundary (non-negotiable)

```
Prioritize ≠ Approve
Prioritize ≠ Apply
Prioritize ≠ Reject
Prioritize ≠ Generate

P5.4 may reorder.
P5.4 may never mutate.

A priority score is a suggestion.
Only a human may approve, reject, or apply.
```

## Summary of design decisions

| Decision | Choice |
|---|---|
| Scope | Only proposals with `status = "pending"` |
| Input signals | Source confidence, historical keep rate, historical revert rate, action type, target kind, recommendation type, human approval history, age |
| Scoring model | Deterministic weighted formula — fully explainable, fully testable |
| Output | `ProposalPriorityReport` — ranked list with per-proposal scores and rationale |
| Explainability | Mandatory — every score decomposes into its component signals |
| Data-insufficient handling | `confidence: LOW` marker + reason — never fabricate confidence |
| Persistence | Saved to `.alix/adaptation/priorities/<generatedAt>.json` |
| Intelligence dependency | Graceful — scores with confidence+LOW and age-only when no IntelligenceReport exists |
| Mutation | Zero. Reads from ProposalStore + IntelligenceStore. Never writes proposals. |

## Architecture

```
IntelligenceStore ──┐  (historical keep rates — optional, degrades gracefully)
ProposalStore ──────┤  (pending proposals to prioritize)
                    │
                    ├── ProposalScorer
                    │     For each pending proposal:
                    │       1. Determine its bucket dimensions (action, targetKind, sourceType)
                    │       2. Look up historical metrics from IntelligenceReport
                    │       3. Compute component scores
                    │       4. Combine into priority score
                    │       5. Attach explainability rationale
                    │
                    ├── PriorityReportAssembler
                    │     Sort proposals by score descending
                    │     Generate executive summary
                    │     Assemble ProposalPriorityReport
                    │
                    ├── PriorityStore
                    │     Persist report to .alix/adaptation/priorities/
                    │
                    └── CLI: alix adaptation prioritize
                          Output ranked table or --json
```

### Component responsibilities

**ProposalScorer**
- Loads the latest IntelligenceReport from IntelligenceStore (null if none exists).
  - Without an IntelligenceReport: scores proposals based on sourceConfidence + age only, confidence: "LOW", rationale explains "No historical data yet. Run `alix adaptation intelligence` to enable data-driven scoring."
- For each pending proposal from ProposalStore:
  1. Determine its bucket dimensions: `proposal.action` → byAction bucket, `proposal.target.kind` → byTargetKind bucket, `proposal.sourceRecommendationType` → bySourceRecommendationType bucket, `proposal.provenance ?? "manual"` → byProvenance bucket.
  2. For each dimension, look up the matching `BucketStat` from the IntelligenceReport.
  3. If the bucket has sufficient data, extract: `keepRate`, `advisoryRevertRate`, `actualRevertRate`, `approvalRate`.
  4. If the bucket has insufficient data, note that confidence is low.
  5. Compute component scores (see Q5).
  6. Compute final priority score (0-1).
  7. Attach rationale: "Score 0.91 — Capability-gap proposals historically succeed 89%. Confidence 0.93. Low revert rate. Aged 3 days."
- Returns `ScoredProposal[]`.

**PriorityReportAssembler**
- Receives `ScoredProposal[]` from ProposalScorer.
- Sorts by score descending.
- Computes score distribution (how many proposals in each decile).
- Generates executive summary: "42 pending proposals ranked. Top 5 have scores > 0.85. 12 proposals have insufficient data for reliable scoring."
- Assembles `ProposalPriorityReport`.

**PriorityStore**
- Directory: `.alix/adaptation/priorities/`.
- Filename: `<generatedAt-iso-with-colons-replaced>.json`.
- Methods: `save(report)`, `load(filename)`, `list()`, `loadLatest()`.
- Mirrors `IntelligenceStore` pattern.

**CLI: `alix adaptation prioritize [--top <n>] [--min-score <n>] [--json]`**
- Outputs ranked table or JSON.

## The 10 design questions

### 1. What is being prioritized?

**Only** proposals with `status = "pending"`.

- Never approved, applied, rejected, or failed proposals.
- The point is to guide human attention toward the most promising pending proposals first.
- Proposals without an effectiveness history for their bucket dimensions still get scored (with lower confidence).

### 2. What signals contribute to priority?

| Signal | Source | Type | Description |
|---|---|---|---|
| Source confidence | `proposal.sourceConfidence` | number 0-1 | How confident the reflection/generator was |
| Historical keep rate | P5.3 `BucketStat.keepRate` | number 0-1 or null | How often proposals like this one were kept |
| Historical revert rate | P5.3 `BucketStat.advisoryRevertRate` | number 0-1 or null | How often proposals like this were advised for revert |
| Actual revert rate | P5.3 `BucketStat.actualRevertRate` | number 0-1 or null | How often proposals like this were actually reverted |
| Historical approval rate | P5.3 `BucketStat.approvalRate` | number 0-1 or null | How often proposals like this were approved |
| Proposal action | `proposal.action` | categorical | Bucket key for historical lookup |
| Target kind | `proposal.target.kind` | categorical | Bucket key for historical lookup |
| Recommendation type | `proposal.sourceRecommendationType` | categorical | Bucket key for historical lookup |
| Provenance | `proposal.provenance` | "auto" \| "manual" | Bucket key for historical lookup |
| Age | `proposal.createdAt` | ISO timestamp | How long the proposal has been waiting |


**Note on byProposalOrigin:** A future iteration should add `byProposalOrigin` as a bucket dimension with values like `"reflection"`, `"effectiveness"`, `"manual_revert"`, `"guided_adaptation"`. This would distinguish proposals generated by different paths and enable P5.5 calibration. Tracked for future addition — not implemented in P5.4.
### 3. What output is produced?

```ts
interface ProposalPriorityReport {
  generatedAt: string;
  /** IntelligenceReport used as the data source (null if none exists). */
  intelligenceReportDate: string | null;
  /** Scoring formula version (e.g. "v1"). Increment when weights change for historical calibration. */
  scoringVersion: string;
  /** Total pending proposals considered. */
  totalPending: number;
  /** Proposals that could be scored (had at least some signal). */
  totalScored: number;
  /** Proposals with insufficient historical data. */
  totalLowConfidence: number;
  /** Score distribution across deciles. */
  scoreDistribution: Array<{ decile: string; count: number }>;
  /** Executive summary — natural language (3-5 sentences). */
  executiveSummary: string;
  /** Ranked proposals, highest score first. */
  ranked: ScoredProposal[];
}

interface ScoredProposal {
  proposalId: string;
  /** Overall priority score 0-1. */
  priorityScore: number;
  /** One of HIGH, MEDIUM, LOW based on data sufficiency. */
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** Component breakdown — for explainability. */
  components: {
    confidenceWeight: number;       // proposal.sourceConfidence
    historicalSuccessWeight: number; // keepRate from matching bucket (0 if insufficient data)
    approvalWeight: number;         // approvalRate from matching bucket (0 if insufficient data)
    revertPenalty: number;          // 1 - blendedRevertRate max(advisory, actual) (0 if insufficient data)
    ageMultiplier: number;         // 1.00 <7d, 1.05 7-30d, 1.10 30-90d, 1.15 >90d
  };
  /** Human-readable explanation of the score. */
  rationale: string;
  /** The proposal itself (for display). */
  proposal: AdaptationProposal;
}
```

### 4. What is the governance boundary?

```
Prioritize ≠ Approve
Prioritize ≠ Apply
Prioritize ≠ Reject
Prioritize ≠ Generate

P5.4 may reorder proposal review order.
P5.4 may never mutate proposal state.
P5.4 may never create proposals.
P5.4 may never write evidence events.
```

A PriorityReport is a suggestion. The human still runs `alix adaptation approve` and `apply` manually. The only difference is *which* proposal they see first.

This is the same boundary as P5.3 — read + compute + save report. No mutation.

### 5. How is scoring calculated?

Deterministic weighted formula — no ML, no heuristics, no hidden parameters.

```
PriorityScore = 
  (W_conf × C_conf) +
  (W_succ × C_succ) +
  (W_app × C_app) +
  (W_revert × C_revert) +
  (W_age × C_age)
```

Where:

| Component | Symbol | Default Weight | Computation |
|---|---|---|---|
| Confidence weight | W_conf | 0.30 | `proposal.sourceConfidence` (raw, 0-1) |
| Historical success | W_succ | 0.30 | Matching bucket's `keepRate` (or 0 if insufficient data) |
| Approval rate | W_app | 0.15 | Matching bucket's `approvalRate` (or 0 if insufficient data) |
| Revert penalty | W_revert | 0.15 | `1 - max(advisoryRevertRate, actualRevertRate)` (blended advisory+actual; 0.5 if insufficient data) |
| Age multiplier | W_age | (post-multiplier) | `anti-starvation multiplier applied after base score` (see below) |

All component values normalized to 0-1 range. Final score clamped to 0-1.

**Example calculation:**

```
Proposal: add ability to route by priority
sourceConfidence: 0.93
createdAt: 3 days ago
Matching byAction bucket "add_capability": keepRate=0.89, approvalRate=0.91, actualRevertRate=0.05

C_conf = 0.93 × 0.30 = 0.279
C_succ = 0.89 × 0.30 = 0.267
C_app  = 0.91 × 0.15 = 0.137
C_rev  = (1 - 0.05) × 0.15 = 0.143
C_age  = min(3/30, 1) × 0.05 = 0.005

Score = 0.279 + 0.267 + 0.137 + 0.143 + 0.005 = 0.831
```

**Explainability output:**
```
Proposal 123 — Score: 0.83
  • Source confidence 0.93 (weight: 0.28)
  • Capability-gap proposals historically succeed 89% (weight: 0.27)
  • Approval rate for this type: 91% (weight: 0.14)
  • Actual revert rate: 5% — low risk (weight: 0.14)
  • Pending 3 days (weight: 0.01)
```

**When all buckets have insufficient data:**
All historical components default to 0 or neutral. Score is driven by `sourceConfidence` and `age` only. The proposal is flagged as `confidence: "LOW"`.

### 6. What happens with insufficient data?

P5.3 already introduced `insufficientData` on `BucketStat`. P5.4 respects it:

- If **all** matching buckets have insufficient data → `confidence: "LOW"`, score is based on confidence + age only.
- If **some** matching buckets have sufficient data → `confidence: "MEDIUM"`, those dimensional signals are used; insufficient-data dimensions are skipped.
- If **all** matching buckets have sufficient data → `confidence: "HIGH"`, full scoring.

A proposal with `confidence: "LOW"` still appears in the ranked list. Its rationale explains why:
```
Score confidence: LOW.
Only 2 historical examples of "adjust_skill_definition" exist.
Score based on source confidence (0.85) and age (7 days pending).
```

Do not fabricate confidence. Insufficient data is honest, actionable information for the human (they may still choose to review lower-confidence proposals).

### 7. What persistence exists?

Reports saved to `.alix/adaptation/priorities/<generatedAt-iso>.json`.

```
.alix/adaptation/priorities/
 ├─ 2026-06-19T23-30-00.json
 ├─ 2026-06-20T10-00-00.json
 └─ ...
```

**Why persist?**
- Enables diffing priority distributions over time (are high-score proposals being approved?).
- Enables calibration analysis in later phases (did our scoring weights predict actual outcomes?).
- Mirrors the P5.3 IntelligenceStore pattern exactly: `PriorityStore` with `save`, `load`, `list`, `loadLatest`.

**No evidence events.** Same rationale as P5.3 — analysis artifacts live in their own directory, not in the evidence chain.

### 8. What evidence is recorded?

**Zero.** P5.4 is read + compute + save report. The only write path is the PriorityStore to `.alix/adaptation/priorities/`.

### 9. What CLI command exposes it?

```
alix adaptation prioritize
alix adaptation prioritize --top 10
alix adaptation prioritize --min-score 0.7
alix adaptation prioritize --json
alix adaptation prioritize --top 5 --json
```

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--top <n>` | number | All | Show only the top N scored proposals |
| `--min-score <n>` | number | 0 | Only show proposals with score >= this value |
| `--json` | boolean | false | Output raw ProposalPriorityReport as JSON |

**Default output (terminal):**

```
=== Proposal Priority Report ===
Generated: 2026-06-19T23:30:00.000Z
Intelligence data from: 2026-06-19T22:00:00.000Z
Pending proposals: 42 | Scored: 38 | Low confidence: 4

Executive Summary:
42 pending proposals. Top 5 have scores ≥ 0.85.
Capability-gap proposals dominate high scores (89% historical success).
4 proposals have insufficient data — review manually if time permits.

Rank  Score  Conf  ID           Action               Target      Age  Rationale
1     0.91   HIGH  prop-042     add_capability       capability  2d   Capability-gap success 89%, conf 0.93
2     0.83   HIGH  prop-038     update_agent_card    agent_card  3d   Agent-card keep rate 82%, conf 0.88
3     0.79   MED   prop-051     adjust_skill_def     skill       5d   Skill success 63%, conf 0.81
...
42    0.35   LOW   prop-017     create_improvement   issue       1d   Insufficient data — only 2 examples
```

**JSON output (`--json`):**
Full ProposalPriorityReport as JSON for programmatic consumption.

### 10. What is explicitly out of scope?

| Feature | Rationale |
|---|---|
| Auto-approve top N proposals | P5.4 may prioritize. Only humans approve. |
| Auto-reject low-scoring proposals | The human may have context the score lacks. |
| Auto-apply proposals | Apply always requires explicit human approval + apply. |
| Dynamic weight tuning from outcomes | Belongs in a later phase after calibration data exists. |
| ML-based scoring | Deterministic formula is testable, explainable, auditable. |
| Priority bucketing (P1/P2/P3) | Flat ranking is simpler and more transparent. |
| Cross-instance priority comparison | Single-instance analysis only. |
| Proposal score decay over time | Age bonus already handles recency. Full decay is future. |
| Re-prioritization notification | Run the CLI when you want an updated ranking. |
| Persisting priority as proposal metadata | Would mutate proposal state — governance violation. |

## Expected first-run behavior

On a fresh ALiX instance with no IntelligenceReport:

```
$ alix adaptation prioritize
=== Proposal Priority Report ===
Generated: 2026-06-19T23:30:00.000Z
Intelligence data from: No intelligence report found.

Error: No IntelligenceReport found. Run `alix adaptation intelligence` first.
The prioritization engine requires historical data from P5.3.
```

If intelligence reports exist but its bucket data is sparse:

```
$ alix adaptation prioritize
=== Proposal Priority Report ===
Pending proposals: 12 | Scored: 12 | Low confidence: 10

Executive Summary:
12 pending proposals. Only 2 have sufficient historical data for reliable scoring.
Most proposals fall into bucket categories with fewer than 5 historical examples.
Continue accumulating adaptations; scoring confidence will improve over time.

Rank  Score  Conf  ID           Action               Target      Age  Rationale
1     0.72   HIGH  prop-008     update_agent_card    agent_card  4d   Agent-card success 83%, conf 0.90
2     0.65   LOW   prop-012     add_capability       capability  2d   Only 3 examples — score based on conf 0.85 + age
...
```

Both outputs are valid. P5.4 does not require sufficient data to run — it scores what it can and honestly reports confidence.

## File structure

| File | Role | Action |
|---|---|---|
| `src/adaptation/priority-types.ts` | ProposalPriorityReport, ScoredProposal interfaces | **Create** |
| `src/adaptation/priority-store.ts` | Save/load/list priority reports | **Create** |
| `src/adaptation/proposal-scorer.ts` | Score pending proposals using intelligence data | **Create** |
| `src/adaptation/priority-reporter.ts` | Orchestrate scoring, assemble report, persist | **Create** |
| `src/cli/commands/adaptation.ts` | Add `prioritize` subcommand | **Modify** |
| Tests | Per component + CLI integration | **Create** |

## Interaction with existing P5 phases

| Phase | Relationship |
|---|---|
| P5.3 Intelligence | `IntelligenceReport` is the primary data source for historical keep/revert/approval rates |
| P5.1 Adaptation | Pending proposals from P5.1 are the inputs being scored |
| P5.2c Auto-Generation | Auto-generated proposals are scored alongside manual ones (byProvenance bucketing distinguishes them) |
| P5.2d Batch Approval | Priority ranking tells the human which batch to approve first |
| P5.2e Executable Revert | Revert rates from P5.2e feed the revert penalty component |
