# P25.0 — Governed Policy Review Candidate Lifecycle Design Spec

**Date:** 2026-07-09
**Status:** Design
**Phase:** P25 — Governed Policy Review Candidate Lifecycle
**Depends on:** P24 (Governance Calibration & Policy Drift Intelligence)
**Checkpoint target:** `alix-p25-governed-policy-review-candidate-lifecycle-complete`

---

## 1. Purpose

P25 introduces a governed human-review lifecycle for P24-derived policy drift evidence.

P24 detects calibration and policy drift signals. P25 converts selected medium/high signals into durable, human-reviewable policy review candidates — structured artifacts with a state machine for review workflow.

P25 is not a policy suggestion engine, not a patch generator, and not an execution path. It creates artifacts for governed human review.

---

## 2. Position in the Governance Ladder

P25 builds on the sealed governed action-readiness ladder:

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
P25 — Governed Policy Review Candidate Lifecycle             ← NEW
```

---

## 3. Relationship to P13.3 and P24

P25 is additive to P24 and separate from P13.3.

| Layer | Input | Output | Persistence |
|-------|-------|--------|-------------|
| P13.3 | P12 run ledger + failure memory | Advisory policy refinement suggestions | On-demand, in-memory |
| P24   | P22 calibration + P23 replay records | PolicyDriftSignal[] | On-demand, in-memory |
| P25   | P24 PolicyDriftSignal[] (medium/high) | PolicyReviewCandidate[] + event log | Explicit persistence via store |

Design rules:

1. P25 may read from P24 signal outputs. P25 does not depend on P24 internals, stores, or mutation paths.
2. P25 is not a replacement for P13.3. P13.3 remains the advisory policy-suggestion layer based on run ledger evidence.
3. P24 signals are evidence. P25 candidates are review artifacts. Neither is policy truth.
4. P25 persistence is explicit, not automatic. Candidates become durable only through an explicit open/import action.

---

## 4. Core Boundary

P25 is explicitly prohibited from:

- autonomous execution or background watchers
- shell, network, MCP, browser, fetch, or subprocess calls
- execution adapters, executor imports, or tool invocations
- creating policy patches or rewrites
- changing readiness thresholds
- ranking candidates, reviewers, or operators
- auto-adopting review outcomes
- auto-closing candidates
- writing to P24, P22, or P23 stores
- emitting policy recommendations as actionable directives
- bypassing governed human review

P25 may create and manage review candidates. P25 must not create policy patches, change readiness thresholds, rank candidates or operators, auto-adopt outcomes, or mutate policy.

---

## 5. Non-Goals

P25 does not:

- execute or approve actions
- rewrite policy text
- change readiness thresholds
- propose exact threshold values ("change X from 0.72 to 0.81")
- rank policy review candidates against each other
- rank operators or reviewers
- score reviewer performance
- auto-adopt review outcomes into policy
- auto-close candidates
- bypass P17 approval, P18 visibility, P19 readiness projection, or P20–P24 boundaries
- write to P24, P22, P23, P13, or P9 stores
- make policy truth decisions

P25 may say: _"Calibration skew (medium) detected in the 90d window. This candidate is proposed for human review."_

P25 must not say: _"This policy should be changed from threshold 0.70 to 0.60."_

---

## 6. Conceptual Model

```
P24 PolicyDriftSignal[] (medium/high only)
         │
         ▼
P25 Candidate Builder (pure, read-only)
         │
         ▼
PolicyReviewCandidate[] (on-demand previews, no persistence)
         │
         ▼
  CLI: open --input <bundle.json>
         │
         ▼
P25 Candidate Store (file-based, explicit writes)
  .alix/governance/policy-review-candidates/
    ├── <candidateId>.json            (current state)
    └── <candidateId>.events.jsonl    (append-only event log)
         │
         ▼
  CLI: transition | note | list | show | report
```

Candidate generation is read-only. Candidate persistence occurs only through an explicit open/import action. Review state transitions are explicit writes.

---

## 7. Candidate Model (P25.1)

### 7.1 PolicyReviewCandidate

```typescript
export type PolicyReviewCandidateStatus =
  | "proposed"
  | "under_review"
  | "needs_info"
  | "deferred"
  | "accepted_for_policy_review"
  | "dismissed"
  | "closed";

export interface PolicyReviewCandidate {
  candidateId: string;

  source: {
    phase: "P24";
    signalId: string;
    signalKind: string;  // PolicyDriftSignalKind
    signalSeverity: string; // PolicyDriftSeverity
    signalDirection: string; // PolicyDriftDirection
    windowStart: string;
    windowEnd: string;
  };

  title: string;
  summary: string;

  status: PolicyReviewCandidateStatus;
  createdAt: string;
  updatedAt: string;

  evidenceRefs: Array<{
    source: string;
    lifecycleId?: string;
    handoffId?: string;
    replayId?: string;
    basis?: string;
  }>;

  review: {
    reviewerId?: string;
    rationale?: string;
    notes: string[];
    decisionBasis: string[];
  };

  boundaries: {
    readOnlyEvidence: true;
    noPolicyMutation: true;
    noThresholdChange: true;
    noAutoAdoption: true;
    noRanking: true;
    requiresHumanReview: true;
  };
}
```

### 7.2 PolicyReviewCandidateEvent

```typescript
export type PolicyReviewCandidateEventType =
  | "candidate_opened"
  | "status_changed"
  | "note_added"
  | "evidence_attached";

export interface PolicyReviewCandidateEvent {
  eventId: string;
  candidateId: string;
  occurredAt: string;
  type: PolicyReviewCandidateEventType;
  previousStatus?: PolicyReviewCandidateStatus;
  nextStatus?: PolicyReviewCandidateStatus;
  actor?: string;
  rationale?: string;
  boundaries: {
    noPolicyMutation: true;
    noThresholdChange: true;
    noAutoAdoption: true;
  };
}
```

### 7.3 Idempotency

Candidate IDs are deterministically derived from the P24 signal:

```
candidateId = sha256("p25" + signalId + signalKind + windowStart + windowEnd)
```

Running the builder repeatedly for the same input produces the same candidates. Repeated `open` calls on an already-persisted candidate are idempotent — the existing record is returned and no duplicate `candidate_opened` event is created.

### 7.4 Candidate Filtering

The builder generates candidate previews only for signals where:

```
severity ∈ {"medium", "high"}
AND kind ∈ {"calibration_skew", "replay_divergence", "convergent_gap", "trend_direction", "volatility"}
AND direction ∉ {"neutral", "insufficient_evidence"}
```

The following do NOT generate policy review candidates by default:
- severity: "none" or "low"
- kind: "evidence_coverage" (confidence guard, not policy drift)
- direction: "neutral" or "insufficient_evidence"

---

## 8. State Machine (P25.3)

### 8.1 State Transitions

```text
proposed
  → under_review
  → dismissed
  → deferred

under_review
  → needs_info
  → deferred
  → accepted_for_policy_review
  → dismissed

needs_info
  → under_review
  → deferred
  → dismissed

deferred
  → under_review
  → dismissed

accepted_for_policy_review
  → closed

dismissed
  → closed
```

### 8.2 Disallowed Transitions

```text
proposed → closed                       (no shortcut to terminal)
needs_info → accepted_for_policy_review  (must pass through review)
deferred → accepted_for_policy_review   (must pass through review)
dismissed → under_review                (reopen not supported in P25)
closed → anything                       (terminal state)
```

### 8.3 Enforcement

The CLI requests a transition. The P25 store/state-machine module validates it before writing. The store is the authority on transition legality — the CLI never decides transition validity.

---

## 9. Persistence Layer (P25.3)

### 9.1 Store Interface

```typescript
interface PolicyReviewCandidateStore {
  openCandidate(opts: {
    candidate: PolicyReviewCandidate;
    rationale?: string;
  }): Promise<PolicyReviewCandidate>;

  transitionCandidate(opts: {
    candidateId: string;
    nextStatus: PolicyReviewCandidateStatus;
    rationale: string;
  }): Promise<PolicyReviewCandidate>;

  addNote(opts: {
    candidateId: string;
    note: string;
  }): Promise<PolicyReviewCandidate>;

  listCandidates(opts?: {
    status?: PolicyReviewCandidateStatus;
  }): Promise<PolicyReviewCandidate[]>;

  showCandidate(candidateId: string): Promise<{
    candidate: PolicyReviewCandidate;
    events: PolicyReviewCandidateEvent[];
  }>;
}
```

The store receives a configurable root directory for testability:

```typescript
function createPolicyReviewCandidateStore(opts: {
  rootDir: string;
}): PolicyReviewCandidateStore;
```

### 9.2 Persistence Layout

```
<rootDir>/
  <candidateId>.json              # current state record
  <candidateId>.events.jsonl       # append-only event log
```

Default root: `.alix/governance/policy-review-candidates/`

### 9.3 Event Log Invariants

- Events are append-only: `transitionCandidate()` appends `status_changed` without deleting prior events.
- The event log preserves the full state history for audit.
- No event is ever modified or deleted after writing.

---

## 10. CLI Shape (P25.4)

### 10.1 Commands

```bash
alix governance policy-review candidates build --input <bundle.json> [--json]
alix governance policy-review candidates open <candidateId> --input <bundle.json> [--rationale "..."]
alix governance policy-review candidates list [--status proposed] [--json]
alix governance policy-review candidates show <candidateId> [--json]
alix governance policy-review candidates transition <candidateId> --status <next> --rationale "..."
alix governance policy-review candidates note <candidateId> --note "..."
alix governance policy-review candidates report [--status proposed] [--json]
```

### 10.2 Command Semantics

| Command | Behavior | Writes |
|---------|----------|--------|
| `build` | Read-only candidate preview from P24 bundle | No |
| `open` | Persist candidate, write candidate_opened event | Yes |
| `list` | Read-only store inspection | No |
| `show` | Read-only candidate detail with event log | No |
| `transition` | Write state transition after store validation | Yes |
| `note` | Append note event | Yes |
| `report` | Read-only candidate summary | No |

---

## 11. Report Shape (P25.4)

The P25.4 report is read-only and summarizes persisted review state:

- Candidate counts by status
- Candidate summaries with title + source P24 signal reference
- Current status
- Transition history (from event log)
- Notes count
- Evidence refs
- Boundary footer

Required footer:

```
No policy was changed.
No threshold was changed.
No candidate was ranked.
No candidate was auto-adopted.
No review outcome was applied to governance policy.
```

---

## 12. Determinism

Candidate generation must be deterministic. Same P24 signals + same thresholds → same candidate previews every time.

- Candidate IDs are SHA-256 hashes of signal identity
- No randomness
- No model calls
- No external calls during generation

---

## 13. Module Boundaries

### 13.1 Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P25.1 | `src/governance/policy-review-candidate-types.ts` | Candidate + event types, allowed transitions map |
| P25.2 | `src/governance/policy-review-candidate-builder.ts` | Pure `buildCandidates()` — medium/high filter |
| P25.3 | `src/governance/policy-review-candidate-store.ts` | File-based store with transition validation |
| P25.4 | `src/governance/policy-review-candidate-report.ts` | Pure report builder + text/json |
| P25.4 | `src/cli/commands/governance-policy-review.ts` | CLI handler |
| P25.0 | `docs/architecture/specs/2026-07-09-p25-0-*.md` | Design spec |
| P25.5 | `docs/architecture/checkpoints/2026-07-09-p25-5-*.md` | Checkpoint |

### 13.2 Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "policy-review"` dispatch |

### 13.3 Untouched Files

- P24 modules (policy-drift-types.ts, policy-drift.ts, calibration-confidence-bands.ts, calibration-report.ts, drift-finding-adapter.ts)
- P13.3 policy-suggestions.ts
- P9.0d governance-drift-detector.ts
- P22 handoff-readiness-calibration.ts
- P23 replay/*

### 13.4 Pure Modules

```text
policy-review-candidate-types.ts       (types + transition map only)
policy-review-candidate-builder.ts     (pure builder — no fs, no store)
policy-review-candidate-report.ts      (pure report builder)
```

### 13.5 Store Module

```text
policy-review-candidate-store.ts       (file I/O + state machine enforcement)
```

The builder MUST NOT import the store. The store MAY import types from `policy-review-candidate-types.ts`. The store MUST NOT import the builder.

### 13.6 CLI Module

```text
governance-policy-review.ts            (command dispatch + fs reads for bundle)
```

CLI handles command parsing and readFileSync for input bundles. CLI never decides transition legality — that authority belongs to the store.

---

## 14. Testing Plan

### P25.1 — Candidate Model (3 tests)

1. Candidate shape has all required fields with correct types.
2. Event shape has all required fields with correct types.
3. Allowed transitions map covers all 7 states with valid and invalid transition pairs.

### P25.2 — Candidate Builder (5 tests)

1. Empty P24 signals produce empty candidates.
2. Medium/high severity signals produce candidates.
3. Low/none severity signals are filtered out (no candidates).
4. Evidence_coverage signals are excluded (no candidates).
5. Volatility signals with medium/high severity produce candidates.

### P25.3 — Candidate Store (10 tests)

1. openCandidate persists candidate and writes candidate_opened event.
2. openCandidate is idempotent for existing candidateId (no duplicate events).
3. transitionCandidate validates legal transition (e.g., proposed → under_review).
4. transitionCandidate rejects illegal transition (e.g., proposed → closed).
5. transitionCandidate rejects dismissed → under_review.
6. transitionCandidate rejects closed → anything.
7. transitionCandidate appends status_changed event without deleting prior events (append-only).
8. addNote appends note_added event.
9. listCandidates filters by status correctly.
10. showCandidate returns candidate + full event log.

### P25.4 — Report + CLI (11 tests)

1. Empty candidates produce clean report with zero counts.
2. Report shows candidate counts by status.
3. Report JSON output is parseable.
4. Report includes boundary footer.
5. `build --input` renders candidate previews.
6. `build --json` returns parseable JSON.
7. `open <candidateId> --input` persists candidate.
8. `list` returns persisted candidates.
9. `show` returns candidate + events.
10. `transition` rejects invalid transition through store validation.
11. `report --json` returns parseable JSON.

**Total: 29 tests.**

---

## 15. P25 Seal Criteria

P25 may be sealed only when:

- all 29 P25 tests pass
- no execution adapter imports exist in P25 modules
- no shell/network/tool execution exists
- no policy writer imports exist
- no readiness threshold writer imports exist
- no approval/handoff/closure writer imports exist
- no audit emitter imports exist from P25 pure modules
- the builder module imports no store module
- the store module is the authority on transition legality
- persistence is explicit (open), not automatic
- P24 modules unchanged
- P13.3 unchanged
- P9.0d unchanged
- P22/P23 unchanged
- operator ranking is absent
- auto-adoption is absent
- no policy patches or threshold-change proposals are emitted

Final seal tag:

```text
alix-p25-governed-policy-review-candidate-lifecycle-complete
```

---

## 16. Proposed Slice Plan

```text
P25.0 — Design Spec
  Define candidate model, state machine, store interface, CLI shape,
  module boundaries, and test plan.

P25.1 — Policy Review Candidate Model (policy-review-candidate-types.ts)
  Candidate + event types, allowed transitions map.
  3 tests.

P25.2 — Candidate Builder (policy-review-candidate-builder.ts)
  Pure buildCandidates() with medium/high filter. No store import.
  5 tests.

P25.3 — Candidate Store (policy-review-candidate-store.ts)
  File-based store with transition validation. Append-only event log.
  10 tests.

P25.4 — Report + CLI (policy-review-candidate-report.ts, governance-policy-review.ts)
  Pure report builder + CLI handler + governance.ts dispatch.
  11 tests (4 report + 7 CLI).

P25.5 — Checkpoint
  Boundary verification. No execution, mutation, ranking, or auto-adoption.
  29 tests total.
```

---

## 17. Next Steps

```text
P25.0 — Governed Policy Review Candidate Lifecycle Design Spec
```

This document is P25.0.

Proceed to implementation planning.
