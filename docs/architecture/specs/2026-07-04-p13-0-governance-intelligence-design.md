# P13.0 — Governance Intelligence & Cross-Run Learning Design Spec

**Date:** 2026-07-04
**Status:** Design — implementation deferred.

## Purpose

P12 gave ALiX a governance control plane: it can evaluate, score, gate, record, recall, and expose controls. P13 makes that control plane **self-auditing and improvement-aware** without making it self-authorizing.

P12 answers "what happened." P13 answers "what does it mean and what should we change."

```
P12 — Can ALiX act? How risky? What gates? What proves it?
P13 — What do the patterns say? What should we improve?
```

## Architecture

```
Run Ledger ──→ P13.1 Ledger Analytics ──→ P13.3 Policy Suggestions
                   │                              │
Failure Memory ──→ P13.2 Failure Clustering ──────┤
                   │                              │
Approval Log ────→ P13.4 Friction Analysis ───────┘
                   │
                   └──→ P13.5 Governance Report CLI
                              │
                              └──→ Human reviews suggestions
                                       │
                                       └──→ Approves/rejects P12 changes
```

## Core invariant

**Suggest governance improvements, don't silently enforce them.**

P13 observes, analyses, and recommends. It never:
- Modifies policy rules
- Changes risk scoring thresholds
- Alters approval gate configurations
- Writes to the run ledger or failure memory
- Blocks or delays any run

Every P13 output is a **recommendation report** that a human operator reads and decides on.

## Components

### P13.1 — Ledger Analytics

Read-only analysis of the run ledger (`run-ledger.jsonl`).

```typescript
interface LedgerAnalytics {
  totalRuns: number;
  byOutcome: Record<LedgerOutcome, number>;
  byRiskLevel: Record<RiskLevel, number>;
  approvalRate: number;           // approved / total gated
  averageRiskScore: number;
  timeframeDays: number;
  trendDirection: "improving" | "stable" | "degrading";
}
```

Also compute per-period (daily/weekly) rollups:

```typescript
interface PeriodRollup {
  date: string;
  runs: number;
  failures: number;
  denied: number;
  avgRiskScore: number;
}
```

**Reads from:** `FileLedgerStore` (P12.4)  
**Pure?** Yes — analyse, don't persist.  
**CLI:** `alix governance analytics [--window N] [--json]`

### P13.2 — Failure Pattern Clustering

Read-only analysis of failure memory (`failure-memory.jsonl`).

```typescript
interface FailureCluster {
  failureType: FailureType;
  count: number;
  recentTimestamp: string;
  commonDetailKeywords: string[];
  commonFilePaths: string[];
  associatedPolicyIds: string[];
}

interface FailureAnalysis {
  total: number;
  clusters: FailureCluster[];
  dominantType: FailureType;
  recurringFilePaths: string[];
  timeframeDays: number;
}
```

Clustering is simple field-grouping — count by `failureType`, collect common `filePaths` and `policyIds`, extract frequent keywords from `detail`. No ML necessary.

**Reads from:** `FileFailureMemoryStore` (P12.5)  
**Pure?** Yes.  
**CLI:** `alix governance failure-analysis [--window N] [--json]`

### P13.3 — Policy Refinement Suggestions

Read-analysis of policy outcomes to suggest adjustments.

```typescript
interface PolicySuggestion {
  type: "tighten" | "loosen" | "add_rule" | "remove_rule";
  policyId?: string;
  reason: string;
  evidence: {
    matchedCount: number;
    deniedCount: number;
    bypassedCount: number;
  };
  confidence: number;   // 0.0–1.0
  recommendation: string;
}
```

Examples:
- A policy that always denies could be tightened or removed.
- A pattern of `policy_denied` + subsequent successful manual merge suggests a rule that should be loosened.
- A frequent `verification_timeout` paired with `test_failure` on the same file paths suggests adding a verification policy.

**Reads from:** `FileLedgerStore` + `FileFailureMemoryStore`  
**Pure?** Yes — analysis only.  
**CLI:** `alix governance policy-suggestions [--window N] [--json]`

### P13.4 — Approval Friction Analysis

Analyse where approval gates cause the most friction.

```typescript
interface ApprovalFriction {
  gate: ApprovalGateName;
  totalOccurrences: number;
  deniedCount: number;
  pendingCount: number;
  approvedCount: number;
  averageTimeToApprove: number | null;  // hours, if timestamps available
  frictionScore: number;   // 0.0–1.0 based on deny rate + pending rate
}

interface FrictionReport {
  gates: ApprovalFriction[];
  highestFrictionGate: ApprovalGateName | null;
  totalApprovalsRequested: number;
  overallFrictionScore: number;
}
```

This identifies which gates are bottlenecks — e.g., `proposal` with 80% deny rate means proposals need better spec, while `verification` with 60% pending means verification is slow.

**Reads from:** `FileLedgerStore`  
**Pure?** Yes.  
**CLI:** `alix governance friction-analysis [--window N] [--json]`

### P13.5 — Governance Report CLI

Surface all P13 analyses through a unified CLI.

```bash
alix governance report                    # Full governance intelligence report
alix governance report --json             # Machine-readable
alix governance report --section analytics
alix governance report --section failures
alix governance report --section policies
alix governance report --section friction
alix governance report --window 30        # Last 30 days
```

The report aggregates P13.1–P13.4 into a single terminal view with coloured output and section headers.

**Not a dashboard** — terminal-first, no persistent server needed.

### P13.6 — Checkpoint + Tag

After all P13 components ship:

```bash
git tag alix-p13-complete
```

## Files

```
src/governance/ledger-analytics.ts           # P13.1
src/governance/failure-clustering.ts         # P13.2
src/governance/policy-suggestions.ts         # P13.3
src/governance/approval-friction.ts          # P13.4
src/cli/commands/governance.ts               # P13.5 (amend)
tests/governance/ledger-analytics.test.ts
tests/governance/failure-clustering.test.ts
tests/governance/policy-suggestions.test.ts
tests/governance/approval-friction.test.ts
```

## Implementation order

| PR | Title | Scope |
|----|-------|-------|
| 221 | (this doc) | Design spec |
| 222 | `feat(governance): add P13.1 ledger analytics` | LedgerAnalytics, PeriodRollup, CLI |
| 223 | `feat(governance): add P13.2 failure clustering` | FailureCluster, FailureAnalysis, CLI |
| 224 | `feat(governance): add P13.3 policy suggestions` | PolicySuggestion, analysis, CLI |
| 225 | `feat(governance): add P13.4 approval friction` | ApprovalFriction, FrictionReport, CLI |
| 226 | `feat(governance): add P13.5 governance report` | Unified report CLI |
| 227 | `docs(governance): record P13 checkpoint` | Milestone doc + tag |

## Non-goals

- **No enforcement** — all outputs are advisory
- **No ML** — clustering is field-grouping, not NLP or embeddings
- **No real-time analysis** — on-demand CLI only
- **No persistent P13 state** — every analysis reads P12 stores fresh
- **No dashboard UI** — terminal-first
- **No policy mutation** — P13 never writes policy files

## Verification

```bash
pnpm build
pnpm typecheck
node --test dist/tests/governance/ledger-analytics.test.js
node --test dist/tests/governance/failure-clustering.test.js
node --test dist/tests/governance/policy-suggestions.test.js
node --test dist/tests/governance/approval-friction.test.js
pnpm test:vitest
```

## Risk assessment

| Risk | Mitigation |
|------|-----------|
| Analysis becomes stale quickly | All P13 reads P12 stores live, no caching |
| Suggestions are too noisy | Confidence scoring + human-gated adoption |
| P12 store format changes | P13 imports P12 types directly, compile-time safety |
| Feature creep toward enforcement | Clear invariant documented in every spec and module header |
