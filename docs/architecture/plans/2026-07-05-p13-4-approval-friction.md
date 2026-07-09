# P13.4 — Approval Friction Analysis Implementation Plan

> **For agentic workers:** Use subagent-driven-development. Steps use checkbox syntax.

**Goal:** Add read-only approval friction analysis — `computeFrictionReport(entries) → FrictionReport`, exposed via `alix governance friction-analysis`.

**Architecture:** Pure analysis in `approval-friction.ts` consuming `LedgerEntry[]`, grouping approvals by gate, computing friction scores. CLI reads `FileLedgerStore` and renders. No writes, no approval gate changes.

**Tech Stack:** Node.js TypeScript, `node:test`, ANSI output.

## Global Constraints

- P13 never mutates P12 stores
- `averageTimeToApprove` is always null (no request timestamps available)
- All ratios division-guarded
- Scores clamped to [0,1] and rounded to 2 decimals
- Sort by frictionScore desc, gate name asc for tie-breaks

---

### Task 1: Implement approval-friction.ts

**Files:** Create `src/governance/approval-friction.ts`

**Types:**
```typescript
import type { ApprovalGateName } from "./approval-workflow.js";

export interface ApprovalFriction {
  gate: ApprovalGateName;
  totalOccurrences: number;
  deniedCount: number;
  pendingCount: number;
  approvedCount: number;
  averageTimeToApprove: null;
  frictionScore: number;
}

export interface FrictionReport {
  gates: ApprovalFriction[];
  highestFrictionGate: ApprovalGateName | null;
  totalApprovalsRequested: number;
  overallFrictionScore: number;
}
```

**Exported functions:**
- `computeFrictionReport(entries: LedgerEntry[]): FrictionReport` — main entry
- `computeFrictionScore(gate: ApprovalFriction): number` — `denyRate*0.6 + pendingRate*0.4`

**Logic:**
1. Collect all approvals across all entries
2. Group by `gate` name
3. For each gate: count total, denied, pending, approved; compute frictionScore
4. Sort gates by score desc, name asc
5. highestFrictionGate = gates[0]?.gate ?? null
6. overallFrictionScore = occurrence-weighted score: `(totalDenied/totalApprovals*0.6 + totalPending/totalApprovals*0.4)`, clamped, rounded. 0 when no approvals.

**Test cases:**
- empty ledger → zero-safe report
- entries with no approvals → zero-safe report
- groups approvals by gate correctly
- counts approved/denied/pending correctly
- frictionScore deterministic and division-safe
- highestFrictionGate picks highest score
- tie-breaks deterministically by gate name
- averageTimeToApprove is always null
- overallFrictionScore is occurrence-weighted (not plain mean)
- overallFrictionScore = 0 when totalApprovalsRequested = 0
- deterministic for identical input
- JSON output shape: `{ frictionReport: FrictionReport }`
- human output includes advisory/no approval gates modified banner

---

### Task 2: Write tests (approval-friction.test.ts) — ~12 cases

### Task 3: Add CLI subcommand (friction-analysis)

### Task 4: Final verification, PR #226
