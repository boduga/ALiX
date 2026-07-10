# P30 — Evidence Navigation & Lineage Browsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Provide per-candidate full lineage browsing across all 16 governance phases (P14–P29) — the final phase of the P-series observational governance layer.

**Architecture:** LineageIndex built on-demand from P24–P29 data. LineageRecord assembles cross-phase references with null-safe missing-phase handling. CLI exposes `alix governance lineage {show|list}`. No new storage, no mutation, no recommendations.

**Tech Stack:** TypeScript, node:test, node:assert/strict, node:crypto (deterministic IDs)

## Global Constraints

- Navigation and visualization only — no recommendations, predictions, prescriptions, or policy guidance
- No autonomous execution, background jobs, or scheduled watchers
- No shell, network, MCP, browser, fetch, or subprocess calls
- No execution adapters, executor imports, or tool invocations
- No policy mutation or readiness threshold mutation
- No reviewer or operator ranking
- No new persistence — LineageIndex built on-demand from caller-provided data
- No mutation of input objects (immutability guard)
- P14–P29 modules remain untouched
- lineageId: SHA-256 of `"alix:p30:lineage:" + candidateId`
- phasePresence: per-phase boolean (p24–p29)
- All builder functions are pure (no I/O, no side effects)
- import type for type-only symbols

---

## File Structure

### Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P30.1 | `src/governance/governance-lineage-types.ts` | LineageRecord, phase refs, LineageIndex |
| P30.2 | `src/governance/governance-lineage-builder.ts` | buildLineageIndex, buildLineageRecord |
| P30.3 | `src/cli/commands/governance-lineage.ts` | CLI handler |
| P30.4 | `docs/architecture/checkpoints/2026-07-10-p30-4-evidence-navigation-lineage-browsing.md` | Checkpoint |

### Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "lineage"` dispatch |

### Untouched Files

- All P14–P29 modules

---

### Task 1: P30.1 — Lineage Types

**Files:**
- Create: `src/governance/governance-lineage-types.ts`
- Test: `tests/governance/governance-lineage-types.test.ts`

**Types to define:**
- `SignalRef`, `CandidateRef`, `OutcomeRef`, `TraceRef`, `ExplanationRef`, `ComplianceRef`
- `LineageRecord` with `phasePresence: { p24–p29: boolean }` and 5 boundary flags
- `LineageIndex` with `byCandidateId`, `bySignalKind`, `byOutcomeType`, `byCompliancePackageId`

**Tests (3):**
1. LineageRecord has all 6 phase refs with correct shapes
2. phasePresence has all 6 boolean fields (p24–p29)
3. Boundary flags present (readOnly, noPolicyMutation, noThresholdChange, noAutoAdoption, noRanking)

Commit: `feat(P30.1): lineage types — LineageRecord, phase refs, LineageIndex, boundary flags`

---

### Task 2: P30.2 — Lineage Builder

**Files:**
- Create: `src/governance/governance-lineage-builder.ts`
- Test: `tests/governance/governance-lineage-builder.test.ts`

**Functions:**

```typescript
function buildLineageIndex(opts: {
  signals: PolicyDriftSignal[];
  candidates: PolicyReviewCandidate[];
  outcomes: PolicyReviewOutcome[];
  traces: DriftOutcomeTrace[];
  explanations: GovernanceExplanation[];
  compliancePackages?: CompliancePackage[];
}): LineageIndex;

function buildLineageRecord(candidateId: string, index: LineageIndex): LineageRecord | null;
```

**Key rules:**
- lineageId: SHA-256 of `"alix:p30:lineage:" + candidateId`
- phasePresence derived from whether each phase ref is non-null
- relatedCandidates: candidates sharing same signalKind (from LineageIndex bySignalKind minus self)
- Missing phase data produces null refs — never throws
- buildLineageRecord returns null for unknown candidateId
- Immutability guard: builder never mutates input objects (uses `.map()` to create new arrays, spreads to copy objects)
- Deterministic sort: records sorted by candidateId

**Tests (7):**
1. Full lineage for candidate with all phases populated
2. Partial lineage for candidate with missing phases (null refs)
3. LineageIndex built correctly from input data
4. LineageRecord returns null for unknown candidateId
5. relatedCandidates derived from signalKind peers
6. Deterministic lineageId
7. Immutability guard — original P24-P29 objects unchanged after buildLineageIndex()

Commit: `feat(P30.2): lineage builder — buildLineageIndex, buildLineageRecord, immutability guard`

---

### Task 3: P30.3 — CLI + Dispatch

**Files:**
- Create: `src/cli/commands/governance-lineage.ts`
- Modify: `src/cli/commands/governance.ts` — add `case "lineage"` dispatch
- Test: `tests/governance/governance-lineage.test.ts`

**CLI commands:**
```bash
alix governance lineage show <candidateId> [--p24-bundle <path>] [--json]
alix governance lineage list [--kind <signalKind>] [--outcome <outcomeType>] [--json]
```

- CLI reads P24 bundle + existing stores, calls builder, renders output
- No writes to any governance store
- Async dispatch (like P25/P26 patterns)

**Tests (4):**
1. show outputs lineage for existing candidate
2. show handles unknown candidate gracefully (null-format output, not crash)
3. list outputs index filtered by kind or outcome
4. --json returns parseable JSON

Commit: `feat(P30.3): lineage CLI — alix governance lineage {show|list}, no write path`

---

### Task 4: P30.4 — Checkpoint + P30.5 Boundary Audit

**Files:**
- Create: `docs/architecture/checkpoints/2026-07-10-p30-4-evidence-navigation-lineage-browsing.md`

**Checklist:**
- All 15 tests pass (3+7+4+1 immutability)
- Static checks: no recommend/predict/execute/policyWriter violations
- P14–P29 modules unchanged
- No new persistence layer introduced
- tsc clean
- Tag: `alix-p30-evidence-navigation-lineage-browsing-complete`

Commit: `docs(P30.4): evidence navigation lineage browsing checkpoint`

---

## Summary

| Slice | Files Created | Tests | Commit |
|-------|--------------|-------|--------|
| P30.1 | 2 | 3 | `feat(P30.1): lineage types — LineageRecord, phase refs, LineageIndex` |
| P30.2 | 2 | 7 | `feat(P30.2): lineage builder — buildLineageIndex, buildLineageRecord, immutability guard` |
| P30.3 | 2+1 touch | 4 | `feat(P30.3): lineage CLI — alix governance lineage {show|list}` |
| P30.4 | 1 | 1 | `docs(P30.4): evidence navigation lineage browsing checkpoint` |
| **Total** | **8 files** | **15 tests** | **4 commits** |
