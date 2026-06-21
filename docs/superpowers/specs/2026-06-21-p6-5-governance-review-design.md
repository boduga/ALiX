# P6.5 — LLM-Supervised Governance Review Council

> **Status:** Spec
> **Slice:** P6.5 Governance Review Council (layer 3.5 of 5 in the P6 Decision Influence framework)
> **Builds on:** P6.1 ApprovalRecommendation, P6.2 OperatorQueue
> **Risk level:** MEDIUM — LLM critique adds non-deterministic signal, but the review is advisory and never mutates state
> **Core invariant:** GovernanceReview ≠ Decision. Review ≠ Approval. Challenge ≠ Rejection.

## Core Framing

**Core question:** What might the deterministic governance layer be missing?

P6 (Context → Risk → Recommendation → Queue → Brief) is fully deterministic. Deterministic systems are excellent at consistency but systematically weak at: novel situations, emerging patterns, hidden assumptions, incomplete evidence, and rule blind spots. P6.5 adds an LLM-powered governance review layer that critiques each recommendation from four independent lenses — without ever making a decision.

**This is not P7.** P6.5 improves governance *quality*. P7 (future) improves governance *accuracy over time through learning*. Different goals.

## Pipeline Placement

P6.5 inserts between Recommendation and Queue:

```
DecisionContext  ← P6.0a (deterministic)
     ↓
RiskScore        ← P6.0b (deterministic)
     ↓
Recommendation   ← P6.1  (deterministic)
     ↓
GovernanceReviewCouncil  ← P6.5  (LLM-augmented critique)
     ↓
OperatorQueue    ← P6.2  (deterministic sort, receives review signal)
     ↓
StrategicBrief   ← P6.3  (deterministic synthesis)
```

**Why here:**
- After Recommendation (the last per-proposal deterministic layer) — the review critiques a complete decision artifact
- Before Queue (the first cross-proposal layer) — the review feeds into ordering as an additional signal
- Same pattern as RiskScore feeds Recommendation: each layer enriches without overriding

## Layer Ownership

| Layer | Owns | Must NOT Own |
|-------|------|-------------|
| DecisionContext | Context assembly | Risk evaluation |
| RiskScore | Risk evaluation | Recommendations |
| Recommendation | Decision guidance | Prioritization |
| **GovernanceReviewCouncil** | **Critique of recommendation** | **Decisions, approvals, rejections** |
| Queue | Attention ordering | Approval decisions |
| StrategicBrief | Long-horizon synthesis | Operational actions |

## Non-Negotiables

```
GovernanceReview ≠ Decision
Review ≠ Approval
Challenge ≠ Rejection
Concern ≠ Mutation
LLM critique ≠ authority
```

Every sentence of the design enforces these. A GovernanceReview with `verdict: "challenge"` does not block the proposal — the Queue still shows it, the human still decides. The review is advisory. Always.

## GovernanceReview Artifact

```typescript
interface GovernanceReview extends DecisionArtifact {
  /** The recommendation this review critiques. */
  recommendationId: string;

  /** Proposal being reviewed. */
  proposalId: string;

  /** Council verdict — NOT a decision. */
  verdict: "agree" | "agree_with_concerns" | "challenge" | "insufficient_information";

  /** Specific concerns raised by the council. */
  concerns: string[];

  /** Blind spots the review identified. */
  blindSpots: string[];

  /** Historical analogs surfaced (from Historian lens). */
  historicalAnalogies: string[];

  /** Per-lens scores (each lens contributes independently). */
  lensScores?: LensScore[];

  /** Council aggregation (how the verdict was reached). */
  councilVote?: CouncilVote;

  /** Source artifacts consumed. */
  sourceArtifacts: SourceArtifact[];

  // outcome inherited from DecisionArtifact — always "reviewed"
}

interface LensScore {
  lens: "red_team" | "historian" | "policy_auditor" | "confidence_critic";
  /** The lens's recommended verdict. */
  recommendedVerdict: GovernanceReview["verdict"];
  /** Confidence in this lens's assessment (0-1). */
  confidence: number;
  /** Key rationale from this lens. */
  rationale: string;
}

interface CouncilVote {
  /** Count of lenses that recommended each verdict. */
  agree: number;
  agreeWithConcerns: number;
  challenge: number;
  insufficientInformation: number;
}
```

**No approve/reject fields. No mutation paths. No decision authority.**

### Verdict semantics

| Verdict | Meaning | Operator Response |
|---------|---------|-------------------|
| `agree` | Council sees no issue | No change to queue position |
| `agree_with_concerns` | Recommendation is sound but has caveats | Minor queue boost |
| `challenge` | Council found real problems | Moderate queue boost |
| `insufficient_information` | Council couldn't assess | High queue boost (needs human review) |

### Confidence in review

GovernanceReview.confidence is computed from:
- Number of lenses that reached a definitive verdict (vs. abstaining)
- Agreement among lenses (higher agreement = higher confidence)
- Evidence availability per lens

Formula: `(definitiveLenses / totalLenses) * agreementFactor`

Where `agreementFactor = max(1, 4 - councilStdev) / 4` (1 = perfect agreement, approaches 0 as disagreement grows).

## Four Review Lenses

Each lens is an LLM agent with one job, one prompt, one output. No cross-lens communication during review — each produces its own `LensScore` independently. Aggregation happens after all four return.

### 1. Red Team Lens

**Question:** How could this fail?

Casts a skeptical eye on the recommendation. Looks for:
- Failure scenarios not considered by the deterministic risk model
- Edge cases where the recommendation would cause harm
- Operational risks (timing, dependencies, human factors)
- Attack vectors or adversarial misuse potential

**Prompt structure:**
```
You are a red-team reviewer. Given a recommendation and its context, identify
concrete failure scenarios. Do not make a decision — only surface risks.
```

**Output concerns:** Focused on operational and edge-case risk.

### 2. Historian Lens

**Question:** Have we seen this before?

Consults historical data:
- EvidenceStore (past adaptation events)
- EffectivenessStore (keep/revert outcomes)
- StrategicBrief history (trends, hotspot analysis)

Looks for:
- Past proposals with similar action type and their outcomes
- Action types with elevated revert rates
- Capability areas that have been problematic historically
- Similar proposals that were reverted

**Prompt structure:**
```
You are a historian reviewer. Given a recommendation and historical context,
identify relevant past analogs, their outcomes, and lessons learned.
```

**Consumes:** Pre-loaded historical summaries (not raw stores — the CLI assembles context).

### 3. Policy Auditor Lens

**Question:** Does this violate governance principles?

Checks the recommendation against hard governance rules:
- Recommend≠Decide invariant (is the recommendation staying in lane?)
- Human approval required (does the recommendation try to bypass?)
- No auto-approve/auto-reject patterns
- Capability routing constraints
- Any violation of ALiX constitutional rules

**Prompt structure:**
```
You are a policy auditor. Given a recommendation and governance context,
identify any policy violations. Be precise — cite the violated rule.
```

**Output concerns:** Governance violations, rule boundary tests, constitutional conflicts.

### 4. Confidence Critic Lens

**Question:** What evidence is missing?

Evaluates the evidence underpinning the recommendation:
- Is the context completeness adequate?
- Are sample sizes sufficient for the risk level?
- Are there data gaps or stale artifacts?
- Is the confidence score justified by the evidence?

**Prompt structure:**
```
You are a confidence critic. Given a recommendation and its evidence base,
identify what evidence is missing, weak, or stale.
```

**Output concerns:** Missing artifacts, thin data, stale context, unwarranted confidence.

## Council Aggregation Rules

After all four lenses return their `LensScore`, the council aggregates deterministically:

### Step 1: Count by verdict

```typescript
function aggregateVerdict(lensScores: LensScore[]): {
  verdict: GovernanceReview["verdict"];
  councilVote: CouncilVote;
} {
  const councilVote: CouncilVote = {
    agree: 0, agreeWithConcerns: 0, challenge: 0, insufficientInformation: 0,
  };

  for (const score of lensScores) {
    councilVote[score.recommendedVerdict === "insufficient_information"
      ? "insufficientInformation"
      : score.recommendedVerdict === "agree_with_concerns"
      ? "agreeWithConcerns"
      : score.recommendedVerdict]++;
  }

  // Plurality rule (most votes wins)
  const entries = Object.entries(councilVote) as [keyof CouncilVote, number][];
  const maxVotes = Math.max(...entries.map(([, v]) => v));
  const winners = entries.filter(([, v]) => v === maxVotes);

  // Map back to verdict (plurality)
  const verdictMap: Record<keyof CouncilVote, GovernanceReview["verdict"]> = {
    agree: "agree",
    agreeWithConcerns: "agree_with_concerns",
    challenge: "challenge",
    insufficientInformation: "insufficient_information",
  };

  // On tie: escalate to most severe among tied verdicts
  const severityRank: Record<GovernanceReview["verdict"], number> = {
    agree: 0,
    agree_with_concerns: 1,
    challenge: 2,
    insufficient_information: 3,
  };

  const tieWinner = winners.sort(
    (a, b) => severityRank[verdictMap[b[0]]] - severityRank[verdictMap[a[0]]],
  )[0];

  return { verdict: verdictMap[tieWinner[0]], councilVote };
}
```

### Step 2: Compute confidence

```typescript
function computeReviewConfidence(
  lensScores: LensScore[],
  verdict: GovernanceReview["verdict"],
): number {
  const definitive = lensScores.filter((s) => s.recommendedVerdict !== "insufficient_information");
  if (definitive.length === 0) return 0;

  const definitiveRatio = definitive.length / lensScores.length;

  // Agreement factor: how many lenses match the final verdict
  const agreementCount = definitive.filter((s) => s.recommendedVerdict === verdict).length;
  const agreementFactor = agreementCount / definitive.length;

  // Average lens confidence among definitive lenses
  const avgLensConfidence = definitive.reduce((sum, s) => sum + s.confidence, 0) / definitive.length;

  return definitiveRatio * agreementFactor * avgLensConfidence;
}
```

### Step 3: Deduplicate concerns

Concerns from all lenses are merged, deduplicated by similarity (exact match on `rationale` text), and ordered by severity. Blind spots are merged similarly.

## Queue Integration

### Current sort order (P6.2)

1. RiskScore.overallRisk descending (primary)
2. Recommendation rank descending (secondary)
3. DecisionContext.ageDays descending (tertiary)
4. proposalId ascending (tiebreaker)

### New sort order (P6.5)

1. RiskScore.overallRisk descending (primary)
2. Recommendation rank descending (secondary)
3. **Governance review severity descending** (tertiary — NEW)
4. DecisionContext.ageDays descending (quaternary)
5. proposalId ascending (tiebreaker)

### Governance review severity rank

```typescript
const GOVERNANCE_REVIEW_SEVERITY: Record<GovernanceVerdict, number> = {
  agree: 0,                       // no signal — no impact
  agree_with_concerns: 1,         // minor signal
  challenge: 2,                   // significant signal
  insufficient_information: 3,    // needs human eyes — highest boost
};
```

**The review only boosts queue position; it never demotes.** If no review is available, severity = 0 (no impact). The existing P6.2 sort is unchanged for unreviewed proposals.

### QueueItem changes

```typescript
// NEW fields on QueueItem:
interface QueueItem extends DecisionArtifact {
  // ...existing fields...
  governanceReviewId?: string;
  governanceVerdict?: GovernanceVerdict;
  ordering: QueueItemOrdering & {
    /** Governance review severity (0-3). 0 = no review or agree. */
    reviewSeverity: number;
  };
}
```

### QueueInput changes

```typescript
// NEW optional field on QueueInput:
export interface QueueInput {
  ctx: DecisionContext;
  riskScore?: RiskScore;
  recommendation?: ApprovalRecommendation;
  governanceReview?: GovernanceReview;  // NEW — optional, missing = no signal
}
```

## CLI

### Review command

```bash
alix decision review <proposal-id>          # Run all 4 lenses, show terminal output
alix decision review <proposal-id> --json   # Full GovernanceReview as JSON
alix decision review <proposal-id> --lens historian  # Run a single lens only
```

### Queue with reviews

```bash
alix decision queue                          # Current behavior (no review signal)
alix decision queue --with-reviews           # Show governance verdict per item
alix decision queue --limit 5 --with-reviews # Combined
```

### Terminal output (review)

```
Governance Review: prop-2026-06-21-042
═══════════════════════════════════════════

Recommendation: Approve (confidence: 0.87)

Council verdict: agree_with_concerns (3 agree, 1 challenge)

Concerns (3):
  ⚠ Proceed with caution — capability-area revert rate is 22%
  ⚠ Historical analog: prop-2026-06-15-008 (similar change, reverted)
  ⚠ No rollback validation evidence found

Blind spots (1):
  · No assessment of downstream capability impact

Confidence in review: 0.72
```

### Terminal output (queue with reviews)

```
Operator Queue: 5 pending proposal(s)
═══════════════════════════════════════

 1. 🔴 prop-2026-06-21-042  challenge  risk: 0.82  review: challenge  ⚠️
 2. 🟠 prop-2026-06-20-101  reject     risk: 0.71
 3. 🟡 prop-2026-06-19-055  defer      risk: 0.45
 4. ⚪ prop-2026-06-18-022  approve    risk: 0.30  review: agree
 5. ⚪ prop-2026-06-17-008  approve    risk: 0.12  review: agree_with_concerns
```

## Governance Sentinels

### No decision authority sentinel

Tests verify that `governance-review.ts` does NOT contain:
- `.approve(`, `.reject(`, `.apply(`, `.execute(`
- `status: "approved"`, `status: "rejected"` (writing, not reading)
- Any mutation calls on proposals or stores

### No store mutation sentinel

Tests verify the review module does NOT import:
- `ProposalStore`, `EvidenceStore.save` (read-only access via CLI context is allowed)
- Any module from `src/security/` or `src/workflow/` (execution paths)
- `approval-gate` or `applier` modules

### Intelligence Law sentinel

Tests verify each lens prompt file does NOT contain:
- Decision language ("I approve", "I reject", "I recommend")
- Action language ("apply this", "execute this")
- Priority language ("this should be first", "prioritize this")

The lens prompts must stay in critique-only territory.

### Purity sentinel

Tests verify the GovernanceReviewCouncil aggregation logic is deterministic:
- No LLM calls in aggregation (the four lenses call LLMs; the council that aggregates their outputs is deterministic)
- No randomness in tiebreaking
- No side effects during aggregation

## Tests

### GovernanceReview type shape

| Test | Scenario |
|------|----------|
| Extends DecisionArtifact | Has id, subject, outcome, confidence, reasons, generatedAt |
| outcome is "reviewed" | Stable semantic value |
| Has recommendationId, proposalId, verdict | Identity and verdict |
| Has concerns, blindSpots, historicalAnalogies | Content fields |
| LensScore has lens, recommendedVerdict, confidence, rationale | Per-lens shape |
| CouncilVote has counts for all 4 categories | Aggregation shape |

### Council aggregation tests

| Test | Scenario |
|------|----------|
| 4 lenses all agree → verdict "agree" | Unanimous |
| 2 agree, 2 challenge → tie resolves to "challenge" (most severe) | Tiebreaker |
| 1 agree, 2 agree_with_concerns, 1 challenge → "agree_with_concerns" | Plurality |
| All insufficient_information → "insufficient_information" | No definitive |
| 3 agree, 1 insufficient_information → "agree" (counts exclude abstain) | Abstention |

### Queue sort integration tests

| Test | Scenario |
|------|----------|
| Same risk + recommendation, review severity breaks tie | Review as tiebreaker |
| No review → severity 0 (no impact) | Missing review |
| Challenge verdict → boosted above agree | Severity rank |

### Governance sentinel tests

| Test | Scenario |
|------|----------|
| No approve/reject/apply/execute in source | No mutation |
| No ProposalStore import in review module | No store mutation |
| Lens prompts contain critique only, no decisions | Intelligence Law |
| Aggregation is deterministic | No randomness, no LLM calls |

## File Structure

```
Create:
  src/adaptation/governance-review-types.ts    — GovernanceReview, LensScore, CouncilVote, GovernanceVerdict
  src/adaptation/governance-review-council.ts   — GovernanceReviewCouncil class (aggregation logic)
  src/adaptation/lens-agent.ts                  — LensAgent base (prompt + LLM call per lens)
  src/adaptation/lens-prompts.ts                — Prompt templates for all 4 lenses
  tests/adaptation/governance-review-types.vitest.ts
  tests/adaptation/governance-review-council.vitest.ts
  tests/adaptation/governance-review-sentinels.vitest.ts

Modify:
  src/adaptation/operator-queue-types.ts        — Add governanceReviewId, governanceVerdict to QueueItem; governanceReview to QueueInput; reviewSeverity to QueueItemOrdering
  src/adaptation/operator-queue.ts              — Add review severity to sort order (tertiary)
  src/adaptation/decision-types.ts              — Add "review" to SourceArtifactType
  src/cli/commands/decision.ts                  — Add runReview handler, case "review" in switch; --with-reviews flag for runQueue
```

## Acceptance Criteria

1. `GovernanceReview` extends `DecisionArtifact` with proposalId, recommendationId, verdict, concerns, blindSpots, historicalAnalogies, lensScores, councilVote
2. `Council.aggregate(lensScores)` returns deterministic verdict and council vote for any valid input
3. Tiebreaker resolves to most severe verdict among tied positions
4. Queue sorts with review severity as tertiary key (between recommendation rank and age)
5. No review → severity 0 (no sort impact)
6. `alix decision review <id>` runs all 4 lenses and displays terminal output
7. `alix decision queue --with-reviews` shows governance verdict per item
8. Four governance sentinel groups pass
9. All existing tests pass (no changes to existing sort behavior for proposals without reviews)
10. Lens prompts contain no decision or action language

## Out of Scope

| Feature | Belongs to | Reason |
|---------|-----------|--------|
| Persisting GovernanceReview to disk | Future | Reviews are ephemeral — re-run when needed |
| Auto-rejection based on review verdict | Never | Would violate Review ≠ Decision |
| Learning from past reviews (P7) | P7 Decision Learning | Different goal (accuracy over time) |
| Human review feedback loop | Future | This is LLM critique only |
| Lens prompt tuning / iteration | Operations | Not an architectural concern |
| Rate-limiting LLM calls | Infrastructure | Outside P6 scope |
| Caching review results | Future | Re-review on demand is simpler |
