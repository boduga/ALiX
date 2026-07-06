# P14.0 — Governance Operator Workflow Plan

**Date:** 2026-07-05
**Status:** Planned — spec ready, implementation pending
**Spec:** `docs/architecture/specs/2026-07-05-p14-0-governance-operator-workflow.md`

## Thesis

P13 tells ALiX what looks risky, suspicious, wasteful, stale, or policy-relevant. P14 gives the operator a structured workflow to inspect those signals, decide what to do, and record the outcome.

**Boundary:** P14 may recommend, organize, queue, explain, and record. P14 must not auto-enforce, auto-block, auto-approve, or silently mutate governance state.

## Module Breakdown

| Module | Name | Purpose | Dependencies |
|---|---|---|---|
| P14.0 | Design Spec | Define operator workflow, boundaries, state model, invariants | — |
| P14.1 | Governance Signal Inbox | Normalize P13 outputs into reviewable inbox items | P13.1–P13.4, existing store patterns |
| P14.2 | Operator Review Session | Let operator open, inspect, classify, and annotate signals | P14.1 |
| P14.3 | Decision Capture | Record operator decisions: accept, dismiss, defer, escalate, convert_to_issue | P14.2 |
| P14.4 | Action Queue | Create explicit, pending operator-approved actions without executing | P14.3 |
| P14.5 | Governance Audit Trail | Append-only ledger for every signal, review, decision, action proposal | P14.1–P14.4 |
| P14.6 | CLI / Dashboard Surface | `alix governance inbox`, `review`, `decide`, `queue`, `audit` | All above |

## Implementation Order

```
P14.0 ──→ P14.1 ──→ P14.2 ──→ P14.3 ──→ P14.4 ──→ P14.6
                                         │
                                         └──→ P14.5 (parallel — audit via store pattern)
```

P14.5 can be implemented in parallel with P14.4 since the append-only store pattern is already established.

## Core Objects

5 types: `GovernanceSignal`, `OperatorReview`, `OperatorDecision`, `GovernanceActionProposal`, `GovernanceAuditEntry`.

All stored as append-only JSONL files under `~/.alix/governance/` (matching P12.4/P12.5 patterns). Separate stores per type for independent query patterns.

## 7 Invariants

1. No silent execution — action proposals require operator confirmation
2. Every decision requires rationale
3. Every workflow item links back to evidence (signal → review → decision → audit)
4. P13 remains advisory — P14 consumes but doesn't change P13 scoring
5. Dismissals are first-class — preserved as training material, not deleted
6. Escalation creates work, not enforcement
7. Audit trail is append-only

## CLI Shape

```bash
alix governance inbox [--status] [--source]          # List signals
alix governance inbox refresh [--window N]            # Capture from P13
alix governance show <signal-id> [--json]             # Signal detail
alix governance review <signal-id> [--notes]          # Review session
alix governance decide <signal-id> --<kind> --reason  # Decision
alix governance escalate <signal-id> [--issue]        # Escalate
alix governance queue [--status]                      # Action queue
alix governance queue cancel <proposal-id>            # Cancel proposal
alix governance audit [--signal] [--since] [--limit]  # Audit trail
```

## Key Design Decision: `averageTimeToApprove` Gap

P13.4's friction scores have `averageTimeToApprove: null` because no `requestedAt` timestamp existed on `ApprovalGate`. P14 adds `requestedAt` to `GovernanceSignal` **only** when the originating P13/P12 evidence contains a reliable gate-request timestamp. Otherwise `requestedAt` remains `null`, and P14 computes operator review latency from `signal.createdAt` to `OperatorDecision.createdAt`. A future P13 enhancement can join against the `GovernanceSignal` store. Per invariant 4, P14 populates this field without changing P13 stores or scoring.

## Spec Fixes Applied (2026-07-05)

| # | Fix | Detail |
|---|---|---|
| 1 | `AppendOnlyStore` interface | Removed `extends { entryId: string; ... }` — types carry their own id field names |
| 2 | Signal status semantics | `inbox --status dismissed` (not `--status decided`) to match invariant 5 |
| 3 | `requestedAt` scope | Clarified: populated only when reliable gate timestamps exist; otherwise `null` |
| 4 | Action execution wording | `action_proposal.executed` → `action_proposal.marked_executed_elsewhere` |

## Next Step

Implement **P14.1 Governance Signal Inbox** as the first code module:
- Signal normalization functions per P13 module
- `FileSignalStore` (append-only JSONL)
- `alix governance inbox refresh` CLI subcommand
- Deduplication logic
- Invariant tests

## File Map

```
docs/architecture/specs/2026-07-05-p14-0-governance-operator-workflow.md  # Design spec (this PR)
docs/architecture/plans/2026-07-05-p14-0-governance-operator-workflow.md  # This plan

src/governance/signal-inbox.ts                                              # P14.1
src/governance/operator-review.ts                                           # P14.2
src/governance/decision-capture.ts                                          # P14.3
src/governance/action-queue.ts                                              # P14.4
src/governance/governance-audit.ts                                          # P14.5
src/cli/commands/governance.ts (amend)                                      # P14.6

tests/governance/signal-inbox.test.ts
tests/governance/operator-review.test.ts
tests/governance/decision-capture.test.ts
tests/governance/action-queue.test.ts
tests/governance/governance-audit.test.ts
tests/governance/governance-operator-invariants.test.ts
```
