# ADR-0010: Executive Intelligence Architecture

**Status:** Accepted (2026-07-13)
**Deciders:** Architecture team
**Scope:** Executive planning, recommendation, outcome evaluation, learning trends, governance bridge

---

## 1. Context

The A-series governed evolution pipeline (ADR-0006) establishes a deterministic, evidence-driven cycle from observation to execution. But the pipeline is reactive — it processes proposals as they arrive. ALiX also needs a **proactive intelligence layer** that can:

- Plan sequences of work across multiple turns (executive planning)
- Generate improvement recommendations from health signals
- Evaluate outcomes and feed results back into future planning
- Bridge executive recommendations into the governance pipeline
- Track learning trends across completed plans

This layer emerged across the P10 executive series: planning, recommendation, outcome evaluation, learning trends, and governance bridging. Unlike the A-series (which is a fixed pipeline), the executive layer is a **cyclic intelligence stack** — each phase produces inputs for subsequent phases, and the cycle repeats as the system accumulates evidence.

---

## 2. Decision

ALiX adopts a **cyclic executive intelligence stack** with four layers — planning, outcome evaluation, learning, and recommendation — bridged into the A-series governance pipeline at the proposal/decision boundary.

### 2.1 Architecture

```
                        Health Signals
                              │
                              ▼
                    ┌──────────────────┐
                    │  Planning Engine │
                    │  (create plan,   │
                    │   step generation)│
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Plan Store      │
                    │  Plan-Approval   │
                    │  Gate            │
                    └────────┬─────────┘
                             │
                    ┌────────v─────────┐
                    │ Executive Bridge │
                    │ → A-series       │
                    │   proposals      │
                    └────────┬─────────┘
                             │
                    ┌────────v─────────┐
                    │ Execution Engine │
                    │ (step runner,    │
                    │  state store)    │
                    └────────┬─────────┘
                             │
                    ┌────────v─────────┐
                    │ Outcome          │
                    │ Evaluator        │
                    │ (auto-hook,      │
                    │  report store)   │
                    └────────┬─────────┘
                             │
                    ┌────────v─────────┐
                    │ Learning Engine  │
                    │ (trend store,    │
                    │  correlation)    │
                    └────────┬─────────┘
                             │
                    ┌────────v─────────┐
                    │ Recommendation   │
                    │ Engine           │
                    │ (bridge → A3     │
                    │  governance)     │
                    └────────┬─────────┘
                             │
                             ▼
                    Governance Feedback
```

### 2.2 Layer Breakdown

#### Layer 1: Planning (`planning-engine.ts`, `plan-store.ts`, `plan-approval-gate.ts`)

The planning engine produces structured executive plans from health signals:

```typescript
interface ExecutivePlan {
  planId: string;
  objectives: Objective[];
  steps: ExecutiveStep[];
  createdAt: string;
  status: "draft" | "approved" | "in_progress" | "completed" | "failed";
}
```

Plans are persisted in the `PlanStore`, gated through `PlanApprovalGate` (which approves individual steps), and executed by the `ExecutionEngine`.

#### Layer 2: Outcome Evaluation (`outcome-evaluator.ts`, `outcome-store.ts`, `outcome-report-id.ts`)

When a plan reaches a terminal status, the `OutcomeEvaluationHook` auto-triggers evaluation. The `OutcomeEvaluator` produces structured reports:

```typescript
interface OutcomeReport {
  reportId: string;
  planId: string;
  objectives: ObjectiveResult[];  // per-objective success/failure
  overall: "success" | "partial" | "failure";
  evidenceIds: string[];
}
```

The `OutcomeReportStore` persists reports with integrity tracking.

#### Layer 3: Learning (`learning-engine.ts`, `trend-store.ts`, `subsystem-correlation.ts`)

The learning engine is read-only — it queries stored outcome reports and health signals to compute trends:

```typescript
interface LearningTrend {
  trendId: string;
  signal: "improving" | "degrading" | "stable" | "insufficient_data";
  confidence: number;       // 0.00–1.00
  observationCount: number;
  source: string;
}
```

Trends are computed by the `LearningEngine` (`computeLearningTrends()`) and stored in the `TrendStore`. The engine does not mutate evidence or plans — it is a pure analytics component.

#### Layer 4: Recommendation (`recommendation-engine.ts`, `recommendation-effectiveness.ts`, `executive-bridge.ts`)

The recommendation engine consumes learning trends and produces actionable recommendations:

```typescript
interface ExecutiveRecommendation {
  recommendationId: string;
  signal: "low_confidence" | "degrading" | "instability" | "improving";
  confidence: number;
  affectedSubsystem: string;
  description: string;
}
```

Recommendations are bridged into the A-series governance pipeline via `ExecutiveBridge`:

```
ExecutiveRecommendation
        │
        ▼
ExecutiveBridge
        │
        ├── Maps recommendation to GovernanceProposal
        ├── Patches report with proposalId/governanceStatus
        └── Creates governance issue
```

The `RecommendationEffectiveness` component tracks whether bridged recommendations produced desired outcomes (the recommendation twin of P5 effectiveness).

### 2.3 Relationship with A-Series

The executive stack is **not** a phase in the A-series pipeline. It is a separate intelligence layer that:

1. **Consumes** health signals and evidence from the A-series
2. **Produces** governance proposals that enter the A-series at the A1/A2 boundary
3. **Tracks** outcomes through A5 observation evidence

```
Executive ──► Governance Proposal ──► A2 Verification ──► A3 Decision ──► A4 Execution ──► A5 Observation
                                           ▲                                               │
                                           │                                               │
                                           └─────────────── Outcome Report ◄───────────────┘
                                                                 │
                                                                 ▼
                                                         Learning Trends
                                                                 │
                                                                 ▼
                                                         Recommendations
```

### 2.4 Key Invariants

1. **The executive layer is advisory.** Recommendations are proposals, not commands. They enter the governance pipeline like any other proposal.
2. **Learning is read-only.** The learning engine never mutates plans, evidence, or governance state.
3. **Outcome evaluation triggers automatically** on plan terminal status but does not block the pipeline.
4. **Recommendations carry provenance.** Every recommendation links back to the trends and health signals that produced it.
5. **The executive stack reuses A-series contracts.** Executive proposals use the same `EvolutionProposal` type; bridged recommendations become governance proposals.

---

## 3. Consequences

### 3.1 Positive

- **Proactive governance:** The executive stack can identify problems and generate proposals without waiting for operator input.
- **Closed learning loop:** Outcome → learning → recommendation → governance → execution → outcome provides a complete intelligence cycle.
- **Reuses existing governance:** Recommendations don't bypass the A-series — they enter it through the standard proposal path.
- **Non-blocking analytics:** Learning and trend computation are async and non-blocking; they don't delay execution.

### 3.2 Negative

- **No cross-plan optimization:** Each plan is evaluated independently. Cross-plan patterns require external analysis of the trend store.
- **Recommendation gap:** The bridge maps recommendations to governance proposals structurally, but proposal quality depends on the recommendation engine's signal quality.
- **Store proliferation:** Six stores (plan, outcome, recommendation, trend, snapshot, execution state) for a single intelligence stack.

---

## 4. Key References

- `src/executive/planning-engine.ts` — Executive plan generation
- `src/executive/plan-store.ts` — Plan persistence
- `src/executive/plan-approval-gate.ts` — Per-step approval
- `src/executive/outcome-evaluator.ts` — Outcome report production
- `src/executive/outcome-store.ts` — Outcome persistence
- `src/executive/learning-engine.ts` — Trend computation (read-only)
- `src/executive/trend-store.ts` — Trend persistence
- `src/executive/recommendation-engine.ts` — Recommendation generation
- `src/executive/recommendation-effectiveness.ts` — Effectiveness tracking
- `src/executive/executive-bridge.ts` — Bridge to A-series governance
- `src/executive/executive-bridge-recommendations.ts` — Recommendation→governance mapping
- `src/executive/execution-engine.ts` — Step-by-step execution
- `src/executive/outcome-report-id.ts` — Deterministic report ID generation
- `src/executive/automatic-outcome-hook.ts` — Auto-trigger on plan terminal status
- `src/executive/subsystem-correlation.ts` — Cross-subsystem pattern analysis
