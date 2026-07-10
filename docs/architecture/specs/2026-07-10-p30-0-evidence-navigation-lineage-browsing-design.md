# P30.0 — Evidence Navigation & Lineage Browsing Design Spec

**Date:** 2026-07-10
**Status:** Design
**Phase:** P30 — Evidence Navigation & Lineage Browsing
**Depends on:** P14–P29 (Complete Governance Observational Layer)
**Checkpoint target:** `alix-p30-evidence-navigation-lineage-browsing-complete`

---

## 1. Primary Invariant

P30 provides navigation and visualization of existing governance history. It never creates new evidence, modifies existing records, generates governance actions, or recommends policy changes.

---

## 2. Purpose

P30 completes the governance observational layer by providing per-candidate full lineage browsing — the end-to-end cross-phase trace from initial signal detection through compliance package, all in one navigable view.

P30 answers:
- What P24 signal triggered this candidate?
- How did this candidate move through the P25 lifecycle?
- What P26 outcome was recorded, and by whom?
- What P27 traces exist for this candidate?
- What P28 explanation was generated?
- Is this candidate included in a P29 compliance package?
- What is the complete cross-phase evidence chain?

P30 assembles navigation primitives — not new intelligence.

---

## 3. Position in the Governance Ladder

```text
P14 — Auditability
...
P28 — Governance Explainability
P29 — Governance Reporting & Compliance Packages
P30 — Evidence Navigation & Lineage Browsing ← FINAL (Observational Layer)
```

P30 is the final phase of the P-series observational governance layer.

---

## 4. Core Boundary

P30 is explicitly prohibited from:
- autonomous execution or background jobs
- policy mutation or threshold changes
- reviewer or operator ranking
- recommendations or prescriptions
- predictions or likelihood estimates
- writing to P14–P29 stores
- new persistence layers
- creating new governance evidence
- modifying existing governance records

---

## 5. Lineage Model

### 5.1 LineageRecord

```typescript
export interface LineageRecord {
  lineageId: string;
  candidateId: string;
  generatedAt: string;

  // Cross-phase references
  signalRef: SignalRef | null;
  candidateRef: CandidateRef | null;
  outcomeRef: OutcomeRef | null;
  traceRef: TraceRef | null;
  explanationRef: ExplanationRef | null;
  complianceRef: ComplianceRef | null;

  // Navigation
  relatedCandidates: string[];
  phaseCount: number;

  readonly readOnly: true;
  readonly noPolicyMutation: true;
  readonly noThresholdChange: true;
  readonly noAutoAdoption: true;
  readonly noRanking: true;
}
```

### 5.2 Phase References

```typescript
export interface SignalRef {
  signalId: string;
  kind: string;
  severity: string;
  direction: string;
  windowStart: string;
  windowEnd: string;
}

export interface CandidateRef {
  candidateId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutcomeRef {
  outcomeId: string;
  outcomeType: string;
  recordedBy: string;
  rationale: string;
  recordedAt: string;
}

export interface TraceRef {
  traceId: string;
  signalKind: string;
  outcomeType: string;
  timeToOutcomeDays: number;
}

export interface ExplanationRef {
  explanationId: string;
  subject: string;
  sectionCount: number;
}

export interface ComplianceRef {
  packageId: string;
  generatedAt: string;
}
```

### 5.3 LineageIndex

A lightweight in-memory index mapping candidateIds to their cross-phase references, built on-demand from existing stores (no new persistence):

```typescript
export interface LineageIndex {
  candidateIds: string[];
  byCandidateId: Map<string, LineageRecord>;
  bySignalKind: Map<string, string[]>;  // kind → candidateIds
  byOutcomeType: Map<string, string[]>; // outcome → candidateIds
}
```

---

## 6. Lineage Builder (P30.2)

### 6.1 Function

```typescript
function buildLineageIndex(opts: {
  signals: PolicyDriftSignal[];
  candidates: PolicyReviewCandidate[];
  outcomes: PolicyReviewOutcome[];
  traces: DriftOutcomeTrace[];
  explanations: GovernanceExplanation[];
  compliancePackages?: CompliancePackage[];
}): LineageIndex;

function buildLineageRecord(
  candidateId: string,
  index: LineageIndex,
): LineageRecord | null;
```

### 6.2 Rules

- Pure functions — no I/O, no side effects
- LineageIndex built on-demand from caller-provided data
- Missing phase data produces null refs for that phase
- Deterministic lineageId (SHA-256 over candidateId)
- relatedCandidates derived from same signalKind peers

---

## 7. CLI

```bash
alix governance lineage show <candidateId> [--p24-bundle <path>] [--json]
alix governance lineage list [--kind <signalKind>] [--outcome <outcomeType>] [--json]
```

| Command | Behavior | Writes |
|---------|----------|--------|
| `show` | Full lineage for one candidate across all 16 phases | No |
| `list` | Index of candidates filtered by signalKind or outcomeType | No |

---

## 8. Module Boundaries

### 8.1 Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P30.1 | `src/governance/governance-lineage-types.ts` | Lineage types |
| P30.2 | `src/governance/governance-lineage-builder.ts` | Pure lineage builder |
| P30.3 | `src/cli/commands/governance-lineage.ts` | CLI handler |
| P30.4 | `docs/architecture/checkpoints/<date>-p30-4-*.md` | Checkpoint |

### 8.2 Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "lineage"` dispatch |

### 8.3 Untouched Files

- P14–P29 modules unchanged

---

## 9. Testing Plan

### P30.1 — Types (3 tests)
1. LineageRecord has all 6 phase refs
2. All ref types have correct shapes
3. Boundary flags present

### P30.2 — Builder (6 tests)
1. Full lineage for candidate with all phases populated
2. Partial lineage for candidate with missing phases (null refs)
3. LineageIndex built correctly from input data
4. LineageRecord returns null for unknown candidateId
5. relatedCandidates derived from signalKind peers
6. Deterministic lineageId

### P30.3 — CLI (4 tests)
1. show outputs lineage for existing candidate
2. show returns null-format for missing candidate
3. list outputs index
4. --json returns parseable JSON

**Total: 13 tests.**

---

## 10. P30 Seal Criteria

- All 13 tests pass
- No execution adapter imports
- No policy/ranking/auto-adoption/recommendation paths
- P14–P29 modules unchanged
- P30 completes the P-series observational governance layer

---

## 11. Proposed Slice Plan

```text
P30.0 — Design Spec
P30.1 — Lineage Types (governance-lineage-types.ts) — 3 tests
P30.2 — Lineage Builder (governance-lineage-builder.ts) — 6 tests
P30.3 — CLI (governance-lineage.ts) — 4 tests
P30.4 — Checkpoint
```
