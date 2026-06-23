# P9.1 — GovernanceRecommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement.

**Goal:** Add advisory `GovernanceRecommendation` layer that reads P9.0 analysis artifacts and produces structured, prioritized, confidence-scored recommendations. No proposals, no lifecycle binding, no mutation.

**Architecture:** 4 recommendation generators (lens, drift, integrity, health) each consuming specific P9.0 artifacts from GovernanceStore. Generator results aggregated into a `GovernanceRecommendation` stored in `recommendations.jsonl` via the existing GovernanceStore. CLI filters by priority/source.

## Global Constraints

- **Recommendations advise. Recommendations do not propose.** No ProposalStore, no `governance_change`, no ApprovalGate, no appliers. Sentinel-enforced (P9.1d).
- **6 protected type files unchanged:** `risk-score-types.ts`, `governance-review-types.ts`, `adaptation-types.ts`, `decision-types.ts`, `learning-types.ts`, `outcome-types.ts`.
- **Existing GovernanceStore** gains a 6th file: `recommendations.jsonl`.
- **No P9.2 symbols** — `GovernanceRecommendation`, `GovernanceProposal`, `governance_change`, `createGovernanceProposal` remain forbidden (already in sentinel).

---

### P9.1a — Types + GovernanceStore recommendations.jsonl

**Files:**
- Modify: `src/governance/governance-types.ts` (add `GovernanceRecommendation`, `Recommendation`)
- Modify: `src/governance/governance-store.ts` (add 6th overload for `"recommendations"`)
- Modify: `tests/governance/governance-store.vitest.ts` (add 2 tests)

Steps:
1. Add types to governance-types.ts
2. Add `recommendations: "recommendations.jsonl"` to store file map + typed overloads
3. Write 2 store tests (append/list recommendations, queryByWindow)
4. Run + commit

---

### P9.1b — RecommendationGenerator

**Files:**
- Create: `src/governance/governance-recommendation-generator.ts`
- Create: `tests/governance/governance-recommendation-generator.vitest.ts`

4 generator functions, each consuming specific P9.0 artifacts:

1. **LensLensGenerator** — reads LensLifecycleReview from GovernanceStore; for each lens where recommendation is `demote` or `retire`, emit a recommendation with `category: "lens_adjustment"`, `confidence` scaled by review count
2. **DriftGenerator** — reads GovernanceDriftReport findings; for findings with severity ≥ high, emit recommendation with matching priority and `category` based on `driftType`
3. **IntegrityGenerator** — reads GovernanceIntegrityReport metrics; for any rate < 60%, emit recommendation with `category: "chain_restoration"` or `"governance_integrity"`
4. **HealthGenerator** — reads GovernanceHealthReport; for weakest layer with < 50% availability, emit recommendation with `category: "policy_coverage"`

Exported function:
```ts
export async function generateRecommendations(opts: {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}): Promise<GovernanceRecommendation>
```

Run + commit.

---

### P9.1c — CLI + filters

**Files:**
- Modify: `src/cli/commands/governance.ts` (add `"recommend"` subcommand)
- Modify: `tests/cli/commands/governance-integration.vitest.ts` (add 2 tests)

CLI:
```bash
alix governance recommend [--window <days>] [--json] [--priority <level>] [--source <source>]
```

Run generator, store to GovernanceStore, render or JSON. Filtering by priority/source done client-side.

Run + commit.

---

### P9.1d — Sentinel extension

**Files:**
- Modify: `tests/governance/governance-sentinels.vitest.ts`

Extend forbidden lists (already present from P9.0a — verify coverage):
- `ProposalStore` — already forbidden
- `governance_change`, `GovernanceProposal` — already forbidden
- Add `approve(`, `apply(`, `createProposal` to write-call checks

Run + full suite + commit.

---

## Summary

| Task | Files | Tests |
|---|---|---|
| P9.1a Types + store | 2 modified | +2 |
| P9.1b RecommendationGenerator | 2 new | +4 |
| P9.1c CLI + filters | 1 modified | +2 |
| P9.1d Sentinel | 1 modified | already covered |

All existing governance tests must still pass. No P8 files touched.
