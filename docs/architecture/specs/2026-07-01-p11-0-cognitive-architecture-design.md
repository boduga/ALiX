# P11.0 — Cognitive Architecture Design Brief

> **Status:** Proposed
> **Phase:** P11.0
> **Goal:** Define the cognitive architecture for P11 before writing any implementation code.

---

## Context

P10 established four layers: Executive Planning, Plan Execution/Orchestration, Remediation Lifecycle, and Baseline Intelligence. Every ALiX subsystem now exposes a standardized observation interface through 9 baseline providers. P10 taught Executive **how to observe**.

P11 teaches Executive **how to think**. Instead of isolated subsystem scores (`Memory: 82, Workflow: 61, Security: 93`), Executive should produce conclusions like: `"Workflow degradation is likely caused by recent skill modifications (confidence: 0.81)."`

---

## Architecture

### Core Pipeline

```
Baseline Providers  (9 subsystems)
        │
        ▼
Correlation Engine  (P11.1)
        │ produces CorrelationGraph
        ▼
Reasoning Engine   (P11.2)
        │ produces RootCauseAnalysis
        ▼
Planning Engine    (P11.3)
        │ produces StrategicPlan
        ▼
Learning Engine    (P11.4)
        │ produces UpdatedConfidenceModel
        ▼
Forecasting        (P11.5)
        │ produces HealthForecast
```

### Architectural Rule (Hard Boundary)

> **Every stage produces structured evidence that the next stage consumes.**

This keeps each stage independently testable and prevents the system from becoming a monolithic component. Each stage's output is a typed, persisted artifact.

---

## Intermediate Representations

### CorrelationGraph (P11.1)

A directed graph where:
- **Nodes** = subsystems with current health metadata (score, drift items, status)
- **Edges** = observed statistical relationships:
  - `co_occurrence_rate` — how often these subsystems degrade together (0–1)
  - `temporal_lag` — if A degrades, B follows N windows later
  - `correlation_direction` — positive | negative
  - `correlation_confidence` — strength of observed relationship (0–1)

**Storage:** Single JSON file (relationships are bounded)

### RootCauseAnalysis (P11.2)

A ranked list of causal explanations:
- `primary_subsystem` — the degraded subsystem
- `likely_causes` — ranked array of `{ cause_subsystem, confidence, mechanism, evidence_ids[] }`
- `driving_metric` — the specific metric causing degradation
- `recommended_action` — strategic-level recommendation
- `supporting_evidence` — references to CorrelationGraph edges, drift items, outcomes

**Storage:** Append-only JSONL

### StrategicPlan (P11.3)

A prioritized multi-subsystem plan:
- `objectives[]` — ranked by strategic impact, each with:
  - `target_subsystem` and `target_metric`
  - `expected_impact` — which other subsystems improve as side effect
  - `estimated_effort` — low/medium/high
  - `prerequisites` — other objectives that must complete first

**Storage:** JSONL

### UpdatedConfidenceModel (P11.4)

Learned parameters:
- Per-correlation-edge weight adjustments
- Per-recommendation-type effectiveness multipliers
- Temporal patterns
- False-positive rate per signal type

**Storage:** JSON file

### HealthForecast (P11.5)

Predicted health 1-3 windows out:
- Per-subsystem forecast with confidence intervals
- "What if" branching under different intervention scenarios

---

## Pipeline Design

| Property | Design |
|----------|--------|
| Inputs | `BaselineComparison[]` + historical trend/outcome data |
| Determinism | Correlation, Planning, Forecasting are deterministic. Reasoning may introduce probabilistic elements. |
| LLM usage | None in Correlation, Planning, Learning, or Forecasting. Reasoning (P11.2) is the only candidate, for inference step only. |
| Persistence | Each stage's output is persisted before next stage reads it. Stages can re-run independently. |
| Testability | Each stage is a pure function: typed input → typed output, no side effects. |
| Confidence model | Float 0–1 propagating through pipeline. Correlation confidence → reasoning confidence → planning confidence. |

### Execution Flow

```
1. Collect:  BaselineRegistry.runAll() → BaselineComparison[]
2. Correlate: CorrelationEngine.run(comparisons, history) → CorrelationGraph
3. Reason:   ReasoningEngine.analyze(graph, drift) → RootCauseAnalysis
4. Plan:     PlanningEngine.prioritize(analysis, objectives) → StrategicPlan
5. Learn:    LearningEngine.update(plan, outcomes) → UpdatedConfidenceModel
6. Forecast: ForecastingEngine.project(models, plans) → HealthForecast
```

Steps 1–4 run every evaluation cycle. Step 5 runs after outcomes are observed. Step 6 is on-demand.

---

## Relationship to P10

| P10 Component | Role in P11 |
|---------------|-------------|
| `BaselineRegistry.runAll()` | Input to Correlation Engine |
| `ExecutiveTrendStore` | Historical data for correlation windows |
| `OutcomeReportStore` | Ground truth for Learning Engine |
| `SubsystemCorrelation` (P10.8c) | Starting pattern for P11.1 |
| `RecommendationEngine` | Deprecated by P11.2/3 |
| `ExecutiveDashboard` | Consumer of P11 outputs |

---

## P11 Roadmap

| Phase | What | Output |
|-------|------|--------|
| P11.0 | Architecture & Design Brief | This document |
| P11.1 | Correlation Engine | `CorrelationGraph` — cross-subsystem relationship detection |
| P11.2 | Reasoning Engine | `RootCauseAnalysis` — causal inference from correlations |
| P11.3 | Planning Engine | `StrategicPlan` — prioritized multi-subsystem plans |
| P11.4 | Learning Engine | `UpdatedConfidenceModel` — parameters from historical outcomes |
| P11.5 | Forecasting | `HealthForecast` — predicted health 1-3 windows out |

---

## Out of Scope

- LLM-based reasoning (structured probabilistic inference only)
- Real-time anomaly detection
- External data integration
- Automated plan execution (StrategicPlan is advisory; human gates remain)
- Replacement of existing P10 recommendation/planning (P11 outputs augment, not replace)
