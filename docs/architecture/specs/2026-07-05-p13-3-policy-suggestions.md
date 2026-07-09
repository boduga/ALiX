# P13.3 — Governance Policy Refinement Suggestions Design Spec

**Date:** 2026-07-05
**Status:** Design — implementation deferred.

## Purpose

P13.3 cross-references the P12.4 run ledger and P12.5 failure memory to produce **advisory** policy refinement suggestions. Where P13.1 said "what happened" and P13.2 said "what's failing," P13.3 says "what should a human consider tightening or loosening."

This is the most sensitive P13 module because its output reads as directives ("tighten this policy"). It must remain purely advisory — every suggestion is a recommendation a human reviews and decides on.

## Core invariant

**Suggest governance refinements, don't apply them.**

P13.3 reads stores and emits suggestions. It never:
- Modifies policy rules (`DEFAULT_GOVERNANCE_POLICIES`, policy files)
- Changes risk scoring thresholds
- Alters approval gate configurations
- Writes to the run ledger or failure memory
- Auto-applies, auto-merges, or auto-approves any suggestion
- Blocks or delays any run

**Hard rule:** Every emitted suggestion MUST include evidence counts and a confidence score. A suggestion without evidence is never emitted.

## Architecture

```
Run Ledger ─────┐
                ├──→ P13.3 Policy Suggestions ──→ P13.5 Governance Report
Failure Memory ─┘         (pure analysis)             (terminal + JSON)
                                │
                                └──→ Human reviews → approves/rejects P12 changes
```

P13.3 is a pure transformation: `(LedgerEntry[], FailureRecord[]) → PolicySuggestion[]`. The CLI reads both stores, passes records to the pure function, renders output. No intermediate persistence.

## Cross-store join model

P13.3 joins the two stores deterministically. Each heuristic declares which join keys it uses:

| Join key | Ledger side | Failure side | Used by |
|----------|-------------|--------------|---------|
| `policyId` | `policyResult.matchedPolicies[]` | `policyIds[]` | H1, H2, H5 |
| `runId` | `runId` | `runId` | H1 bypass, H2 (downstream success) |
| file path overlap | `filesChanged[]` | `filePaths[]` | H2, H3, H4 |
| timestamp window | both stores filtered independently by `--window` before analysis | | all |

`bypassedCount` is computed precisely via the `runId` join: it is the count of failure records tagged with `policyId` whose `runId` also appears in the ledger with `outcome === "completed"`. If a failure record has no `runId`, it cannot contribute to `bypassedCount` (it contributes to `relatedFailureCount` instead — see Types).

## Types

```typescript
type PolicySuggestionType = "tighten" | "loosen" | "add_rule" | "remove_rule";

interface PolicySuggestionEvidence {
  matchedCount: number;        // ledger entries whose policyResult.matchedPolicies includes this policyId
  deniedCount: number;         // ledger entries with outcome "denied" attributable to this policy
  bypassedCount: number;       // failure records tagged with policyId whose runId later has outcome "completed" in the ledger (deterministic runId join; 0 when no runId link)
  relatedFailureCount: number; // failure records tagged with this policyId (total, regardless of run outcome)
}

interface PolicySuggestion {
  type: PolicySuggestionType;
  policyId?: string;           // present for tighten/loosen/remove_rule; absent for add_rule
  reason: string;              // human-readable explanation
  evidence: PolicySuggestionEvidence;
  confidence: number;          // 0.0–1.0
  recommendation: string;      // concrete action for the human
  sourceHeuristic: "H1" | "H2" | "H3" | "H4" | "H5";  // provenance for tests + P13.5 reporting
}
```

## Heuristics (each gated on evidence + confidence thresholds)

All heuristics emit nothing unless the supporting evidence counts meet a minimum sample size (`MIN_SAMPLE_SIZE = 3`) AND the computed confidence meets `MIN_CONFIDENCE = 0.5`. **All ratios are division-guarded** — denominators of 0 yield a ratio of 0 rather than `NaN`/`Infinity`:

```typescript
const denyRate  = matchedCount > 0 ? deniedCount / matchedCount : 0;
const bypassRate = deniedCount > 0 ? bypassedCount / deniedCount : 0;
```

### H1 — `remove_rule` / `loosen`
A policy with **high `matchedCount`** and **high `deniedCount`** but **low or absent related failures** (the deny rarely corresponds to a real safety event).
- Trigger: `matchedCount >= MIN_SAMPLE_SIZE` AND `denyRate >= 0.6` AND `bypassRate < 0.2`
- Type: `loosen` (default). Escalates to `remove_rule` when `deniedCount === matchedCount` (policy always denies) AND `bypassedCount === 0`.
- Confidence: scaled by `denyRate` (capped at 0.9).

### H2 — `tighten`
A policy **frequently matches but related runs still fail** — the policy is not catching the dangerous case.
- Trigger: `matchedCount >= MIN_SAMPLE_SIZE` AND related `test_failure` / `verification_timeout` failures on matched paths `>= MIN_SAMPLE_SIZE`.
- Confidence: scaled by failure ratio, capped at 0.85.

### H3 — `add_rule` (ungoverned recurring failures)
Recurring failure patterns exist **without associated `policyIds`** — the failing path is unregulated.
- Trigger: failure records with empty/absent `policyIds` on the same `filePaths` recurring `>= MIN_SAMPLE_SIZE` times.
- Confidence: scaled by recurrence, capped at 0.8.

### H4 — `add_rule` (verification + test cluster)
`verification_timeout` + `test_failure` recur on the same file paths — suggests a verification policy gap.
- Trigger: `>= MIN_SAMPLE_SIZE` co-occurring `verification_timeout` and `test_failure` records sharing a file path.
- Confidence: scaled by co-occurrence, capped at 0.8.

### H5 — `loosen` (repeated policy_denied with no downstream safety failure)
`policy_denied` failures appear repeatedly for the same `policyId` with no later safety failures tied to that policy.
- Trigger: `policy_denied` failure count for a policyId `>= MIN_SAMPLE_SIZE` AND `bypassedCount === 0`.
- Confidence: scaled by repetition, capped at 0.8.

## Confidence model

```typescript
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
```

All confidence scores are deterministic functions of evidence counts, rounded to 2 decimals, clamped to `[0, cap]`. No random, no time-of-day, no external state.

## Determinism

For identical inputs, `computePolicySuggestions(...)` MUST return identical output. Suggestions are sorted by:
1. `confidence` descending
2. `type` alphabetically (tie-break)
3. `policyId` alphabetically (tie-break, with undefined sorted last)

## Conflict resolution (same policyId)

H1/H5 can emit `loosen`/`remove_rule` while H2 can emit `tighten` for the **same** `policyId`. To avoid contradictory recommendations in one run, after all heuristics run:

1. Group emitted suggestions by `policyId` (suggestions without `policyId` — i.e. `add_rule` — are never conflicting and always kept).
2. For each policyId with multiple suggestions, keep exactly one:
   - Highest `confidence` wins.
   - Confidence tie → `tighten` wins over `loosen`/`remove_rule`.
   - Further tie → alphabetical by `type`.
3. `add_rule` suggestions (no `policyId`) are never deduped against named policies.

This guarantees no single `policyId` receives both a `tighten` and a `loosen` in the same output.

## CLI

```bash
alix governance policy-suggestions [--window N] [--json]
```

Reads `FileLedgerStore` and `FileFailureMemoryStore`, applies window filter, calls `computePolicySuggestions`, renders colored terminal output or JSON.

**Terminal output:**
```
Governance Policy Suggestions
═══════════════════════════════════════════════════════════════
Window:   90 days
Suggestions: 3 (advisory only — no policy files modified)

[0.85] tighten  governance-source-change-ask
  Reason:        Policy matches frequently but matched runs still fail
  Recommendation: Tighten match criteria or add a verification requirement
  Evidence:      matched=12, denied=2, bypassed=4

[0.70] add_rule  (no policyId)
  Reason:        Recurring failures without an associated policy
  Recommendation: Add a policy governing src/unchecked/handler.ts
  Evidence:      matched=0, denied=0, bypassed=6

[0.60] loosen   governance-large-change-ask
  Reason:        High deny rate with no downstream safety failures
  Recommendation: Consider raising the file-count threshold
  Evidence:      matched=8, denied=7, bypassed=0
```

**JSON output:**
```json
{
  "policySuggestions": [
    {
      "type": "tighten",
      "policyId": "governance-source-change-ask",
      "reason": "Policy matches frequently but matched runs still fail",
      "evidence": {
        "matchedCount": 12,
        "deniedCount": 2,
        "bypassedCount": 4,
        "relatedFailureCount": 6
      },
      "confidence": 0.85,
      "recommendation": "Tighten match criteria or add a verification requirement",
      "sourceHeuristic": "H2"
    }
  ]
}
```

## Verification

```bash
pnpm build
node --test dist/tests/governance/policy-suggestions.test.js
pnpm test:vitest
node bin/alix.js governance policy-suggestions --json
```

## Non-goals

- **No auto-apply** — every suggestion requires human action
- **No ML** — heuristics are threshold-based rules over counts
- **No policy mutation** — never writes policy files
- **No cross-referencing with approval gates** — that's P13.4
- **No suggestion persistence** — computed on-demand from live stores

## Files

```
src/governance/policy-suggestions.ts           # Create
tests/governance/policy-suggestions.test.ts    # Create
src/cli/commands/governance.ts                  # Amend (add policy-suggestions subcommand)
docs/architecture/plans/2026-07-05-p13-3-policy-suggestions.md  # Plan
```
