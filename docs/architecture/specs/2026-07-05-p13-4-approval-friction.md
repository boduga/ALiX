# P13.4 — Governance Approval Friction Analysis Design Spec

**Date:** 2026-07-05
**Status:** Design — implementation deferred.

## Purpose

P13.4 analyses where approval gates cause the most friction by reading the P12.4 run ledger and aggregating approval outcomes per gate. It identifies which gates are bottlenecks — e.g., `proposal` with 80% deny rate suggests proposals need better spec, while `verification` with 60% pending suggests verification is slow.

## Core invariant

**Analyse friction, don't change approval configuration.**

P13.4 reads the run ledger and computes friction metrics. It never:
- Modifies approval gate configurations
- Changes risk scoring thresholds
- Modifies policy rules
- Writes to the run ledger or failure memory
- Blocks or delays any run

## Architecture

```
Run Ledger ──→ P13.4 Approval Friction ──→ P13.5 Governance Report CLI
(file JSONL)    (gate-level aggregation)        (terminal + JSON)
```

Pure transformation: `LedgerEntry[] → FrictionReport`. The CLI reads the store, passes entries to the pure function, renders output.

## Data source

The `ApprovalGate` type (P12.3) provides:
- `gate`: `"proposal" | "file_scope" | "verification" | "pr" | "merge"`
- `status`: `"pending" | "approved" | "denied"`
- `approvedAt?`: ISO timestamp when gate was approved (if applicable)

There is NO `requestedAt` or `createdAt` timestamp per gate. This means `averageTimeToApprove` cannot be computed from available data and MUST be `null`.

## Types

```typescript
interface ApprovalFriction {
  gate: ApprovalGateName;
  totalOccurrences: number;
  deniedCount: number;
  pendingCount: number;
  approvedCount: number;
  averageTimeToApprove: null;        // always null — no request timestamps
  frictionScore: number;              // 0.0–1.0
}

interface FrictionReport {
  gates: ApprovalFriction[];          // sorted by frictionScore desc, then gate name asc
  highestFrictionGate: ApprovalGateName | null;
  totalApprovalsRequested: number;    // total gate occurrences across all entries
  overallFrictionScore: number;     // occurrence-weighted denyRate*0.6 + pendingRate*0.4 across all gates, 0 when no approvals
}
```

## Friction score formula

Simple weighted combination of deny rate and pending rate:

```typescript
function computeFrictionScore(gate: ApprovalFriction): number {
  const denyRate = gate.totalOccurrences > 0 ? gate.deniedCount / gate.totalOccurrences : 0;
  const pendingRate = gate.totalOccurrences > 0 ? gate.pendingCount / gate.totalOccurrences : 0;
  return round2(clamp(denyRate * 0.6 + pendingRate * 0.4, 0, 1));
}
```

- Denies contribute more weight (0.6) than pendings (0.4) — a denied gate is a stronger friction signal than a pending one
- All ratios division-guarded (zero total → rate 0)
- Result clamped to [0, 1], rounded to 2 decimals

## Determinism

For identical inputs, output is identical. Gates sorted by `frictionScore` descending, then `gate` name alphabetically for tie-breaks. `highestFrictionGate` = first gate in sorted list (null when no gates). `overallFrictionScore` = occurrence-weighted score (denyRate*0.6 + pendingRate*0.4 across ALL approvals, not plain mean of gate scores). 0 when no approvals.

## CLI

```bash
alix governance friction-analysis [--window N] [--json]
```

Reads `FileLedgerStore`, applies window filter, calls `computeApprovalFriction`, renders terminal output or JSON.

**Terminal output:**
```
Governance Approval Friction Analysis
═══════════════════════════════════════════════════════════════
Window:                    90 days
Total Approvals Requested: 24
Overall Friction Score:    0.45
Highest Friction Gate:     proposal

By Gate:
  0.62  proposal       (12 occurrences: 6 denied, 2 pending, 4 approved)
  0.35  verification   (8 occurrences: 2 denied, 2 pending, 4 approved)
  0.18  pr             (4 occurrences: 0 denied, 2 pending, 2 approved)

Average time to approve: not available (no request timestamps)
```

**JSON output:**
```json
{
  "frictionReport": {
    "gates": [...],
    "highestFrictionGate": "proposal",
    "totalApprovalsRequested": 24,
    "overallFrictionScore": 0.45
  }
}
```

## Verification

```bash
pnpm build
node --test dist/tests/governance/approval-friction.test.js
pnpm test:vitest
node bin/alix.js governance friction-analysis --json
node bin/alix.js governance friction-analysis
```

## Non-goals

- **No approval gate configuration modification**
- **No policy mutation**
- **No timing analysis** — timestamps insufficient for `averageTimeToApprove`
- **No P13.5 unified report** — shipped separately
- **No suggestion generation** — pure measurement, no "loosen this gate" recommendations (that's P13.3 territory)

## Files

```
src/governance/approval-friction.ts           # Create
tests/governance/approval-friction.test.ts    # Create
src/cli/commands/governance.ts                 # Amend (add friction-analysis subcommand)
```
