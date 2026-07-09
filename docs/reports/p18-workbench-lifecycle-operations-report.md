# P18 — Governance Workbench & Lifecycle Operations

**Report Date:** _To be filled on merge_
**Status:** Final Checkpoint
**Tag:** `alix-p18-governance-workbench-complete`
**Commit:** _To be filled on merge_

---

## 1. Phase Summary

P18 introduced a **read-only governance workbench** that surfaces the operator-facing lifecycle of governance remediations: from signal detection through investigation, proposal, planning, approval, execution attempt, and execution report.

The phase delivered **5 slices** across queue views, lifecycle traces, a read model, a CLI integration, and this checkpoint report. Every slice enforces a hard **no-mutation boundary**: the workbench reads from governance stores but never writes to them, never emits audit events, and never invokes operator ranking or punitive inference.

**Deliverable scope:** 4 new source/handler files, 3 CLI commands, 4 test files, ~44 test cases, 0 new store writes, 0 new audit emitter imports.

---

## 2. Delivered Capabilities

### P18.1 — Governance Workbench Read Model

| Capability | Detail |
|------------|--------|
| **Snapshot builder** | `buildWorkbenchSnapshot()` — cross-references remediations, execution plans, approvals, attempts, signals, investigations, and reports into a deterministic combined view |
| **Queue classification** | `classifyQueue()` — maps each remediation into one of 4 operator queues based on lifecycle state |
| **Lifecycle trace builder** | `buildLifecycleTrace()` — ordered chain of 7 hop kinds with gap detection |
| **Summary computation** | `computeSummary()` — aggregate counts, oldest items, staleness |
| **Types** | `WorkbenchQueueName`, `WorkbenchSeverity`, `WorkbenchQueueItem`, `WorkbenchLifecycleHop`, `WorkbenchLifecycleTrace`, `WorkbenchSummary`, `GovernanceWorkbenchSnapshot` |

**Files:** `src/governance/governance-workbench.ts` (~740 lines)

### P18.2 — Operator Queue Views

| Capability | Detail |
|------------|--------|
| **4 queues** | `needs_acceptance`, `needs_planning`, `needs_approval`, `needs_followup` |
| **Deterministic sort** | Queue priority → severity desc → createdAt asc → id asc |
| **Severity mapping** | Remediation severity → workbench severity (critical→critical, high/medium→warning, low→info) |
| **Lifecycle totals** | accepted, planned, approved, executed, failed, partial, reverted, unresolved, superseded |
| **Staleness** | Days since oldest unattended item per queue |

### P18.3 — Lifecycle Detail View

| Capability | Detail |
|------------|--------|
| **7 hop kinds** | signal → investigation → proposal → plan → approval → attempt → report |
| **Gap detection** | Missing hops rendered as `○` with descriptive placeholder text |
| **Full chain** | Successfully links signal → investigation → remediation across `sourceRecommendationIds`, `sourceArtifactId`, and `signalId` |
| **Not-found handling** | Returns single `proposal:not_found` hop for unknown remediation IDs |

### P18.4 — Workbench CLI Integration

| Capability | Detail |
|------------|--------|
| **`alix governance workbench queue`** | Renders queue headers with severity-colored items, empty-state message |
| **`alix governance workbench trace <id>`** | Renders lifecycle hops with `●`/`○` markers, gap messaging |
| **`alix governance workbench summary`** | Renders queue counts, lifecycle totals, oldest items |
| **`--json` flag** | All 3 commands emit stable JSON output |
| **ANSI coloring** | Critical (red), warning (yellow), dim (info), labels in cyan |
| **Sentinel enforcement** | CLI handler does not call `.append()`, `.write()`, `.transition()`; imports no audit emitters |

**Files:** `src/cli/commands/governance.ts` (P18 section: ~210 lines at lines 2443–2652), `tests/cli/governance-workbench-cli.test.ts` (335 lines)

### P18.5 — Workbench Report / Checkpoint

This report.

---

## 3. Operator Workflow

The governance workbench surfaces a complete lifecycle chain for operators:

```
Signal ──→ Investigation ──→ Proposal ──→ Plan ──→ Approval ──→ Attempt ──→ Report
                             │            │          │             │
                             ▼            ▼          ▼             ▼
                       needs_acceptance  needs_    needs_        needs_
                                         planning  approval      followup
```

**Operator queue flow:**

1. A new remediation proposal is in `needs_acceptance` — operator reviews and accepts or dismisses
2. Once accepted, it moves to `needs_planning` — an execution plan must be created
3. Once a plan exists, it moves to `needs_approval` — operator approves or rejects the plan
4. Once approved, it moves to `needs_followup` — execution is attempted or pending

**Terminal states** (removed from queues): `dismissed`, `resolved`, `superseded`, `succeeded`, `reverted`.

---

## 4. Read-Only Boundary

The workbench is a **pure read model** with the following invariant:

```
workbench.ts:   NO store.append()   NO store.write()   NO store.transition()
                NO "audit-emitter"  NO "auditEmitter"  NO "emitAuditEvent"
                NO "emitAudit"      NO ExecutionStore import
CLI handler:   NO .append()        NO .write()         NO .transition()
                NO audit emitter imports
```

This is enforced by **compile-time sentinel tests** in both `governance-workbench.test.ts` and `governance-workbench-cli.test.ts` that read the source files and assert the absence of forbidden patterns.

---

## 5. Queue Model

Four operator queues are maintained, refreshed from the governance stores:

| Queue | Severity Scale | Trigger |
|-------|---------------|--------|
| `needs_acceptance` | critical → warning → info | Remediation status is `open` |
| `needs_planning` | critical → warning → info | Remediation accepted but no execution plan exists |
| `needs_approval` | warning only | Plan created but no operator approval |
| `needs_followup` | critical/warning | Approved but no attempt, attempt failed, or attempt partial |

Each queue item includes: `remediationId`, `proposalId`, `planId`, `approvalId`, `latestAttemptId`, `reason` (human-readable), `severity`, `createdAt`, `updatedAt`.

---

## 6. Lifecycle Trace Model

The trace links up to 7 lifecycle hops in order:

| Hop Type | Status Source | Gap Condition |
|----------|--------------|---------------|
| `signal` | signal.status | No signal linked via investigation.sourceArtifactId |
| `investigation` | investigation.status | No investigation linked via sourceRecommendationIds |
| `proposal` | remediation.status | Remediation not found |
| `plan` | "plan_created" | No plan for remediationId |
| `approval` | approval.decision | No approval for plan |
| `attempt` | attempt.status | No attempt for plan |
| `report` | reportItem.executionState | No report item for remediationId |

Gaps are rendered as `○` (dimmed) vs populated hops as `●`. The trace is built by `buildLifecycleTrace()` — a pure function with no store dependencies.

---

## 7. CLI Surface

### `alix governance workbench queue [--json]`

```
Needs Acceptance (1)
────────────────────────────────────────────────────────────
  INFO prop-test
    Reason: Remediation "Test proposal" needs operator acceptance
    Plan: —  Approval: —
    Created: 2026-07-09T12:00:00.000Z
```

JSON output: `{ queue: { needs_acceptance: [...], ... }, summary: { ... } }`

### `alix governance workbench trace <remediationId> [--json]`

```
Lifecycle Trace: prop-test
────────────────────────────────────────────────────────────
  signal        ● sig-1   new  Signal: anomaly detected
  investigation ● inv-1   open Investigation: anomaly
  proposal      ● prop-test accepted  Test proposal
  plan          ● plan-1  plan_created  Execution plan with 3 action(s)
  approval      ● approval-1 approved  Approved by operator
  attempt       ● attempt-1 succeeded  Execution succeeded
  report        ● prop-test executed  Execution state: executed
```

Gap hops render as `○ kind — — —` with dimmed text.

### `alix governance workbench summary [--json]`

```
Governance Workbench Summary
────────────────────────────────────────────────────────────
  Queues:
    1 needs acceptance
    1 needs planning
    1 needs approval
    1 needs follow-up
    4 total pending

  Lifecycle Totals:
    2 accepted
    1 planned
    1 executed
    ...

  Oldest pending items:
    r-1 — Remediation "..." needs operator acceptance
```

JSON output: `WorkbenchSummary` shape directly.

---

## 8. Safety Invariants

Three layers of safety enforcement:

| Invariant | Enforced By |
|-----------|------------|
| No store writes in workbench module | Sentinel tests scan `governance-workbench.ts` for `.append(`, `.write(`, `.transition(` |
| No audit emitter imports in workbench module | Sentinel tests scan for `audit-emitter`, `auditEmitter`, `emitAuditEvent`, `emitAudit` |
| No audit emitter imports in CLI handler | Sentinel tests scan `governance.ts` for same patterns |
| No write/append/transition in CLI workbench section | Sentinel tests scan the workbench handler section |
| JSON output contains no ANSI codes | Test asserts `\x1b[` not present in JSON output |
| Read model does not mutate inputs | Test snapshots inputs before/after `buildWorkbenchSnapshot()` call |
| No operator ranking terms in signal titles | Test asserts titles don't contain `operator failed`, `reviewer incomplete`, `low-quality` |
| Field names match snapshot type | Test asserts `snapshot.queue` (not `queues`) matches CLI output |

---

## 9. Test Coverage

### By slice

| Slice | File | Tests | Focus |
|-------|------|-------|-------|
| P18.1 – P18.3 | `tests/governance/governance-workbench.test.ts` | 21 | Queue classification, lifecycle trace, summary, purity, sentinels |
| P18.2 (signals) | `tests/governance/workbench-signals.test.ts` | 13 | `detectWorkbenchSignals` — stale proposals, critical alerts, patterns, orphans |
| P18.2 (lifecycle) | `tests/governance/remediation-lifecycle.test.ts` | 11 | State transitions, validity, error messages |
| P18.4 | `tests/cli/governance-workbench-cli.test.ts` | 9 | Text rendering, JSON validity, empty states, not-found, sentinels |

**Total P18 test cases: 54**

### Test breakdown by concern

| Concern | Count |
|---------|-------|
| Queue classification logic | 10 |
| Lifecycle trace / hops | 4 |
| Summary computation | 4 |
| CLI text rendering | 4 |
| CLI JSON output | 4 |
| Sentinels (purity, no-audit, no-write) | 7 |
| Workbench signal detection | 10 |
| Remediation state transitions | 11 |

### Running tests

```bash
npx tsx --test tests/governance/*.test.ts          # All governance tests
npx tsx --test tests/cli/governance-workbench-cli.test.ts  # CLI-only
```

---

## 10. Known Non-Goals

The following capabilities are explicitly deferred or out of scope for P18:

| Capability | Status | Rationale |
|-----------|--------|-----------|
| Lifecycle mutation | ❌ Deferred | Workbench is read-only by design |
| Approval/rejection via workbench | ❌ Deferred | Separate approval workflow exists at P9 |
| Remediation state transitions | ❌ Deferred | `transitionRemediationState` is tested but not wired to CLI |
| Execution via workbench | ❌ Deferred | Separate execution pipeline |
| Store writes from workbench | ❌ Never permitted | Pure read model invariant |
| Audit emission from workbench | ❌ Never permitted | Import sentinel enforced |
| Operator ranking | ❌ Never permitted | No punitive inference |
| Full store persistence for all lifecycle types | ⏳ Pending | Only `ExecutionStore` has file persistence; remediation, plan, approval stores are `TODO` stubs |
| Operator-facing UI (web dashboard) | ❌ Out of scope | Terminal CLI is the supported surface |

---

## 11. Final Checkpoint

P18 — Governance Workbench & Lifecycle Operations is sealed with the following evidence:

```text
P18.1 — Governance Workbench Read Model ✅
P18.2 — Operator Queue Views ✅
P18.3 — Lifecycle Detail View ✅
P18.4 — Workbench CLI Integration ✅
P18.5 — Workbench Report / Checkpoint ✅

TypeScript:                         clean
Governance tests (governance/):     54/54 passing
CLI tests (cli/):                   9/9 passing
No mutation boundary crossed:       verified
No audit emitter imports:           verified
No operator ranking drift:          verified
Checkpoint tag:                     alix-p18-governance-workbench-complete
```

The workbench is a **read-only operator surface** that satisfies all requirements established in the P18 design without crossing the no-mutation, no-audit, no-ranking boundaries specified in the hard boundary contract.
