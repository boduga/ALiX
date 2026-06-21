# P6.0b — RiskScore

> **Status:** Spec — awaiting review
> **Slice:** P6.0b (RiskScore) — next constitutional test case
> **Builds on:** P6.0a DecisionContext, P5.7 Lineage + Governance, P5.3 Intelligence
> **Blocks:** P6.2 Recommendation
> **Risk level:** LOW — read-only, deterministic scoring, no recommendations

## Core Question

Can ALiX quantify proposal risk using existing governance, lineage, intelligence, and effectiveness evidence without making recommendations?

## Constitutional Compliance

### Governance Review — ✅

| Check | Verdict |
|-------|---------|
| Can it write? | No — read-only |
| Can it approve? | No |
| Can it apply? | No |

### Intelligence Review — ✅

| Check | Answer |
|-------|--------|
| What question does it answer? | What could go wrong? |
| Is that question owned by another layer? | No — DecisionContext owns "What do we know?" |
| If removed, what capability disappears? | Risk quantification |

### Layer Ownership

| Owns | Does NOT own |
|------|-------------|
| Risk quantification | Recommendations |
| Risk dimension scoring | Prioritization |
| Evidence quality assessment | Strategic analysis |

## Inputs

- `DecisionContext` — proposal context, lineage, effectiveness, evidence completeness
- `LineageGraph` — lifecycle stage, completeness, warnings
- `EffectivenessTrend` — historical outcomes for this action type
- Evidence fingerprints — presence/absence

## Output

```typescript
export type RiskDimension =
  | "governance"
  | "operational"
  | "capability"
  | "revertability"
  | "evidence_quality";

export interface RiskItem {
  dimension: RiskDimension;
  /** 0-1 where 0 = no risk, 1 = critical risk. */
  score: number;
  /** Confidence in this score (0-1). */
  confidence: number;
  /** Human-readable justifications. Matches DecisionArtifact.reasons pattern. */
  reasons: string[];
}

export interface RiskScore extends DecisionArtifact {
  /** Overall risk level (0-1). */
  overallRisk: number;

  /** Per-dimension breakdown. */
  risks: RiskItem[];

  /** Convenience accessor — per-dimension scores. */
  dimensions: Record<RiskDimension, number>;

  /** Provenance — preserves chain from DecisionContext. */
  sourceArtifacts: SourceArtifact[];
}
```

## Risk Dimensions

| Dimension | Question | Scoring factors |
|-----------|----------|----------------|
| `governance` | Is governance evidence incomplete? | Lineage completeness, warning count, contextStatus = insufficient_data |
| `operational` | Could application fail? | Proposal status is "failed", similar proposals have high failure rate, effectiveness trend is negative |
| `capability` | Has this action historically performed poorly? | Effectiveness keepRate for this action type, revertRate, similar proposal outcomes |
| `revertability` | Can this be safely reverted? | Snapshot exists, action is mutating (vs create_improvement_issue), lineage completeness |
| `evidence_quality` | How complete and current is the evidence base? | Evidence fingerprint count, dataFreshness age range, lineage completeness — NOT inverted confidence. Risk and uncertainty are separate dimensions: evidenceQuality measures the evidence base itself, riskConfidence expresses uncertainty in the scores. |

## Scoring Methodology

Deterministic, no ML, no prediction.

### Computation

Each dimension is scored independently based on available evidence. All scoring functions are **pure, deterministic, and side-effect free** — they receive a `DecisionContext` and return a number. This makes them independently testable and future-safe across all P6.x layers.

The builder orchestrates:

```typescript
interface RiskScoreBuilder {
  build(ctx: DecisionContext): RiskScore;
}
```

It never reads from stores directly — it receives its data through DecisionContext, preserving the read boundary.

Scoring functions:

```typescript
function scoreGovernance(ctx: DecisionContext): number {
  let score = 0;
  // No lineage → governance evidence gap
  if (ctx.lineageCompleteness === "broken") score += 0.4;
  else if (ctx.lineageCompleteness === "partial") score += 0.2;
  // Warnings indicate governance gaps
  score += Math.min((ctx.warnings?.length ?? 0) * 0.15, 0.3);
  // Insufficient data is a governance red flag
  if (ctx.contextStatus === "insufficient_data") score += 0.5;
  return Math.min(score, 1);
}

function scoreOperational(ctx: DecisionContext): number {
  let score = 0;
  // Previously failed proposals are higher risk
  if (ctx.proposalStatus === "failed") score += 0.4;
  // Similar proposals with poor outcomes
  const badOutcomes = ctx.similarProposals.filter(
    (s) => s.outcome === "revert" || s.outcome === "investigate"
  ).length;
  score += Math.min(badOutcomes * 0.1, 0.3);
  // Effectiveness trend negative
  if (ctx.effectivenessTrend.revertRate > 0.5) score += 0.3;
  return Math.min(score, 1);
}

function scoreCapability(ctx: DecisionContext): number {
  let score = 0;
  // No effectiveness data = unknown capability risk
  if (ctx.effectivenessTrend.sampleSize === 0) score += 0.3;
  // Low keep rate indicates capability risk
  if (ctx.effectivenessTrend.sampleSize > 0) {
    score += (1 - ctx.effectivenessTrend.keepRate) * 0.5;
  }
  // Similar proposals with reverts increase risk
  const revertCount = ctx.similarProposals.filter(
    (s) => s.outcome === "revert"
  ).length;
  score += Math.min(revertCount * 0.1, 0.2);
  return Math.min(score, 1);
}

function scoreRevertability(ctx: DecisionContext): number {
  // Non-mutating actions are always low risk
  if (ctx.proposalAction === "create_improvement_issue") return 0.1;
  if (ctx.proposalAction === "suggest_routing_weight") return 0.1;
  // Mutating actions without lineage are higher risk
  if (ctx.lineageCompleteness === "broken") return 0.7;
  // Applied proposals with snapshots are safer to revert
  if (ctx.proposalStatus === "applied") return 0.3;
  // Pending/approved proposals haven't been applied yet
  return 0.5;
}

function scoreEvidenceQuality(ctx: DecisionContext): number {
  // Evidence quality measures the evidence base itself, not inverted confidence.
  // Risk and uncertainty are separate dimensions that should not be conflated.
  let score = 0;
  // No evidence fingerprints → poor evidence quality
  if (ctx.evidenceRefs.length === 0) score += 0.4;
  // Old data artifacts reduce evidence quality
  if (ctx.dataFreshness.oldestArtifactAgeDays > 30) score += 0.2;
  // Broken lineage = incomplete evidence trail
  if (ctx.lineageCompleteness === "broken") score += 0.3;
  else if (ctx.lineageCompleteness === "partial") score += 0.15;
  // Stale context is an evidence quality concern
  if (ctx.contextStatus === "stale_context") score += 0.3;
  return Math.min(score, 1);
}
```

### Overall Risk

```typescript
overallRisk = Math.round(
  (governance + operational + capability + revertability + evidenceQuality) / 5
  * 100
) / 100;
```

No weighting — all dimensions are equal. Weighting introduces subjectivity that belongs in P6.2 (Recommendation) or operator configuration.

### Confidence

Risk confidence is derived from the DecisionContext's evidence completeness:

```typescript
riskConfidence = ctx.confidence;
```

High evidence completeness = high confidence in risk scores. Low evidence completeness = low confidence (the risk scores may be unreliable due to missing data).

## DecisionArtifact Compatibility

```typescript
interface RiskScore extends DecisionArtifact {
  outcome: "low" | "medium" | "high" | "critical";
  confidence: number;       // inherited — reflects evidence completeness
  reasons: string[];        // inherited — per-dimension rationales
  warnings?: string[];      // inherited — propagated from DecisionContext
  evidenceRefs: string[];   // inherited — proposal + lineage evidence refs
  overallRisk: number;
  risks: RiskItem[];
  dimensions: Record<RiskDimension, number>;
}
```

The `outcome` field is set based on `overallRisk`:
- `overallRisk < 0.3` → `"low"`
- `overallRisk < 0.6` → `"medium"`
- `overallRisk < 0.85` → `"high"`
- `overallRisk >= 0.85` → `"critical"`

## CLI

```bash
alix decision risk <proposal-id>
alix decision risk <proposal-id> --json
```

Terminal output:
```
Risk Score: prop-2026-06-20-001
──────────────────────────────
Overall: MEDIUM (0.52)

Dimensions:
  Governance      0.30  — Lineage partially complete
  Operational     0.20  — No similar failures
  Capability      0.65  — Limited effectiveness history (n=1)
  Revertability   0.30  — Applied proposal with snapshot
  Evidence Quality 0.15  — Confidence 0.85

Risk confidence: 0.85 (evidence completeness)
```

## File Structure

```
Create:
  src/adaptation/risk-score-types.ts         — RiskItem, RiskDimension, RiskScore
  src/adaptation/risk-score-builder.ts       — deterministic scoring functions
  tests/adaptation/risk-score-builder.vitest.ts
  tests/adaptation/risk-score-sentinels.vitest.ts

Modify:
  src/cli/commands/decision.ts                — add `alix decision risk` subcommand
```

## Governance Sentinel

Add a new P6 sentinel suite `tests/adaptation/risk-score-sentinels.vitest.ts`:

1. **No ApprovalGate imports** — RiskScoreBuilder must not import `approval-gate`, appliers, or generators
2. **No Recommendation types** — RiskScoreBuilder must not import `Recommendation` types (would indicate analytical drift)
3. **No Queue types** — RiskScoreBuilder must not import queue/prioritization types
4. **No write methods** — RiskScoreBuilder must not call `.save()`, `.update()`, `.approve()`, `.apply()`
5. **No recommendation language** — RiskScoreBuilder must not contain the words `approve`, `reject`, `defer`, or `investigate` as action-oriented terms. These belong to Recommendation (P6.2). A grep-based sentinel enforces: `expect(source).not.toContain("approve")` etc. Only the RiskScore outcome labels (`"low"`, `"medium"`, `"high"`, `"critical"`) are permitted.

## Determinism Assertion

The architectural acceptance criterion: **two operators looking at the same DecisionContext should receive the same RiskScore**.

```typescript
it("produces identical risk scores for the same DecisionContext", () => {
  const ctx = createTestContext(/* ... */);
  const score1 = riskScoreBuilder.build(ctx);
  const score2 = riskScoreBuilder.build(ctx);
  expect(score1).toEqual(score2);
});
```

## Tests

| Test | Scenario |
|------|----------|
| Governance risk from broken lineage | Lineage broken → governance score > 0 |
| Operational risk from failed proposals | Status=failed → operational score > 0 |
| Capability risk from no effectiveness | Unknown action type → capability score > 0 |
| Revertability low for non-mutating | create_improvement_issue → revertability ~0.1 |
| Evidence quality inverts confidence | Low confidence → high evidence risk |
| Overall risk is average of dimensions | Verify arithmetic |
| Deterministic — same input, same output | Two calls with same DecisionContext produce identical result |
| RiskScore extends DecisionArtifact | outcome, reasons, warnings, evidenceRefs, generatedAt present |
| CLI --json output | Valid RiskScore JSON |
| Governance sentinel passes | No forbidden imports or calls |

## Out of Scope

| Feature | Belongs to | Reason |
|---------|-----------|--------|
| Recommendations | P6.2 | Would violate Intelligence Law |
| Priority ranking | P6.4 Queue | Would violate Intelligence Law |
| Weighted risk dimensions | P6.2 or operator config | Weighting is subjective judgment |
| ML-based risk prediction | Future | Deterministic first, ML later |
| Strategic risk aggregation | P6.5 Strategic Brief | Needs aggregate across proposals |

## Acceptance Criteria

1. RiskScore type matches this spec exactly (DecisionArtifact extension)
2. All 5 dimensions scored deterministically from DecisionContext alone
3. `overallRisk` is unweighted average of all 5 dimensions
4. Two calls with same DecisionContext produce identical RiskScore
5. CLI `alix decision risk <id>` renders terminal output
6. CLI `alix decision risk <id> --json` outputs valid JSON
7. Governance sentinel passes (no forbidden imports, types, or methods)
8. All existing tests pass

The Architecture Axiom holds:

DecisionContext: What do we know?
RiskScore: What could go wrong?
Neither: What should we do?
