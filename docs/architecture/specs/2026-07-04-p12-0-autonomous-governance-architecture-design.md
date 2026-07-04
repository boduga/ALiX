# P12.0 — Autonomous Governance & Control Plane Design Spec

**Date:** 2026-07-04
**Status:** Design — implementation deferred.

## Purpose

P11 gave ALiX the ability to observe, reason, plan, learn, forecast, and safely move an issue toward a draft PR. P12 decides **when ALiX is allowed to act, what risk level it is operating under, and when a human must approve**.

P12 answers four questions:

```
Can ALiX act?          → Policy Engine (P12.1)
How risky is this?     → Risk Scoring (P12.2)
Does it need approval? → Approval Workflow (P12.3)
What proves it ran?    → Run Ledger (P12.4)
```

## Architecture

```
Issue → Policy Engine → Risk Scoring → Approval Workflow
  → (if approved) → Existing P11 safe chain
  → Run Ledger (audit trail)
  → Failure Memory (regression prevention)
  → Operator CLI (governance surface)
```

## Components

### P12.1 — Policy Engine

Deterministic engine evaluating whether ALiX is allowed to proceed.

```typescript
interface PolicyResult {
  decision: "allow" | "deny" | "requires_approval";
  reason: string;
  matchedPolicies: string[];
  requiredApprovals: string[];
}

interface Policy {
  id: string;
  description: string;
  /** Pattern to match against action types, labels, repos, paths */
  match: PolicyMatch;
  effect: "allow" | "deny" | "requires_approval";
  /** Required approval role when effect is requires_approval */
  approvalRole?: string;
}

interface PolicyMatch {
  actionTypes?: string[];       // e.g. ["issue.run", "issue.pr"]
  labels?: string[];            // e.g. ["bug", "security"]
  repos?: string[];             // e.g. ["boduga/ALiX"]
  paths?: string[];             // e.g. ["src/security/**"]
  maxFiles?: number;
  branches?: string[];
}
```

Example policy:

```json
{
  "id": "security-source-deny",
  "description": "Deny autonomous changes to security source code",
  "match": { "paths": ["src/security/**", "src/auth/**"] },
  "effect": "deny"
}
```

### P12.2 — Risk Scoring

Classify autonomous runs by risk level.

```typescript
type RiskLevel = "low" | "medium" | "high" | "critical";

interface RiskScore {
  level: RiskLevel;
  score: number;           // 0–100
  factors: RiskFactor[];
}

interface RiskFactor {
  name: string;
  score: number;           // 0–100 contribution
  description: string;
}
```

Risk factors:

| Factor | Low (0-25) | Medium (26-50) | High (51-75) | Critical (76-100) |
|--------|-----------|----------------|--------------|-------------------|
| File scope | Docs, tests only | Source changes | Security/auth paths | Secrets, infra, deploy |
| File count | 1-3 | 4-6 | 7-10 | 10+ |
| Action type | Read, proposal | Edit existing | Delete, create | Destructive, release |
| Verification | Build+test pass | Typecheck only | No verification | Failed |
| Labels | docs, test | bug, chore | feature, enhancement | security, infra |

### P12.3 — Approval Workflow

Approval gates before sensitive transitions.

```typescript
interface ApprovalGate {
  gate: "proposal" | "file_scope" | "verification" | "pr" | "merge";
  status: "pending" | "approved" | "denied";
  approvedBy?: string;
  approvedAt?: string;
  reason?: string;
}
```

| Gate | When required | Default |
|------|---------------|---------|
| `proposal` | Risk >= medium | Requires approval |
| `file_scope` | Risk >= high | Requires approval |
| `verification` | Risk >= low | Always runs |
| `pr` | Risk >= low | Always draft |
| `merge` | Always | Never autonomous |

### P12.4 — Run Ledger

Persistent audit trail for every autonomous decision.

```typescript
interface LedgerEntry {
  runId: string;
  issueId: string;
  policyResult: PolicyResult;
  riskScore: RiskScore;
  approvals: ApprovalGate[];
  filesChanged: string[];
  verificationResults: VerificationResult[];
  draftPrId?: string;
  outcome: "completed" | "failed" | "cancelled" | "denied";
  timestamp: string;
}
```

### P12.5 — Failure / Regression Memory

When a run fails, ALiX remembers why and avoids repeating.

```typescript
interface FailureRecord {
  runId: string;
  issueId: string;
  failureType: "policy_denied" | "file_scope_violation" | "blocked_command"
    | "verification_timeout" | "test_failure" | "approval_denied" | "pr_rejected";
  detail: string;
  timestamp: string;
}
```

### P12.6 — Operator Control Surface

CLI commands:

```bash
alix governance status          # Current policy state
alix governance policies        # List policies
alix runs list                  # Recent ledger entries
alix runs show <id>             # Single entry details
alix runs approve <id>          # Approve pending run
alix runs deny <id>             # Deny pending run
alix runs cancel <id>           # Cancel in-progress run
```

## Integration with P11

Each P11 component feeds into P12:

| P11 component | Feeds P12 |
|---------------|-----------|
| Eligibility checks | Policy match input |
| Execution context | Run ledger identity |
| Changed-files guardrail | Risk factor (file scope) |
| Verification runner | Risk factor (verification) + ledger evidence |
| Draft PR creation | Approval gate (pr) + ledger entry |
| Diagnostic events | Failure memory evidence |
| EventLog | Ledger audit trail |

## Implementation Order

| PR | Title | Scope |
|----|-------|-------|
| 214 | (this doc) | Design spec |
| 215 | `feat(governance): add P12.1 policy engine` | Policy type, engine, CLI list |
| 216 | `feat(governance): add P12.2 risk scoring` | RiskScore, RiskFactor, classification |
| 217 | `feat(governance): add P12.3 approval workflow` | ApprovalGate, approve/deny CLI |
| 218 | `feat(governance): add P12.4 run ledger` | LedgerEntry, persist, CLI query |
| 219 | `feat(governance): add P12.5 failure memory` | FailureRecord, store, recall |
| 220 | `feat(governance): add P12.6 operator CLI` | Full governance CLI surface |
| 221 | `docs(governance): record P12 checkpoint` | Milestone doc |

## Non-Goals

- **No autonomous merge** — policy enforced at P12 level
- **No dashboard UI** — CLI-first control surface
- **No distributed governance** — single-machine policies
- **No OpenTelemetry** — existing diagnostics store sufficient
- **No orchestration rewrite** — P12 layers on top of P11

## Verification

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```
