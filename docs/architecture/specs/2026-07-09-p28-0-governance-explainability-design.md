# P28.0 — Governance Explainability Design Spec

**Date:** 2026-07-09
**Status:** Design
**Phase:** P28 — Governance Explainability
**Depends on:** P27 (Policy Review Learning Synthesis & Drift Outcome Correlation)
**Checkpoint target:** `alix-p28-governance-explainability-complete`

---

## 1. Primary Invariant

P28 produces **explanations** of governance decisions already made.

P28 SHALL NOT produce recommendations, predictions, prescriptions, or policy guidance.

| Allowed (✓) | Prohibited (✗) |
|-------------|----------------|
| "This candidate was created because calibration_skew (medium) was detected in the 90d window" | "This policy threshold should be adjusted" |
| "The candidate was dismissed with rationale: 'No evidence of drift'" | "Based on similar cases, this candidate is likely to be accepted" |
| "Similar calibration_skew candidates were accepted in 3 of 5 cases" | "You should prioritize candidates of this type" |
| "This is the 4th instance of replay_divergence in this policy area" | "The governance system recommends dismissing this candidate" |

P28 explains what happened, how it was reviewed, how it compares, and what patterns exist. It never tells governance actors what to do.

---

## 2. Purpose

P28 transforms P27's trace data and correlation analytics into human-readable governance explanations.

P28 answers:

- Why was this review candidate created?
- What signal triggered it, and how severe was it?
- What happened during the review lifecycle?
- What outcome did the human reviewer reach, and why?
- How does this case compare to similar governance events?
- What patterns does this case fit into?

P28 produces descriptive evidence narratives — not recommendations.

---

## 3. Position in the Governance Ladder

```text
P14 — Auditability
P15 — Observability
P16 — Safe Response & Remediation
P17 — Approved Execution Lifecycle
P18 — Governance Workbench & Lifecycle Operations
P19 — Automation Readiness Projection
P20 — Controlled Manual Execution Handoff
P21 — Human Execution Evidence Ledger & Review Closure
P22 — Closure Intelligence & Handoff Quality Signals
P23 — Governance Replay & Counterfactual Readiness Review
P24 — Governance Calibration & Policy Drift Intelligence
P25 — Governed Policy Review Candidate Lifecycle
P26 — Policy Review Outcome Ledger & Candidate Closure Intelligence
P27 — Policy Review Learning Synthesis & Drift Outcome Correlation
P28 — Governance Explainability                                              ← NEW
```

---

## 4. Core Boundary

P28 is explicitly prohibited from:

- autonomous execution, background jobs, or scheduled watchers
- shell, network, MCP, browser, fetch, or subprocess calls
- execution adapters, executor imports, or tool invocations
- policy mutation or readiness threshold mutation
- reviewer or operator ranking
- recommending actions to governance actors
- predicting future governance outcomes
- prescriptive statements about what should change
- claiming causation between governance events
- auto-adopting explanations as governance decisions
- writing to P25, P26, or P27 stores

P28 explains decisions already made. It never recommends, predicts, or prescribes.

---

## 5. Conceptual Model

```
DriftOutcomeTrace[]  ──→  Section Builder  ──→  GovernanceExplanation
P27 analytics                       (typed sections)
                                            │
                                            ▼
                                    Report + CLI
                                    (text/JSON)
```

P28 reads from P27 trace data (which itself reads from P25/P26). No new storage. Pure computation.

---

## 6. Explanation Model (P28.1)

### 6.1 Explanation Section

```typescript
export type ExplanationSectionKind =
  | "signal_origin"
  | "candidate_lifecycle"
  | "outcome_summary"
  | "peer_comparison"
  | "learning_synthesis";

export interface ExplanationSection {
  kind: ExplanationSectionKind;
  heading: string;
  body: string;
  evidenceRefs: string[];
  dataPoints?: Record<string, unknown>;
}
```

### 6.2 Governance Explanation

```typescript
export interface GovernanceExplanation {
  explanationId: string;
  generatedAt: string;

  subject: string;         // e.g., "Why candidate c-1 was created and dismissed"
  sections: ExplanationSection[];

  // Source trace references
  traceIds: string[];

  readonly readOnly: true;
  readonly noPolicyMutation: true;
  readonly noThresholdChange: true;
  readonly noAutoAdoption: true;
  readonly noRanking: true;
}
```

### 6.3 Section Semantics

| Kind | Content | Example |
|------|---------|---------|
| `signal_origin` | What P24 signal triggered the candidate | "calibration_skew (medium, too_loose) detected in window 2026-06-01 → 2026-07-01" |
| `candidate_lifecycle` | How the candidate moved through P25 states | "Created as proposed, transitioned to under_review, then to dismissed after 3 days" |
| `outcome_summary` | P26 human outcome and rationale | "Dismissed with rationale: 'No evidence of drift.'" |
| `peer_comparison` | How similar cases (same signalKind) were handled | "Of 5 calibration_skew candidates, 3 were accepted, 2 were dismissed" |
| `learning_synthesis` | Broader pattern context | "This is the 4th replay_divergence signal in this policy area" |

---

## 7. Explanation Builder (P28.2)

### 7.1 Builder Functions

```typescript
function buildTraceExplanation(
  trace: DriftOutcomeTrace,
  peerGroup?: DriftOutcomeTrace[],
): GovernanceExplanation;

function buildWindowExplanation(
  traces: DriftOutcomeTrace[],
  analytics: DriftCorrelationAnalytics,
): GovernanceExplanation;
```

### 7.2 Peer Group Semantics

Peer groups are defined by matching `signalKind`. When building a trace explanation, the caller may optionally provide other traces with the same `signalKind` for comparison.

Peer comparisons describe patterns — they never rank:

- ✅ "Of 5 calibration_skew candidates, 3 were accepted, 2 were dismissed"
- ❌ "This candidate was the worst-performing calibration_skew case"
- ❌ "Your review was inconsistent with 60% of peers"

### 7.3 Builder Rules

- All functions are pure (no I/O, no side effects)
- Section body text is generated deterministically from trace data
- Empty or partial traces produce partial explanations with available fields only
- No inferred data — if a field is empty, the section notes it
- import type for type-only symbols

---

## 8. Report + CLI (P28.3)

### 8.1 CLI

```bash
alix governance explain trace <candidateId> [--p24-bundle <path>] [--json]
alix governance explain window [--p24-bundle <path>] [--json]
```

| Command | Behavior | Writes |
|---------|----------|--------|
| `trace` | Per-candidate explanation with peer comparison | No |
| `window` | Window-level synthesis over all traces | No |

### 8.2 Report Text Format

```
P28-EXPLAIN-START
Why candidate c-1 was created and dismissed
============================================

[Signal Origin]
calibration_skew (medium, too_loose) was detected in the 90-day window
2026-06-01 → 2026-07-01. The overconfidence rate was 0.65 across 20
calibrations.

[Candidate Lifecycle]
The candidate was created as 'proposed', transitioned to 'under_review'
within 2 days, and reached 'dismissed' after 5 days total.

[Outcome Summary]
The human reviewer dismissed this candidate with rationale:
"No evidence of calibration drift."

[Peer Comparison]
Of 5 similar calibration_skew candidates:
- 3 were accepted for policy work
- 2 were dismissed without change

[Learning Synthesis]
This is the 4th calibration_skew signal in this policy area.
2 of 4 were accepted. No repeated pattern.
---
P28 explains governance decisions already made.
It does not recommend, predict, or prescribe actions.
No policy was changed. No thresholds were adjusted.
P28-EXPLAIN-END
```

### 8.3 Required Footer

Every explanation output must include:

```
P28 explains governance decisions already made.
It does not recommend, predict, or prescribe actions.
No policy was changed. No thresholds were adjusted.
No reviewers were ranked. No outcomes were predicted.
```

---

## 9. Module Boundaries

### 9.1 Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P28.1 | `src/governance/governance-explainability-types.ts` | Explanation types, section kinds |
| P28.2 | `src/governance/governance-explainability-builder.ts` | Pure explanation builders |
| P28.3 | `src/governance/governance-explainability-report.ts` | Text/JSON renderers |
| P28.3 | `src/cli/commands/governance-explain.ts` | CLI handler |
| P28.0 | `docs/architecture/specs/<date>-p28-0-*.md` | Design spec |
| P28.4 | `docs/architecture/checkpoints/<date>-p28-4-*.md` | Checkpoint |

### 9.2 Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "explain"` dispatch |

### 9.3 Untouched Files

- P24 modules (policy-drift-*.ts)
- P25 modules (policy-review-candidate-*.ts)
- P26 modules (policy-review-outcome-*.ts)
- P27 modules (learning-synthesis-*.ts)

### 9.4 Pure Modules

```text
governance-explainability-types.ts      (types only)
governance-explainability-builder.ts    (pure builders, no I/O)
governance-explainability-report.ts     (pure renderers)
```

The CLI handler owns all file reads.

---

## 10. Testing Plan

### P28.1 — Explanation Model (3 tests)

1. ExplanationSection has all 5 defined kinds.
2. GovernanceExplanation has boundary flags.
3. Empty sections produce valid empty explanation.

### P28.2 — Explanation Builder (8 tests)

1. buildTraceExplanation with full trace produces all expected sections.
2. buildTraceExplanation with partial trace produces valid partial explanation.
3. buildTraceExplanation with peerGroup produces peer_comparison section.
4. buildTraceExplanation without peerGroup omits peer_comparison section.
5. buildWindowExplanation produces learning_synthesis section.
6. No prescriptive language in any section body.
7. Section body is deterministic (same input → same text).
8. No ranking statements in peer_comparison sections.

### P28.3 — Report + CLI (6 tests)

1. Render text includes all sections in order.
2. Render text includes required footer.
3. Render JSON is parseable.
4. CLI trace output includes explanation.
5. CLI window output includes explanation.
6. No write operations occur.

**Total: 17 tests.**

---

## 11. P28 Seal Criteria

P28 may be sealed only when:

- all 17 P28 tests pass
- no execution adapter imports exist
- no shell/network/tool execution exists
- no policy writer imports exist
- no threshold writer imports exist
- no reviewer ranking exists
- no predictive statements exist in explanation output
- no prescriptive statements exist in explanation output
- no auto-adoption exists
- P24/P25/P26/P27 modules unchanged

Final seal tag:

```text
alix-p28-governance-explainability-complete
```

---

## 12. Proposed Slice Plan

```text
P28.0 — Design Spec
P28.1 — Explanation Model (governance-explainability-types.ts) — 3 tests
P28.2 — Explanation Builder (governance-explainability-builder.ts) — 8 tests
P28.3 — Report + CLI (governance-explainability-report.ts, governance-explain.ts) — 6 tests
P28.4 — Checkpoint
```

---

## 13. Next Steps

```text
P28.0 — Governance Explainability Design Spec
```

This document is P28.0.

Proceed to implementation planning.
