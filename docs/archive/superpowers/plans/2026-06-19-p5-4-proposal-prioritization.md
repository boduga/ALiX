# P5.4 — Proposal Prioritization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
> **Plan home:** `docs/superpowers/plans/2026-06-19-p5-4-proposal-prioritization.md`
> **SDS:** `docs/superpowers/specs/2026-06-19-p5-4-proposal-prioritization-design.md`

**Goal:** Prioritize pending proposals using historical intelligence — score each pending proposal by combining source confidence, historical keep/revert rates, approval rates, and age. Produce a ranked list with explainable scores.

**Risk:** LOW — pure read + compute + save report. No mutations, no state changes, no applier modifications.

## Global Constraints

- **P5.4 prioritizes. P5.4 does not mutate.** No proposals created, no approvals, no evidence writes. Read from ProposalStore + IntelligenceStore, write only the PriorityReport to `.alix/adaptation/priorities/`.
- **Only pending proposals.** `status === "pending"` only. Never process approved/applied/rejected/failed proposals.
- **Graceful degradation.** Without an IntelligenceReport, score based on sourceConfidence + age only with `confidence: "LOW"` — never error.
- **Deterministic scoring.** Weighted formula, fully explainable, fully testable. No ML.
- **Anti-starvation.** Age multiplier (1.00, 1.05, 1.10, 1.15 by band) prevents proposals from starving in the queue.
- **Scoring version.** `scoringVersion: "v1"` stamped in every report for future calibration.
- **Run `gitnexus_impact` before editing any indexed symbol** — especially `proposal-store.ts` and `adaptation.ts`.
- **Do not touch** the 5 pre-existing uncommitted files (`AGENTS.md`, `CLAUDE.md`, `planning-agent.ts`, 2 test files).

## Scoring formula

```
BaseScore = (0.30 × sourceConfidence)
          + (0.30 × bucket.keepRate)
          + (0.15 × bucket.approvalRate)
          + (0.15 × (1 - max(bucket.advisoryRevertRate, bucket.actualRevertRate)))

AgeMultiplier = 1.00  (age < 7d)
             = 1.05  (7d ≤ age < 30d)
             = 1.10  (30d ≤ age < 90d)
             = 1.15  (age ≥ 90d)

FinalScore = min(BaseScore × AgeMultiplier, 1.0)
```

## File Structure

| File | Role | Action |
|---|---|---|
| `src/adaptation/priority-types.ts` | ProposalPriorityReport, ScoredProposal, PriorityScoringConfig interfaces | **Create** |
| `src/adaptation/priority-store.ts` | save/load/list/loadLatest under `.alix/adaptation/priorities/` | **Create** |
| `src/adaptation/proposal-scorer.ts` | Score pending proposals using IntelligenceReport + deterministic formula | **Create** |
| `src/adaptation/priority-reporter.ts` | Orchestrate scoring, assemble report, persist | **Create** |
| `src/cli/commands/adaptation.ts` | Add `prioritize` subcommand | **Modify** |
| Tests | Per component + CLI integration | **Create** |

## Task 1: Priority types + store

**Files:**
- Create: `src/adaptation/priority-types.ts`
- Create: `src/adaptation/priority-store.ts`
- Test: `tests/adaptation/priority-store.vitest.ts`

**Types (priority-types.ts):**
```ts
export interface ScoredProposalComponents {
  confidenceWeight: number;
  historicalSuccessWeight: number;
  approvalWeight: number;
  revertPenalty: number;
  ageMultiplier: number;
}

export interface ScoredProposal {
  proposalId: string;
  priorityScore: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  components: ScoredProposalComponents;
  rationale: string;
  proposal: AdaptationProposal;
}

export interface ProposalPriorityReport {
  generatedAt: string;
  scoringVersion: string;
  intelligenceReportDate: string | null;
  totalPending: number;
  totalScored: number;
  totalLowConfidence: number;
  scoreDistribution: Array<{ decile: string; count: number }>;
  executiveSummary: string;
  ranked: ScoredProposal[];
}
```

**PriorityStore (priority-store.ts)** — identical pattern to IntelligenceStore:
- `save(report)`, `load(filename)`, `list()`, `loadLatest()`
- Directory: `.alix/adaptation/priorities/`
- Filename: `<generatedAt-iso-with-colons-replaced>.json`

**Test:** save round-trips, load returns null for missing, list sorts newest-first, loadLatest returns most recent.

## Task 2: ProposalScorer

**Files:**
- Create: `src/adaptation/proposal-scorer.ts`
- Test: `tests/adaptation/proposal-scorer.vitest.ts`

**Class:**
```ts
class ProposalScorer {
  constructor(
    private readonly proposalStore: ProposalStore,
    private readonly intelligenceStore: IntelligenceStore,
  ) {}

  async scoreProposals(opts?: { top?: number; minScore?: number }): Promise<ProposalPriorityReport>
}
```

**Behavior:**
1. Load all pending proposals from ProposalStore.
2. Attempt to load latest IntelligenceReport from IntelligenceStore.
3. For each pending proposal:
   a. Determine bucket dimensions: `proposal.action`, `proposal.target.kind`, `proposal.sourceRecommendationType`, `proposal.provenance ?? "manual"`.
   b. If IntelligenceReport exists, look up matching BucketStat from each dimension. Extract `keepRate`, `advisoryRevertRate`, `actualRevertRate`, `approvalRate`.
   c. Compute confidence tier:
      - If multiple buckets with sufficient data → `"HIGH"`
      - If at least one bucket with sufficient data → `"MEDIUM"`
      - If no buckets with sufficient data (or no IntelligenceReport) → `"LOW"`
   d. Compute components:
      - `confidenceWeight`: `proposal.sourceConfidence`
      - `historicalSuccessWeight`: best available `keepRate` (0 if insufficient data or no report)
      - `approvalWeight`: best available `approvalRate` (0 if insufficient data or no report)
      - `revertPenalty`: `1 - max(advisoryRevertRate, actualRevertRate)` of best available bucket (0.5 if insufficient data or no report)
      - `ageMultiplier`: based on days since createdAt (1.00/1.05/1.10/1.15)
   e. Compute `baseScore = Σ(weight × value)`
   f. Compute `priorityScore = min(baseScore × ageMultiplier, 1.0)`
   g. Generate rationale string: e.g. "Confidence 0.93. Capability-gap proposals succeed 89%. Low revert risk. Pending 3 days."
4. Sort by priorityScore descending.
5. Assemble ProposalPriorityReport.
6. Save via PriorityStore.

**Test:** score pending proposals with: full IntelligenceReport (HIGH confidence), partial data (MEDIUM), no IntelligenceReport (LOW — graceful), single proposal, empty pending, age multiplier kicks in for old proposals, top/minScore filtering.

## Task 3: priority-reporter.ts

**Files:**
- Create: `src/adaptation/priority-reporter.ts`
- Test: `tests/adaptation/priority-reporter.vitest.ts`

**Class:**
```ts
class PriorityReporter {
  constructor(
    private readonly scorer: ProposalScorer,
    private readonly priorityStore: PriorityStore,
  ) {}

  async generateReport(opts?: { top?: number; minScore?: number }): Promise<ProposalPriorityReport>
}
```

**Behavior:**
1. Delegates to `scorer.scoreProposals(opts)` which handles all logic.
2. The report is already assembled and stored by the scorer.
3. This class exists for:
   - Clean separation: scorer computes scores, reporter handles orchestration.
   - Future extensibility (post-processing, enrichment, notifications).
4. Actually — since the scorer already produces and saves the report, we can simplify.
   Either make `ProposalScorer` the sole entry point (rename `scoreProposals` to `generateReport`) or keep `PriorityReporter` as thin delegation.

**Simplification:** Combine Task 2 and Task 3. `ProposalScorer.generateReport()` does everything. The `PriorityReporter` wrapping is unnecessary indirection. The plan recommends: **skip PriorityReporter, put orchestration in ProposalScorer directly.**

The CLI will:
```
ProposalScorer
  ↓ (ProposalPriorityReport)
PriorityStore.save()
  ↓
stdout
```

## Task 4: CLI prioritize subcommand

**Files:**
- Modify: `src/cli/commands/adaptation.ts`
- Test: `tests/cli/commands/adaptation-prioritize.vitest.ts`

**Subcommand:** `alix adaptation prioritize [--top <n>] [--min-score <n>] [--json]`

```ts
case "prioritize":
  await runPrioritize(cwd, store, rest);
  return;
```

`runPrioritize(cwd, proposalStore, args)`:
1. Parse flags: `--top`, `--min-score`, `--json`.
2. Wire up: `IntelligenceStore` (`.alix/adaptation/intelligence/`), `PriorityStore` (`.alix/adaptation/priorities/`), `ProposalScorer`.
3. Call `scorer.generateReport({ top, minScore })`.
4. If `--json`: print `JSON.stringify(report, null, 2)`.
5. Otherwise: print formatted ranked table.
6. Update `printUsage`.

**Table output:**
```
=== Proposal Priority Report v1 ===
Generated: ... | Pending: 42 | Scored: 38 | Low confidence: 4

Executive Summary:
...

Rank  Score  Conf  ID           Action               Target      Age  Rationale
1     0.91   HIGH  prop-042     add_capability       capability  2d   ...
2     0.83   HIGH  prop-038     update_agent_card    agent_card  3d   ...
```

## Task 5: Verification + PR

```bash
npx vitest run tests/adaptation/priority-* tests/cli/commands/adaptation-prioritize* --config vitest.config.mts
npx vitest run --config vitest.config.mts
npx tsc --noEmit
gitnexus_detect_changes
```

**Push + PR:**
- Branch: `feature/p5.4-proposal-prioritization`.
- Commit messages: `P5.4.N: component` per task.
- PR title: `P5.4: Proposal Prioritization — strategic memory to decision influence`.
- Tag on merge: `alix-p5.4-complete`.

## Verification (end-to-end)

```bash
# Seed pending proposals via test helper
# Seed IntelligenceReport via IntelligenceStore
# Run: alix adaptation prioritize
# Confirm: ranked table, executive summary, top N highlighted
# Confirm: .alix/adaptation/priorities/<timestamp>.json exists
# Run: alix adaptation prioritize --json
# Confirm: valid JSON with scoringVersion: "v1"
# Run: alix adaptation prioritize --top 5
# Confirm: only 5 proposals shown
# Run on instance without IntelligenceReport
# Confirm: graceful output with confidence: LOW
```

## Summary of governance boundary

| Capability | P5.4 boundary |
|---|---|
| Read pending proposals | ✅ Yes |
| Read IntelligenceReport | ✅ Yes |
| Write PriorityReport | ✅ Yes — to `.alix/adaptation/priorities/` |
| Create/approve/apply/reject proposals | ❌ No |
| Write evidence events | ❌ No |
| Mutate proposals | ❌ No |
