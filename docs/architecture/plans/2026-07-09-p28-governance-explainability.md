# P28 — Governance Explainability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Transform P27 trace data into human-readable governance explanations — end-to-end evidence narratives that explain what happened, how it was reviewed, and what patterns exist, without crossing into recommendation, prediction, or prescription.

**Architecture:** Section-based explanation model (5 kinds) built by pure functions over DriftOutcomeTrace[]. CLI reads P27 data, calls builders, renders text/JSON. No new storage, no mutation, no inference.

**Tech Stack:** TypeScript, node:test, node:assert/strict, node:fs (CLI only), node:crypto (deterministic IDs)

## Global Constraints

- Explanations only — no recommendations, predictions, prescriptions, or policy guidance
- No autonomous execution, background jobs, or scheduled watchers
- No shell, network, MCP, browser, fetch, or subprocess calls
- No execution adapters, executor imports, or tool invocations
- No policy mutation or readiness threshold mutation
- No reviewer or operator ranking
- No ranking statements in peer comparisons ("performed better", "worst case", "should prioritize", "more successful")
- No auto-adoption of explanations as governance decisions
- No writing to P25/P26/P27 stores
- P24/P25/P26/P27 modules remain untouched
- All builder functions are pure (no I/O, no side effects)
- Deterministic explanation IDs (SHA-256)
- import type for type-only symbols
- Tests use `node:test` (describe/it) + `node:assert/strict`

---

## File Structure

### Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P28.1 | `src/governance/governance-explainability-types.ts` | Explanation types, section kinds |
| P28.2 | `src/governance/governance-explainability-builder.ts` | Pure explanation builders |
| P28.3 | `src/governance/governance-explainability-report.ts` | Text/JSON renderers |
| P28.3 | `src/cli/commands/governance-explain.ts` | CLI handler |
| P28.4 | `docs/architecture/checkpoints/2026-07-09-p28-4-governance-explainability.md` | Checkpoint |

### Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "explain"` dispatch |

### Untouched Files

- P24 modules (policy-drift-*.ts)
- P25 modules (policy-review-candidate-*.ts)
- P26 modules (policy-review-outcome-*.ts)
- P27 modules (learning-synthesis-*.ts)

### Pure Modules

```text
governance-explainability-types.ts      (types only)
governance-explainability-builder.ts    (pure builders, no I/O)
governance-explainability-report.ts     (pure renderers)
```

### Forbidden Imports in Pure Modules

```text
execute, recommend, mutate, write, policyUpdate
```

---

### Task 1: P28.1 — Explanation Model

**Files:**
- Create: `src/governance/governance-explainability-types.ts`
- Test: `tests/governance/governance-explainability-types.test.ts`

**Interfaces:**
- Produces: `ExplanationSectionKind`, `ExplanationSection`, `GovernanceExplanation` — consumed by Tasks 2, 3, 4

- [ ] **Step 1: Write failing type tests**

Create `tests/governance/governance-explainability-types.test.ts` with tests for:
1. Section kinds: exactly 5 supported kinds exist (signal_origin, candidate_lifecycle, outcome_summary, peer_comparison, learning_synthesis)
2. Boundary flags: readOnly, noPolicyMutation, noThresholdChange, noAutoAdoption, noRanking are all true
3. Empty explanation validity: `{ sections: [], traceIds: [] }` produces valid object

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/governance-explainability-types.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal types file**

Create `src/governance/governance-explainability-types.ts` with:
- `ExplanationSectionKind` union (5 literals)
- `ExplanationSection` interface (kind, heading, body, evidenceRefs, dataPoints?)
- `GovernanceExplanation` interface (explanationId, generatedAt, subject, sections, traceIds, boundary flags)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/governance-explainability-types.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/governance-explainability-types.ts tests/governance/governance-explainability-types.test.ts
git commit -m "feat(P28.1): governance explainability types — section model, boundary flags"
```

---

### Task 2: P28.2 — Explanation Builder

**Files:**
- Create: `src/governance/governance-explainability-builder.ts`
- Test: `tests/governance/governance-explainability-builder.test.ts`

**Interfaces:**
- Consumes: `DriftOutcomeTrace`, `DriftCorrelationAnalytics` from P27 (import type only), `GovernanceExplanation`, `ExplanationSection` from Task 1
- Produces: `buildTraceExplanation(trace, peerGroup?)`, `buildWindowExplanation(traces, analytics)` — consumed by Tasks 3, 4

**Helper functions:**

- `createExplanationId(traceIds)` — deterministic SHA-256 over trace IDs
- `buildSignalOriginSection(trace)` — describes what P24 signal triggered the candidate
- `buildLifecycleSection(trace)` — candidate state transitions
- `buildOutcomeSection(trace)` — human outcome + rationale
- `buildPeerComparisonSection(trace, peers)` — comparison without ranking
- `buildLearningSection(traces, analytics)` — broader pattern context

**Key rules:**
- Peer comparison must NEVER contain: "performed better", "worst case", "should prioritize", "more successful"
- Allowed: "3 accepted, 2 dismissed"
- Partial traces produce valid partial explanations with available fields only
- Deterministic output

- [ ] **Step 1: Write failing tests**

Create `tests/governance/governance-explainability-builder.test.ts` with 8 tests:
1. Full trace produces all expected sections
2. Partial trace (missing fields) produces valid partial explanation
3. Peer group included produces peer_comparison section
4. No peer group omits peer_comparison section
5. Window synthesis produces learning_synthesis section
6. No prescriptive language in any section body
7. Deterministic output (identical input → identical explanation)
8. No ranking statements in peer_comparison sections

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/governance-explainability-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the builder implementation**

Create `src/governance/governance-explainability-builder.ts`:

```
import type { DriftOutcomeTrace, DriftCorrelationAnalytics } from "./learning-synthesis-types.js";
import type { GovernanceExplanation, ExplanationSection, ExplanationSectionKind } from "./governance-explainability-types.js";
import { createHash } from "node:crypto";
```

Implement:
- `buildTraceExplanation(trace, peerGroup?)` — builds 3-5 sections depending on peer availability
- `buildWindowExplanation(traces, analytics)` — builds learning_synthesis section
- Internal helper per section type

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/governance-explainability-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/governance-explainability-builder.ts tests/governance/governance-explainability-builder.test.ts
git commit -m "feat(P28.2): governance explainability builder — pure explanation section generators"
```

---

### Task 3: P28.3 — Report + CLI

**Files:**
- Create: `src/governance/governance-explainability-report.ts`
- Create: `src/cli/commands/governance-explain.ts`
- Modify: `src/cli/commands/governance.ts` — add `case "explain"` dispatch
- Test: `tests/governance/governance-explainability-report.test.ts`
- Test: `tests/governance/governance-explain.test.ts`

**Interfaces:**
- Consumes: `GovernanceExplanation` from Task 1, builders from Task 2
- Produces: `renderExplanationText(explanation)`, `renderExplanationJson(explanation)`, CLI handler

**Report constants:**

```typescript
export const P28_FOOTER = `P28 explains governance decisions already made.
It does not recommend, predict, or prescribe actions.
No policy was changed. No thresholds were adjusted.
No reviewers were ranked. No outcomes were predicted.`;
```

**Text rendering order (must remain stable):**
```
P28-EXPLAIN-START
subject
signal_origin
candidate_lifecycle
outcome_summary
peer_comparison
learning_synthesis
footer
P28-EXPLAIN-END
```

**CLI commands:**
```
alix governance explain trace <candidateId> [--p24-bundle <path>] [--json]
alix governance explain window [--p24-bundle <path>] [--json]
```

CLI responsibilities: read input bundle → call builder → render output → print. Never modify stores, call execution, invoke agents, or write policies.

- [ ] **Step 1: Write failing tests**

Create tests for:
1. Text rendering includes all sections in correct order
2. Text rendering includes required footer
3. JSON output is parseable
4. CLI trace output includes explanation
5. CLI window output includes explanation
6. No write operations occur

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/governance-explainability-report.test.ts tests/governance/governance-explain.test.ts`
Expected: FAIL

- [ ] **Step 3: Write report and CLI implementations**

- [ ] **Step 4: Wire dispatch in governance.ts**

Add `case "explain"` with dynamic import:

```typescript
case "explain": {
  const { handleGovernanceExplainCommand } = await import("./governance-explain.js");
  return handleGovernanceExplainCommand(args.slice(1), { cwd });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test tests/governance/governance-explainability-report.test.ts tests/governance/governance-explain.test.ts`
Expected: PASS

- [ ] **Step 6: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 7: Commit**

```bash
git add src/governance/governance-explainability-report.ts src/cli/commands/governance-explain.ts src/cli/commands/governance.ts tests/governance/governance-explainability-report.test.ts tests/governance/governance-explain.test.ts
git commit -m "feat(P28.3): governance explainability report + CLI — render explanations without writes"
```

---

### Task 4: P28.4 — Checkpoint

**Files:**
- Create: `docs/architecture/checkpoints/2026-07-09-p28-4-governance-explainability.md`

- [ ] **Step 1: Run full P28 test suite**

Run: `npx tsx --test tests/governance/governance-explainability-types.test.ts tests/governance/governance-explainability-builder.test.ts tests/governance/governance-explainability-report.test.ts tests/governance/governance-explain.test.ts 2>&1`
Expected: All 17 tests pass

- [ ] **Step 2: Static checks — verify no prohibited terms in explanation modules**

```bash
grep -c "recommend" src/governance/governance-explainability-* 2>/dev/null
grep -c "predict" src/governance/governance-explainability-* 2>/dev/null
grep -c "execute" src/governance/governance-explainability-* 2>/dev/null
```
Expected: 0 violations

- [ ] **Step 3: Final tsc check**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 4: Create checkpoint doc**

Include verification checklist: explanations only, no recommendations, no predictions, no prescriptions, no policy mutation, no threshold mutation, no reviewer ranking.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/checkpoints/2026-07-09-p28-4-governance-explainability.md
git commit -m "docs(P28.4): governance explainability checkpoint"
```

- [ ] **Step 6: Create seal tag**

```bash
git tag alix-p28-governance-explainability-complete
```

---

## Summary

| Slice | Files Created | Tests | Commit |
|-------|--------------|-------|--------|
| P28.1 | 2 | 3 | `feat(P28.1): governance explainability types — section model, boundary flags` |
| P28.2 | 2 | 8 | `feat(P28.2): governance explainability builder — pure explanation section generators` |
| P28.3 | 3+1 touch | 6 | `feat(P28.3): governance explainability report + CLI — render explanations without writes` |
| P28.4 | 1 | — | `docs(P28.4): governance explainability checkpoint` |
| **Total** | **9 files** | **17 tests** | **4 commits** |
