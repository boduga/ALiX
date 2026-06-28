# P6.3 — Strategic Brief

> **Status:** Spec
> **Slice:** P6.3 Strategic Brief (layer 5 of 5 in the P6 Decision Influence framework)
> **Builds on:** P6.0a DecisionContext, P6.0b RiskScore, P6.1 ApprovalRecommendation, P6.2 Operator Queue
> **Risk level:** LOW — read-only, pure synthesis from existing persisted stores

## Core Framing

**Core question:** What patterns matter over time?

**Intelligence Law boundary:** StrategicBrief synthesizes temporal patterns from existing persisted stores (IntelligenceStore, EffectivenessStore, EvidenceStore). It does NOT reference individual proposals, does NOT produce per-proposal recommendations, and does NOT re-evaluate risk or confidence. It answers a single question: "What trends, hotspots, and systemic observations can be derived from accumulated adaptation data?"

**This is the first temporal-intelligence layer** in the P6 stack: it looks across proposals, not at a single proposal. All layers below it are per-proposal operational intelligence.

### Layer Stack (P6)

```
DecisionContext: What do we know?          ← per-proposal
     RiskScore: What could go wrong?       ← per-proposal
Recommendation:  What appears reasonable?  ← per-proposal
   OperatorQueue: What deserves attention first?  ← per-proposal ordering
 StrategicBrief: What patterns matter over time?  ← temporal synthesis
```

### Layer Ownership

| Layer | Owns | Must NOT Own |
|-------|------|-------------|
| DecisionContext | Context assembly | Risk evaluation |
| RiskScore | Risk evaluation | Recommendations |
| Recommendation | Decision guidance | Prioritization |
| Queue | Attention ordering | Approval decisions |
| **Strategic Brief** | **Long-horizon synthesis** | **Operational actions** |

## Architecture

### Approach: Rolling Window Brief (B)

Three alternatives were considered:

| Approach | Description | Verdict |
|----------|-------------|---------|
| A. Snapshot Brief | Current artifacts only, no trends | ❌ Not truly strategic |
| **B. Rolling Window Brief** | **Historical stores → trends, hotspots, findings** | **✅ Selected** |
| C. Intelligence Layer | Themes, clusters, narratives, forecasts | ❌ Too large for P6.3 |

**B is chosen** because it generates actual temporal intelligence from already-persisted data, without requiring new storage or crossing into prediction/forecasting territory.

### What P6.3 reads

Three existing persisted stores — NO new stores:

| Store | Data Provided | Temporal Signal |
|-------|---------------|-----------------|
| `IntelligenceStore` | Bucketed trend analysis, confidence calibration, revert signal analysis | Aggregate outcome patterns |
| `EffectivenessStore` | Per-proposal keep/revert outcomes | Proposal-level effectiveness |
| `EvidenceStore` | Lifecycle records (adaptation_proposed, approved, applied, failed, reverted) | Event timeline |

### What P6.3 does NOT read or create

NOT read:
- `DecisionContext` (not persisted)
- `RiskScore` (not persisted)
- `ApprovalRecommendation` (not persisted)
- `QueueItem` (not persisted)

NOT created:
- `DecisionContextStore`, `RiskScoreStore`, `RecommendationStore`, `QueueStore`
- Any new evidence types
- Any mutation paths

## Data Model

### StrategicBriefInput — what the CLI assembles

```typescript
interface StrategicBriefInput {
  intelligenceReports: IntelligenceReport[];
  effectivenessReports: EffectivenessReport[];
  evidenceRecords: EvidenceRecord[];
}
```

The StrategicBriefBuilder is a pure builder — store querying happens in the CLI layer.

### StrategicBriefOptions

```typescript
interface StrategicBriefOptions {
  /** Rolling window size in days: 30, 90, or 180. Default: 30. */
  window?: 30 | 90 | 180;
  /** Override generatedAt for deterministic testing. */
  generatedAt?: string;
}
```

### StrategicBrief — the output artifact

```typescript
interface TimeWindow {
  start: string;  // ISO 8601
  end: string;    // ISO 8601
}

interface StrategicFinding {
  /** Category of finding. */
  category: "trend" | "hotspot" | "system_warning" | "strategic_observation";
  /** One-sentence finding. */
  summary: string;
  /** Supporting detail. */
  detail: string;
  /** Confidence in this finding (0-1). */
  confidence: number;
  /** Evidence refs supporting this finding. */
  evidenceRefs: string[];
}

interface Trend {
  /** What is trending. */
  metric: string;
  /** Direction of change. */
  direction: "increasing" | "decreasing" | "stable";
  /** Magnitude of change (0-1 scale). */
  magnitude: number;
  /** Sample size supporting this trend. */
  sampleSize: number;
}

interface Hotspot {
  /** Area of concern. */
  area: string;
  /** Risk level. */
  severity: "low" | "medium" | "high";
  /** Action types or capability areas involved. */
  relatedActionTypes: string[];
  /** Supporting evidence. */
  evidence: string;
}

interface StrategicBrief extends DecisionArtifact {
  /** The time window this brief covers. */
  period: TimeWindow;
  /** Strategic findings — no per-proposal references. */
  findings: StrategicFinding[];
  /** Detected trends across the window. */
  trends: Trend[];
  /** Emerging areas of concern. */
  hotspots: Hotspot[];
  /**
   * Strategic action areas — NOT per-proposal recommendations.
   * Examples:
   *   - "Review governance requirements for agent-card modifications"
   *   - "Investigate rising defer rates on skill-definition changes"
   * NOT:
   *   - "Approve proposal prop-123"
   */
  /**
   * Confidence in the brief's data sufficiency — NOT confidence that any
   * action should be taken.
   *
   * Formula: min(1, sampleSize / targetSampleSize) adjusted downward for
   * data gaps. targetSampleSize = 30 (one proposal per day in a 30-day window).
   */
  confidence: number;

  /** Source artifacts consumed: intelligence, effectiveness, evidence. */
  sourceArtifacts: SourceArtifact[];

  // outcome inherited from DecisionArtifact — always "brief"
}
```

## StrategicBriefBuilder — Pure Synthesis Class

```typescript
class StrategicBriefBuilder {
  /**
   * Build a StrategicBrief from historical intelligence, effectiveness,
   * and evidence records.
   *
   * Pure function — no stores, no side effects.
   * Deterministic for same inputs + same generatedAt.
   */
  build(input: StrategicBriefInput, options?: StrategicBriefOptions): StrategicBrief;
}
```

**Store querying happens in the CLI layer.** The builder receives already-loaded data.

### Synthesis Logic

The builder processes inputs through several lenses:

**Trend detection:** Analyzes IntelligenceReport buckets across the window to detect direction changes in:
- Outcome keep/revert rates by action type
- Confidence calibration drift
- Revert signal patterns

**Hotspot identification:** Flags areas where:
- Revert rates exceed threshold (>15%)
- Investigate recommendations are concentrated in one action type
- Evidence quality is consistently low for a capability area

**System warnings:** Generated when:
- Overall confidence drops across multiple reports
- Sample sizes are too low for reliable patterns
- Data gaps exist in the window

### Output Rules

1. **No proposal IDs in findings** — a finding mentioning `prop-2026-06-21-005` has stopped being strategic
2. **No per-proposal recommendations** — strategic recommendations are action-type or capability-area level
3. **Confidence is bounded by available data** — low sample sizes produce low-confidence findings
4. **Findings are descriptive, not prescriptive** — they describe patterns, not required actions

## CLI

```bash
alix decision brief                     # Current 30-day brief (terminal)
alix decision brief --window 90         # 90-day window
alix decision brief --json              # Full JSON output
alix decision brief --window 180 --json # 180-day window as JSON
```

### Terminal Output

```
Strategic Brief: Last 30 days (2026-05-22 → 2026-06-21)
═════════════════════════════════════════════════════════

Findings (4):
 📈 Trend: Agent-card changes show 42% increase in defer outcomes
 📊 Trend: Evidence quality declining for skill-definition proposals
 🔥 Hotspot: Revert rate on capability changes at 22% (high)
 ⚠️ Warning: Insufficient data for recommend trends (n=3)

Recommendations:
 · Review governance requirements for agent-card modifications
 · Investigate rising revert rate on capability changes

Data: 45 effectiveness reports, 12 intelligence reports, 287 evidence records
```

## Governance Sentinels

### No proposal-ID sentinel

Two layers of enforcement:

**Static sentinel:** Tests verify that `strategic-brief.ts` source does NOT contain:
- `prop-` string literals in findings, strategicActions, or hotspot evidence
- Any hardcoded proposal identifier patterns

**Runtime test:** A test verifies that given input data containing real proposal IDs
(e.g., `prop-2026-06-21-005`), the builder's output JSON (findings, trends, hotspots,
strategicActions) does NOT contain `prop-` anywhere. This catches accidental leakage
from input payloads and is stronger than source-grep alone.

The builder may read proposal IDs from input data, but must never emit them in
findings, trends, hotspots, or strategic actions.

### No per-proposal recommendation sentinel

Tests verify that `strategic-brief.ts` does NOT contain per-proposal directive language:
- `"approve proposal"`
- `"reject proposal"`
- `"approve prop-"`
- `"reject prop-"`

The words `approve` and `reject` are NOT banned globally — historical metrics
like "approval rate decreased" or "rejection-like outcomes increased" are
valid strategic content.

### StrategicBrief purity sentinel

Tests verify that `strategic-brief.ts` does NOT import:
- `ProposalStore`, `EvidenceStore`, or any `*-store` pattern
- `DecisionContextBuilder`, `RiskScoreBuilder`, `RecommendationEngine`, `OperatorQueue`
- `decision-confidence` or scoring modules

## File Structure

```
Create:
  src/adaptation/strategic-brief-types.ts   — StrategicBriefInput, StrategicBrief, StrategicFinding, Trend, Hotspot, TimeWindow, StrategicBriefOptions
  src/adaptation/strategic-brief.ts          — StrategicBriefBuilder class (pure synthesis)
  tests/adaptation/strategic-brief.vitest.ts — Unit tests
  tests/adaptation/strategic-brief-governance-sentinels.vitest.ts — Purity + no-proposal-ID + no-per-proposal-recommendation sentinels

Modify:
  src/cli/commands/decision.ts              — Add `brief` subcommand handler + case in switch
```

## Tests

### Type shape tests

| Test | Scenario |
|------|----------|
| StrategicBrief extends DecisionArtifact | Has outcome, confidence, reasons, evidenceRefs, generatedAt |
| outcome is "brief" | Stable semantic value |
| Has period, findings, trends, hotspots, recommendations | Shape match |
| StrategicFinding has category, summary, detail, confidence, evidenceRefs | Shape match |

### Builder tests

| Test | Scenario |
|------|----------|
| Empty inputs produce empty findings/trends/hotspots | Graceful empty state |
| Single intelligence report produces findings | Minimal data |
| Multiple reports produce trend detection | Rolling window aggregation |
| High revert rate produces hotspot | Threshold detection |
| Low sample size produces low-confidence findings | Confidence bounded by data |
| determinism | Same inputs + same generatedAt → same output |

### Governance sentinel tests

| Test | Scenario |
|------|----------|
| No proposal IDs in findings (static) | Source grep for `prop-` string literals in output content |
| No proposal IDs in findings (runtime) | Given input with proposal IDs, output JSON must not contain `prop-` |
| No per-proposal directive language | No `"approve proposal"`, `"reject proposal"`, `"approve prop-"`, `"reject prop-"` — approve/reject as historical metrics ARE allowed |
| No store imports | Builder doesn't import ProposalStore, EvidenceStore |
| No builder/engine imports | Doesn't import DecisionContextBuilder, RiskScoreBuilder, RecommendationEngine, OperatorQueue |

## Acceptance Criteria

1. `StrategicBrief` type matches this spec exactly (DecisionArtifact extension, period, findings, trends, hotspots, strategicActions, sourceArtifacts)
2. `StrategicBrief.confidence` reflects data sufficiency: `min(1, sampleSize / targetSampleSize)`
3. `StrategicBriefBuilder.build(input)` produces a StrategicBrief for any valid input
4. `options.window` controls window filtering: builder filters records by generatedAt
5. Empty inputs produce empty findings, trends, and hotspots
6. Trend detection works with multiple intelligence reports
7. Hotspot detection triggers on high revert rates
8. No proposal IDs appear in findings, trends, hotspots, or strategicActions (static + runtime test)
9. No `"approve proposal"`, `"reject proposal"`, `"approve prop-"`, or `"reject prop-"` in output
10. Governance sentinels pass
11. All existing tests pass

## Out of Scope

| Feature | Belongs to | Reason |
|---------|-----------|--------|
| DecisionArtifact persistence | Future | Not needed — existing stores sufficient |
| Forecasting / prediction | Future | Would violate Intelligence Law |
| Auto-remediation | Never | Would violate Recommend≠Decide |
| Per-proposal references | Never | Would make StrategicBrief operational, not strategic |
| New evidence types | Future | Not needed — reads existing stores |
| ML-based trend detection | Future | Deterministic first, enhance later |
