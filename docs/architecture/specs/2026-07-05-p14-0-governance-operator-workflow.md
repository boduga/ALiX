# P14.0 — Governance Operator Workflow Design

**Date:** 2026-07-05
**Status:** Design

## Purpose

Turn P13 advisory governance intelligence into an operator-mediated review and decision workflow. P13 tells ALiX what looks risky, suspicious, wasteful, stale, or policy-relevant. P14 gives the operator a structured workflow to inspect those signals, decide what to do, and record the outcome.

## Non-goals

- **No automatic enforcement** — P14 may recommend, organize, queue, explain, and record. P14 must not auto-enforce, auto-block, auto-approve, or silently mutate governance state.
- **No P13 scoring changes** — P14 consumes P13 signals but does not modify P13 analysis or scoring behavior.
- **No protected file writes** — P14 writes only to its own append-only stores (signals, reviews, decisions, action proposals, audit). It does not write policy files, approval gate configs, risk thresholds, or run ledger entries.
- **No approval gate mutation** — P14 cannot change gate state, approve/reject runs, or modify gate configuration.

## Architecture

```
P13.1 Ledger Analytics ───┐
P13.2 Failure Clustering ─┤
P13.3 Policy Suggestions ─┤──→ Governance Signal Inbox ──→ Operator Review ──→ Decision ──→ Action Queue ──→ Audit Trail
P13.4 Approval Friction ──┘         ▲                             ▲               ▲              ▲
                                     │                             │               │              │
                              P14.1 normalize               P14.2 session     P14.3 capture  P14.4 queue
```

P14 is a **consumption layer** over P13:

1. **P14.1 Governance Signal Inbox** — normalizes P13 module outputs into reviewable `GovernanceSignal` items. Each signal is a single actionable observation with evidence backlinks, severity, confidence, and recommendation.
2. **P14.2 Operator Review Session** — lets the operator open a signal, inspect its evidence chain, add notes, and classify the issue.
3. **P14.3 Decision Capture** — records the operator's explicit decision: accept, dismiss, defer, escalate, or convert to a GitHub issue.
4. **P14.4 Action Queue** — creates pending `GovernanceActionProposal` entries for decisions that require follow-up. These proposals require operator confirmation to act — nothing executes silently.
5. **P14.5 Governance Audit Trail** — append-only ledger recording every signal, review, decision, and action proposal event.
6. **P14.6 CLI / Dashboard Surface** — `alix governance inbox`, `review`, `decide`, `queue`, `audit` subcommands.

## Core Objects

### GovernanceSignal

A single actionable observation from P13, normalized for operator review.

```typescript
interface GovernanceSignal {
  signalId: string;                          // uuid
  sourcePhase: string;                       // "p13.1" | "p13.2" | "p13.3" | "p13.4"
  signalType: SignalType;                    // "trend_alert" | "failure_cluster" | "policy_suggestion" | "friction_alert"
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;                        // 0-1, inherited from P13 module
  title: string;                             // one-line human-readable summary
  description: string;                       // detail
  evidenceRefs: EvidenceRef[];               // links to P13 source data (query params, IDs)
  recommendation: string;                    // what P13 suggests should be done
  metadata: Record<string, unknown>;         // source-specific payload (e.g. heuristic name, gate name, trend direction)
  status: SignalStatus;                      // lifecycle
  requestedAt: string | null;                // ISO timestamp — populated when the signal relates to an approval gate action; fills P13.4's averageTimeToApprove gap
  createdAt: string;                         // ISO timestamp
  updatedAt: string;                         // ISO timestamp
}

type SignalStatus = "new" | "reviewing" | "decided" | "dismissed" | "escalated";
type SignalType = "trend_alert" | "failure_cluster" | "policy_suggestion" | "friction_alert";
```

**`requestedAt`** is the design answer to the P13.4 `averageTimeToApprove: null` gap. P13.4 could not compute time-to-approve because no `requestedAt` timestamp existed on `ApprovalGate`. P14 signals carry `requestedAt` **only** when the originating P13/P12 evidence contains a reliable gate-request timestamp. Otherwise `requestedAt` remains `null`, and P14 computes operator review latency from `signal.createdAt` to `OperatorDecision.createdAt`. A future P13 enhancement can join against the `GovernanceSignal` store to compute real time-to-approve metrics. Per invariant 4, P14 populates this field without changing P13 scoring.

### EvidenceRef

```typescript
interface EvidenceRef {
  source: string;        // e.g. "failure-analysis", "policy-suggestion"
  id: string;            // source record ID or CLI query params
  description: string;   // what this evidence demonstrates
}
```

### OperatorReview

```typescript
interface OperatorReview {
  reviewId: string;
  signalId: string;
  reviewer: string;                    // operator identifier (git config user, CLI --as flag, or env)
  notes: string;                       // free-text observations
  classification: string | null;       // optional re-classification of the signal
  createdAt: string;                   // ISO timestamp
}
```

### OperatorDecision

```typescript
interface OperatorDecision {
  decisionId: string;
  signalId: string;
  decision: DecisionKind;
  rationale: string;                   // required — operator must provide a reason
  actionProposalId: string | null;     // set when decision produces an action proposal
  createdAt: string;                   // ISO timestamp
}

type DecisionKind = "accept" | "dismiss" | "defer" | "escalate" | "convert_to_issue";
```

| DecisionKind | Meaning | Follow-up |
|---|---|---|
| `accept` | Operator agrees with P13 recommendation, marking signal actionable | Creates `GovernanceActionProposal` in queue |
| `dismiss` | Operator overrides — signal not actionable, or P13 analysis incorrect | No action proposal. Signal preserved as training material. |
| `defer` | Operator postpones decision — needs more info or context | Signal stays in inbox; optionally set a reminder |
| `escalate` | Signal warrants higher-level review or broader investigation | Creates `GovernanceActionProposal` with actionType "escalate" |
| `convert_to_issue` | Signal should be tracked as a GitHub issue | Creates `GovernanceActionProposal` with actionType "file_issue" |

### GovernanceActionProposal

A concrete, operator-approved action that **awaits explicit confirmation** before execution.

```typescript
interface GovernanceActionProposal {
  actionProposalId: string;
  decisionId: string;
  actionType: ActionType;
  target: string;                                      // what would be acted upon
  proposedChanges: string;                             // description of the changes
  requiresConfirmation: boolean;                       // always true — invariant 1
  executionStatus: "pending" | "cancelled" | "executed_elsewhere";
  createdAt: string;
}

type ActionType = "create_policy" | "modify_gate" | "investigate" | "file_issue" | "escalate" | "modify_threshold";
```

### GovernanceAuditEntry

Append-only entry recording every state transition in the P14 workflow.

```typescript
interface GovernanceAuditEntry {
  entryId: string;
  eventType: AuditEventType;
  actor: string;                       // "operator" | "system" | "alix"
  targetId: string;                    // affected entity ID
  targetType: "signal" | "review" | "decision" | "action_proposal";
  payload: Record<string, unknown>;    // event-specific data (snapshot, rationale, diff)
  timestamp: string;                   // ISO timestamp, microsecond precision
}

type AuditEventType =
  | "signal.created"
  | "signal.updated"
  | "review.created"
  | "decision.created"
  | "action_proposal.created"
  | "action_proposal.cancelled"
  | "action_proposal.marked_executed_elsewhere";
```

## Signal-to-P13 Mapping

| P13 Module | Output | Signal Type | Severity Basis |
|---|---|---|---|
| P13.1 Ledger Analytics | Trend direction, metric deltas | `trend_alert` | Metric magnitude + direction |
| P13.2 Failure Clustering | Failure cluster with severity | `failure_cluster` | `failureSeverityForType` |
| P13.3 Policy Suggestions | Suggestion with heuristic (H1–H5) | `policy_suggestion` | Confidence (≥0.5 already enforced) |
| P13.4 Approval Friction | Per-gate friction scores | `friction_alert` | Friction score (denyRate, overall) |

### Signal Capture (Inbox Refresh)

`alix governance inbox refresh` runs all four P13 modules through their current window and converts outputs into `GovernanceSignal` records:

1. Run P13.1 analytics → for each detected trend, create a `trend_alert` signal if trend magnitude exceeds a configurable threshold (default: direction is not `stable`).
2. Run P13.2 failure analysis → for each failure cluster with severity ≥ `medium`, create a `failure_cluster` signal.
3. Run P13.3 policy suggestions → for each suggestion, create a `policy_suggestion` signal (confidence ≥ 0.5 already enforced by P13.3).
4. Run P13.4 friction analysis → for each gate with overall friction score > 0.3, create a `friction_alert` signal.

Deduplication: if a signal with identical `sourcePhase` + `signalType` + `title` + `metadata` already exists in the inbox with status `new`, skip creation. This prevents duplicate signals on repeated `inbox refresh`.

## State Storage

All P14 stores follow the append-only JSONL pattern established by P12.4 (`FileLedgerStore`) and P12.5 (`FileFailureMemoryStore`).

```
~/.alix/governance/signals.jsonl        # GovernanceSignal records
~/.alix/governance/reviews.jsonl        # OperatorReview records
~/.alix/governance/decisions.jsonl      # OperatorDecision records
~/.alix/governance/action-proposals.jsonl # GovernanceActionProposal records
~/.alix/governance/audit.jsonl          # GovernanceAuditEntry records
```

**Why separate stores (not one unified JSONL):**
- Query patterns differ per object type — listing signals by status, decisions by signal, proposals by status
- Each store can be independently window-filtered (like P13 modules do)
- The audit store is the single ordered event stream for traceability

Each store exposes the same `AppendOnlyStore<T>` interface:

```typescript
interface AppendOnlyStore<T> {
  append(entry: T): Promise<void>;
  getAll(): AsyncIterable<T>;
  getById(id: string): Promise<T | null>;
  query(filter: Partial<T>): AsyncIterable<T>;
}
```

Object types carry their own `id` field: `signalId`, `reviewId`, `decisionId`, `actionProposalId`, `entryId`. The store is generic — `getById` takes a string and delegates to the concrete implementation's index.

## CLI Interface

```bash
alix governance inbox                          # List signals by status (default: all new)
alix governance inbox --status new             # Filter by status
alix governance inbox --status dismissed        # Query dismissed signals (preserved as training material)
alix governance inbox --source p13.3           # Filter by source phase
alix governance inbox refresh                  # Run P13 modules and capture new signals
alix governance inbox refresh --window 30      # Override P13 window (days)

alix governance show <signal-id>               # Full signal detail + evidence refs
alix governance show <signal-id> --json        # Machine-readable

alix governance review <signal-id>             # Open a review session
alix governance review <signal-id> --notes "observed pattern in approval queue"

alix governance decide <signal-id> \
  --accept --reason "agree with P13 assessment"
alix governance decide <signal-id> \
  --dismiss --reason "false positive — gate already addressed"
alix governance decide <signal-id> \
  --defer --reason "need to check with team first"

alix governance escalate <signal-id>           # Escalate with auto-rationale prompt
alix governance escalate <signal-id> --issue   # Escalate + convert to GitHub issue

alix governance queue                          # List pending action proposals
alix governance queue --status pending         # Filter by execution status
alix governance queue cancel <proposal-id>     # Cancel a pending action proposal

alix governance audit                          # Recent audit entries
alix governance audit --signal <signal-id>     # Full audit trail for one signal
alix governance audit --limit 50               # Override default limit
alix governance audit --since "2026-07-01"     # Time filter
```

### Flags

| Flag | Applies to | Description |
|---|---|---|
| `--window N` | `inbox refresh` | Time window in days for P13 analysis (default 90) |
| `--status` | `inbox`, `queue` | Filter by status |
| `--source` | `inbox` | Filter by P13 source phase |
| `--json` | `show`, `audit`, `queue` | Machine-readable output |
| `--reason` | `decide`, `escalate` | Required operator rationale |
| `--limit` | `audit` | Max entries (default 20) |
| `--since` | `audit` | ISO date lower bound |

## Workflow Diagram

```
P13 Module Outputs
     │
     ▼
┌─────────────────────┐
│  P14.1 Inbox Refresh │  ← `alix governance inbox refresh`
│  (normalize + dedup) │
└─────────┬───────────┘
          │ signal created
          ▼
┌─────────────────────┐
│  GovernanceSignal   │  ← status: "new"
│  Inbox              │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  P14.2 Review       │  ← `alix governance review <signal-id>`
│  Session            │
└─────────┬───────────┘
          │ review created
          ▼
┌─────────────────────┐
│  P14.3 Decision     │  ← `alix governance decide <signal-id> --<kind> --reason "..."`
│  Capture            │
└──┬──────┬──────┬────┘
   │      │      │
   ▼      ▼      ▼
accept  defer  dismiss  escalate  convert_to_issue
   │      │      │        │            │
   │      │      │        ▼            ▼
   │      │      │   ┌────────────┐ ┌────────────┐
   │      │      │   │ action:    │ │ action:    │
   │      │      │   │ "escalate" │ │ "file_issue"│
   │      │      │   └────────────┘ └────────────┘
   │      │      │
   │      │      └──► Signal preserved as training material
   │      │           (status: "dismissed", not deleted)
   │      │
   │      └──────► Signal stays in inbox (status: "new")
   │                optionally with defer-until timestamp
   │
   ▼
┌─────────────────────┐
│  P14.4 Action Queue │  ← `alix governance queue`
│  (requires confirm) │     status: "pending"
└─────────┬───────────┘
          │
          ▼
    Operator confirms
    (manual action, not CLI)
```

## Invariants

| # | Invariant | Enforcement |
|---|---|---|
| 1 | **No silent execution** — Action proposals require operator confirmation. The `requiresConfirmation` field is always `true`. No P14 code path executes a proposal without an explicit confirmation action. | Type-level: `requiresConfirmation` is always `true` on write. Tests confirm no code path calls proposal execution. |
| 2 | **Every decision requires rationale** — `rationale` field is non-empty on all `OperatorDecision` writes. CLI `--reason` flag is required for `decide` and `escalate`. | CLI rejects empty `--reason`. Store write validates non-empty. |
| 3 | **Every workflow item links back to evidence** — `GovernanceSignal.evidenceRefs[]` contains P13 source references. `OperatorReview.signalId` → `GovernanceSignal`. `OperatorDecision.signalId` → `GovernanceSignal`. `GovernanceActionProposal.decisionId` → `OperatorDecision`. | Join chain: signal → review → decision → action_proposal. All refs are required foreign keys. |
| 4 | **P13 remains advisory** — P14 consumes P13 signal outputs but does not modify P13 analysis functions, scoring, thresholds, or stores. P14's signal capture runs P13 modules read-only. | Separation: P14.1 calls P13 pure functions but never writes to P12/P13 stores. |
| 5 | **Dismissals are first-class** — `dismiss` decision preserves the signal with status `"dismissed"`. No deletion. Dismissed signals remain queryable via `inbox --status dismissed` and serve as training/evaluation material. | Store retains records. CLI shows dismissed signals on request. |
| 6 | **Escalation creates work, not enforcement** — `escalate` creates an action proposal. It does not directly modify governance state, policy, or gates. | Action proposal with `actionType: "escalate"` enters the queue as pending. No enforcement code path. |
| 7 | **Audit trail is append-only** — `GovernanceAuditEntry` is written once and never modified, deleted, or overwritten. | Append-only store pattern. No update or delete methods on the audit store. |

## Verification Strategy

### Unit tests

| Test area | Coverage |
|---|---|
| Signal normalization | Each P13 module → correct `GovernanceSignal` shape, evidence refs, severity mapping |
| Deduplication | Identical signals skipped on `inbox refresh` |
| Decision validation | Empty rationale rejected; all 5 decision kinds accepted |
| Action proposal invariants | `requiresConfirmation` always `true`; `executionStatus` transitions valid |
| Audit immutability | Append-only store rejects updates/deletes |
| Join integrity | Orphan check: no review without parent signal, etc. |

### Integration tests

| Test | What it proves |
|---|---|
| `inbox refresh` → signals created | Full P13 pipeline → signal normalization works end-to-end |
| `decide --accept` → action proposal created | Decision capture → queue works end-to-end |
| `queue cancel` → audit entry written | State transition recorded |
| P13 scores unchanged after P14 operations | P14 does not mutate P13 stores or scoring |

### Invariant tests

A dedicated test suite (`governance-operator-invariants.test.ts`) verifies all 7 invariants structurally and at runtime.

## Integration Points

| Target | Integration | Phase |
|---|---|---|
| P13 modules | P14.1 calls P13 pure functions (read-only) for signal capture | P14.1 |
| P12.4 Run Ledger | Evidence refs link to run IDs for traceability | P14.1 |
| P12.5 Failure Memory | Evidence refs link to failure records | P14.2 |
| P4.4 Issue Flow | `convert_to_issue` decision → GitHub issue creation via `gh` | P14.3+ |
| P5 adaptation | Action proposals could feed into P5 proposal lifecycle (out of scope for P14) | Future |
| Existing monitoring stack | Monitoring/analytics outputs serve as evidence providers, not workflow engine | All phases |

## The `averageTimeToApprove` Gap

P13.4's `ApprovalGateFriction.averageTimeToApprove` is typed as `null` because no `requestedAt` timestamp existed on `ApprovalGate`. P14 resolves this gap:

- `GovernanceSignal.requestedAt` — populated when a signal originates from an approval gate context
- `OperatorDecision.createdAt` — records when the operator acted on that signal
- The delta between these two timestamps approximates time-to-approve for that signal

A future P13.4 enhancement can join against P14's signal store to compute real `averageTimeToApprove` metrics. This does not violate invariant 4 because P14 populates the timestamps as part of its own workflow — it does not modify P13 scoring or stores.

## Files

### P14.0 — Design (this PR)

```
docs/architecture/specs/2026-07-05-p14-0-governance-operator-workflow.md  # ← this file
docs/architecture/plans/2026-07-05-p14-0-governance-operator-workflow.md  # implementation plan
```

### Future files (per module)

```
# P14.1 Governance Signal Inbox
src/governance/signal-inbox.ts
tests/governance/signal-inbox.test.ts
# Amend: src/cli/commands/governance.ts (add inbox subcommand)

# P14.2 Operator Review Session
src/governance/operator-review.ts
tests/governance/operator-review.test.ts

# P14.3 Decision Capture
src/governance/decision-capture.ts
tests/governance/decision-capture.test.ts

# P14.4 Action Queue
src/governance/action-queue.ts
tests/governance/action-queue.test.ts

# P14.5 Audit Trail
src/governance/governance-audit.ts
tests/governance/governance-audit.test.ts

# P14.6 CLI / Dashboard Surface
src/cli/commands/governance.ts (amend — add all P14 subcommands)
tests/governance/governance-operator-invariants.test.ts
```
