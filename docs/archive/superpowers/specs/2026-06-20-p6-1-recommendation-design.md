# P6.1 — Approval Recommendation

> **Status:** Spec — awaiting review
> **Slice:** P6.1 (ApprovalRecommendation)
> **Builds on:** P6.0a DecisionContext, P6.0b RiskScore
> **Blocks:** P6.2 Operator Queue
> **Risk level:** LOW — read-only, deterministic rules, no mutation paths

## Core Question

Can ALiX produce a single coherent recommendation from DecisionContext + RiskScore without violating the Recommend ≠ Decide invariant?

## Constitutional Compliance

### Governance Review — ✅

| Check | Verdict |
|-------|---------|
| Can it write? | No — read-only, no stores, no appliers, no generators |
| Can it approve? | No — recommendation only, ApprovalGate is separate |
| Can it apply? | No — Recommend ≠ Decide |

### Intelligence Review — ✅

| Check | Answer |
|-------|--------|
| What question does it answer? | What appears reasonable? |
| Is that question owned by another layer? | No — DecisionContext owns "What do we know?" RiskScore owns "What could go wrong?" |
| If removed, what capability disappears? | Single coherent recommendation from context + risk + trends |

### Layer Ownership

| Owns | Does NOT own |
|------|-------------|
| One coherent recommendation per proposal | Risk evaluation |
| Signal coherence (confidence in the recommendation) | Prioritization |
| Deterministic outcome rules | Queue ordering |
| | Approval authority |

## Three Signals — Never Collapsed

| Signal | Source | Represents |
|--------|--------|------------|
| Evidence completeness | `DecisionContext.confidence` | How much we know |
| Risk magnitude | `RiskScore.overallRisk` | How bad it could be |
| Signal coherence | `Recommendation.confidence` | How clearly data points to this outcome |

These three must remain independent. A recommendation must never conflate high risk with low confidence, or complete evidence with automatic approval.

## Inputs

- `DecisionContext` — proposal context, lineage, evidence completeness, warnings
- `RiskScore` (optional) — 5-dimension risk assessment
- Effectiveness trends and similar proposals (already in DecisionContext)

## Output

```typescript
type Recommendation = "approve" | "reject" | "defer" | "investigate";

type WarningSeverity = "info" | "warning" | "critical";

interface EnrichedWarning {
  message: string;
  severity: WarningSeverity;
}

interface ApprovalRecommendation extends DecisionArtifact {
  /** One outcome — "What appears reasonable?" */
  recommendation: Recommendation;

  /** The proposal this recommendation addresses. */
  proposalId: string;

  /** Reference to the RiskScore used (if any). */
  riskScoreId?: string;

  /** Human-readable rationale — per-rule justifications. */
  reasons: string[];

  /** RiskScore dimensions forwarded for operator convenience. */
  risks?: RiskItem[];

  /** Preserves evidence chain from DecisionContext. */
  sourceArtifacts: SourceArtifact[];
}
```

The `outcome` field (inherited from DecisionArtifact) mirrors `recommendation`:

| recommendation | outcome       |
|---------------|---------------|
| approve       | approve       |
| reject        | reject        |
| defer         | defer         |
| investigate   | investigate   |

## Rules (Priority Order)

Rules are evaluated in order. The first match wins.

```
1. reject       if lineageCompleteness === "broken"
                AND contextStatus === "insufficient_data"
                AND at least one warning has severity === "critical"

2. defer        if contextStatus === "stale_context"
                OR contextStatus === "insufficient_data"

3. investigate  if (riskScore exists AND overallRisk >= 0.6)
                OR (ctx.confidence >= 0.8 AND riskScore exists AND overallRisk >= 0.4)
                (signals conflict: strong evidence + material risk)

4. approve      otherwise (context sufficient, risk moderate/low, signals align)
```

**Rationale for rule ordering:**
- `reject` is the narrowest path — a trust/integrity circuit breaker, not a quality judgment. High risk alone must NOT produce reject.
- `defer` preserves the human's time — don't ask them to evaluate stale data.
- `investigate` is the safe middle — high risk with good evidence means "pay attention, human."
- `approve` is the default when nothing is wrong — but confidence may be low if evidence is thin.

**Note on warnings:** The reject rule depends on severity. DecisionContext's `warnings` field transitions from `string[]` to `EnrichedWarning[]` (or equivalent metadata) as part of P6.1. Each warning carries a `severity: "info" | "warning" | "critical"` to enable automated triage. The `reasons` and legacy access paths remain `string[]` for backward compatibility.

## Confidence Model

Recommendation confidence measures **signal coherence** — how clearly the available evidence supports the selected recommendation:

```typescript
function computeSignalCoherence(
  recommendation: Recommendation,
  ctx: DecisionContext,
  riskScore?: RiskScore,
): number {
  // Count supporting vs. contradicting signals
  let support = 0;
  let contradict = 0;

  // Evidence completeness supports when high
  if (ctx.confidence >= 0.7) support++;
  else if (ctx.confidence < 0.4) contradict++;

  // Risk assessment support depends on recommendation
  if (riskScore) {
    if (recommendation === "investigate" && riskScore.overallRisk >= 0.6) support++;
    else if (recommendation !== "investigate" && riskScore.overallRisk < 0.4) support++;
    else contradict++;
  }

  // Lineage completeness supports confident recommendations
  if (ctx.lineageCompleteness === "complete") support++;
  else if (ctx.lineageCompleteness === "broken") contradict++;

  // Effectiveness trend alignment
  if (ctx.effectivenessTrend.sampleSize > 0) {
    const trendSupports = (recommendation === "approve" && ctx.effectivenessTrend.keepRate > 0.7)
      || (recommendation === "investigate" && ctx.effectivenessTrend.revertRate > 0.3);
    if (trendSupports) support++;
    else contradict++;
  }

  const total = support + contradict;
  if (total === 0) return 0.5; // neutral — no signals to judge

  // Raw coherence: what proportion of signals support the recommendation
  const rawCoherence = support / total;

  // Evidence ceiling: recommendation cannot be more certain than the available evidence
  // Bounded by a floor of 0.5 so low evidence doesn't collapse confidence to zero
  const evidenceCeiling = Math.max(0.5, ctx.confidence);
  const clamped = Math.min(rawCoherence, evidenceCeiling);

  return Math.round(clamped * 100) / 100;
}
```

Pure, deterministic, no ML. Confidence is clamped to [0, 1] with 2 decimal places.

## CLI

```bash
alix decision recommend <proposal-id>
alix decision recommend <proposal-id> --json
```

Terminal output:
```
Recommendation: prop-2026-06-20-001
────────────────────────────────────
✅ Approve (confidence: 0.85)

Context confidence: 0.90 (evidence completeness)
Risk score:        0.22  (low)

Reasons:
 · Evidence is current and lineage is complete
 · Risk is low across all dimensions
 · Effectiveness trend supports this action type

Warnings:
 · (none)
```

## File Structure

```
Create:
  src/adaptation/recommendation-types.ts       — Recommendation, ApprovalRecommendation
  src/adaptation/recommendation-engine.ts      — RecommendationEngine, recommendation rules
  tests/adaptation/recommendation-engine.vitest.ts
  tests/adaptation/recommendation-sentinels.vitest.ts

Modify:
  src/cli/commands/decision.ts                — add `alix decision recommend` subcommand
```

## Governance Sentinel

New sentinel suite `tests/adaptation/recommendation-sentinels.vitest.ts`:

1. **No ApprovalGate imports** — RecommendationEngine must not import approval-gate, appliers, or generators
2. **No store references** — RecommendationEngine must not reference ProposalStore, EvidenceStore, LineageBuilder, IntelligenceStore, or EffectivenessStore
3. **No queue types** — must not import queue/prioritization types or QueueItem
4. **No write/approve/apply calls** — must not call `.save()`, `.update()`, `.approve()`, `.apply()`, `.reject()`, `.queue()`
5. **No recommendation language bypass** — must not import RiskScoreBuilder's forbidden words as action terms
6. **Constructor store check** — constructor must not accept store parameters

## Key Invariant Tests

| Test | What it protects |
|------|-----------------|
| High risk → investigate, not reject | Most important boundary — risk magnitude ≠ recommendation |
| Defer for stale/insufficient context | Don't recommend on thin data |
| Reject only with broken lineage + insufficient + warnings | Reject is a trust circuit breaker |
| Approve when context is sufficient and risk is low | Happy path |
| Same DecisionContext + RiskScore → same recommendation | Determinism |
| Three signals remain independent | No collapse of evidence/risk/coherence |
| Governance sentinel passes | No forbidden imports, writes, or store refs |

## Determinism Assertion

```typescript
it("produces identical recommendations for the same inputs", () => {
  const ctx = createTestContext();
  const engine = new RecommendationEngine();
  const r1 = engine.recommend(ctx, riskScore, "2026-06-20T12:00:00.000Z");
  const r2 = engine.recommend(ctx, riskScore, "2026-06-20T12:00:00.000Z");
  expect(r1).toEqual(r2);
});
```

## Acceptance Criteria

1. `ApprovalRecommendation extends DecisionArtifact` — outcome, confidence, reasons, evidenceRefs, warnings, generatedAt all present
2. Rules evaluated in priority order — first match wins
3. High risk (`overallRisk >= 0.6`) with strong context (`confidence >= 0.8`) → investigate, NOT reject
4. `reject` requires lineage broken + insufficient data + governance-critical warning — all three
5. `defer` for stale or insufficient context
6. `approve` as default when nothing triggers above rules
7. Confidence measures signal coherence, NOT evidence completeness or risk magnitude
8. Deterministic — same inputs always produce same output
9. Pure — no store reads, no side effects, no async
10. Governance sentinel passes
11. CLI `alix decision recommend <id>` renders terminal output
12. CLI `--json` outputs valid JSON

## Out of Scope

| Feature | Belongs to | Reason |
|---------|-----------|--------|
| Multi-outcome scoring | Future | Risks becoming probability model before operator feedback exists |
| Conditions/preconditions | Future | Can be expressed via `warnings[]` for now |
| Queue / priority ordering | P6.2 Operator Queue | Would violate Intelligence Law |
| Auto-approve / auto-apply | Never — would violate Recommend ≠ Decide | |
| ML-based recommendation | Future | Deterministic first, learn from operator feedback later |
| Strategic trends | P6.3 Strategic Brief | Needs aggregate across proposals |

## Architecture Axiom

```
DecisionContext: What do we know?
       RiskScore: What could go wrong?
Recommendation:  What appears reasonable?
             ↓
      [Human makes the decision]
             ↓
   ApprovalGate: Authorize or deny
```

The Recommendation layer advises. The ApprovalGate authorizes. The human decides.
