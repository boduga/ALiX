# Executive Lifecycle Reference

> **Purpose:** Single canonical reference for the ALiX Executive subsystem — commands, state machines, evidence, lineage, recovery, and fixture requirements.
>
> **Covers:** P10.0–P10.9.2d (Executive Intelligence through Remediation Stabilization).

---

## 1. Architecture Overview

The Executive subsystem plans, executes, observes, and remediates multi-step improvement objectives for the ALiX agent. It is the **operational layer** between strategic signals (health, trends, recommendations) and tactical mutations (proposals, governance changes).

```
┌──────────────────────────────────────────────────────────────┐
│                    Executive Subsystem                         │
│                                                              │
│  ┌──────────┐   ┌───────────┐   ┌────────────┐              │
│  │ Signals  │──▶│  Plan     │──▶│  Execution │──▶ Outcomes   │
│  │ (health, │   │  Engine   │   │  Engine    │              │
│  │  trends) │   └───────────┘   └─────┬──────┘              │
│  └──────────┘                         │                      │
│                                       ▼                      │
│  ┌──────────┐                 ┌──────────────┐               │
│  │ Learn    │◀── Trends ◀────│  Bridge +    │               │
│  │ & Adapt  │                 │  Remediate   │──▶ Proposals  │
│  └──────────┘                 └──────────────┘               │
│                                       │                      │
│                                       ▼                      │
│  ┌──────────┐                 ┌──────────────┐               │
│  │Dashboard │◀──── Refresh ──│  Orchestrate │──▶ Resume Plan │
│  └──────────┘                 └──────────────┘               │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Command Reference

All commands under `alix executive <subcommand>`.

### Plan Lifecycle

| Command | Phase | Description |
|---------|-------|-------------|
| `alix executive dashboard` | Observe | Display executive health dashboard (5 panels: Health, Priority, Objective, Trend, Plan) |
| `alix executive plan create [N]` | Plan | Create an execution plan from current dashboard signals (default window: 7 days) |
| `alix executive plan list` | Plan | List all saved execution plans |
| `alix executive plan show <id>` | Plan | Show full details of a plan |
| `alix executive plan approve <id>` | Plan | Approve a plan for execution |
| `alix executive plan reject <id> [--reason]` | Plan | Reject a plan |
| `alix executive plan start <id>` | Execute | Begin executing an approved plan |
| `alix executive plan run <id>` | Execute | Run all ready steps (call runReadySteps) |
| `alix executive plan step <stepId>` | Execute | Execute a single step |
| `alix executive plan resume <id>` | Execute | Resume a blocked/waiting plan |

### Observation & Analysis

| Command | Phase | Description |
|---------|-------|-------------|
| `alix executive evaluate <id> [--save]` | Observe | Evaluate an execution plan outcome |
| `alix executive outcomes list [--plan <id>]` | Observe | List outcome reports |
| `alix executive outcomes show <id>` | Observe | Show full outcome report |
| `alix executive learn trends [--window N]` | Analyze | Compute learning trends from outcomes |
| `alix executive recommend [--save]` | Analyze | Generate recommendations from trends |
| `alix executive recommend [--save]` | Analyze | (--save persists to RecommendationReportStore) |
| `alix executive recommendation-effectiveness` | Analyze | Show effectiveness dispositions per recommendation |
| `alix executive subsystem-correlation` | Analyze | Cross-subsystem correlation analysis |

### Bridge & Remediate

| Command | Phase | Description |
|---------|-------|-------------|
| `alix executive bridge status --plan <id>` | Bridge | Show proposal readiness for a plan |
| `alix executive bridge` | Bridge | Convert eligible executive recommendations into P5 governance proposals |
| `alix executive remediate <proposalId> [flags]` | Remediate | Generate a child proposal from an executive_remediation_request |
| `alix executive orchestrate [--plan <id>] [--dry-run]` | Recover | Reconcile terminal child proposals against parent plans |

### Flags for `remediate`

| Flag | Description |
|------|-------------|
| `--action <name>` | Action type. Accepts aliases: `governance`, `agent_card`, `skill`, `issue` |
| `--target <id>` | Target identifier (skill ID, governance ID, etc.) |
| `--reason <text>` | Human-readable reason (min 10 chars) |
| `--payload <file>` | JSON file path with additional payload fields |
| `--dry-run` | Preview without writing |
| `--json` | Structured JSON output |

### Flags for `orchestrate`

| Flag | Description |
|------|-------------|
| `--plan <id>` | Only process proposals linked to this plan |
| `--dry-run` | Preview reconciliation without mutations |
| `--json` | Structured JSON output |

---

## 3. Plan Lifecycle

```
  ┌─────────┐
  │  draft  │ ←── alix executive plan create
  └────┬────┘
       │
  ┌────▼──────┐
  │  approved  │ ←── alix executive plan approve
  └────┬──────┘
       │
  ┌────▼──────┐
  │  running   │ ←── alix executive plan start
  └────┬──────┘
       │
       ├─────────────────── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
       │                      │                    │
  ┌────▼──────┐        ┌──────▼──────┐      ┌─────▼─────┐
  │ completed │        │   failed    │      │  blocked  │
  │ (all steps│        │ (step fail) │      │ (step     │
  │  done)    │        │             │      │  blocked) │
  └───────────┘        └─────────────┘      └─────┬─────┘
                                                   │
                                         ┌─────────▼──────┐
                                         │  running       │
                                         │ (via resume)   │
                                         └────────────────┘
```

**Transitions:**

| From | To | Trigger |
|------|----|---------|
| draft | approved | `alix executive plan approve` |
| draft | rejected | `alix executive plan reject` |
| approved | running | `alix executive plan start` |
| running | completed | All steps complete |
| running | failed | Any step terminates with `failed` status |
| running | blocked | Any step terminates with `blocked` status |
| blocked | running | `alix executive plan resume` |
| completed | — | Terminal — no further transitions |
| failed | — | Terminal — no further transitions |

---

## 4. Step State Machine

```
  ┌──────────┐
  │  pending │ ←── Initial state after plan approval
  └────┬─────┘
       │ (dependsOn satisfied, step starts)
  ┌────▼──────────┐
  │  in_progress  │ ←── StepRunner is executing
  └────┬──────────┘
       │
       ├──────────────────── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
       │                           │               │
  ┌────▼─────────┐     ┌───────────▼──────┐  ┌────▼──────┐
  │  completed   │     │ waiting_for_bridge│  │  failed   │
  │ (step done)  │     │ (proposal created)│  │ (error)   │
  └──────────────┘     └──────────┬────────┘  └───────────┘
                                  │
                          ┌───────▼─────────┐
                          │  completed      │ ←── OrchestrationHook
                          │ (child applied) │     or reconcileChildProposal
                          └─────────────────┘
```

**Transitions:**

| From | To | Trigger |
|------|----|---------|
| pending | in_progress | `runReadySteps` or `executeStep` |
| in_progress | completed | Step executes successfully |
| in_progress | failed | Step throws or returns error |
| in_progress | waiting_for_bridge | Step bridges to P5 proposal (see §6) |
| waiting_for_bridge | completed | Child proposal applied → orchestration |
| waiting_for_bridge | blocked | Child proposal failed → orchestration |

---

## 5. Proposal Lifecycle (P5/P9 Adaptation)

```
  ┌──────────┐
  │ pending  │ ←── Created by remediate, bridge, or auto-generator
  └────┬─────┘
       │
  ┌────▼────────┐
  │  approved   │ ←── alix adaptation approve
  └────┬────────┘
       │
  ┌────▼────────┐      ┌───────────┐
  │  applied    │      │  failed   │ ←── apply threw
  │ (success)   │      └───────────┘
  └────┬────────┘
       │ (optionally)
  ┌────▼──────────┐
  │  reverted     │ ←── alix adaptation revert
  └───────────────┘
```

**Proposal action types (remediation subset shown; full list in `adaptation-types.ts`):**

| Action | Alias | Target Kind | Description |
|--------|-------|-------------|-------------|
| `governance_change` | `governance` | governance | Modify governance calibration/lens/policy |
| `update_agent_card` | `agent_card` | agent_card | Update agent card definition |
| `adjust_skill_definition` | `skill` | skill | Modify a skill definition |
| `create_improvement_issue` | `issue` | issue | Create a GitHub issue |

---

## 6. Proposal Lineage

The executive subsystem produces a lineage chain: plan → step → bridge proposal → remediation proposal → apply.

```
┌──────────────────────────────────────────────────────────────┐
│                        Lineage Chain                          │
│                                                              │
│  Executive Plan                                               │
│  └── Step "remediate-X"                                      │
│       └── Action: executive_remediation_request              │
│            └── Remediation (alix executive remediate)        │
│                 ├── Child Proposal A (e.g., governance_change)│
│                 │    ├── approved (by human)                 │
│                 │    ├── applied  (by human)                 │
│                 │    └── OrchestrationHook fires             │
│                 │         └── Step → completed               │
│                 │                                              │
│                 └── Child Proposal B (e.g., skill fix)       │
│                      ├── approved                            │
│                      └── applied                             │
│                           └── OrchestrationHook fires        │
│                                └── Step → completed          │
│                                                              │
│  When all steps complete → Plan → completed                  │
└──────────────────────────────────────────────────────────────┘
```

**Payload lineage metadata** (carried through the chain):

```json
{
  "source": "executive_remediate",
  "planId": "plan-414561-7",
  "stepId": "remediate-1",
  "parentProposalId": "prop-exec-remediation-xxx"
}
```

These fields are reserved by `validatePayload()` and cannot be overridden via `--payload`.

---

## 7. Evidence Types

Evidence is recorded at every stage. All executive evidence types:

### Plan-level evidence

| Type | When emitted | Payload includes |
|------|-------------|-----------------|
| `executive_plan_saved` | Plan created | `{ planId, stepCount }` |
| `executive_plan_approved` | Plan approved | `{ planId, approvedBy }` |
| `executive_plan_rejected` | Plan rejected | `{ planId, reason }` |
| `executive_plan_started` | Plan execution begins | `{ planId }` |
| `executive_plan_completed` | All steps done | `{ planId, stepCount }` |
| `executive_plan_failed` | Any step failed | `{ planId, failedStepId, error }` |

### Step-level evidence

| Type | When emitted | Payload includes |
|------|-------------|-----------------|
| `executive_step_intent_recorded` | Before execution | `{ planId, stepId }` |
| `executive_step_executed` | Step completes | `{ planId, stepId, durationMs }` |
| `executive_step_blocked` | Step blocked | `{ planId, stepId, reason }` |
| `executive_step_bridged_to_proposal` | Bridge creates proposal | `{ planId, stepId, proposalId }` |
| `executive_step_bridge_failed` | Bridge fails | `{ planId, stepId, error }` |
| `executive_step_applied_remediation` | Remediation child created | `{ planId, stepId, childProposalId }` |
| `executive_step_orchestrated` | Child terminal → step transition | `{ planId, stepId, childProposalId, childStatus, newStepStatus }` |

### Proposal-level evidence (P5)

| Type | When emitted | Payload includes |
|------|-------------|-----------------|
| `adaptation_proposed` | Proposal created | `{ proposalId, action, target, reason }` |
| `adaptation_approved` | Proposal approved | `{ proposalId, approvedBy }` |
| `adaptation_applied` | Proposal applied | `{ proposalId, action, target, snapshotFingerprint }` |
| `adaptation_failed` | Proposal apply failed | `{ proposalId, error }` |
| `adaptation_snapshot_taken` | Before mutation | `{ proposalId, snapshotFingerprint, contentHash, filePath }` |

---

## 8. Recovery & Orchestration

### Hybrid architecture

The orchestration layer uses a two-path design:

```
                        ┌─────────────────────┐
                        │  alix adaptation apply│
                        └──────────┬──────────┘
                                   │
              ╔════════════════════╧════════════════════╗
              ║  Fast Path (event hook)                  ║
              ║  ExecutiveOrchestrator.onProposalTerminal║
              ║    └── reconcileChildProposal            ║
              ║         └── step: waiting_for_bridge     ║
              ║              → completed / blocked        ║
              ║                                           ║
              ║  Caveat: on failed apply, process.exit    ║
              ║  fires before async hook completes.       ║
              ╚════════════════════╤════════════════════╝
                                   │
              ┌────────────────────┴────────────────────┐
              │  Recovery Path (CLI)                     │
              │  alix executive orchestrate [--plan <id>]│
              │    └── Scans all proposals for           │
              │         unreconciled children            │
              │    └── Shows dry-run preview with        │
              │         --dry-run (pure preview only)    │
              │    └── Applies reconciliation with       │
              │         real EvidenceEventWriter          │
              └─────────────────────────────────────────┘
```

### Remediation flow

```
  alix executive remediate <proposalId> --action <type> --target <id> --reason "..."
       │
       ├── 1. Load parent proposal (executive_remediation_request)
       ├── 2. validateRemediationParent — must be approved, executive type
       ├── 3. Find provider via RemediatorRegistry
       ├── 4. parseFlagSpec — resolve action aliases, validate governance kind
       ├── 5. validateSpecification — action, target, reason, governance kind
       ├── 6. Skill preflight — check .alix/skills/workflow/<id>.json exists
       ├── 7. Build child proposal draft
       ├── 8. Save via ProposalStore
       └── 9. Record executive_step_applied_remediation evidence
```

---

## 9. File Structure

```
.alix/executive/
├── plans/                    # PlanStore directory
│   ├── plan-<id>.json        # PersistedExecutionPlan
│   └── <planId>-state.json   # PlanExecutionState (alongside plan file)
├── outcomes/                 # OutcomeReportStore directory
│   └── outcome-<planId>-<timestamp>.json
├── trends/                   # Trend store directory
├── recommendations/          # RecommendationReportStore directory
│   └── recommendation-<id>.json
├── snapshots/                # ExecutiveSnapshotStore directory
└── bridges/                  # Bridge metadata directory

.alix/adaptation/
├── proposals/                # ProposalStore directory
│   └── prop-<id>.json
├── snapshots/                # Adaptation snapshot files (per proposal)
│   └── <proposalId>.json
└── effectiveness/            # Effectiveness data

.alix/skills/
└── workflow/                 # Skill definitions directory
    └── <skillId>.json

.alix/governance/             # Governance files directory
├── calibration.json
├── lens-registry.json
└── policy-coverage.json

.alix/security/               # Evidence store
├── evidence.jsonl            # Append-only JSONL evidence log
└── evidence.lock             # Cross-process lock (auto-clears stale)
```

---

## 10. E2E Fixture Requirements

Use `tests/executive/fixture-helpers.ts` to bootstrap test data:

| Helper | Creates | Required for |
|--------|---------|-------------|
| `seedSkillFixture(rootDir, skillId)` | `.alix/skills/workflow/<skillId>.json` | Testing `adjust_skill_definition` remediation |
| `seedCalibrationFixture(rootDir)` | `.alix/governance/calibration.json` | Testing `confidence_calibration` governance |
| `seedLensRegistryFixture(rootDir)` | `.alix/governance/lens-registry.json` | Testing `lens_adjustment` governance |
| `seedPolicyCoverageFixture(rootDir)` | `.alix/governance/policy-coverage.json` | Testing `policy_coverage` governance |
| `bootstrapMinimalFixture(rootDir)` | All of the above + security + proposals dirs | Full E2E test setup |

**Golden path sequence** (full E2E):

```bash
# 1. Create a plan
alix executive plan create 7
# 2. Show dashboard health
alix executive dashboard
# 3. Approve and start the plan
alix executive plan approve <planId>
alix executive plan start <planId>
# 4. Check bridge status
alix executive bridge status --plan <planId>
# 5. Remediate a step
alix executive remediate <proposalId> --action skill --target <skillId> --reason "stabilize lifecycle test"
# 6. Approve and apply the child
alix adaptation approve <childProposalId>
alix adaptation apply <childProposalId>
# 7. Orchestrate the plan back to running
alix executive orchestrate --plan <planId>
# 8. Evaluate the outcome
alix executive evaluate <planId>
alix executive learn trends
alix executive recommend
```

---

## 11. Known Debt

| Item | Status | Impact |
|------|--------|--------|
| Windows shell compatibility | Unresolved | Certain CLI patterns (path separators, shell quoting) may fail on Windows |
| Failed-apply hook race | Documented | `process.exit(1)` in catch block fires before async orchestration completes. Recovery CLI is the reliable path |
| Governance applier lock | Process-local only | `GovernanceChangeApplier` serialization lock is per-process. Concurrent CLI invocations could race — mitigated by cross-process evidence lock on the evidence store |
| No golden path regression test | Unresolved | No automated E2E test exercises the full plan→bridge→remediate→apply→orchestrate→evaluate sequence |

---

## 12. Quick Reference: File Map

| Source File | Responsibility |
|-------------|---------------|
| `src/executive/planning-engine.ts` | Plan creation from dashboard signals |
| `src/executive/plan-store.ts` | PersistedExecutionPlan I/O |
| `src/executive/execution-state-store.ts` | PlanExecutionState I/O |
| `src/executive/step-runner.ts` | Single-step execution with evidence |
| `src/executive/execution-engine.ts` | Plan orchestration, runReadySteps |
| `src/executive/plan-approval-gate.ts` | Plan approve/reject gate |
| `src/executive/executive-bridge.ts` | Step → P5 proposal bridge |
| `src/executive/executive-remediate.ts` | Remediation wizard core (pure types, validators, builder) |
| `src/executive/executive-orchestrator.ts` | Lifecycle orchestration hook + reconciliation |
| `src/executive/executive-dashboard-loader.ts` | Dashboard data aggregation |
| `src/executive/executive-health.ts` | Health signal computation |
| `src/executive/outcome-evaluator.ts` | Plan outcome evaluation |
| `src/executive/outcome-store.ts` | OutcomeReportStore |
| `src/executive/trend-store.ts` | Learning trend persistence |
| `src/executive/recommendation-engine.ts` | Recommendation computation from trends |
| `src/executive/executive-recommend-store.ts` | RecommendationReportStore |
| `src/executive/executive-effectiveness.ts` | Effectiveness dispositions |
| `src/executive/subsystem-correlation.ts` | Cross-subsystem analysis |
| `src/cli/commands/executive.ts` | CLI dispatcher (router) |
| `src/cli/commands/executive-*-handler.ts` | Individual CLI handlers (one per subcommand) |
| `src/executive/executive-orchestrate-handler.ts` | Recovery CLI handler |
| `src/executive/executive-remediate-handler.ts` | Remediation CLI handler |

---

> **Last updated:** 2026-07-01
> **Covers:** P10.0 through P10.9.2d
> **Next expected:** P11
