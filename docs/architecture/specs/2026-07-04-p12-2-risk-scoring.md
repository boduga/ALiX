# P12.2 — Risk Scoring Design Spec

**Date:** 2026-07-04
**Status:** Design — implementation deferred to plan.

## Purpose

Classify an autonomous run by risk level — answering **"How risky is this?"** — without making approval decisions itself.

P12's four questions:

```
Can ALiX act?          → Policy Engine (P12.1)
How risky is this?     → Risk Scoring (P12.2)  ← YOU ARE HERE
Does it need approval? → Approval Workflow (P12.3)
What proves it ran?    → Run Ledger (P12.4)
```

## Key Invariant

**Score, don't gate.** P12.2 is a "risk thermometer", not a decision maker:

- P12.1 decides: `allow | deny | requires_approval`
- P12.2 decides: `low | medium | high | critical`
- P12.3 decides: approval gate state
- P12.4 records the evidence

No approval workflow coupling (that's P12.3). No persistence (that's P12.4).

## Types

```typescript
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskFactor {
  name: string;
  score: number;        // 0–100 numeric contribution
  level: RiskLevel;     // derived from score range
  description: string;  // explainable — e.g. "5 source files changed"
}

export interface RiskScore {
  level: RiskLevel;
  score: number;         // 0–100 overall
  factors: RiskFactor[];
}

export interface ScoringInput {
  files: string[];
  actionType: "read" | "edit" | "create" | "delete" | "destructive" | "release" | "proposal";
  verificationStatus: "passed" | "typecheck" | "none" | "failed";
  labels: string[];
}
```

## Scoring Factors

Each factor produces a `RiskFactor` with score 0–100 and a `RiskLevel` label.

### 1. File Scope

| Match | Level | Score |
|-------|-------|-------|
| Only docs/** or tests/** | low | 10 |
| Source files (src/**) | medium | 40 |
| Security/auth paths (src/security/**, src/auth/**) | high | 70 |
| Secrets/infra/deploy paths | critical | 90 |

### 2. File Count

| Count | Level | Score |
|-------|-------|-------|
| 1–3 | low | 10 |
| 4–6 | medium | 35 |
| 7–10 | high | 65 |
| 10+ | critical | 85 |

### 3. Action Type

| Action | Level | Score |
|--------|-------|-------|
| read, proposal | low | 5 |
| edit | medium | 40 |
| create, delete | high | 65 |
| destructive, release | critical | 90 |

### 4. Verification

| Status | Level | Score |
|--------|-------|-------|
| build + tests pass | low | 5 |
| typecheck only | medium | 35 |
| no verification | high | 65 |
| failed | critical | 90 |

### 5. Labels

| Label | Level | Score |
|-------|-------|-------|
| docs, test | low | 10 |
| bug, chore | medium | 35 |
| feature, enhancement | high | 65 |
| security, infra | critical | 85 |

## Overall Score Formula

Do **not** average away danger. One critical factor dominates.

```typescript
const overallScore = max(factorScores); // base
// optional: + small additive pressure for non-critical factors
```

Thresholds:
- 0–25 → `low`
- 26–50 → `medium`
- 51–75 → `high`
- 76–100 → `critical`

## Scoring Input — Defaults

Fields that represent "no data" or can't be determined produce `low` risk:

- Empty file list → file count factor: 0 files → low (score 0)
- Unknown action type → action type factor: low (score 5)
- No labels → label factor: low (score 0)
- Unrecognised label → label factor: low (score 5)

## Determinism

Given identical `ScoringInput`, `computeRiskScore()` MUST return identical output every time. No randomness, no external state.

## CLI

```
alix governance risk-score --files <paths...> [--action <type>] [--verification <status>] [--labels <labels...>]
alix governance risk-score --json (machine-readable output)
```

## Edge Cases

| Case | Behaviour |
|------|-----------|
| Empty file list | Low risk score (no files = minimal blast radius) |
| Unknown action type | Low risk (conservative guess) |
| No labels | Low risk factor |
| All factors low | Overall low |
| One critical, rest low | Critical (max dominates) |
| Multiple medium | Medium (max dominates, additive pressure may push to high) |

## Files

- `src/governance/risk-scoring.ts` — Types, factor scoring, `computeRiskScore()`
- `tests/governance/risk-scoring.test.ts` — Unit tests (node:test + assert/strict)
- `src/cli/commands/governance.ts` — Add `risk-score` subcommand

## Merge Criteria

```bash
pnpm build && pnpm typecheck && node --test dist/tests/governance/risk-scoring.test.js && pnpm test:vitest
```

Required tests:
- docs-only → low risk
- source change → medium risk
- security/auth paths → high risk
- secrets/infra paths → critical risk
- file count escalation (1, 5, 9, 11 files)
- verification escalation (pass → typecheck → none → failed)
- security label → critical risk
- deterministic output (same input → same output)
- no approval workflow coupling (no imports from approval modules)
