# P4.5 — Autonomous Issue Execution Loop: System Design Specification

**Date:** 2026-06-18  
**Status:** Draft — supersedes all prior P4.5 planning  
**Repository:** `boduga/ALiX`  
**Foundation:** P4.3-S Security & Trust ✅, P4.4 Evidence Memory ✅  
**Tags:** `phase:p4.5`, `type:design`

---

## 1. Purpose

P4.5 turns GitHub Issues into ALiX's durable agent task queue. The goal is not "agent writes code" — it's "ALiX can accept an issue, generate a plan, create evidence, track progress, open a PR, and explain every decision." Execution (coding) is the *last* capability added, not the first.

**First milestone:** ALiX takes Issue #61 and moves it to PR without human intervention for a well-scoped, labeled issue.

---

## 2. Q1: Who Owns Decisions?

Every agent has an explicit, bounded scope. No agent can escalate its own authority.

| Decision | Owner | Notes |
|---|---|---|
| What to work on next | **IssueIntakeAgent** (proposes) → **Human** (approves) | Human picks from `ready-for-agent` labelled issues |
| How to implement | **PlanningAgent** | Produces task graph, file list, acceptance criteria |
| Approve plan for execution | **Human** only | Gate before any code is written |
| Write code | **ExecutionAgent** | Scoped to files in the approved plan |
| Review code | **ReviewAgent** (automated) → **Human** (final) | ReviewAgent finds issues; Human gates merge |
| Create PR | **PRAgent** | Automated — title, body, evidence links, issue links |
| Merge PR | **Human** only | ALiX never merges without explicit approval |
| Close issue | **Human** only | ALiX can suggest closure, never execute it |
| Delete branches | **Human** only | Safety invariant |
| Modify protected config | **Human** only | Config signing (P4.3-Se) requires human key |

**Key constraint:** ExecutionAgent and ReviewAgent are **separate agents**. P4.3-S proved that independent review catches real bugs (audit durability, grace parsing, double-now signing). The same agent must not both write and review code.

---

## 3. Q2: What Is the State Machine?

### States

| State | Description | Owner |
|---|---|---|
| `NEW` | Issue created, not yet evaluated | System |
| `SELECTED` | Issue intake complete, ready for planning | IssueIntakeAgent |
| `PLANNED` | Execution plan generated, awaiting human approval | PlanningAgent |
| `APPROVED_FOR_EXECUTION` | Human approved the plan | Human |
| `EXECUTING` | Code being written | ExecutionAgent |
| `BLOCKED` | Waiting on external dependency, human answer, CI, or service | WorkflowCoordinator |
| `UNDER_REVIEW` | Code submitted for review | ReviewAgent |
| `FIX_REQUIRED` | Review found issues, fixes needed | ExecutionAgent |
| `PR_READY` | PR created, awaiting human | PRAgent |
| `AWAITING_HUMAN` | Human gate (approve, request changes, merge) | Human |
| `MERGED` | PR merged, post-merge cleanup pending | System |
| `COMPLETE` | Issue finished | System |

### Allowed transitions

```
                         ┌─────────────────────────────────────┐
                         │                                     │
                         v                                     │
  NEW ──→ SELECTED ──→ PLANNED ──→ APPROVED_FOR_EXECUTION ──→ EXECUTING ──→ BLOCKED
  │         │             │              │                       │    │        │
  │         │             │              │                       │    │        │
  │         │             │              │                       v    │        v
  │         │             │              │                 UNDER_REVIEW │  EXECUTING
  │         │             │              │                  │       │   │
  │         │             │              │                  v       v   │
  │         │             │              │           FIX_REQUIRED      │
  │         │             │              │                  │          │
  │         │             │              └──────────────────┘          │
  │         │             │                                            │
  │         │             │              ┌─────────────────────────────┘
  │         │             │              v
  │         │             │        PR_READY ──→ AWAITING_HUMAN ──→ MERGED ──→ COMPLETE
  v         v             v                                         │
  └─────────┴─────────────┴─────────────────────────────────────────┘
                       (rollback — returns to NEW or SELECTED)
```

### Transition rules

| From | To | Trigger | Evidence Required | Rollback |
|---|---|---|---|---|
| `NEW` | `SELECTED` | IssueIntakeAgent selects issue | `issue_selected` | — |
| `SELECTED` | `PLANNED` | PlanningAgent completes plan | `plan_generated` | → `NEW` on plan failure |
| `PLANNED` | `APPROVED_FOR_EXECUTION` | Human approves plan | `plan_approved` | → `SELECTED` on rejection |
| `APPROVED_FOR_EXECUTION` | `EXECUTING` | ExecutionAgent starts work | `execution_started` | — |
| `EXECUTING` | `UNDER_REVIEW` | ExecutionAgent completes | `execution_completed` | → `EXECUTING` on compile failure |
| `EXECUTING` | `BLOCKED` | External dependency, human question, CI | `workflow_blocked` | → `EXECUTING` on unblock |
| `BLOCKED` | `EXECUTING` | Dependency resolved, unblocked | `workflow_unblocked` | — |
| `UNDER_REVIEW` | `FIX_REQUIRED` | ReviewAgent finds issues | `review_completed` | → `EXECUTING` with findings |
| `UNDER_REVIEW` | `PR_READY` | ReviewAgent approves | `review_completed` | — |
| `FIX_REQUIRED` | `EXECUTING` | ExecutionAgent receives fixes | `execution_started` | — |
| `PR_READY` | `AWAITING_HUMAN` | PRAgent creates PR | `pr_created` | → `EXECUTING` on PR failure |
| `AWAITING_HUMAN` | `MERGED` | Human merges PR | `merge_completed` | — |
| `AWAITING_HUMAN` | `PR_READY` | Human requests changes | — | → `EXECUTING` with feedback |
| `MERGED` | `COMPLETE` | Post-merge cleanup | `issue_closed` | — |
| Any | `(rolled back)` | Failure or rejection | `workflow_aborted` | Returns to prior state |

### Who can move

- **Agents:** SELECTED, PLANNED, EXECUTING, UNDER_REVIEW, FIX_REQUIRED, PR_READY
- **Human only:** APPROVED_FOR_EXECUTION, AWAITING_HUMAN, MERGED, COMPLETE
- **Either:** NEW (via issue create or human re-open)

---

## 4. Q3: What Are the Contracts?

### WorkPackage (IssueIntakeAgent → PlanningAgent)

```typescript
interface WorkPackage {
  issueNumber: number;
  issueTitle: string;
  labels: string[];
  priority: "low" | "medium" | "high" | "critical";
  complexity: "small" | "medium" | "large" | "unknown";
  estimatedFiles: string[];
  dependencies: number[]; // blocking issue numbers
  acceptanceCriteria: string[];
  riskFlags: string[];
}
```

### ExecutionPlan (PlanningAgent → ExecutionAgent + Human)

```typescript
interface ExecutionPlan {
  workPackage: WorkPackage;
  subtasks: Subtask[];
  branchName: string;
  estimatedCommits: number;
  approvalRequired: boolean;
}

interface Subtask {
  id: string;                    // e.g. "step-1"
  description: string;
  files: string[];               // files to create or modify
  testFiles: string[];
  acceptanceCheck: string;       // how to verify this subtask
  dependsOn: string[];           // subtask IDs
}
```

### ReviewFinding (ReviewAgent → Human + ExecutionAgent)

```typescript
interface ReviewFinding {
  severity: "critical" | "major" | "minor" | "nit";
  file: string;
  line?: number;
  summary: string;
  recommendation: string;
}

interface ReviewReport {
  issueNumber: number;
  commitSha: string;
  verdict: "approve" | "changes_requested" | "reject";
  findings: ReviewFinding[];
  summary: string;
}
```

### PullRequestArtifact (PRAgent → GitHub)

```typescript
interface PullRequestArtifact {
  issueNumber: number;
  branchName: string;
  title: string;
  body: string;          // includes issue links, evidence links, change summary
  draft: boolean;        // true until human review is complete
  evidenceFingerprints: string[];  // references into P4.4 store
}
```

### EvidenceArtifact (Every agent → EvidenceStore)

```typescript
interface EvidenceArtifact {
  eventType: EvidenceEventType;
  issueNumber: number;
  state: WorkflowState;
  actor: AgentName;
  timestamp: string;
  payload: Record<string, unknown>;
  transition: { from: WorkflowState; to: WorkflowState };
}
```

---

## 5. Q4: What Evidence Is Required?

Every state transition writes to P4.4 Evidence Memory:

| Event | Writer | Payload keys |
|---|---|---|
| `issue_selected` | IssueIntakeAgent | issueNumber, priority, complexity, labels |
| `plan_generated` | PlanningAgent | issueNumber, subtaskCount, estimatedFiles |
| `plan_approved` | System (CLI) | issueNumber, planFingerprint |
| `plan_rejected` | System (CLI) | issueNumber, reason |
| `execution_started` | ExecutionAgent | issueNumber, branchName, subtaskId |
| `execution_completed` | ExecutionAgent | issueNumber, commitSha, filesChanged |
| `review_started` | ReviewAgent | issueNumber, commitSha |
| `review_completed` | ReviewAgent | issueNumber, verdict, findingCount |
| `pr_created` | PRAgent | issueNumber, prUrl, branchName |
| `merge_completed` | System (webhook) | issueNumber, mergeCommitSha |
| `workflow_blocked` | WorkflowCoordinator | issueNumber, reason, blockedAt, blockingItem |
| `workflow_unblocked` | WorkflowCoordinator | issueNumber, blockedDurationMs |
| `workflow_aborted` | WorkflowCoordinator | issueNumber, reason, rollbackState |

All evidence is queryable via `alix evidence list --kind <event>`.

---

## 6. Q5: What Is the Trust Boundary?

### ALiX may NEVER do without human approval:

1. **Merge a PR** — merge requires human click on GitHub
2. **Delete a branch** — ALiX creates branches, never removes them
3. **Close an issue** — ALiX can suggest closure, never execute it
4. **Modify protected config** — paths defined in P4.3-Se's `coveredPaths`
5. **Sign a config** — config signing requires the human-held key
6. **Modify agent definitions** — ALiX cannot change agent roles, capabilities, or trust boundaries
7. **Push to main** — all branches are feature branches; only human merges to `main`

### ALiX MAY do autonomously:

- Create branches from issues
- Commit to feature branches
- Open PRs (as draft)
- Run CI pipelines
- Record evidence
- Read issues, labels, project boards

### Enforcement

- GitHub branch protection rules enforce the merge gate
- CI pipeline enforces signed config requirement (P4.3-Se)
- Evidence store is append-only; agents cannot delete evidence
- Workflow state machine rejects transitions that skip human gates

---

## 7. Q6: What Is Success?

### P4.5 is successful when:

1. ALiX accepts Issue #61 (a well-scoped, `ready-for-agent` labeled issue)
2. ALiX generates a plan with subtask breakdown and file estimates
3. ALiX creates evidence records for every workflow transition
4. ALiX executes the plan (creates branch, writes code, passes tests)
5. ALiX reviews its own code and finds issues before the human
6. ALiX opens a PR with issue links, change summary, and evidence links
7. ALiX explains every decision — why it chose the issue, why it designed the solution that way, what tradeoffs exist
8. A human can approve and merge with confidence

**Not measured:** lines of code, commit count, speed.

**Measured:** did ALiX govern work before doing work? Can a human audit the entire chain of decisions from a single `alix evidence show <fingerprint>`?

---

## 8. WorkflowCoordinator

The state machine must be owned by a single entity, not scattered across agents. The **WorkflowCoordinator** owns:

- State machine transitions (validates and enforces)
- Agent dispatch (assigns work to the right agent)
- Timeout detection and stalled-workflow recovery
- Evidence recording for every transition
- Orphan detection (workflow stuck in a state past its TTL)
- BLOCKED state management (dependency tracking, blocking/unblocking)

```typescript
class WorkflowCoordinator {
  // ── State machine ──────────────────────────────────────────
  async transition(issueNumber: number, to: WorkflowState): Promise<void>;
  async currentState(issueNumber: number): Promise<WorkflowStateEntry>;
  async listActive(): Promise<WorkflowStateEntry[]>;

  // ── Agent dispatch ─────────────────────────────────────────
  async assignAgent(issueNumber: number, agent: AgentName): Promise<void>;
  async releaseAgent(issueNumber: number): Promise<void>;

  // ── Block management ───────────────────────────────────────
  async block(issueNumber: number, reason: string, blockingItem?: string): Promise<void>;
  async unblock(issueNumber: number): Promise<void>;

  // ── Recovery ───────────────────────────────────────────────
  async detectStale(): Promise<WorkflowStateEntry[]>;
  async recover(issueNumber: number, forceState: WorkflowState): Promise<void>;

  // ── Evidence ───────────────────────────────────────────────
  private recordTransition(issueNumber: number, from: WorkflowState, to: WorkflowState): Promise<void>;
}
```

The WorkflowCoordinator is the **only** component that writes to the workflow state file. Agents report results; the Coordinator moves state.

## 9. Agent Capability Contract

Before assigning work, ALiX verifies the agent can handle the issue's complexity and domain.

```typescript
interface AgentCapability {
  agentId: AgentName;
  skills: string[];              // e.g. ["coding", "review", "planning", "intake"]
  maxComplexity: "small" | "medium" | "large";
  allowedTools: string[];        // e.g. ["git", "gh", "npm", "filesystem"]
  maxConcurrentIssues: number;
  requiresHumanGate: boolean;    // e.g. PRAgent always requires human
}
```

This contract enables P4.7 Dynamic Teams: ALiX selects agents whose capabilities match the issue requirements.

## 10. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WorkflowCoordinator                          │
│  State machine | Agent dispatch | Timeouts | Evidence recording     │
└───────┬─────────────────┬────────────────────┬──────────────────────┘
        │                 │                    │
        ▼                 ▼                    ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│  Agents      │  │  State File  │  │  Evidence Store  │
│              │  │  (.alix/)    │  │  (P4.4)          │
│ IssueIntake  │  │              │  │                  │
│ Planning     │  │ state.json   │  │ evidence.jsonl   │
│ Execution    │  │ state.lock   │  │                  │
│ Review       │  │ history.jsonl│  │                  │
│ PR           │  │              │  │                  │
└──────────────┘  └──────────────┘  └──────────────────┘
```

### Agent capabilities

| Agent | Skills | Tools | Max complexity |
|---|---|---|---|
| IssueIntakeAgent | intake, estimation, dependency detection | `gh issue view/list`, label reading | large |
| PlanningAgent | planning, file analysis, risk assessment | `gh issue view`, file system (read-only) | large |
| ExecutionAgent | coding, testing, refactoring | `git`, file system (write), `npm`, `gh` | large |
| ReviewAgent | code review, diff analysis, test verification | `git diff`, file system (read-only), `npx vitest` | large |
| PRAgent | PR creation, documentation | `gh pr create/comment` | small |

---

## 11. Storage Layout

```
.alix/
  workflow/
    state.json              # current workflow state per issue
    state.json.lock         # cross-process lock (reuse P4.3-Sd audit lock)
    history.jsonl           # append-only workflow event log

  security/evidence.jsonl   # P4.4 evidence store (shared)
```

### Key files

| File | Purpose |
|------|---------|
| `src/workflow/coordinator.ts` | WorkflowCoordinator — state machine, agent dispatch, block management, recovery |
| `src/workflow/types.ts` | Shared contracts and interfaces |
| `src/workflow/state-file.ts` | State file read/write with cross-process lock |
| `src/workflow/evidence-writer.ts` | Evidence event recording |
| `src/workflow/agents/issue-intake-agent.ts` | IssueIntakeAgent |
| `src/workflow/agents/planning-agent.ts` | PlanningAgent |
| `src/workflow/agents/execution-agent.ts` | ExecutionAgent |
| `src/workflow/agents/review-agent.ts` | ReviewAgent |
| `src/workflow/agents/pr-agent.ts` | PRAgent |
| `src/cli/commands/workflow.ts` | CLI commands: `alix workflow status/list/transition` |

### State file schema

```typescript
interface WorkflowStateEntry {
  issueNumber: number;
  state: WorkflowState;
  assignedAgent: AgentName | null;
  evidenceFingerprints: string[]; // links into evidence store
  startedAt: string;
  updatedAt: string;
  humanGateRequired: boolean;
  planFingerprint?: string;       // links to ExecutionPlan evidence
  prNumber?: number;
  error?: string;
}
```

---

## 12. Build Order

```
1. System Design Specification (this document)                          ← DONE
2. Epic + work-unit issues created (epic #61, issues #62–#68)          ← DONE
3. WorkflowCoordinator — state machine, agent dispatch, timeouts       ← NEXT
4. Evidence event writer — every transition → P4.4 store
5. IssueIntakeAgent — read issues, estimate, package
6. PlanningAgent — task graph, acceptance criteria
7. ReviewAgent — independent review
8. PRAgent — automated PR creation
9. ExecutionAgent — code generation (LAST)
```

**Rationale for order change:** The WorkflowCoordinator is the kernel. IssueIntakeAgent and PlanningAgent depend on workflow state. Everything else is a plugin to the state machine.

**Cardinal rule:** No autonomous coding until ALiX can prove it can select, plan, track, and explain work safely.

---

## 13. Risk Register

| Risk | Mitigation |
|---|---|
| ExecutionAgent produces incorrect code | ReviewAgent catches before human gate |
| State machine deadlocks | Lock with stale recovery (P4.3-Sd); human override via CLI |
| Evidence store contention | Reuses P4.3-Sd AuditLock for cross-process safety |
| Agent misidentifies issue scope | PlanningAgent estimates files; human approves plan |
| Branch conflicts from concurrent agents | Feature branches per issue; merge via PR |
| Orphaned workflow state | Timeout + alert via Observability (P4.2) |

---

## 14. Migration Path

P4.5 is additive — it does not modify P4.3-S or P4.4 code. It creates new agents that consume existing infrastructure:

- GitHub Issues → IssueIntakeAgent (new)
- Evidence Store → EvidenceArtifact (new consumer)
- Audit lock → Workflow state lock (reuse pattern)
- CLI → Workflow commands (new)
- Health system → Workflow health signals (new consumer)

No existing infrastructure is modified. This allows independent testing and rollback.

---

*End of SDS. Implementation begins when this document is approved and work-unit issues are created.*
