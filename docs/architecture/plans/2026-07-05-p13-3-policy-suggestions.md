# P13.3 — Policy Refinement Suggestions Implementation Plan

> **For agentic workers:** Use subagent-driven-development. Steps use checkbox syntax.

**Goal:** Add read-only policy refinement suggestions — `computePolicySuggestions(ledger, failures) → PolicySuggestion[]`, exposed via `alix governance policy-suggestions`.

**Architecture:** Pure analysis in `policy-suggestions.ts` consuming `LedgerEntry[]` + `FailureRecord[]`, producing deterministic, evidence-backed suggestions. CLI reads both stores and renders. No writes, no policy mutation.

**Source of truth:** `docs/architecture/specs/2026-07-05-p13-3-policy-suggestions.md`

**Tech Stack:** Node.js TypeScript, `node:test`, ANSI output.

## Global Constraints

- P13 never mutates P12 stores — no writes to run ledger, failure memory, policy files, risk thresholds, or approval gates
- **Every suggestion must include evidence counts and a confidence score** — emit nothing without evidence
- Minimum sample size `MIN_SAMPLE_SIZE = 3`; minimum confidence `MIN_CONFIDENCE = 0.5`
- All confidence scores deterministic, clamped, rounded to 2 decimals
- **All ratio calculations are division-guarded** — denominator 0 yields ratio 0, never `NaN`/`Infinity`
- **No policyId may receive both `tighten` and `loosen`/`remove_rule` in one output** (conflict resolution applied)
- Build-first test execution: `pnpm build && node --test dist/tests/governance/policy-suggestions.test.js`

---

### Task 1: Implement policy-suggestions.ts

**Files:**
- Create: `src/governance/policy-suggestions.ts`

**Interfaces:**
- Consumes: `LedgerEntry`, `LedgerOutcome` from `./run-ledger.js`; `FailureType`, `FailureRecord` from `./failure-memory.js`
- Produces: `computePolicySuggestions(ledger: LedgerEntry[], failures: FailureRecord[]): PolicySuggestion[]`

**Exported types:**
```typescript
export type PolicySuggestionType = "tighten" | "loosen" | "add_rule" | "remove_rule";

export interface PolicySuggestionEvidence {
  matchedCount: number;         // ledger entries whose policyResult.matchedPolicies includes policyId
  deniedCount: number;          // ledger entries with outcome "denied" attributable to this policy
  bypassedCount: number;        // failure records tagged with policyId whose runId later has outcome "completed" (runId join; 0 if no runId link)
  relatedFailureCount: number;  // total failure records tagged with policyId (regardless of run outcome)
}

export interface PolicySuggestion {
  type: PolicySuggestionType;
  policyId?: string;
  reason: string;
  evidence: PolicySuggestionEvidence;
  confidence: number;
  recommendation: string;
  sourceHeuristic: "H1" | "H2" | "H3" | "H4" | "H5";
}
```

**Exported constants:**
```typescript
export const MIN_SAMPLE_SIZE = 3;
export const MIN_CONFIDENCE = 0.5;
```

**Exported pure helpers:**
- `computePolicySuggestions(ledger, failures): PolicySuggestion[]` — runs all heuristics, applies conflict resolution, sorts
- `computeEvidenceForPolicy(policyId, ledger, failures): PolicySuggestionEvidence` — deterministic evidence counter using `matchedPolicies`/`policyIds` join for counts and `runId` join for `bypassedCount`
- `clamp(value, min, max): number`
- `round2(value): number`
- `safeRatio(numerator, denominator): number` — returns 0 when denominator is 0

**Heuristics (one private function each, gated on thresholds, all ratios division-guarded):**
- `suggestLoosenOrRemove(evidence, policyId): PolicySuggestion | null` (H1) — `denyRate = safeRatio(denied, matched)`; trigger `denyRate >= 0.6 && safeRatio(bypassed, denied) < 0.2`; `remove_rule` when `denied===matched && bypassed===0`; cap 0.9
- `suggestTighten(evidence, policyId, failures): PolicySuggestion | null` (H2) — matched policy runs still produce `test_failure`/`verification_timeout` on overlapping file paths; cap 0.85
- `suggestAddRuleUngoverned(failures): PolicySuggestion[]` (H3) — recurring failures with empty/absent `policyIds` on same `filePaths`; cap 0.8
- `suggestAddRuleVerificationCluster(failures): PolicySuggestion | null` (H4) — co-occurring `verification_timeout`+`test_failure` sharing a file path; cap 0.8
- `suggestLoosenPolicyDenied(failures, policyId, evidence): PolicySuggestion | null` (H5) — repeated `policy_denied` for a policyId with `bypassedCount === 0`; cap 0.8

**Conflict resolution (applied after all heuristics, before sort):**
1. Group emitted suggestions by `policyId`. `add_rule` (no policyId) always kept.
2. For each policyId with >1 suggestion, keep one: highest confidence → tie favors `tighten` over `loosen`/`remove_rule` → tie alphabetical by type.

**Sort order (deterministic):** confidence desc → type asc → policyId asc (undefined last).

**Commit:** `feat(governance): add P13.3 policy suggestions types and pure functions`

---

### Task 2: Write tests

**Files:**
- Create: `tests/governance/policy-suggestions.test.ts`

Test cases (must include all):
1. Empty ledger + empty failure memory returns `[]`
2. H1 emits `loosen` for high deny rate with low related failures
3. H1 emits `remove_rule` when `deniedCount === matchedCount` and `bypassedCount === 0`
4. H2 emits `tighten` when matched policy runs still produce `test_failure`/`verification_timeout`
5. H3 emits `add_rule` for recurring ungoverned file-path failures
6. H4 emits `add_rule` for shared `verification_timeout` + `test_failure` file paths
7. H5 emits `loosen` for repeated `policy_denied` with no downstream safety failure
8. Suggestions below `MIN_SAMPLE_SIZE` are not emitted
9. Suggestions below `MIN_CONFIDENCE` are not emitted
10. `bypassedCount` only counts failure records with `runId` linked to `completed` ledger entries
11. Records without `runId` contribute to `relatedFailureCount`, NOT `bypassedCount`
12. Confidence is rounded to 2 decimals
13. Confidence is clamped to cap
14. Sorting is deterministic: confidence desc, type asc, policyId asc, undefined last
15. Conflicting same-policyId suggestions resolve to one output (no tighten + loosen together)
16. Confidence tie prefers `tighten` over `loosen`/`remove_rule`
17. `add_rule` suggestions (no policyId) are not deduped against named policies
18. Division-by-zero guards: zero `matchedCount`/`deniedCount` produce no `NaN`
19. Every emitted suggestion has non-empty evidence (at least one count > 0) and `sourceHeuristic` set
20. Determinism: identical input yields identical output (deepStrictEqual twice)
21. **Per-heuristic provenance:** for each of H1–H5, construct input that triggers it and assert the emitted suggestion has `sourceHeuristic` matching the heuristic, non-empty `reason`, non-empty `recommendation`, and evidence with at least one non-zero count (so P13.5 can rely on `sourceHeuristic`)

**Commit:** `test(governance): add P13.3 policy suggestions tests`

---

### Task 3: Add CLI subcommand

**Files:**
- Modify: `src/cli/commands/governance.ts`

Add `case "policy-suggestions":`, `runPolicySuggestions` handler (reads both `FileLedgerStore` + `FileFailureMemoryStore`, window filter on both, calls `computePolicySuggestions`), and renderer with confidence coloring + advisory banner ("advisory only — no policy files modified"). JSON output: `{ policySuggestions: [...] }`.

**Commit:** `feat(governance): add 'alix governance policy-suggestions' CLI subcommand`

---

### Task 4: Final verification

GitNexus detect-changes, full build + test suite, CLI smoke (`--json` parseable + human banner says advisory-only), create PR #225.

**Verification commands:**
```bash
pnpm build
pnpm typecheck   # npx tsc --noEmit
node --test dist/tests/governance/policy-suggestions.test.js
pnpm test:vitest
node bin/alix.js governance policy-suggestions --json
node bin/alix.js governance policy-suggestions
```
