# P18.0 — Governance Workbench & Lifecycle Operations Design Spec

**Status:** Design
**Phase:** P18 — Governance Workbench & Lifecycle Operations
**Builds on:** P14 (Auditability), P15 (Observability), P16 (Safe Response & Remediation), P17 (Approved Execution Lifecycle)

## 1. Purpose

P18 unifies the governance lifecycle into an operator-facing control surface for reviewing signals, remediation proposals, execution plans, approvals, execution records, and reports.

P14–P17 built the individual lifecycle phases as isolated concerns. P18 composes them into a coherent read-only operator experience: one surface to see what needs attention, trace a remediation from signal to completion, and understand the full state of governance at a glance.

Core goal: the operator should not need to switch between six subcommands to understand governance state. P18 provides composite views that cross-reference the stores.

## 2. Hard Boundaries

No autonomous execution. No policy mutation. No hidden side effects. No audit emitter imports. No operator ranking. No punitive inference. No lifecycle mutation from read-only views. No store writes. No direct audit emitter imports.

Every workbench view must be: read-only, composable from existing stores, deterministic, traceable to source data, stateless across invocations.

## 3. Scope

### In scope

| Slice | Deliverable |
|-------|-------------|
| P18.1 | Governance Workbench Read Model — aggregate read-only view across all governance stores |
| P18.2 | Operator Queue Views — pending decisions (accept, approve, review, follow-up) |
| P18.3 | Lifecycle Detail View — one traceable view per remediation from signal → report |
| P18.4 | Workbench CLI Integration — safe CLI views with text and JSON output |
| P18.5 | Workbench Report / Checkpoint — operator workflow report and final seal |

### Out of scope

Lifecycle mutation, acceptance decisions, approval decisions, execution, reversion, dismissal, resolution, superseding, store writes, audit emitter calls, autonomous action, policy mutation, operator ranking.

## 4. Architecture

### 4.1 Read Model

A pure function that takes all existing governance stores as input and produces a single composite state.

```typescript
interface GovernanceWorkbenchInput {
  signals: GovernanceSignal[];
  remediations: GovernanceRemediationProposal[];
  executionPlans: GovernanceExecutionPlan[];
  approvals: GovernanceExecutionApproval[];
  attempts: GovernanceExecutionAttempt[];
  report: GovernanceExecutionReport | null;
  options?: {
    since?: string;
    until?: string;
    now?: string;
  };
}
```

Output is a deterministic read-only snapshot:

```typescript
interface GovernanceWorkbenchSnapshot {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  queue: WorkbenchQueue;
  summary: WorkbenchSummary;
}
```

### 4.2 Data sources

| Store | Phase | Module |
|-------|-------|--------|
| GovernanceSignal | P12 | `governance-signal.ts` |
| GovernanceRemediationProposal | P16.2 | `remediation-queue.ts` |
| GovernanceExecutionPlan | P17.2 | `execution-plans.ts` |
| GovernanceExecutionApproval | P17.3 | `execution-approval.ts` |
| GovernanceExecutionAttempt | P17.4 | `execution-recorder.ts` |
| GovernanceExecutionReport | P17.5 | `execution-report.ts` |

### 4.3 Queue classification

The workbench classifies each remediation into one of four operator queues:

| Queue | Selection rule |
|-------|---------------|
| `needs_acceptance` | Remediation where `status === "open"` |
| `needs_planning` | Accepted remediation with no execution plan |
| `needs_approval` | Plan exists but no approval decision |
| `needs_followup` | Approved plan with failed/partial/started attempt, or no attempt yet |

Items can appear in at most one queue. Priority order: needs_acceptance > needs_planning > needs_approval > needs_followup.

### 4.4 Lifecycle detail

A single remediation's full trace:

```
signal → investigation → proposal → plan → approval → attempt → report
```

Each hop links to the originating entity's ID and status. Missing hops are explicitly shown as gaps. The trace is read-only — mutation happens through existing P16/P17 commands.

### 4.5 Summary

| Section | Content |
|---------|---------|
| queue_counts | Count per queue, total pending |
| lifecycle_state | Accepted/planned/approved/executed/failed/reverted/unresolved/superseded — from execution report |
| oldest_items | Top-N items by `createdAt` needing attention |
| staleness | Days since oldest unattended item per queue |

## 5. Non-goals

- No store writes
- No autonomous action
- No policy mutation
- No audit emission
- No operator scoring or ranking
- No lifecycle mutation from workbench views
- No chat/UI surface — CLI only in P18
- No web dashboard

## 6. Files

| File | Change |
|------|--------|
| `src/governance/governance-workbench.ts` | New — pure read model, queue classification, lifecycle trace |
| `tests/governance/governance-workbench.test.ts` | New — tests |
| `src/cli/commands/governance.ts` | Modified — CLI handler |

## 7. Required tests (P18.1–P18.2)

1. Empty inputs produce zero counts
2. Open remediation appears in needs_acceptance queue
3. Accepted remediation without plan appears in needs_planning
4. Plan without approval appears in needs_approval
5. Approved plan without attempt appears in needs_followup
6. Failed attempt appears in needs_followup
7. Partial attempt appears in needs_followup
8. Succeeded attempt does not appear in any queue
9. Rejected plan does not appear in any queue
10. Superseded remediation does not appear in any queue
11. Item appears in at most one queue (priority wins)
12. Lifecycle detail shows all populated hops
13. Lifecycle detail shows gaps for missing hops
14. Summary counts match items in queues + terminal states
15. Read model produces no store writes
16. No audit emitter imports
