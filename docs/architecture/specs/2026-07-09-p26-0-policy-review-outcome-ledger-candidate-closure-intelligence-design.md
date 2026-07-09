# P26.0 — Policy Review Outcome Ledger & Candidate Closure Intelligence Design Spec

**Date:** 2026-07-09
**Status:** Design
**Phase:** P26 — Policy Review Outcome Ledger & Candidate Closure Intelligence
**Depends on:** P24 (Governance Calibration & Policy Drift Intelligence), P25 (Governed Policy Review Candidate Lifecycle)
**Checkpoint target:** `alix-p26-policy-review-outcome-ledger-candidate-closure-intelligence-complete`

---

## 1. Purpose

P26 records human review outcomes for P25 policy review candidates and produces read-only intelligence about closure patterns, review quality, and outcome consistency.

P26 answers:

- What happened to policy review candidates after human review?
- Which candidates were accepted, dismissed, deferred, superseded, or closed without action?
- What evidence supported the closure outcome?
- Are there recurring closure patterns worth surfacing?
- Are review outcomes well documented?

P26 must not apply policy changes, generate patches, change thresholds, rank reviewers, or automatically close candidates.

---

## 2. Position in the Governance Ladder

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
P26 — Policy Review Outcome Ledger & Candidate Closure Intelligence    ← NEW
```

---

## 3. Phase Relationship

P24 detects policy drift intelligence. P25 creates and manages governed policy review candidates. P26 records human review outcomes for those candidates and analyzes closure quality.

| Layer | Input | Output | Persistence |
|-------|-------|--------|-------------|
| P24   | P22 + P23 records | PolicyDriftSignal[] | On-demand, in-memory |
| P25   | P24 PolicyDriftSignal[] (medium/high) | PolicyReviewCandidate[] + event log | Explicit open via store |
| P26   | P25 terminal candidates + human input | PolicyReviewOutcome[] + analytics | Append-only outcome ledger |

P26 is strictly additive to P25. P25 remains the only lifecycle authority. P26 records outcome evidence after or alongside explicit human lifecycle transitions, but does not perform those transitions itself.

---

## 4. Core Boundary

P26 is explicitly prohibited from:

- autonomous execution, background jobs, or scheduled watchers
- shell, network, MCP, browser, fetch, or subprocess calls
- execution adapters, executor imports, or tool invocations
- policy mutation or readiness threshold mutation
- policy patch generation
- candidate auto-close or lifecycle state mutation
- reviewer or operator ranking
- scoring individual people
- auto-adoption of review outcomes
- outcome recommendation as actionable directives
- converting intelligence into executable changes
- bypassing the P25 candidate lifecycle
- writing to P25, P24, P22, P23, or P9 stores

P26 may record and analyze review outcomes. P26 must not apply policy changes, generate patches, change thresholds, rank reviewers, or auto-close candidates.

---

## 5. Non-Goals

P26 does not:

- make lifecycle decisions for candidates (P25 owns this)
- transition candidate state (P25 owns this)
- close candidates (P25 owns this)
- apply policy changes
- generate patches
- change readiness thresholds
- rank reviewers or operators
- produce reviewer scorecards
- classify candidates as "best" or "worst"
- auto-resolve missing outcomes
- recommend exact policy changes
- recommend exact threshold changes
- execute or approve actions

---

## 6. Conceptual Model

```
P25 candidates reaching terminal states
         │
         ▼
Human records outcome via CLI: alix governance policy-review-outcome record
         │
         ▼
P26 Outcome Ledger (append-only store)
  .alix/governance/policy-review-outcomes/
    ├── <outcomeId>.json
         │
         ▼
P26 Outcome Analytics (pure, read-only)
         │
         ▼
P26 Outcome Report (text + JSON)
```

Recording an outcome never mutates the P25 candidate. P25 remains the lifecycle authority.

---

## 7. Outcome Model (P26.1)

### 7.1 Outcome Types

```typescript
export type PolicyReviewOutcomeType =
  | "accepted_for_policy_work"
  | "dismissed_no_change"
  | "deferred_needs_more_evidence"
  | "superseded_by_newer_candidate"
  | "closed_as_duplicate"
  | "closed_out_of_scope"
  | "closed_no_action";
```

### 7.2 Outcome Record

```typescript
export interface PolicyReviewOutcome {
  outcomeId: string;
  candidateId: string;
  candidateTitle: string;
  outcomeType: PolicyReviewOutcomeType;
  recordedAt: string;
  recordedBy: string;
  rationale: string;
  evidenceRefs: string[];
  candidateStateAtRecording: string; // P25 status snapshot
  linkedEventIds: string[];
  notes: string;
  // Immutable creation timestamp
  readonly createdAt: string;
}
```

### 7.3 Outcome Ledger Invariants

- Append-only: existing outcomes must not be rewritten
- Duplicate outcome IDs are rejected
- `outcomeId` should be deterministically derived (SHA-256 hash)
- `rationale` must be non-empty
- `recordedBy` must be non-empty

---

## 8. Outcome Recorder (P26.2 — Candidate Closure Outcome Recorder)

### 8.1 Recorder Rules

- Candidate must exist in P25 store
- Outcome type must be valid
- Rationale must be non-empty
- RecordedBy must be non-empty
- Evidence references must be preserved as references only
- Recording an outcome **must not mutate the candidate**
- Recording an outcome **must not transition candidate state**
- Duplicate outcome IDs are rejected
- Repeated outcomes for the same candidate are allowed as separate append-only records

### 8.2 Recorder Interface

```typescript
interface PolicyReviewOutcomeLedger {
  recordOutcome(opts: {
    candidateId: string;
    outcomeType: PolicyReviewOutcomeType;
    recordedBy: string;
    rationale: string;
    evidenceRefs?: string[];
    notes?: string;
  }): Promise<PolicyReviewOutcome>;

  listOutcomes(opts?: {
    candidateId?: string;
    outcomeType?: PolicyReviewOutcomeType;
  }): Promise<PolicyReviewOutcome[]>;

  getOutcome(outcomeId: string): Promise<PolicyReviewOutcome | null>;
}
```

---

## 9. Outcome Analytics (P26.3)

### 9.1 Analytics

Pure functions computing read-only metrics over outcome ledger entries:

| Metric | Description |
|--------|-------------|
| Outcome counts by type | Distribution of outcome types |
| Outcome counts by candidate state | Outcomes grouped by candidate status at recording time |
| Candidates with no recorded outcome | Terminal candidates lacking any outcome record |
| Candidates with multiple outcomes | Candidates with 2+ distinct outcome records |
| Outcomes missing rationale | Records with empty or short rationale |
| Outcomes missing evidence references | Records with empty evidenceRefs |
| Stale unresolved candidates | Candidates without outcome beyond configurable age threshold |
| Closure pattern summaries | Recurring outcome patterns (e.g., "dismissed_no_change for evidence_coverage signals") |
| Documentation completeness signals | Overall outcome documentation quality indicators |

### 9.2 Prohibited Analytics

Analytics must not:

- rank reviewers
- produce reviewer scorecards
- recommend exact policy changes
- recommend exact threshold changes
- classify candidates as "best" or "worst"
- auto-resolve missing outcomes

### 9.3 Deterministic Sorting

- Outcome types sorted alphabetically or by fixed enum order
- Candidate IDs sorted lexicographically
- Timestamps sorted ascending or descending only where explicitly documented
- No person-based leaderboard ordering

---

## 10. Persistence Layer

### 10.1 Store Layout

```
.alix/governance/policy-review-outcomes/
  ├── <outcomeId>.json              (outcome record)
```

Separate from P25's candidate store to keep lifecycle state separate from outcome intelligence.

```text
.alix/governance/policy-review-candidates/   (P25 — candidate lifecycle)
.alix/governance/policy-review-outcomes/     (P26 — outcome ledger)
```

### 10.2 Store Interface

```typescript
function createPolicyReviewOutcomeLedger(opts: {
  rootDir: string;
}): PolicyReviewOutcomeLedger;
```

---

## 11. CLI Shape (P26.4)

```bash
alix governance policy-review-outcome record <candidateId> \
  --outcome <type> \
  --recorded-by <operator> \
  --rationale "<text>" \
  [--evidence <ref>] \
  [--notes "<text>"]

alix governance policy-review-outcome list [--candidate-id <id>] [--outcome <type>]

alix governance policy-review-outcome show <outcomeId>

alix governance policy-review-outcome report [--json]
```

### 11.1 Command Semantics

| Command | Behavior | Writes |
|---------|----------|--------|
| `record` | Record outcome after validating candidate exists and input rules | Yes (append-only) |
| `list` | Read-only outcome inspection | No |
| `show` | Read-only single outcome detail | No |
| `report` | Read-only analytics + outcome summary | No |

---

## 12. Report Shape (P26.4)

The P26.4 report is read-only and includes:

- Report ID
- `generatedAt` timestamp
- `windowStart`/`windowEnd` if filtering is supported
- Total outcomes
- Outcome distribution by type
- Candidates without outcomes
- Candidates with multiple outcomes
- Documentation gaps (missing rationale, missing evidence)
- Stale unresolved candidates
- Boundary footer

Required footer:

```
P26 records and analyzes human review outcomes for governed policy review candidates.
This report is read-only intelligence.
It does not apply policy changes, generate patches, change thresholds, rank reviewers,
auto-adopt outcomes, or auto-close candidates.
```

---

## 13. Module Boundaries

### 13.1 Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P26.1 | `src/governance/policy-review-outcome-types.ts` | Outcome types, ledger interface |
| P26.2 | `src/governance/policy-review-outcome-ledger.ts` | File-based append-only outcome store |
| P26.3 | `src/governance/policy-review-outcome-analytics.ts` | Pure outcome analytics |
| P26.4 | `src/governance/policy-review-outcome-report.ts` | Pure report builder + text/json |
| P26.4 | `src/governance/policy-review-outcome-cli.ts` | CLI handler |
| P26.0 | `docs/architecture/specs/<date>-p26-0-*.md` | Design spec |
| P26.5 | `docs/architecture/checkpoints/<date>-p26-5-*.md` | Checkpoint |

### 13.2 Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "policy-review-outcome"` dispatch |

### 13.3 Untouched Files

- P24 modules (policy-drift-*.ts)
- P25 modules (policy-review-candidate-*.ts)
- P13.3 policy-suggestions.ts
- P9.0d governance-drift-detector.ts
- P22 handoff-readiness-calibration.ts
- P23 replay/*

### 13.4 Pure Modules

```text
policy-review-outcome-types.ts       (types + ledger interface)
policy-review-outcome-analytics.ts   (pure analytics functions)
policy-review-outcome-report.ts      (pure report builder)
```

### 13.5 Store Module

```text
policy-review-outcome-ledger.ts      (file I/O + append-only enforcement)
```

### 13.6 CLI Module

```text
policy-review-outcome-cli.ts         (command dispatch + bundle/candidate reads)
```

The ledger stores outcomes only. It must never read or write P25 candidate files directly — P25 candidate reads happen through the CLI boundary.

---

## 14. Testing Plan

### P26.1 — Outcome Model (3 tests)

1. Valid outcome types are exhaustive (7 types as defined).
2. Outcome record shape has all required fields.
3. Duplicate outcome type enum matches spec.

### P26.2 — Outcome Recorder (10 tests)

1. Record valid outcome creates file + returns record.
2. Invalid candidate ID is rejected.
3. Empty rationale is rejected.
4. Empty recordedBy is rejected.
5. Duplicate outcome ID is rejected.
6. Append-only: recording the same candidate twice produces two separate records.
7. Evidence references are preserved as reference strings (not resolved).
8. Recording outcome does not mutate P25 candidate file.
9. Recording outcome does not transition candidate state.
10. Reading recorded outcome returns correct data.

### P26.3 — Outcome Analytics (8 tests)

1. Outcome counts by type are correct.
2. Outcomes by candidate state at recording time.
3. Candidates with no recorded outcome detected.
4. Candidates with multiple outcomes detected.
5. Outcomes missing rationale detected.
6. Outcomes missing evidence references detected.
7. Stale candidate detection (beyond configurable threshold).
8. Deterministic sorting (no person-based ordering).

### P26.4 — Outcome Report + CLI (8 tests)

1. Empty report produces clean zero counts.
2. Report shows outcome distribution.
3. Report shows candidates without outcomes.
4. Report shows documentation gaps.
5. Report includes boundary footer.
6. Record CLI persists outcome.
7. List CLI returns outcomes.
8. Show CLI returns single outcome.

### Hard Negative Tests (5 tests)

1. No policy patch generation paths exist.
2. No reviewer ranking logic exists.
3. No candidate auto-close path exists.
4. No outcome auto-adoption path exists.
5. No lifecycle transition bypass exists.

**Total: 34 tests.**

---

## 15. P26 Seal Criteria

P26 may be sealed only when:

- all 34 P26 tests pass
- no execution adapter imports exist
- no shell/network/tool execution exists
- no policy writer imports exist
- no readiness threshold writer imports exist
- no approval/handoff/closure writer imports exist
- no audit emitter imports exist from P26 pure modules
- outcome recorder never reads P25 candidate store directly
- outcome recorder never mutates P25 candidate records
- ranking logic is absent (no reviewer scores, no leaderboards)
- auto-adoption is absent
- auto-close is absent
- P25 modules unchanged
- P24 modules unchanged
- P9.0d/P22/P23 unchanged

Final seal tag:

```text
alix-p26-policy-review-outcome-ledger-candidate-closure-intelligence-complete
```

---

## 16. Proposed Slice Plan

```text
P26.0 — Design Spec
P26.1 — Review Outcome Ledger Model (policy-review-outcome-types.ts) — 3 tests
P26.2 — Candidate Closure Outcome Recorder (policy-review-outcome-ledger.ts) — 10 tests
P26.3 — Review Outcome Analytics (policy-review-outcome-analytics.ts) — 8 tests
P26.4 — Outcome Report + CLI (policy-review-outcome-report.ts, governance-policy-review-outcome.ts) — 8 tests
       + Hard Negative Tests — 5 tests
P26.5 — Checkpoint
```

---

## 17. Next Steps

```text
P26.0 — Policy Review Outcome Ledger & Candidate Closure Intelligence Design Spec
```

This document is P26.0.

Proceed to implementation planning.
