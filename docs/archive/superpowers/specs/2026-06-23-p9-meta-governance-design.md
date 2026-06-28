# P9 — Meta-Governance Design Spec (SDS)

> **Status:** SDS — design phase. Not yet approved.
> **Spec home (on approval):** `docs/superpowers/specs/2026-06-23-p9-meta-governance-design.md`
> **Governs:** `feature/p9-meta-governance` branch, off `main` at P8.5b squash.

## Core framing

```text
P8 asks:  How should ALiX improve itself?
P9 asks:  How do we govern ALiX's self-improvement process?
```

P8 built the substrate: persistence (P7.5p), calibration adapters (P8.5a.2), explainability (P8.5c), and operational visibility (P8.5b). P9 is the **governance layer over that substrate**.

It does not rebuild any of P8. It reads from P8's outputs and evaluates whether those outputs indicate healthy governance or drift.

## Hard governance boundary (non-negotiable)

```text
P9 evaluates governance.
P9 does not change governance.

Meta-Governance ≠ Self-Mutation.
```

**P9 can:**
- Read from all P8 stores (OutcomeStore, RecommendationStore, RiskScoreStore, GovernanceReviewStore, LearningStore, EvidenceChainStore)
- Read ProposalExplanation from the Explain assembler
- Read DashboardReport from the Dashboard aggregator
- Produce analysis reports (GovernanceHealthReport, GovernanceDriftReport, etc.)
- Create pending Proposals for governance changes (following the P5 lifecycle: propose → approve → apply)

**P9 cannot:**
- Modify policies directly
- Retire or change lenses directly
- Mutate governance mechanisms bypassing proposals
- Bypass the existing approve/apply lifecycle
- Create, approve, or apply its own proposals
- Write to any P7.5p/P8.5a store without a proposal lifecycle
- Import or invoke CLI renderers, terminal formatters, or dashboard presentation code — P9 builders consume stores, explain assemblers, and dashboard aggregators only. Presentation logic stays in P9's own CLI renderer.

## The 8 design questions

### 1. What does P9 consume?

P9 is a **read-only consumer** of all P8 infrastructure:

| P8 output | What P9 reads | How |
|---|---|---|
| OutcomeStore | OutcomeRecord per proposal | Direct store read |
| LearningStore | LearningSignals by adapter + signalType | querySignals({ windowDays }) |
| LearningStore | CalibrationProfiles | queryProfiles({ windowDays }) |
| EvidenceChainStore | ProvenanceLinks | getChainForRoot, listChains |
| ProposalExplanation | 6-layer explanation + joinPath per layer | assembleProposalExplanation() |
| DashboardReport | AggregatedIntegrity + dashboardIntegrityScore | buildDashboardReport() |
| GovernanceReviewStore | Lens scores, concerns, verdicts | queryByWindow, queryByProposal |

P9 does NOT build its own joins or duplicate explanation logic. The DashboardAggregator and Explain assembler are the canonical sources.

### 2. What artifacts does P9 produce?

P9 produces **analysis artifacts** that separate objective measurements from subjective conclusions. These are stored in a new `GovernanceStore` (append-only JSONL, same pattern as P7.5p):

```ts
/**
 * Raw governance measurements — objective, verifiable, no interpretation.
 * P10 Executive Intelligence consumes this layer directly.
 */
export interface GovernanceHealthReport extends DecisionArtifact {
  reportType: "governance_health";
  /** Summary statistics (objective). */
  totalReviews: number;
  totalProposals: number;
  lensEffectiveness: Record<string, number>;  // lensName → predictiveValue
  policyCoverage: number;                      // %
  /** Sources consumed (from P8). */
  sourceMetrics: {
    dashboardIntegrityScore: number | null;
    explanationCompleteness: number | null;
    evidenceChainUsage: number | null;
    incompleteChainLayers: number;
  };
}

/**
 * Interpretation of health measurements — subjective, opinionated.
 * Separated from GovernanceHealthReport so P10 can consume raw
 * metrics independently of governance judgments.
 */
export interface GovernanceAssessment extends DecisionArtifact {
  reportType: "governance_assessment";
  governanceConfidence: number;                // 0-1
  unresolvedGovernanceIssues: number;
  assessmentNotes: string[];
}

export interface GovernanceDriftReport extends DecisionArtifact {
  reportType: "governance_drift";
  findings: DriftFinding[];
}

export interface DriftFinding {
  driftType: "lens_drift" | "policy_drift" | "confidence_drift" | "chain_coverage_drop";
  detectedAt: string;
  severity: "low" | "medium" | "high" | "critical";
  /** How certain the detector is about this finding (0-1). */
  confidence: number;
  evidenceRefs: string[];
  description: string;
  recommendation: string;
}

export interface LensLifecycleReview extends DecisionArtifact {
  reportType: "lens_lifecycle";
  lensReviews: {
    lens: LensName;
    predictiveValue: number;
    reviewsAnalyzed: number;
    falseAlarms: number;
    missedFailures: number;
    recommendation: "keep" | "promote" | "demote" | "retire";
    reason: string;
  }[];
}

/**
 * Meta-governance evaluation of governance quality itself.
 * Equivalent to P8.5c's explanationIntegrity but for governance artifacts.
 */
export interface GovernanceIntegrityReport extends DecisionArtifact {
  reportType: "governance_integrity";
  metrics: {
    totalReviews: number;
    reviewsWithProvenance: number;     // reviews linked via EvidenceChain
    reviewsWithExplanations: number;   // reviews explainable via alix explain
    reviewsLinkedToOutcomes: number;   // reviews where outcome exists
    untraceableFindings: number;       // findings without evidence chain
    provenanceRate: number;            // %
    explanationRate: number;           // %
    outcomeLinkRate: number;           // %
  };
}
```

### 3. How does P9 detect governance drift?

Three drift detectors, each consuming specific P8 outputs:

**Confidence drift** — checks whether recommendation confidence consistently exceeds observed success rates. Reads: `LearningStore.querySignals({ signalTypes: ["overconfidence", "underconfidence"] })`. If overconfidence signals dominate over a window, a `confidence_drift` finding is emitted.

**Chain coverage drop** — checks whether `evidenceChainUsage` from DashboardReport drops below a threshold (default: < 60%). A sustained drop in chain coverage means proposals are being executed without provenance linking. Reads: `buildDashboardReport().explanationIntegrity.evidenceChainUsage`.

**Lens drift** — checks whether any governance lens's predictive value has degraded below its historical baseline. Reads: LensCalibrationReport from the dashboard or directly from calibration profiles.

### 4. How does P9 produce a LensLifecycleReview?

Reuses the P8.3 GovernanceCalibrationBuilder's output (already in LearningStore). For each lens:
- If `predictiveValue > 0.7` and `reviewsAnalyzed > 20`: recommend `promote`
- If `predictiveValue < 0.4` and `reviewsAnalyzed > 20`: recommend `demote`
- If `predictiveValue < 0.2` and `reviewsAnalyzed > 30`: recommend `retire`
- If `falseAlarms > 10` and `falseAlarmRate > 0.4`: recommend `demote`
- Default: `keep`

This is PURE analysis — the review recommends, it does not implement.

### 5. Does P9 generate proposals?

**Not in P9.0.** Proposal generation is the first place P9 begins influencing the system. Even though approval is still external, proposal creation changes operator attention and governance workload. Validate the analysis layer first.

**P9.0** — analysis only:
- Produces `GovernanceHealthReport`, `GovernanceAssessment`, `GovernanceDriftReport`, `LensLifecycleReview`, `GovernanceIntegrityReport`
- No proposals. No lifecycle interaction. Reports are read-only governance artifacts.

**P9.1** — recommendations (future):
- Adds `GovernanceRecommendation` — advisory, no lifecycle binding
- Still no proposals

**P9.2** — proposal generation (future):
- Adds pending `governance_change` proposals through the existing `approve → apply` lifecycle
- Same lifecycle as P5: propose → approve → apply. No auto-approval, no auto-apply.

### 6. What new infrastructure does P9 need?

Minimal — P9 is mostly analysis over existing data.

**New store:** `GovernanceStore` (append-only JSONL at `.alix/governance/`). Each artifact type gets its own JSONL file for clean separation — avoids expensive filtering and simplifies retention policies. Stores all 5 P9.0 artifact types:

```text
.alix/governance/
  health.jsonl         # GovernanceHealthReport (measurements)
  assessment.jsonl     # GovernanceAssessment (interpretation)
  drift.jsonl          # GovernanceDriftReport (drift findings)
  lens-reviews.jsonl   # LensLifecycleReview (lens lifecycle recommendations)
  integrity.jsonl      # GovernanceIntegrityReport (meta-governance evaluation)
```

**New CLI surface:** `alix governance` — subcommands:
- `alix governance health` — show GovernanceHealthReport
- `alix governance drift` — run drift detection
- `alix governance lens-review` — run lens lifecycle review

**New files:**
```text
src/governance/governance-types.ts           # Report types (5 artifact types)
src/governance/governance-store.ts           # Append-only store
src/governance/governance-health-builder.ts  # Pure: reads P8 outputs → GovernanceHealthReport
src/governance/governance-assessment.ts      # Pure: interpretation → GovernanceAssessment
src/governance/governance-drift-detector.ts  # Pure: drift detection
src/governance/governance-lens-review.ts     # Pure: lens lifecycle analysis
src/governance/governance-integrity.ts       # Pure: GovernanceIntegrityReport
src/cli/commands/governance.ts              # CLI dispatcher
tests/governance/                           # Tests per builder
tests/cli/commands/governance-cli.vitest.ts  # CLI tests
```

### 7. How does P9 integrate with the existing lifecycle?

P9's analysis artifacts are **DecisionArtifacts** (to maintain provenance):

```text
GovernanceHealthReport
  ├── sourceMetrics: DashboardIntegrityScore
  ├── evidenceRefs: [LearningSignals, proposals, outcomes]
  └── generatedBy: "alix governance health"

GovernanceDriftReport
  ├── findings: DriftFinding[]
  ├── evidenceRefs: [ProposalExplanation, LearningStore, EvidenceChain]
  └── generatedBy: "alix governance drift"
```

These artifacts participate in the EvidenceChain. A future P9 explainer entrypoint will explain them (deferred, not part of P8.5c):

```bash
alix explain governance gov-health-001
alix explain governance drift-001
alix explain governance lens-review-001
alix explain governance integrity-001
```

P8.5c remains proposal-centric: `alix explain proposal <id>`. Governance artifacts have their own explain path, preserving the clean artifact taxonomy established since P5.

### 8. What prevents P9 from becoming self-mutating?

**P9.0 produces reports only, not proposals.** The self-mutation risk is structurally eliminated because there are no proposals to approve.

The structural protections for P9.0:

1. **P9 analysis is read-only** — all analysis functions are pure (read P8 stores, produce reports).
2. **P9 does not import ApprovalGate, appliers, or AutomaticProposalGenerator** — no mutation surface exists in P9.0 code.
3. **P9 does not write to P8 stores** — GovernanceStore is the only store P9 writes to; it never touches OutcomeStore, LearningStore, EvidenceChainStore, or any other P8 substrate.
4. **Governance reports are DecisionArtifacts** — they participate in EvidenceChain and Explain, providing auditability.
5. **Sentinel-enforced** — `tests/governance/governance-sentinels.vitest.ts` forbids imports of ApprovalGate, appliers, AutomaticProposalGenerator, and all P8 store write methods.

## CLI examples

```bash
# Governance health report
alix governance health
→ Governance Health Report
  Confidence: 0.84
  Lens Effectiveness:
    red_team:          0.72 (promote)
    historian:         0.65 (keep)
    policy_auditor:    0.31 (demote)
    confidence_critic: 0.18 (retire)
  Source Metrics:
    Dashboard Integrity: 92/100
    Explanation Completeness: 83.3%
    Evidence Chain Usage: 81%

# Drift detection
alix governance drift
→ Drift Findings: 2
  🔴 CRITICAL: Confidence drift detected
     Overconfidence signals: 14 (70% of all signals)
  🟡 WARNING: Chain coverage dropping
     Current: 55% (below 60% threshold)

# Lens lifecycle review
alix governance lens-review
→ Lens Lifecycle Review
  red_team:          keep    (PV 0.72, 28 reviews)
  historian:         keep    (PV 0.65, 22 reviews)
  policy_auditor:    demote  (PV 0.31, 25 reviews)
  confidence_critic: retire  (PV 0.18, 32 reviews, 14 false alarms)
```

## Acceptance criteria

### Functional

```text
Given complete P8 stores with signals, explanations, and dashboard data:

alix governance health      → returns GovernanceHealthReport + GovernanceAssessment
alix governance drift       → detects drift when overconfidence > 50%
alix governance lens-review → recommends retire for lens with PV < 0.2
alix governance integrity   → returns GovernanceIntegrityReport with provenance/explanation rates
```

### Read-only invariant

```text
P9 may write only GovernanceStore.
P9 may not write:
- OutcomeStore
- RecommendationStore
- RiskScoreStore
- GovernanceReviewStore
- LearningStore
- EvidenceChainStore
```

Verified by purity sentinel — each forbidden store is explicitly in the deny list.

### No proposal lifecycle (P9.0)

```text
P9.0 produces reports only, not proposals.
No proposal generation. No lifecycle interaction.
Governance reports are read-only DecisionArtifacts.
Verifiable by absence of ProposalStore imports and proposal lifecycle calls.
```

## Out of scope

| Feature | Reason |
|---|---|
| Automatic governance adjustment | Violates Meta-Governance ≠ Self-Mutation invariant |
| Policy definition language | Future — P9 works with existing policy mechanisms |
| Cross-instance governance | Future — P9 is single-instance for now |
| Governance rollback | Future — P5 revert lifecycle applies |

## What this depends on from P8

| P8 phase | How P9 uses it |
|---|---|
| P7.5p.1-3 (persistence) | Reads OutcomeStore, RiskScoreStore, GovernanceReviewStore |
| P8.5a.0 (Evidence Chain) | Reads ProvenanceLinks for chain coverage checks |
| P8.5a.2 (adapters) | Reads LearningStore signals for drift detection |
| P8.5c (Explain) | Reads ProposalExplanation for explanation integrity |
| P8.5b (Dashboard) | Reads dashboardIntegrityScore for source metrics |
| P8.5b (Dashboard renderer) | NO — governance has its own terminal rendering |

The dependency chain is: **P9 reads P8, P8 does not know P9 exists.** No circular dependencies, no modifications to P8 code, no new coupling.
