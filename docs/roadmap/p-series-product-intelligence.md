# P-Series — Product Intelligence Roadmap

**Purpose:** Build ALiX's autonomous intelligence using the platform.

The P-Series consumes M-Series platform primitives and delivers user-facing product capabilities.

## Status

**P-series is complete through P30.** Milestone completion is verified by annotated
git tags (`alix-p*-complete`) and source. The roadmap below reflects shipped state,
not aspiration.

## Milestones

| Milestone | Status | Description |
|---|---|---|
| P4 | ✅ Complete | Workflow orchestration integration |
| P5 | ✅ Complete | Adaptation and proposal lifecycle |
| P6 | ✅ Complete | Decision Influence framework (Recommend ≠ Decide) |
| P7 | ✅ Complete | Approval recommendation persistence |
| P8 | ✅ Complete | Learning engine |
| P9 | ✅ Complete | Governance |
| P10 | ✅ Complete | Executive Intelligence |
| P11 | ✅ Complete | Strategic planning engines |
| P12 | ✅ Complete | Governance operator experience |
| P13 | ✅ Complete | Governance intelligence |
| P14 | ✅ Complete | Governance operator workflow + audit |
| P15 | ✅ Complete | Governance observability |
| P16 | ✅ Complete | Governance response / remediation |
| P17 | ✅ Complete | Execution lifecycle |
| P18 | ✅ Complete | Governance workbench |
| P19 | ✅ Complete | Governance automation readiness |
| P20 | ✅ Complete | Controlled manual execution handoff |
| P21 | ✅ Complete | Human execution evidence ledger & review closure |
| P22 | ✅ Complete | Closure intelligence (handoff quality signals) |
| P23 | ✅ Complete | Governance replay / counterfactual readiness |
| P24 | ✅ Complete | Governance calibration & policy drift intelligence |
| P25 | ✅ Complete | Governed policy review candidate lifecycle |
| P26 | ✅ Complete | Policy review outcome ledger & candidate closure |
| P27 | ✅ Complete | Policy review learning synthesis & drift outcome correlation |
| P28 | ✅ Complete | Governance explainability |
| P29 | ✅ Complete | Governance reporting & compliance packages |
| P30 | ✅ Complete | Evidence navigation & lineage browsing |

## P10 — Executive Intelligence (Complete)

The P10 series builds ALiX's executive intelligence layer: health assessment, trends, recommendations, and effectiveness analysis. Complete through P10.10.4 (baseline providers for Security, Tools, Adaptation).

| Slice | Status | Description |
|---|---|---|
| P10.0 | ✅ | Executive health reports |
| P10.1 | ✅ | Priority engine |
| P10.2 | ✅ | Investigation engine |
| P10.3 | ✅ | Planning engine |
| P10.4 | ✅ | Execution engine + bridges |
| P10.5 | ✅ | Outcome evaluation + persistence |
| P10.6 | ✅ | Learning engine (trend analysis) + confidence adjustment |
| P10.7 | ✅ | Recommendation engine + persistence + bridge |
| P10.8a | ✅ | Recommendation effectiveness intelligence |
| P10.8b | ✅ | Effectiveness outcome join |
| P10.8c | ✅ | Predictive signal correlation (subsystem-delta) |
| P10.9 | ✅ | Executive dashboard + proposal readiness |
| P10.10 | ✅ | Baseline providers (Skills, Agent, Workflow, Security, Tools, Adaptation) |

## Frontier

P30 is the current head. Future P work beyond P30 is not yet specified in the roadmap
— the next Product Intelligence milestones would extend the governance/executive
intelligence stack. Governance explainability (P28) and learning synthesis (P27)
are the most recent complete capabilities.

## Rules

- P-series code may depend on M-series contracts
- P-series must not duplicate M-series infrastructure
- Every P specification must document its platform dependencies
