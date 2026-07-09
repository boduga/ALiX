# P21.0 — Human Execution Evidence Ledger & Review Closure Design Spec

**Date:** 2026-07-09
**Status:** Design
**Phase:** P21 — Human Execution Evidence Ledger & Review Closure
**Depends on:** P17 Approved Execution Lifecycle, P18 Governance Workbench & Lifecycle Operations, P19 Automation Readiness Projection, P20 Controlled Manual Execution Handoff
**Checkpoint target:** `alix-p21-human-execution-evidence-ledger-review-closure-complete`

---

## 1. Purpose

P21 closes the post-handoff loop without making ALiX an executor.

P20 made ALiX capable of preparing manual-only handoff packages, validating supporting evidence, preparing execution records, and reporting lifecycle state. P21 adds the missing after-action layer: once a human operator manually performs or rejects a handoff outside ALiX, ALiX can record submitted evidence, review closure state, audit the closure decision, and report completion status.

P21 does **not** execute.
P21 does **not** infer that execution happened automatically.
P21 does **not** rank operators.
P21 does **not** mutate policy.
P21 only records and reviews human-submitted closure evidence.

---

## 2. Core principle

```text
P20 prepares manual execution handoffs.
P21 records human-submitted evidence about what happened afterward.
```

The distinction is critical:

| Capability                                        | Allowed in P21? | Notes                                        |
| ------------------------------------------------- | --------------: | -------------------------------------------- |
| Store prepared handoff reference                  |               ✅ | By immutable ID/ref only                     |
| Attach human-submitted evidence refs              |               ✅ | Evidence refs, not executed commands         |
| Mark closure review status                        |               ✅ | accepted/rejected/incomplete/needs-follow-up |
| Produce closure report                            |               ✅ | Read-only report                             |
| Emit audited closure records                      |               ✅ | Through audited store boundaries only        |
| Execute shell/network/tool action                 |               ❌ | Still forbidden                              |
| Persist executable instructions as actions to run |               ❌ | Handoff refs only                            |
| Mutate policy                                     |               ❌ | No policy write path                         |
| Auto-close based on inferred success              |               ❌ | Closure requires explicit operator review    |
| Rank operators                                    |               ❌ | No leaderboard, score, productivity ranking  |

---

## 3. Phase slices

```text
P21.0 — Design Spec
P21.1 — Evidence Ledger Store
P21.2 — Closure Review Model
P21.3 — Audit-Safe Closure Recorder
P21.4 — Closure Report + CLI
P21.5 — Checkpoint
```

---

## 4. Terminology

### 4.1 Prepared handoff

A P20-generated manual execution package or prepared execution record. It describes what a human operator may do outside ALiX after prior governance gates have passed.

P21 stores references to prepared handoffs. It does not recreate, mutate, or execute them.

### 4.2 Human execution evidence

A human-submitted reference proving, explaining, or documenting what happened after manual action.

Examples:

```text
- log excerpt ref
- screenshot ref
- PR URL
- issue URL
- incident note ref
- terminal transcript ref
- deployment note ref
- rollback note ref
- external ticket ref
- manual verification note
```

Evidence is represented as metadata and references. P21 should not require binary blob storage in the first slice.

### 4.3 Closure review

A human review that decides whether the handoff is considered closed, rejected, incomplete, or follow-up-required.

### 4.4 Closure artifact

The durable record joining:

```text
prepared handoff ref
+ submitted evidence refs
+ closure review decision
+ audit refs
```

---

## 5. Lifecycle model

P21 introduces closure states for prepared manual handoffs.

```text
prepared
  → evidence_submitted
  → closure_accepted
  → closure_rejected
  → closure_incomplete
  → follow_up_required
```

### 5.1 State definitions

| State                | Terminal? | Meaning                                                         |
| -------------------- | --------: | --------------------------------------------------------------- |
| `prepared`           |        No | A P20 handoff exists but no P21 evidence has been submitted     |
| `evidence_submitted` |        No | One or more evidence refs have been appended                    |
| `closure_accepted`   |       Yes | Reviewer accepts the evidence as sufficient closure             |
| `closure_rejected`   |       Yes | Reviewer rejects the evidence or outcome                        |
| `closure_incomplete` |        No | Evidence exists but is insufficient                             |
| `follow_up_required` |        No | Reviewer requires additional manual action, evidence, or review |

### 5.2 Allowed transitions

```text
prepared → evidence_submitted
evidence_submitted → closure_accepted
evidence_submitted → closure_rejected
evidence_submitted → closure_incomplete
evidence_submitted → follow_up_required
closure_incomplete → evidence_submitted
follow_up_required → evidence_submitted
```

### 5.3 Forbidden transitions

```text
prepared → closure_accepted
prepared → closure_rejected
closure_accepted → evidence_submitted
closure_rejected → evidence_submitted
closure_accepted → follow_up_required
closure_rejected → follow_up_required
```

Terminal closure states must not be reopened in P21. Reopening, if ever needed, belongs to a future explicitly governed phase.

---

## 6. Data model

### 6.1 Evidence ref

```typescript
export type HumanExecutionEvidenceKind =
  | "log_ref"
  | "screenshot_ref"
  | "pull_request_ref"
  | "issue_ref"
  | "incident_note_ref"
  | "terminal_transcript_ref"
  | "deployment_note_ref"
  | "rollback_note_ref"
  | "external_ticket_ref"
  | "manual_verification_note"
  | "other_ref";

export interface HumanExecutionEvidenceRef {
  evidenceId: string;
  handoffId: string;
  preparedRecordId: string | null;
  kind: HumanExecutionEvidenceKind;
  uri: string | null;
  label: string;
  summary: string;
  submittedBy: string;
  submittedAt: string;
  contentHash: string | null;
  auditRefs: string[];
}
```

Rules:

```text
- evidenceId is deterministic or UUID-based, but immutable once written.
- handoffId is required.
- submittedBy is required.
- submittedAt is required.
- label and summary must be non-empty.
- uri may be null only for manual_verification_note.
- contentHash is optional in P21.1 but supported for future strengthening.
```

### 6.2 Evidence ledger entry

```typescript
export interface HumanExecutionEvidenceLedgerEntry {
  ledgerEntryId: string;
  handoffId: string;
  preparedRecordId: string | null;
  evidenceId: string;
  appendedAt: string;
  appendedBy: string;
  auditRefs: string[];
}
```

### 6.3 Closure review

```typescript
export type HumanExecutionClosureDecision =
  | "accepted"
  | "rejected"
  | "incomplete"
  | "needs_follow_up";

export interface HumanExecutionClosureReview {
  closureReviewId: string;
  handoffId: string;
  preparedRecordId: string | null;
  decision: HumanExecutionClosureDecision;
  rationale: string;
  reviewedBy: string;
  reviewedAt: string;
  evidenceIds: string[];
  followUpRequired: boolean;
  followUpSummary: string | null;
  auditRefs: string[];
}
```

### 6.4 Closure artifact (read model)

```typescript
export interface HumanExecutionClosureArtifact {
  handoffId: string;
  preparedRecordId: string | null;
  status:
    | "prepared"
    | "evidence_submitted"
    | "closure_accepted"
    | "closure_rejected"
    | "closure_incomplete"
    | "follow_up_required";
  evidenceRefs: HumanExecutionEvidenceRef[];
  latestReview: HumanExecutionClosureReview | null;
  reviewHistory: HumanExecutionClosureReview[];
  auditRefs: string[];
  createdAt: string;
  updatedAt: string;
}
```

This may be computed from ledger entries and reviews rather than stored as a separate mutable projection. Prefer computed read model.

---

## 7. Store architecture

### 7.1 New pure types file

```text
src/governance/human-execution-closure-types.ts
```

Contains all evidence and closure review types. No filesystem access, no audit store imports, no CLI imports.

### 7.2 Evidence ledger store

```text
src/governance/human-execution-evidence-ledger.ts
```

```typescript
export interface HumanExecutionEvidenceLedgerStore {
  appendEvidence(ref: HumanExecutionEvidenceRef): Promise<HumanExecutionEvidenceRef>;
  listEvidence(): Promise<HumanExecutionEvidenceRef[]>;
  listEvidenceForHandoff(handoffId: string): Promise<HumanExecutionEvidenceRef[]>;
}
```

Store path: `.alix/governance/human-execution-evidence-ledger.jsonl`

### 7.3 Closure review store

```text
src/governance/human-execution-closure-review.ts
```

```typescript
export interface HumanExecutionClosureReviewStore {
  appendReview(review: HumanExecutionClosureReview): Promise<HumanExecutionClosureReview>;
  listReviews(): Promise<HumanExecutionClosureReview[]>;
  listReviewsForHandoff(handoffId: string): Promise<HumanExecutionClosureReview[]>;
}
```

Store path: `.alix/governance/human-execution-closure-reviews.jsonl`

---

## 8. Audit-safe recorder

P21.3 (`src/governance/audited-human-execution-closure.ts`) introduces audited wrappers. CLI must not directly append unaudited closure data.

### 8.1 Audit event kinds

```typescript
type P21AuditEventKind =
  | "human_execution_evidence_appended"
  | "human_execution_closure_reviewed";
```

### 8.2 Audit rules

- Evidence append must produce an audit ref.
- Closure review must produce an audit ref.
- Store objects must include auditRefs.
- CLI must use audited recorder/wrapper only.
- Tests must include no direct unaudited append path from CLI.

---

## 9. Report model

P21.4 (`src/governance/human-execution-closure-report.ts`) adds a read-only closure report.

### 9.1 Report item

```typescript
export interface HumanExecutionClosureReportItem {
  handoffId: string;
  preparedRecordId: string | null;
  title: string;
  status:
    | "awaiting_evidence"
    | "evidence_submitted"
    | "accepted"
    | "rejected"
    | "incomplete"
    | "needs_follow_up";
  evidenceCount: number;
  latestReviewDecision: HumanExecutionClosureDecision | null;
  latestReviewAt: string | null;
  followUpRequired: boolean;
  auditRefCount: number;
}
```

### 9.2 Sorting

```text
1. followUpRequired true first
2. status priority: needs_follow_up, incomplete, awaiting_evidence, evidence_submitted, rejected, accepted
3. latestReviewAt ascending, nulls first
4. handoffId ascending
```

No sorting by operator. No operator leaderboard. No productivity language.

---

## 10. CLI surface

### 10.1 Append evidence

```bash
alix governance handoff evidence append \
  --handoff <handoffId> \
  --prepared-record <preparedRecordId> \
  --kind <kind> \
  --label <label> \
  --summary <summary> \
  --uri <uri> \
  --submitted-by <operatorId>
```

Optional: `--content-hash <sha256>`, `--json`

### 10.2 Review closure

```bash
alix governance handoff closure review \
  --handoff <handoffId> \
  --decision accepted|rejected|incomplete|needs-follow-up \
  --rationale <text> \
  --reviewed-by <operatorId> \
  --evidence <evidenceId,evidenceId>
```

### 10.3 Closure report

```bash
alix governance handoff closure report
alix governance handoff closure report --json
alix governance handoff closure report --since <iso> --until <iso>
```

---

## 11. Window semantics

Half-open interval `[since, until)`. Default: `--since: now - 7 days`, `--until: now`.

---

## 12. Validation rules

### 12.1 Evidence validation

- handoffId required
- kind required and known
- label non-empty
- summary non-empty
- submittedBy non-empty
- submittedAt valid ISO
- uri required unless kind = manual_verification_note
- contentHash, when provided, must be non-empty and stable string

### 12.2 Review validation

- handoffId required
- decision required and known
- rationale non-empty
- reviewedBy non-empty
- reviewedAt valid ISO
- evidenceIds must exist for handoff
- accepted/rejected require evidenceIds.length > 0
- incomplete/needs_follow_up require followUpSummary

### 12.3 Transition validation

- No closure without evidence.
- No terminal state reopening.
- Additional evidence may be appended after incomplete or needs_follow_up.
- Additional evidence may not be appended after accepted/rejected in P21.

---

## 13. Files

| File | Change |
|------|--------|
| `docs/architecture/specs/2026-07-09-p21-0-human-execution-evidence-ledger-review-closure.md` | New design spec |
| `src/governance/human-execution-closure-types.ts` | New shared types |
| `src/governance/human-execution-evidence-ledger.ts` | P21.1 store |
| `src/governance/human-execution-closure-review.ts` | P21.2 review model/store |
| `src/governance/audited-human-execution-closure.ts` | P21.3 audited recorder |
| `src/governance/human-execution-closure-report.ts` | P21.4 pure report builder |
| `src/cli/commands/governance.ts` | Extend CLI dispatch |
| `tests/governance/human-execution-evidence-ledger.test.ts` | New |
| `tests/governance/human-execution-closure-review.test.ts` | New |
| `tests/governance/audited-human-execution-closure.test.ts` | New |
| `tests/governance/human-execution-closure-report.test.ts` | New |

---

## 14. Test plan summary

- P21.1: 8 tests (append, list, duplicate rejection, field validation, ISO timestamps)
- P21.2: 10 tests (all closure state transitions, evidence requirements, terminal state enforcement)
- P21.3: 6 tests (audit emission, auditRefs, sentinel checks)
- P21.4: 11 tests (totals, status counts, sorting, window filtering, no operator ranking)
- Boundary sentinel: 7 checks across all files

---

## 15. Non-goals

```text
- No autonomous execution
- No shell/network/tool execution
- No execution adapter
- No policy mutation
- No hidden side effects
- No operator ranking
- No automatic success inference
- No binary evidence blob store
- No reopening terminal closures
- No bypass around P17 approval, P18 visibility, P19 readiness, P20 handoff evidence
```

---

## 16. Acceptance gate

P21 is complete when:

- P21.0 design spec exists and is approved.
- P21.1 evidence ledger is append-only and tested.
- P21.2 closure review model enforces valid closure states.
- P21.3 all evidence and closure writes go through audited boundaries.
- P21.4 closure report is read-only and supports text + JSON.
- P21.5 checkpoint verifies no execution capability.
- TypeScript clean, governance tests pass, no autonomous execution exists.

---

## 17. Seal statement target

```text
P21 — Human Execution Evidence Ledger & Review Closure ✅ SEALED

ALiX can now:
- accept human-submitted evidence refs for prepared manual handoffs
- preserve evidence in an append-only ledger
- record closure reviews through audited boundaries
- classify closure as accepted, rejected, incomplete, or needs-follow-up
- report closure state read-only

ALiX still cannot:
- execute
- mutate policy
- bypass approval, visibility, readiness, or handoff evidence
- auto-close without human review
```
