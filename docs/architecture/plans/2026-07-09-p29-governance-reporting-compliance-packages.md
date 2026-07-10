# P29 — Governance Reporting & Compliance Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Create exportable compliance evidence packages that assemble P14–P28 governance data into a single audit artifact — without recommending, predicting, prescribing, or mutating governance state.

**Architecture:** Pure builder composes P24–P28 data (signals, candidates, outcomes, traces, analytics, explanations) into a structured CompliancePackage. CLI exposes `alix governance report compliance` with optional `--output` for explicit file export. No new persistence. No store writes.

**Tech Stack:** TypeScript, node:test, node:assert/strict, node:fs (CLI only), node:crypto (deterministic IDs)

## Global Constraints

- Read-only reporting — no recommendations, predictions, prescriptions, or policy guidance
- No autonomous execution, background jobs, or scheduled watchers
- No shell, network, MCP, browser, fetch, or subprocess calls
- No execution adapters, executor imports, or tool invocations
- No policy mutation or readiness threshold mutation
- No reviewer or operator ranking
- No `reviewerScore`, `reviewerQuality`, `reviewerRanking` fields
- No auto-adoption of evidence packages as governance decisions
- `--output` writes to user-specified file path only — never to `.alix/` governance stores
- P14–P28 modules remain untouched
- All builder functions are pure (no I/O, no side effects)
- Deterministic package ID (SHA-256 over window + trace count)
- import type for type-only symbols
- Tests use `node:test` (describe/it) + `node:assert/strict`

---

## File Structure

### Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P29.1 | `src/governance/governance-reporting-types.ts` | CompliancePackage types |
| P29.2 | `src/governance/governance-reporting-builder.ts` | Pure builder |
| P29.3 | `src/governance/governance-reporting-export.ts` | JSON/text output |
| P29.3 | `src/cli/commands/governance-report.ts` | CLI handler |
| P29.4 | `docs/architecture/checkpoints/2026-07-09-p29-4-governance-reporting-compliance-packages.md` | Checkpoint |

### Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "report"` dispatch |

### Untouched Files

- P24 modules (policy-drift-*.ts)
- P25 modules (policy-review-candidate-*.ts)
- P26 modules (policy-review-outcome-*.ts)
- P27 modules (learning-synthesis-*.ts)
- P28 modules (governance-explainability-*.ts)

### Forbidden Imports in Pure Modules

```text
fs, child_process, executor, policyWriter, scheduler
```

---

### Task 1: P29.1 — Compliance Package Types

**Files:**
- Create: `src/governance/governance-reporting-types.ts`
- Test: `tests/governance/governance-reporting-types.test.ts`

**Interfaces:**
- Produces: `CompliancePackage`, `ComplianceSignalSummary`, `ComplianceCandidateSummary`, `ComplianceOutcomeSummary`, `ComplianceTraceSummary` — consumed by Tasks 2, 3, 4

- [ ] Step 1: Write failing types tests (3 tests)
  1. CompliancePackage shape — verify inventory fields, summaries, analytics, explanations, metadata
  2. Summary types — verify all 4 summary types have required fields
  3. Boundary flags — readOnly, noPolicyMutation, noThresholdChange, noAutoAdoption, noRanking are all true

Run: `npx tsx --test tests/governance/governance-reporting-types.test.ts`
Expected: FAIL

- [ ] Step 2: Write the types implementation

```typescript
export interface CompliancePackage {
  packageId: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  totalSignals: number;
  totalCandidates: number;
  totalOutcomes: number;
  totalTraces: number;
  signalSummary: ComplianceSignalSummary[];
  candidateSummary: ComplianceCandidateSummary[];
  outcomeSummary: ComplianceOutcomeSummary[];
  traceSummary: ComplianceTraceSummary[];
  correlationAnalytics: DriftCorrelationAnalytics;
  keyExplanations: GovernanceExplanation[];
  phasesIncluded: string[];
  readonly readOnly: true;
  readonly noPolicyMutation: true;
  readonly noThresholdChange: true;
  readonly noAutoAdoption: true;
  readonly noRanking: true;
}

export interface ComplianceSignalSummary {
  signalId: string;
  kind: string;
  severity: string;
  direction: string;
  windowStart: string;
  windowEnd: string;
}

export interface ComplianceCandidateSummary {
  candidateId: string;
  title: string;
  status: string;
  signalKind: string;
  signalSeverity: string;
  createdAt: string;
  hasOutcome: boolean;
}

export interface ComplianceOutcomeSummary {
  outcomeId: string;
  candidateId: string;
  outcomeType: string;
  recordedBy: string;
  rationale: string;
}

export interface ComplianceTraceSummary {
  outcomeId: string;
  candidateId: string;
  signalKind: string;
  outcomeType: string;
  timeToOutcomeDays: number;
}
```

- [ ] Step 3: Run test to verify it passes

Run: `npx tsx --test tests/governance/governance-reporting-types.test.ts`
Expected: PASS

- [ ] Step 4: Commit

```bash
git add src/governance/governance-reporting-types.ts tests/governance/governance-reporting-types.test.ts
git commit -m "feat(P29.1): compliance package types — CompliancePackage, summary types, boundary flags"
```

---

### Task 2: P29.2 — Compliance Package Builder

**Files:**
- Create: `src/governance/governance-reporting-builder.ts`
- Test: `tests/governance/governance-reporting-builder.test.ts`

**Interfaces:**
- Consumes: P24 PolicyDriftSignal, P25 PolicyReviewCandidate, P26 PolicyReviewOutcome, P27 DriftOutcomeTrace/DriftCorrelationAnalytics, P28 GovernanceExplanation (all import type only)
- Produces: `buildCompliancePackage(opts)` → `CompliancePackage` — consumed by Tasks 3, 4

**Internal helpers:**

```typescript
function buildSignalSummaries(signals): ComplianceSignalSummary[]
function buildCandidateSummaries(candidates): ComplianceCandidateSummary[]
function buildOutcomeSummaries(outcomes): ComplianceOutcomeSummary[]
function buildTraceSummaries(traces): ComplianceTraceSummary[]
function deriveIncludedPhases(input): string[]
function createPackageId(windowStart, windowEnd, traceCount): string
```

**Key rules:**
- Phase detection: signals present → "P24", candidates present → "P25", outcomes present → "P26", traces present → "P27", explanations present → "P28"
- Phase detection describes available evidence, never implies validation or approval
- packageId: SHA-256 over `windowStart + "|" + windowEnd + "|" + String(traceCount)` — no external clock, randomness, or environment access
- **Sort all summaries deterministically** before returning: signalSummary by signalId, candidateSummary by candidateId, outcomeSummary by outcomeId, traceSummary by outcomeId
- Pure function — no I/O, no side effects
- Missing data produces partial package with available fields
- No mutation of input data
- Same evidence → same package (replay stability)

- [ ] Step 1: Write failing tests (10 tests)
  1. Complete package — all sections populated
  2. Missing signals — partial evidence handling
  3. Missing outcomes — partial lifecycle
  4. Missing explanations — no failure
  5. Deterministic ID — replay stability
  6. Counts match — inventory accuracy
  7. Input immutability — no mutation
  8. Phase derivation — correct evidence discovery
  9. Package replay stability — same inputs produce deepEqual packages
  10. No governance directive language — assertNoGovernanceDirective on all section bodies (scans for should, must, recommend, suggest, prioritize, best, likely, expected, improve, optimize)

Run: `npx tsx --test tests/governance/governance-reporting-builder.test.ts`
Expected: FAIL

- [ ] Step 2: Write the builder implementation

```typescript
import type { PolicyDriftSignal } from "./policy-drift-types.js";
import type { PolicyReviewCandidate } from "./policy-review-candidate-types.js";
import type { PolicyReviewOutcome } from "./policy-review-outcome-types.js";
import type { DriftOutcomeTrace, DriftCorrelationAnalytics } from "./learning-synthesis-types.js";
import type { GovernanceExplanation } from "./governance-explainability-types.js";
import type { CompliancePackage, ComplianceSignalSummary, ComplianceCandidateSummary, ComplianceOutcomeSummary, ComplianceTraceSummary } from "./governance-reporting-types.js";
import { createHash } from "node:crypto";
```

Implement `buildCompliancePackage()`, all 5 internal helpers, `deriveIncludedPhases`, and `createPackageId`.

- [ ] Step 3: Run test to verify it passes

Run: `npx tsx --test tests/governance/governance-reporting-builder.test.ts`
Expected: PASS

- [ ] Step 4: Commit

```bash
git add src/governance/governance-reporting-builder.ts tests/governance/governance-reporting-builder.test.ts
git commit -m "feat(P29.2): compliance package builder — deterministic evidence composition"
```

---

### Task 3: P29.3 — Export + CLI

**Files:**
- Create: `src/governance/governance-reporting-export.ts`
- Create: `src/cli/commands/governance-report.ts`
- Modify: `src/cli/commands/governance.ts` — add `case "report"` dispatch
- Test: `tests/governance/governance-reporting-export.test.ts`
- Test: `tests/governance/governance-report.test.ts`

**Interfaces:**
- Consumes: `CompliancePackage` from Task 1
- Produces: `renderComplianceJson(package)`, `renderComplianceText(package)`, CLI handler

**Export functions:**

```typescript
function renderComplianceJson(pkg: CompliancePackage): string
function renderComplianceText(pkg: CompliancePackage): string
```

**CLI command:**

```bash
alix governance report compliance --p24-bundle <path> [--json] [--output <path>]
```

**Key rules:**
- renderComplianceJson uses `JSON.stringify(pkg, null, 2)` with trailing newline
- --output writes to user-specified path only (not to .alix/ stores)
- CLI never writes governance state, updates stores, triggers reviews, or modifies policies
- `--output` behavior is acceptable because: user-initiated, explicit path, artifact export only, outside governance persistence

- [ ] Step 1: Write failing tests (4 tests)
  1. CLI execution succeeds
  2. --json mode returns parseable JSON
  3. --output writes file to requested path
  4. Store isolation — no governance store writes

Run: `npx tsx --test tests/governance/governance-reporting-export.test.ts tests/governance/governance-report.test.ts`
Expected: FAIL

- [ ] Step 2: Write export + CLI implementations

- [ ] Step 3: Wire dispatch in governance.ts

Add `case "report"` with dynamic import:

```typescript
case "report": {
  const { handleGovernanceReportCommand } = await import("./governance-report.js");
  return handleGovernanceReportCommand(args.slice(1), { cwd });
}
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx tsx --test tests/governance/governance-reporting-export.test.ts tests/governance/governance-report.test.ts`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add src/governance/governance-reporting-export.ts src/cli/commands/governance-report.ts src/cli/commands/governance.ts tests/governance/governance-reporting-export.test.ts tests/governance/governance-report.test.ts
git commit -m "feat(P29.3): compliance export + CLI — renderComplianceJson/Text, --output export"
```

---

### Task 4: P29.4 — Checkpoint + Static Checks + Tag

**Files:**
- Create: `docs/architecture/checkpoints/2026-07-09-p29-4-governance-reporting-compliance-packages.md`

- [ ] Step 1: Run full P29 test suite

Run: `npx tsx --test tests/governance/governance-reporting-types.test.ts tests/governance/governance-reporting-builder.test.ts tests/governance/governance-reporting-export.test.ts tests/governance/governance-report.test.ts 2>&1`
Expected: All 17 tests pass

- [ ] Step 2: Static checks

```bash
grep -c "recommend\|predict\|execute\|policyWriter\|reviewerScore\|reviewerQuality\|reviewerRanking" src/governance/governance-reporting-*
grep -c "should\|must\|suggest\|prioritize\|optimize" src/governance/governance-reporting-builder.ts src/governance/governance-reporting-export.ts 2>/dev/null
```
Expected: 0 violations

- [ ] Step 3: Final tsc check

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] Step 4: Create checkpoint doc with verification checklists

- [ ] Step 5: Commit + tag

```bash
git add docs/architecture/checkpoints/2026-07-09-p29-4-governance-reporting-compliance-packages.md
git commit -m "docs(P29.4): governance reporting compliance packages checkpoint"
git tag alix-p29-governance-reporting-compliance-packages-complete
```

---

## Summary

| Slice | Files Created | Tests | Commit |
|-------|--------------|-------|--------|
| P29.1 | 2 | 3 | `feat(P29.1): compliance package types — CompliancePackage, summary types, boundary flags` |
| P29.2 | 2 | 8 | `feat(P29.2): compliance package builder — deterministic evidence composition` |
| P29.3 | 3+1 touch | 4 | `feat(P29.3): compliance export + CLI — renderComplianceJson/Text, --output export` |
| P29.4 | 1 | — | `docs(P29.4): governance reporting compliance packages checkpoint` |
| **Total** | **10 files** | **17 tests** | **4 commits** |
