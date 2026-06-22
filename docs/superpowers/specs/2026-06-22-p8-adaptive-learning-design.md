# P8 — Adaptive Learning

> **Status:** Spec
> **Software delivery:** Split into P8.0a–P8.8 (10 sub-phases).
> **P8.0a ships:** Learning types + governance sentinels (no store yet)
> **P8.0b ships:** LearningStore (append-only, deferred until builders prove the shape)
> **P8.1 ships:** Recommendation calibration signal builder + proposals
> **P8.2 ships:** Risk calibration signal builder + proposals
> **P8.3 ships:** Governance calibration signal builder + proposals
> **P8.4 ships:** Routing calibration signal builder + proposals
> **P8.5 ships:** Proposal integration — all P8 outputs enter the existing lifecycle
> **P8.6 ships:** Expanded governance sentinels
> **P8.7 ships:** `alix learning` CLI subcommands
> **P8.8 ships:** Release gate checklist + integration tests
> **Slice:** P8 Adaptive Learning — the first phase where ALiX makes recommendations about its own decision-making process.
> **Builds on:** P7 Outcome Intelligence (outcome records, accuracy reports, lens calibration reports)
> **Risk level:** HIGH — this is meta-intelligence. ALiX begins proposing changes to its own calibration. The invariant *Learning proposes. Governance approves.* must be enforced everywhere.
> **Core invariant:** Learning ≠ Mutation. Proposal ≠ Approval. Signal ≠ Action.

## Core Framing

**Core question:** How should ALiX improve future recommendations using measured outcomes?

P7 established outcome measurement. ALiX can now answer: *Was that recommendation correct?* P8 adds the learning loop: *Given what we observed, what should we change?*

**This is meta-intelligence.** P6 was decision intelligence ("what should we recommend?"). P7 was outcome intelligence ("was it right?"). P8 is learning intelligence ("how should we change based on what we learned?").

The critical design constraint: **learning must never become self-authorizing.** Every learning output is a proposal. Every proposal requires human approval before any calibration changes. The system that measures and the system that changes are separated by the full governance lifecycle.

### Intelligence Law Boundary

| Phase | Answers | Mutates? |
|-------|---------|----------|
| P6 | What deserves attention? | No — read-only analysis |
| P7 | Was it right? | No — append-only measurement |
| **P8** | **How should we change?** | **No — proposal-only. Mutation requires approval.** |

### Pipeline Placement

```
P7 Outcome Intelligence
  ↓  (outcome records, accuracy reports, lens calibration reports)
P8 Learning Signal Builders  ← P8.0–P8.4
  ↓  (LearningSignal[], CalibrationProfile[])
P8 Learning Proposal Integration  ← P8.5
  ↓  (AdaptationProposal with action: "learning_adjustment")
Existing Proposal Lifecycle
  → Governance Review (P6.5)
  → Operator Queue (P6.2)
  → Human Approval
  ↓
P8 calibration does not take effect in P8.
Approved learning_adjustment proposals become operator-approved intent.
Actual calibration application is deferred to P8.9/P9.
```

## Non-Negotiables

```
Learning ≠ Mutation
Signal ≠ Action
Proposal ≠ Approval
Calibration file ≠ applied configuration
Learning cannot write calibration profiles directly
Learning cannot modify routing tables directly
Learning cannot modify governance weights directly
Learning cannot approve its own proposals
Learning cannot apply its own proposals
Learning cannot bypass the proposal lifecycle
```

Every line of code in P8 enforces these. The sentinel file (P8.6) is not optional — it is the release gate for P8.

---

## P8.0a — Learning Foundations (Types + Sentinels)

> **Slice first:** Types and sentinels only. No store, no builders, no CLI. The sentinels define the safety boundary before any code that produces data exists.

### Purpose

Define the core data types and the structural sentinels that all P8 sub-phases build on. The LearningStore is deferred to P8.0b — builders should prove the shape before persistence is introduced.

### Core Question

What types and structural safety boundaries does ALiX need before any learning code can be written?

### Data Model

#### LearningSignal

A single observed signal derived from comparing expected vs actual outcomes.

```typescript
interface LearningSignal extends DecisionArtifact {
  /** Source report that produced this signal. */
  sourceReportId: string;

  /** Classification of the signal. */
  signalType:
    | "overconfidence"
    | "underconfidence"
    | "risk_dimension_overfire"
    | "risk_dimension_miss"
    | "risk_dimension_ignored"
    | "lens_high_predictive_value"
    | "lens_low_predictive_value"
    | "lens_high_false_positive"
    | "lens_high_miss_rate"
    | "routing_quality_good"
    | "routing_quality_poor"
    | "routing_cost_efficient"
    | "routing_cost_inefficient"
    | "routing_latency_concern";

  /** How strong the signal is (0–1). Higher = more evidence. */
  strength: number;

  /** Confidence in the signal itself (0–1). */
  confidence: number;

  /** Human-readable summary of what was observed. */
  summary: string;

  /** Evidence references pointing to P7 artifacts. */
  evidenceRefs: string[];

  /** Quantitative delta: expected vs observed. */
  delta?: {
    expected: number;
    observed: number;
    unit: string;
  };
}
```

#### CalibrationProfile

A suggested adjustment to a calibrated value. Never applied — only proposed.

```typescript
interface CalibrationProfile extends DecisionArtifact {
  /** What is being calibrated. */
  target:
    | "recommendation_confidence_multiplier"
    | "risk_dimension_weight"
    | "governance_lens_weight"
    | "routing_model_preference";

  /** Human-readable name of the specific target. */
  targetName: string;

  /** Current value before adjustment. */
  previousValue: number;

  /** Suggested new value. */
  suggestedValue: number;

  /** Confidence in this calibration suggestion (0–1). */
  confidence: number;

  /** Reason for the suggested change. */
  reason: string;

  /** Evidence references supporting this calibration. */
  evidenceRefs: string[];

  /** Source LearningSignal IDs that drove this profile. */
  sourceSignalIds: string[];
}
```

#### LearningProposal

A proposal to apply one or more calibration changes. Enters the standard proposal lifecycle.

```typescript
interface LearningProposal extends DecisionArtifact {
  /** What kind of learning adjustment. */
  proposalType:
    | "recommendation_calibration"
    | "risk_calibration"
    | "governance_calibration"
    | "routing_calibration";

  /** The calibration profiles this proposal would apply. */
  profiles: CalibrationProfile[];

  /** Expected benefit if applied. */
  expectedBenefit: string;

  /** Risk estimate if applied incorrectly. */
  riskEstimate: string;

  /** Source LearningSignal IDs. */
  sourceSignalIds: string[];

  /** Whether human approval is required (always true in P8). */
  requiresApproval: true;
}
```

#### LearningReport

Aggregated summary of all learning signals in a window.

```typescript
interface LearningReport extends DecisionArtifact {
  /** Time window in days. */
  windowDays: number;

  /** ISO 8601 range. */
  windowStart: string;
  windowEnd: string;

  /** All signals in the window. */
  signals: LearningSignal[];

  /** Calibration profiles generated from signals. */
  profiles: CalibrationProfile[];

  /** Summary sections, one per signal type group. */
  sections: LearningReportSection[];

  /** Cross-cutting patterns found. */
  patterns?: LearningPattern[];
}

interface LearningReportSection {
  title: string;
  summary: string;
  signals: LearningSignal[];
  profiles: CalibrationProfile[];
  recommendation: string;
}

interface LearningPattern {
  description: string;
  affectedSignals: string[];
  recurrenceCount: number;
  severity: "info" | "warning" | "significant";
}
```

### Governance Invariants (P8.0a)

- LearningSignal has NO mutation methods — it's a data object
- CalibrationProfile is a data object, not a writer — no `.apply()` or `.save()` methods
- No learning module may import any applier, writer, or mutation path
- Sentinels are written before any builder code (P8.6 starts in P8.0a)

### Test Strategy (P8.0a)

- Types instantiate with correct field shapes
- LearningSignal requires valid signalType from the union
- CalibrationProfile requires previousValue and suggestedValue
- Sentinel file exists and passes (initially empty, amended per sub-phase)

---

## P8.0b — LearningStore (Append-Only)

> **Deferred until at least one calibration builder (P8.1–P8.4) exists and proves the shape.**
> Do not implement P8.0b during P8.0a. The store should emerge from what the builders actually need, not from speculation.

### Purpose

Provide append-only persistence for learning signals, calibration profiles, and learning reports.

### Core Question

How should learning artifacts be stored without introducing mutation paths?

### Interface

```typescript
interface LearningStore {
  /** Append a signal. Returns the signal with generated ID. */
  appendSignal(signal: LearningSignal): Promise<LearningSignal>;

  /** Append a profile. */
  appendProfile(profile: CalibrationProfile): Promise<CalibrationProfile>;

  /** Append a report. */
  appendReport(report: LearningReport): Promise<LearningReport>;

  /** Query signals by type and time window. */
  querySignals(opts: {
    signalTypes?: string[];
    windowDays?: number;
    limit?: number;
  }): Promise<LearningSignal[]>;

  /** Query profiles by target and time window. */
  queryProfiles(opts: {
    targets?: string[];
    windowDays?: number;
  }): Promise<CalibrationProfile[]>;
}
```

**Storage:** JSONL files under `.alix/learning/signals.jsonl`, `.alix/learning/profiles.jsonl`, `.alix/learning/reports.jsonl`.

**Append-only invariant:** No delete or update methods. No clear or truncate. Historical signals must never be modified.

### Governance Invariants (P8.0b)

- Same as P8.0a, plus:
- LearningStore has NO delete, update, clear, or truncate methods
- LearningStore cannot import any applier, writer, or mutation path

### Test Strategy (P8.0b)

- Append a signal → read it back → verify fields
- Append multiple signals → query by type → verify filtering
- Append-only: assert that no delete/update/clear/truncate methods exist
- Store directory doesn't exist → auto-creates
- Corrupt line in JSONL → skips without crashing

---

## P8.1 — Recommendation Calibration

### Purpose

Detect overconfidence and underconfidence in ALiX's recommendation engine, and propose confidence multiplier adjustments.

### Core Question

When ALiX says "I'm 90% confident" and is only right 55% of the time, how should it adjust?

### Inputs Consumed

- **OutcomeStore** (P7): outcome records with `subjectType: "recommendation"` and observed verdicts
- **RecommendationAccuracyReport** (P7b): per-bucket accuracy data with confidence intervals

### Processing Logic

```
For each recommendation_confidence bucket (0.0–0.1, 0.1–0.2, ..., 0.9–1.0):
  expected = bucket midpoint (e.g., 0.85 for 0.8–0.9)
  observed = outcomes in bucket where outcome === "success"

  delta = observed - expected

  if delta < -threshold:
    signal = overconfidence (confidence too high for observed accuracy)
  if delta > +threshold:
    signal = underconfidence (confidence too low for observed accuracy)

  strength = abs(delta)  // 0–1 scale
  confidence = f(sample_size)  // more samples = higher confidence

If observed accuracy deviates consistently:
  profile.suggestedValue = expected * adjustment_factor
  profile.previousValue = current_confidence_multiplier
```

### Signals Produced

| Signal Type | When |
|-------------|------|
| `overconfidence` | Observed success rate < expected confidence by ≥ threshold |
| `underconfidence` | Observed success rate > expected confidence by ≥ threshold |

### Calibration Profile Produced

| Target | Value |
|--------|-------|
| `recommendation_confidence_multiplier` | Adjusted multiplier per confidence bucket |

### Example

```
Recommendation confidence: 0.90
Observed success rate:    0.55
Delta:                    -0.35

Signal: overconfidence (strength: 0.35, confidence: 0.85)
Profile: Reduce confidence_multiplier from 1.0 to 0.65 for bucket 0.8–1.0
```

### Governance Invariants (P8.1)

- CalibrationBuilder cannot import applier modules
- CalibrationBuilder cannot call `proposalStore.save` — it returns data, it doesn't persist
- All calibration profiles are data objects; no side effects
- The CLI's `propose` subcommand is the only path that saves to ProposalStore

### Test Strategy

- Perfect calibration (expected == observed) → zero signals
- Overconfident bucket → overconfidence signal with correct delta
- Underconfident bucket → underconfidence signal with correct delta
- Small sample size → signal has low confidence
- Empty outcomes → zero signals (no crash)
- Threshold boundary: delta < threshold → no signal
- Profile has correct `previousValue` and `suggestedValue`

---

## P8.2 — Risk Calibration

### Purpose

Identify which risk dimensions are overfiring (false positives), missing real failures, or being ignored entirely, and propose weight adjustments.

### Core Question

When the risk scorer flags "security" at 0.9 and nothing bad happens, or flags everything at 0.1 and a failure occurs, how should risk weights be adjusted?

### Inputs Consumed

- **RiskAssessment records** (P6.0b): per-proposal risk scores by dimension
- **OutcomeStore** (P7): observed outcomes for risk-assessed proposals

### Processing Logic

```
For each risk dimension:
  overfire_count = proposals where risk_score > 0.7 AND outcome === "success"
  miss_count    = proposals where risk_score < 0.3 AND outcome === "failure"
  total_count   = proposals where this dimension was assessed

  overfire_rate = overfire_count / total_count
  miss_rate     = miss_count / total_count

  if overfire_rate > threshold_overfire:
    signal = risk_dimension_overfire
    profile = Reduce weight for this dimension

  if miss_rate > threshold_miss:
    signal = risk_dimension_miss
    profile = Increase weight for this dimension

  ignored_rate = proposals missing this dimension / total_proposals
  if ignored_rate > threshold_ignored:
    signal = risk_dimension_ignored
    profile = Review dimension inclusion criteria
```

### Signals Produced

| Signal Type | When |
|-------------|------|
| `risk_dimension_overfire` | Dimension flags risk but outcomes are consistently safe |
| `risk_dimension_miss` | Dimension scores low but failures occur |
| `risk_dimension_ignored` | Dimension is routinely excluded from assessments |

### Calibration Profile Produced

| Target | Value |
|--------|-------|
| `risk_dimension_weight` | Adjusted weight per dimension |

### Example

```
Risk dimension: revert_risk
  Assessor: 0.85, Outcome: success
  Assessor: 0.92, Outcome: success
  Assessor: 0.78, Outcome: success
  Overfire rate: 3/3 = 1.0

Signal: risk_dimension_overfire (strength: 0.30, confidence: 0.70)
Profile: Reduce revert_risk weight from 0.8 to 0.5
```

### Governance Invariants (P8.2)

- Same invariants as P8.1 — no mutation paths
- Risk dimension weights are never written by the learning layer
- `riskStore.save()` must never appear in calibration code

### Test Strategy

- All risk scores high, all outcomes success → overfire signals
- All risk scores low, all outcomes failure → miss signals
- Mixed outcomes → proportional signals
- Dimension with zero assessments → ignored signal
- No outcomes → zero signals (no crash)
- Profile correctly aggregates across multiple proposals

---

## P8.3 — Governance Calibration

### Purpose

Measure which governance lenses provide predictive value vs. which ones fire false positives or miss real issues, and propose lens weight adjustments.

### Core Question

When the Historian lens is useful 82% of the time and the Red Team lens is useful only 41% of the time, should they carry equal weight?

### Inputs Consumed

- **LensCalibrationReport** (P7c): per-lens predictive value, false positive rate, missed failure rate
- **OutcomeStore** (P7): outcome records linked to governance reviews

### Processing Logic

```
For each lens:
  predictive_value = correct_challenges / total_challenges  (from LensCalibrationReport)
  false_positive_rate = false_challenges / total_challenges
  missed_failure_rate = failures_not_challenged / total_failures

  if predictive_value > threshold_high:
    signal = lens_high_predictive_value
    profile = Increase weight for this lens

  if predictive_value < threshold_low:
    signal = lens_low_predictive_value
    profile = Decrease weight for this lens

  if false_positive_rate > threshold_fp:
    signal flagged separately (lens overfires)
```

### Signals Produced

| Signal Type | When |
|-------------|------|
| `lens_high_predictive_value` | Lens consistently identifies real issues |
| `lens_low_predictive_value` | Lens often challenges incorrectly |
| `lens_high_false_positive` | Lens overfires — high false positive rate |
| `lens_high_miss_rate` | Lens misses real failures |

### Calibration Profile Produced

| Target | Value |
|--------|-------|
| `governance_lens_weight` | Adjusted weight per lens |

### Example

```
Historian Lens:
  Predictive value: 82% (41/50 challenges correct)
  False positive rate: 18%

Red Team Lens:
  Predictive value: 41% (12/29 challenges correct)
  False positive rate: 59%

Signal: lens_high_predictive_value for Historian (strength: 0.32, confidence: 0.85)
Signal: lens_low_predictive_value for Red Team (strength: 0.39, confidence: 0.72)

Profile: Increase Historian weight from 1.0 to 1.15
Profile: Decrease Red Team weight from 1.0 to 0.75
```

### Governance Invariants (P8.3)

- Same invariants as P8.1 — no mutation paths
- Governance council weights are never written by the learning layer
- `governanceStore.save()` must never appear in calibration code
- Lens agent source code is never modified by calibration proposals

### Test Strategy

- High predictive value → `lens_high_predictive_value` signal
- Low predictive value → `lens_low_predictive_value` signal
- High false positive rate → `lens_high_false_positive` signal
- Lens with zero challenges → no signal (insufficient data)
- Empty calibration report → zero signals
- Profile correctly maps predictive value to weight suggestions

---

## P8.4 — Routing Calibration

> **Observational only in P8.** Routing telemetry may not yet be reliable. P8.4 produces observational reports and proposal shapes — not an actionable optimizer. Full quality/cost/latency optimization is deferred until provider telemetry is proven.

### Purpose

Observe provider/model outcome patterns and surface routing observations for operator awareness.

### Core Question

What routing patterns can ALiX observe from available execution data, and which are worth flagging for operator review?

### Inputs Consumed

- **Execution metadata** (available data): model used, tokens consumed, latency
- **OutcomeStore** (P7): outcome quality by provider/model/task type (if available)

### Processing Logic

```
For each (provider, model, task_type) combination with sufficient data:
  quality_score = average outcome quality for this combination (if available)
  failure_rate = failed_runs / total_runs

  Compare against other combinations serving the same task_type:

  if quality_score significantly higher than peers:
    signal = routing_quality_good

  if quality_score significantly lower than peers OR failure_rate high:
    signal = routing_quality_poor

  if cost per successful outcome significantly lower than peers:
    signal = routing_cost_efficient

  if cost per successful outcome significantly higher than peers:
    signal = routing_cost_inefficient

  if observed p95 latency exceeds threshold:
    signal = routing_latency_concern
```

**Note:** If routing telemetry data is incomplete, only produce signals for dimensions that have reliable data. An empty routing calibration section in the learning report is acceptable — it means "insufficient data to observe patterns."

### Signals Produced

| Signal Type | When |
|-------------|------|
| `routing_quality_good` | Model produces observably higher-quality outcomes than peers |
| `routing_quality_poor` | Model produces observably lower-quality or high failure rate |
| `routing_cost_efficient` | Model has observably lower cost per successful outcome |
| `routing_cost_inefficient` | Model has observably higher cost per successful outcome |
| `routing_latency_concern` | p95 latency exceeds threshold |

### Calibration Profile Produced

| Target | Value |
|--------|-------|
| `routing_model_preference` | Observational preference indicator (informational — no routing table changes in P8) |

### Example

```
Task type: planning (sufficient data: 142 runs across 3 models)
  Claude Sonnet:  avg quality 0.91, cost $0.008/query, p95 1.8s
  GPT-4o:         avg quality 0.88, cost $0.015/query, p95 2.1s
  Qwen + Phi:     avg quality 0.82, cost $0.003/query, p95 1.2s

Signal: routing_quality_good for Claude Sonnet (strength: 0.25, confidence: 0.80)
Signal: routing_cost_efficient for Qwen+Phi (strength: 0.30, confidence: 0.75)

Observation: Claude Sonnet produces best quality for planning.
Observation: Qwen+Phi is most cost-efficient for planning.
Proposal shape: routing_model_preference suggestion (informational, no config change)
```

### Governance Invariants (P8.4)

- Same invariants as P8.1 — no mutation paths
- Routing tables/config are never written by the learning layer
- `routeStore.save()` must never appear in calibration code
- Provider credentials/endpoints are never exposed to the learning layer
- P8.4 produces informational observations only — no actionable routing config changes
- If routing telemetry is incomplete, produce fewer signals rather than speculative ones

### Test Strategy

- Sufficient data with clear quality difference → quality signal
- Insufficient data for a model → no signal (defer)
- High failure rate → poor quality signal
- Equal performance across models → no signal (not enough differentiation)
- Single model for a task type → no comparative signal (insufficient data)
- Zero routing records → empty routing section (graceful)

---

## P8.5 — Learning Proposal Integration

### Purpose

Every learning output enters the existing ALiX proposal lifecycle. Nothing bypasses it.

### Core Question

How do LearningProposals become AdaptationProposals without creating a privileged path?

### Flow

```
LearningSignal (P8.0)
  → CalibrationProfile (P8.0)
    → LearningProposal (P8.0 — data object)
      → CLI: `alix learning propose --target <area>`   [P8.7]
        → ProposalFactory converts LearningProposal to AdaptationProposal
          → ProposalStore.save(proposal)
            → Proposal enters standard lifecycle:
                Pending → Governance Review (P6.5) → Queue (P6.2) → Approved

  P8 stops at approved proposal. The actual Apply step (writing calibration
  files) is deferred to P8.9/P9. An approved learning_adjustment proposal
  exists in the store as evidence of operator intent — but no calibration
  file applier is implemented in P8.
```

### ProposalFactory

```typescript
interface ProposalFactory {
  /**
   * Convert a LearningProposal into an AdaptationProposal.
   *
   * The resulting proposal has:
   *   - action: "learning_adjustment"
   *   - target: determined by proposalType
   *   - payload: contains the CalibrationProfile[]
   *   - status: "pending" (always — never auto-approved)
   *   - requiresApproval: true (always — never bypassed)
   */
  toAdaptationProposal(learning: LearningProposal): AdaptationProposal;
}
```

### AdaptationProposal Extension (new action type)

```typescript
// New ProposalAction value:
"learning_adjustment"

// New ProposalTarget kind:
{ kind: "learning", area: "recommendation" | "risk" | "governance" | "routing" }

// Payload carries the full calibration profiles:
{
  profiles: CalibrationProfile[],
  sourceSignalIds: string[],
  expectedBenefit: string,
  riskEstimate: string,
}
```

### Allowed Proposal Paths

| Path | Allowed? | Why |
|------|----------|-----|
| `learning propose --target recommendation` → ProposalStore | ✅ | Human-gated |
| `learning report --window 90` → stdout | ✅ | Read-only |
| `AutomaticProposalGenerator` producing learning proposals | ❌ | P8.5 explicitly forbids — only CLI produces learning proposals |
| Learning module calling `proposalStore.save()` | ❌ | ProposalFactory is CLI-only |
| Learning module calling `approvalGate.approve()` | ❌ | Structural sentinel |

### Governance Invariants (P8.5)

- `ProposalFactory` is instantiated only in the CLI `propose` command — never in `LearningSignalBuilder`, `CalibrationBuilder`, or any automated path
- `LearningProposal.requiresApproval` is always `true` — the type enforces this
- No test in P8 may call `proposalStore.save()` from a learning module — sentinel enforces this
- `learning_adjustment` proposals have no applier in P8. The approved proposal exists as evidence of operator intent; the actual calibration file write is deferred to P8.9/P9.

### Test Strategy

- `ProposalFactory.toAdaptationProposal()` produces correctly-shaped `AdaptationProposal`
- Resulting proposal has `status: "pending"`, `requiresApproval: true`
- Resulting proposal has `action: "learning_adjustment"`
- Proposal roundtrips through `ProposalStore.save()` + `ProposalStore.load()`
- `alix learning propose` CLI command creates a pending proposal
- `alix propose` (without `--target`) does NOT create learning proposals
- An approved learning_adjustment proposal has no applier — attempting `apply` produces a clear error
- Sentinel: learning modules cannot import ProposalStore

---

## P8.6 — Learning Governance Sentinels

### Purpose

Structural enforcement of the core invariant: *Learning proposes. Governance approves.*

### Sentinel File

**Location:** `tests/learning/learning-sentinels.vitest.ts`

### Required Sentinel Tests

**1. No mutation imports in learning modules**
```
All files in src/learning/ must not import from:
  - src/adaptation/proposal-store.ts
  - src/adaptation/approval-gate.ts
  - src/adaptation/agent-card-applier.ts
  - src/adaptation/skill-applier.ts
  - src/adaptation/revert-applier.ts
  - src/adaptation/evidence-writer.ts (except EvidenceEventWriter for read-only evidence)
```

**2. No direct calibration writes**
```
All files in src/learning/ must not:
  - Call writeFileSync / writeFile / appendFile on calibration files
  - Import calibration profile config files with write intent
  - Reference calibration file paths for writing
```

**3. No ApprovalGate bypass**
```
No file in src/learning/ may import ApprovalGate
No file in src/learning/ may reference approve/apply/reject lifecycle functions
No file in src/learning/ may call proposalStore.save()
```

**4. No Auto-Generated Learning Proposals**
```
grep for "AutomaticProposalGenerator" in src/learning/ → must not exist
grep for "proposalStore" in src/learning/ → must not exist
grep for "approvalGate" in src/learning/ → must not exist
```

**5. ProposalFactory is CLI-only**
```
ProposalFactory is instantiated only in src/cli/commands/learning.ts
ProposalFactory must not be imported by any src/learning/ module
```

**6. LearningStore is append-only**
```
LearningStore has no delete/update/clear/truncate methods
Assert this structurally: list all methods, confirm none match /delete|update|clear|truncate/i
```

**7. CalibrationProfile is a data object, not a writer**
```
CalibrationProfile has no .apply() or .save() methods
CalibrationProfile has no writer module imports
```

**8. Read-only evidence access only**
```
If learning modules import EvidenceEventWriter, confirm only read methods are used:
  - query()
  - get()
  NOT: record(), recordPlanGenerated(), recordAdaptationApplied()
```

### Integration Test

```
Full learning → proposal → approve cycle:
1. Seed P7 outcome records
2. Run `alix learning report --window 90` → produces LearningReport
3. Run `alix learning propose --target recommendation` → creates pending proposal
4. Verify proposal has status "pending", action "learning_adjustment"
5. Approve the proposal via `alix approval approve <id>`
6. Verify proposal now has status "approved"
7. Verify there is no applier for "learning_adjustment" — attempting apply errors clearly
8. Evidence chain: verify adaptation_proposed + adaptation_approved evidence records exist
```

**Why no Apply in P8:** Calibration file appliers are deferred to P8.9/P9. P8 proves that learning proposals can be created, reviewed, and approved through the standard lifecycle — but no calibration files are written until the applier exists in a later phase.

---

## P8.7 — Executive Learning Reports

### Purpose

Provide the operator with a comprehensive view of what ALiX has learned, what it recommends changing, and the evidence behind each recommendation.

### CLI

```bash
alix learning report                         # Last 30 days
alix learning report --window 90              # Custom window
alix learning report --json                   # Machine-readable
alix learning report --window 90 --target recommendation  # Filter by area

alix learning propose                         # Interactive: propose all available calibrations
alix learning propose --target recommendation  # Specific area
alix learning propose --target risk
alix learning propose --target governance
alix learning propose --target routing
alix learning propose --dry-run               # Show what would be proposed without creating
```

### Report Output (text mode)

```
═══ Learning Report ═══
Window: 2026-05-23 to 2026-06-22 (30 days)

── Recommendation Calibration ──
  Overconfident by 18% in bucket 0.8–1.0
    Signal: overconfidence (strength: 0.35, confidence: 0.85)
    Proposal: confidence_multiplier: 1.0 → 0.65
    Status: not yet proposed (run `alix learning propose --target recommendation`)

── Risk Calibration ──
  revert_risk overfiring (3/3 flagged, 0 actual failures)
    Signal: risk_dimension_overfire (strength: 0.30, confidence: 0.70)
    Proposal: revert_risk weight: 0.8 → 0.5
    Status: proposed (prop-learning-001, pending)

── Governance Calibration ──
  Historian: predictive value 82%
    Signal: lens_high_predictive_value (strength: 0.32, confidence: 0.85)
    Proposal: Historian weight: 1.0 → 1.15
    Status: not yet proposed

  Red Team: predictive value 41%
    Signal: lens_low_predictive_value (strength: 0.39, confidence: 0.72)
    Proposal: Red Team weight: 1.0 → 0.75
    Status: proposed (prop-learning-002, pending)

── Routing Calibration ──
  Claude Sonnet recommended for planning
    Signal: routing_quality_good (strength: 0.25, confidence: 0.80)
    Proposal: planning preference: 1.0 → 1.2
    Status: not yet proposed

  0 low-confidence signals excluded (confidence < 0.5)
```

### Report Output (JSON mode)

```json
{
  "windowDays": 30,
  "windowStart": "2026-05-23T00:00:00.000Z",
  "windowEnd": "2026-06-22T00:00:00.000Z",
  "sections": [
    {
      "title": "Recommendation Calibration",
      "signals": [...],
      "profiles": [...],
      "recommendation": "Proposed confidence_multiplier adjustment for bucket 0.8-1.0"
    }
  ],
  "proposalSummary": {
    "available": 3,
    "alreadyProposed": 2,
    "pendingProposalIds": ["prop-learning-001", "prop-learning-002"]
  }
}
```

### CLI Implementation

```
src/cli/commands/learning.ts
  - learningCommand() → route to report or propose
  - runLearningReport() → build report from LearningStore + P7 stores
  - runLearningPropose() → build LearningProposal → ProposalFactory → ProposalStore.save()

src/cli.ts (update)
  - Add "learning" to command enum
  - Route to learningCommand()
```

### Governance Invariants (P8.7)

- `alix learning report` is read-only — no side effects beyond store reads
- `alix learning propose` creates pending proposals — never approved, never applied
- `alix learning propose --dry-run` demonstrates intent without persisting anything
- The CLI is the ONLY entry point for creating learning proposals (enforced by sentinel)

### Test Strategy

- `alix learning report` produces correctly-formatted output
- `alix learning report --json` produces valid JSON
- `alix learning propose --target recommendation` creates a pending proposal
- `alix learning propose --dry-run` does NOT create any proposals (verify by count)
- CLI routes unknown `--target` values to error message
- CLI handles empty data gracefully ("No learning signals found in window")
- CLI includes low-confidence signal count

---

## P8.8 — Release Gate

### Purpose

Verify that P8 is complete and safe before P9 (Agentic Exchange) begins.

### Gate Checklist

**Learning Foundations (P8.0)**
- [ ] LearningSignal, CalibrationProfile, LearningProposal, LearningReport types exist
- [ ] LearningStore is append-only with JSONL persistence
- [ ] LearningStore has no delete/update methods
- [ ] Learning sentinel file exists and passes

**Recommendation Calibration (P8.1)**
- [ ] CalibrationBuilder produces overconfidence/underconfidence signals
- [ ] Signals have correct delta, strength, and confidence
- [ ] Zero outcomes → zero signals (no crash)
- [ ] Small sample → low confidence signals

**Risk Calibration (P8.2)**
- [ ] RiskCalibrationBuilder produces overfire/miss/ignored signals
- [ ] Dimensions are correctly attributed
- [ ] No outcomes → zero signals (no crash)

**Governance Calibration (P8.3)**
- [ ] GovernanceCalibrationBuilder produces lens value signals
- [ ] Lenses are correctly attributed by ID
- [ ] Empty calibration report → zero signals

**Routing Calibration (P8.4)**
- [ ] RoutingCalibrationBuilder produces quality/cost/latency signals
- [ ] Comparative analysis across models for same task type
- [ ] Single model → no comparative signals

**Proposal Integration (P8.5)**
- [ ] LearningProposal → AdaptationProposal conversion is correct
- [ ] All learning proposals start as "pending"
- [ ] All learning proposals require human approval
- [ ] CLI `propose` is the only creation path
- [ ] ProposalFactory is CLI-only (sentinel enforced)
- [ ] `learning_adjustment` has NO applier — attempting `apply` errors clearly
- [ ] No calibration file is written by any P8 code path

**Governance Sentinels (P8.6)**
- [ ] All 8 sentinel tests pass
- [ ] No mutation imports in src/learning/
- [ ] No direct calibration writes
- [ ] No ApprovalGate bypass
- [ ] No auto-generated learning proposals
- [ ] LearningStore is append-only
- [ ] CalibrationProfile has no apply/save methods
- [ ] Evidence access is read-only

**CLI (P8.7)**
- [ ] `alix learning report` works with and without --window
- [ ] `alix learning report --json` produces valid JSON
- [ ] `alix learning propose` creates pending proposals
- [ ] `alix learning propose --dry-run` is no-op
- [ ] All four target areas supported
- [ ] Error messages for invalid targets

### Acceptance Criteria

Before P9 begins:

```
ALiX can:
✓ measure outcomes (P7)
✓ measure recommendation quality (P7)
✓ measure governance quality (P7)
✓ measure routing quality (P8)*
✓ propose calibration improvements (P8)
✓ report learning in human-readable form (P8)
✓ approve learning proposals through standard lifecycle (P8)

ALiX cannot:
✗ self-approve
✗ self-modify calibration files
✗ self-modify routing tables
✗ self-modify governance weights
✗ self-reconfigure
✗ bypass proposal lifecycle
✗ auto-generate learning proposals
✗ apply learning proposals (no applier exists in P8)

*Routing calibration is observational only in P8 — full optimization requires proven telemetry.

### Why This Gate Matters

P9 (Agentic Exchange) changes ALiX from a decision system into a self-evolving agent ecosystem. Agents will propose new agents, new skills, new routes, and new capabilities. If the learning layer isn't fully proven — with every mutation path blocked by sentinels and every calibration change gated by human approval — then P9 introduces an unacceptable risk of self-authorizing behavior.

P8 must be boring. Boring means: the learning layer produces signals, signals become proposals, proposals require approval, and there is literally no code path that skips these steps.

---

## Implementation Order

The sub-phases should be implemented in this order:

```
P8.0a  →  Learning Types + Governance Sentinels (no store yet)
  ↓
P8.6  →  Learning Governance Sentinels (amended per sub-phase)
  ↓
P8.1  →  Recommendation Calibration
  ↓
P8.0b  →  LearningStore (deferred until builder proves the shape)
  ↓
P8.2  →  Risk Calibration
  ↓
P8.3  →  Governance Calibration
  ↓
P8.4  →  Routing Calibration (observational only)
  ↓
P8.5  →  Learning Proposal Integration (no applier — stops at approval)
  ↓
P8.7  →  CLI + Learning Reports
  ↓
P8.8  →  Release Gate
```

**Why sentinels before calibration builders:** The sentinels define the safety boundary. Calibration builders are written inside that boundary. This prevents accidental mutation paths from being introduced during implementation.

**Why P8.0b deferred to after P8.1:** Builders prove the data shape before persistence is introduced. Starting without a store forces the design to be driven by actual builder needs, not speculation.

**Why P8.5 stops at approval, not apply:** Learning calibration file appliers are deferred to P8.9/P9. P8 proves that learning proposals flow through the full lifecycle — propose → review → approve — but no code path exists that writes calibration files.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Learning proposal creates mutation path | Low | Critical | Sentinels (P8.6) are structural grep-based tests, written before calibration builders |
| Auto-generated learning proposals bypass human | Low | Critical | `AutomaticProposalGenerator` is explicitly blocked from producing learning proposals (sentinel) |
| Calibration file written directly | Low | Critical | No applier exists in P8 for `learning_adjustment` — there is literally no code path that writes calibration files |
| Learning proposal integration skips lifecycle | Low | Critical | `ProposalFactory` is CLI-only; sentinel enforces no proposalStore.save() in learning modules |
| Learning signal confidence misinterpreted | Medium | Medium | All signals carry `confidence` field; low-confidence (<0.5) signals are excluded from reports by default |
| Insufficient data produces misleading signals | Medium | Medium | Strength and confidence scale with sample size; small samples produce low-confidence signals |
| P8.1–P8.4 builders coupled to P7 store shapes | Medium | Medium | Builders consume P7 types via interfaces, not concrete stores; adapter pattern if shapes diverge |
| Routing telemetry unreliable | Medium | Low | P8.4 is observational only; empty routing section is acceptable |
| LearningStore introduces persistence before shape is proven | Low | Low | P8.0b explicitly deferred until a builder exists (P8.0a ships without store) |
