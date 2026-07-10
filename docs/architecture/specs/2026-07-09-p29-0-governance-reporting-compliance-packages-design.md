# P29.0 — Governance Reporting & Compliance Packages Design Spec

**Date:** 2026-07-09
**Status:** Design
**Phase:** P29 — Governance Reporting & Compliance Packages
**Depends on:** P27 (Learning Synthesis), P28 (Governance Explainability)
**Checkpoint target:** `alix-p29-governance-reporting-compliance-packages-complete`

---

## 1. Primary Invariant

P29 produces read-only governance reporting artifacts. It composes existing data from P14–P28 into structured compliance evidence packages — it never creates new governance intelligence, mutates state, recommends actions, or prescribes changes.

---

## 2. Purpose

P29 assembles a complete, exportable compliance evidence package for any governance window or review candidate — a single artifact an auditor or decision-maker can inspect to verify what happened, why, and how the governance system responded.

P29 answers:
- What governance events occurred in this window?
- What signals were detected, what candidates were created, what outcomes were recorded?
- What did the governance system learn from this period?
- What explanations exist for key decisions?
- What is the complete evidence trace for a given candidate?

P29 produces audit artifacts — not intelligence, recommendations, or policy guidance.

---

## 3. Position in the Governance Ladder

```text
P14 — Auditability
P15 — Observability
...
P27 — Learning Synthesis
P28 — Governance Explainability
P29 — Governance Reporting & Compliance Packages    ← NEW
```

---

## 4. Core Boundary

P29 is explicitly prohibited from:
- autonomous execution or background jobs
- policy mutation or threshold changes
- reviewer or operator ranking
- recommendations or prescriptions
- predictions or likelihood estimates
- writing to P14–P28 stores
- new persistence layers

---

## 5. Compliance Package Model

### 5.1 CompliancePackage

```typescript
export interface CompliancePackage {
  packageId: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;

  // Inventory
  totalSignals: number;
  totalCandidates: number;
  totalOutcomes: number;
  totalTraces: number;

  // Evidence
  signalSummary: ComplianceSignalSummary[];
  candidateSummary: ComplianceCandidateSummary[];
  outcomeSummary: ComplianceOutcomeSummary[];
  traceSummary: ComplianceTraceSummary[];

  // Analytics snapshot
  correlationAnalytics: DriftCorrelationAnalytics;

  // Explanations
  keyExplanations: GovernanceExplanation[];

  // Metadata
  phasesIncluded: string[];

  readonly readOnly: true;
  readonly noPolicyMutation: true;
  readonly noThresholdChange: true;
  readonly noAutoAdoption: true;
  readonly noRanking: true;
}
```

### 5.2 Summary Types

```typescript
export interface ComplianceSignalSummary {
  signalId: string;
  kind: string;
  severity: string;
  direction: string;
  windowStart: string;
  windowEnd: string;
}

export interface ComplianceCandidateSummary {
  candidateId: string;
  title: string;
  status: string;
  signalKind: string;
  signalSeverity: string;
  createdAt: string;
  hasOutcome: boolean;
}

export interface ComplianceOutcomeSummary {
  outcomeId: string;
  candidateId: string;
  outcomeType: string;
  recordedBy: string;
  rationale: string;
}

export interface ComplianceTraceSummary {
  outcomeId: string;
  candidateId: string;
  signalKind: string;
  outcomeType: string;
  timeToOutcomeDays: number;
}
```

---

## 6. Builder

### 6.1 Function

```typescript
function buildCompliancePackage(opts: {
  signals: PolicyDriftSignal[];
  candidates: PolicyReviewCandidate[];
  outcomes: PolicyReviewOutcome[];
  traces: DriftOutcomeTrace[];
  analytics: DriftCorrelationAnalytics;
  explanations: GovernanceExplanation[];
  windowStart: string;
  windowEnd: string;
}): CompliancePackage;
```

### 6.2 Rules

- Pure function — no I/O, no side effects
- All input data is composed, never mutated
- Missing data produces partial package with available fields
- Deterministic packageId (SHA-256 over window + trace count)
- phaesIncluded derived from input data presence

---

## 7. CLI + Export

### 7.1 CLI

```bash
alix governance report compliance [--p24-bundle <path>] [--json] [--output <path>]
```

`--output <path>` writes the JSON artifact to a specified file path. This is the only write operation in P29 — an explicit, user-requested file export with no governance store involvement.

### 7.2 Export

The `--output` flag writes to a user-specified file path only. No automatic persistence to `.alix/` stores. The package is computed in memory and optionally written to a file the user explicitly names.

```bash
alix governance report compliance --p24-bundle bundle.json --json --output ./compliance-report.json
```

---

## 8. Module Boundaries

### 8.1 Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P29.1 | `src/governance/governance-reporting-types.ts` | CompliancePackage types |
| P29.2 | `src/governance/governance-reporting-builder.ts` | Pure builder |
| P29.3 | `src/governance/governance-reporting-export.ts` | JSON/text output |
| P29.3 | `src/cli/commands/governance-report.ts` | CLI handler |
| P29.4 | `docs/architecture/checkpoints/<date>-p29-4-*.md` | Checkpoint |

### 8.2 Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "report"` dispatch |

### 8.3 Untouched Files

- P14–P28 modules unchanged
- P24/P25/P26/P27/P28 modules untouched

---

## 9. Testing Plan

### P29.1 — Types (3 tests)
1. CompliancePackage has all required fields
2. Summary types have correct shapes
3. Boundary flags present

### P29.2 — Builder (8 tests)
1. Full data produces complete package
2. Missing signals produces partial package
3. Missing outcomes produces partial package
4. Missing explanations omits keyExplanations
5. PackageId is deterministic (same inputs same ID)
6. Inventory counts match input data
7. No mutation of input data
8. phaesIncluded derived correctly

### P29.3 — CLI + Export (4 tests)
1. CLI produces output without error
2. --json returns parseable JSON
3. --output writes file to specified path
4. No governance store writes occur

**Total: 15 tests.**

---

## 10. P29 Seal Criteria

- All 15 tests pass
- No execution adapter imports
- No policy/ranking/auto-adoption/recommendation paths
- P14–P28 modules unchanged
- --output writes to user-specified path only (no automatic persistence)

---

## 11. Proposed Slice Plan

```text
P29.0 — Design Spec
P29.1 — Compliance Package Types (governance-reporting-types.ts) — 3 tests
P29.2 — Compliance Package Builder (governance-reporting-builder.ts) — 8 tests
P29.3 — CLI + Export (governance-reporting-export.ts, governance-report.ts) — 4 tests
P29.4 — Checkpoint
```
