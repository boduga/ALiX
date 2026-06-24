# P9.3 — Governance Proposal Lifecycle Design Spec (SDS)

> **Status:** SDS — approved.
> **Spec home:** `docs/superpowers/specs/2026-06-23-p9-3-governance-proposal-lifecycle-design.md`
> **Branch (on implementation):** `feature/p9.3-governance-proposal-lifecycle`
> **Risk level:** HIGH — first phase to extend the existing ApprovalGate with governance-specific criteria. The governing invariant: **ApprovalGate may approve or reject. ApprovalGate may not execute governance mutation.**

## Core framing

```text
P9.0 asks: What is the state of governance?
P9.1 asks: What should we do about it?
P9.2 asks: Let's propose those changes.
P9.3 asks: Should this proposal be allowed?

P9.2  recommendation → pending proposal
P9.3  pending proposal → structural review → approve/reject
P9.4  approved proposal → apply via GovernanceChangeApplier
```

P9.3 extends the existing P5 `ApprovalGate` with governance-specific criteria. It does NOT create a parallel approval authority. All proposals still pass through the same gate — `governance_change` proposals get additional structural checks before approval is granted.

**Hard boundary (non-negotiable):**

```text
ApprovalGate may approve.
ApprovalGate may reject.
ApprovalGate may not execute governance mutation.
```

## Architectural principles

```text
single ApprovalGate
read-only criteria module
read-only explain assembler
audit-only denial events
tombstone, not delete
no applier until P9.4
```

### One gate, one extension point

```
governance_change proposals → existing ApprovalGate + governance criteria
All other proposals → existing ApprovalGate (unchanged)
```

The `ApprovalGate` itself is the single approval authority. No second gate, no parallel lifecycle, no circumvention path.

## Approval criteria (the gate extension)

Inside `ApprovalGate.approve()`, after the existing `requirePending()` check:

```
if proposal.action === "governance_change"
  → runGovernanceCriteria(proposal)
       ├── proposal.status === "pending"
       ├── proposal.systemState?.orphaned !== true
       ├── EvidenceChain edge exists: proposal_from_recommendation
       ├── source recommendation exists (via GovernanceStore.findRecommendationById)
       ├── source recommendation confidence ≥ threshold
       ├── source recommendation.status was open at proposal time
       └── explanation assembles read-only + integrity ≥ threshold
```

**Immutable proposal-time evaluation:** Governance approval evaluates the recommendation state captured when the proposal was created, not the recommendation's current mutable state. This prevents a race condition where a recommendation is dismissed after a proposal is created but before it is approved — the proposal is judged against the snapshot that justified its creation. The proposal's `payload._provenance` (P9.2) and the EvidenceChain edge provide the immutable reference.

**All criteria must pass.** If any fails:

```text
→ record governance_approval_denied evidence (failed criterion, integrity score if applicable)
→ proposal.status remains "pending"
→ return rejection message to operator
```

**All criteria pass:**

```text
→ record governance_approval_decision (integrityScore, threshold, passed: true)
→ transition proposal to approved
→ record adaptation_approved evidence (existing)
```

If `governance_approval_decision` fails to record, approval fails closed — the proposal stays pending.

### Explanation integrity check (Option C)

The criteria module imports the P8.5c explain assembler and calls it read-only. The explanation is assembled from the **proposal's provenance chain**:

```
proposal → recommendation → source governance artifact
```

The assembler traces this chain via the EvidenceChain:

```
proposal_id
  → proposal_from_recommendation edge
  → source recommendation
  → source P9.0 governance artifact (health/drift/lens-review/integrity)
```

Then runs the 6-layer integrity check on the assembled chain:

```
assembler.explain(proposalId)
  → 6-layer chain: Outcome → Recommendation → Risk → Governance → Learning → Calibration
  → explanationIntegrity score (P8.5b metric)
  → threshold compare
```

The assembler is read-only by design (P8.5c invariant) — no mutation risk.

**Rejection message when integrity is below threshold:**

```
Approval rejected: governance_change proposal must be explained first.
Explanation integrity score: 0.62 (threshold: 0.75)
Run:
  alix explain governance <proposal-id>
```

### Integrity threshold

Defined as a constant in the criteria module. Suggested default: `0.6` (aligned with the P9.2 confidence gate default). Configurable if P13 introduces operator-configurable thresholds.

## Evidence events

| Event | When | Payload |
|-------|------|---------|
| `governance_approval_denied` | Governance criteria fail | `{ proposalId, criterion: string, integrityScore?: number }` |
| `governance_approval_decision` | Approval succeeds | `{ proposalId, integrityScore: number, threshold: number, passed: true }` |
| `governance_orphan_cleaned` | Orphaned proposal tombstoned | `{ proposalId, reason: string }` |

`governance_approval_denied` preserves a record of failed attempts — preventing invisible retry-loops. The proposal status is NOT changed; only an audit event is emitted.

## Orphaned proposal visibility and cleanup

P9.2 introduced `systemState.orphaned` as an atomicity recovery mechanism. P9.3 adds operator visibility:

```
alix governance list               → pending governance proposals (excludes orphaned)
alix governance list --orphaned    → orphaned proposals eligible for cleanup
```

**Cleanup operation** (NOT physical deletion):

```
alix governance cleanup <proposal-id>
  → marks systemState.cleaned = true (tombstone, not delete)
  → records governance_orphan_cleaned evidence
  → proposal file retained on disk for audit
```

**Invariants:**

- Only `systemState.orphaned === true` proposals may be cleaned up
- Cleanup does NOT remove the EvidenceChain edge
- The proposal remains on disk as a JSON file (archived, not deleted)
- No automated/cron cleanup — always an explicit operator command

## Re-proposal rules

```text
A rejected proposal cannot be re-opened.
A new proposal requires a new recommendation.
One recommendation → at most one proposal.
```

If a `governance_change` proposal is explicitly rejected (status → `"rejected"`):

1. Operator investigates the root cause
2. Generates a fresh recommendation via P9.1 `alix governance recommend`
3. Creates a new proposal via `alix governance propose <fresh-rec-id>`

P9.3 does NOT support re-proposing from a rejected proposal's payload. The idempotency invariant (`one recommendation → at most one proposal`) means a fresh recommendation is required. Deferred to a future slice if the pattern proves valuable.

## CLI changes

```
alix governance approve <proposal-id>              ← NEW: UX wrapper around ApprovalGate.approve()
alix governance reject <proposal-id> <reason>      ← NEW: UX wrapper around ApprovalGate.reject()
alix governance list [--orphaned]                  ← NEW: filtered governance proposal list
alix governance cleanup <proposal-id>              ← NEW: tombstone orphaned proposals
alix governance propose <id>                       ← P9.2 (unchanged)
alix governance explain <id>                       ← P8.5c (unchanged)
```

**Façade invariant:**

```text
alix governance approve
alix adaptation approve
must reach the same ApprovalGate.approve() through the same path.
```

The governance CLI commands are UX wrappers only. They render governance-specific output (explain integrity score, source recommendation details, approval attempt history) but all mutations flow through the existing `ApprovalGate`.

**`alix governance explain <proposal-id>` enhancement:**

The explain output surfaces:

```text
Approval attempts: 4
  Denied: 3
  Last denial:
    explanationIntegrity 0.42 below threshold 0.60
```

This is read-only data read from evidence events — not stored on the proposal itself.

## Sentinel enforcement

New file: `src/governance/governance-approval-criteria.ts`

- This file may import `EvidenceChainStore` (read-only) and the explain assembler (read-only)
- It must NOT import `ProposalStore`, `ApprovalGate`, any applier
- It must NOT call `approve(`, `apply(`, `reject(`, `save(`, `appendChain(`
- It is a pure validation module: given a proposal and read-only stores, returns pass/fail with reason
- The existing `ALLOWED_IN_FILE` mechanism gets one additional entry for this file

**Return contract (future-ready):**

```ts
export type GovernanceCriteriaResult = {
  passed: boolean;
  failedCriterion?: string;
  integrityScore?: number;
  details?: Record<string, unknown>;
};
```

`details` is unused in P9.3 but reserved for richer governance diagnostics in P9.4+.

**No new write-surface allowlist entries** (the criteria module is read-only — it calls no write methods).

## Explicitly out of scope

```
GovernanceChangeApplier                          → P9.4
Actual governance mutation                       → P9.4
Automatic approval                               → never (constitutional)
Automatic apply                                  → never (constitutional)
Multiple approval authorities                    → never (single gate)
Physical deletion of proposals                   → never (audit chain)
Re-proposal of rejected proposals                → future slice
Operator-configurable thresholds                 → future slice (P13+)
```

## Lifecycle summary

```text
Recommendation (P9.1)
    ↓
governance_change Proposal (P9.2)
    ↓
ApprovalGate
  ├── criteria pass
  │     ↓
  │   approved → pending P9.4 applier
  │
  └── criteria fail
        ↓
      remains pending (audit evidence recorded)
        ↓
      operator investigates
        ↓
      fresh recommendation
        ↓
      fresh proposal
```

## Design decisions log

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | P9.3 stops at approval; applier deferred to P9.4 | Applier is a different risk class — approval logic and mutation logic should not land together |
| 2 | Extend existing ApprovalGate | One approval authority strengthens the invariant |
| 3 | ApprovalGate re-runs explain assembler read-only (Option C) | Avoids new persistence; uses existing P8.5c machinery |
| 4 | `governance_approval_denied` recorded on criteria failure | Audit trail without state transition |
| 5 | `governance_approval_decision` recorded before status transition | Prevents approved proposal with no decision evidence |
| 6 | Tombstone instead of delete for orphaned cleanup | Preserves audit chain integrity |
| 7 | CLI is UX façade only; all mutations through ApprovalGate | Prevents governance-specific approval drift |
| 8 | Re-proposal requires fresh recommendation | Preserves idempotency invariant; strongest audit guarantee |

## Related documents

- P9.0 Meta-Governance SDS: `docs/superpowers/specs/2026-06-23-p9-meta-governance-design.md`
- P9.1 Governance Recommendations SDS: `docs/superpowers/specs/2026-06-23-p9-1-governance-recommendations-design.md`
- P9.2 Governance Proposals SDS: `docs/superpowers/specs/2026-06-23-p9-2-governance-proposals-design.md`
- ADR-0004 Protected Type Files: `docs/adr/ADR-0004-protected-type-files.md`
