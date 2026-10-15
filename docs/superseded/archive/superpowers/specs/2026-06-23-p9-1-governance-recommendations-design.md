# P9.1 — GovernanceRecommendation Design Spec (SDS)

> **Status:** SDS — approved. Merged via PR #117 (squash commit `3bf2c835`), tagged `alix-p9-1-complete`.
> **Branch:** `feature/p9.1-governance-recommendations`, off `main`.
>
> **Amendment 1 (P9.2 design review, 2026-06-23):** added `Recommendation.metadata` as a discriminated union keyed on `category`. The P9.1 generators populate this field directly. P9.2's proposal payload is a 1:1 projection of `metadata` (with one key rename: `category` → `kind`). This eliminates the text-parsing fallback that was originally in the P9.2 SDS draft. Implementation of this amendment ships in P9.2a (a small P9.1 follow-up PR that adds the `metadata` field, populates it in the 4 generators, and runs the existing test suite to confirm zero regression).

## Core framing

```text
P9.0 asks: What is the state of governance?
P9.1 asks: What should we do about it?
P9.2 asks: Let's propose those changes.
```

P9.1 is the **advisory layer** between analysis and action. It reads P9.0's analysis artifacts (HealthReport, DriftReport, LensLifecycleReview, IntegrityReport) and produces `GovernanceRecommendation` artifacts — structured, prioritized suggestions that operators can review. No proposals, no lifecycle binding, no mutation.

## Hard boundary

```text
Recommendations advise.
Recommendations do not propose.
```

P9.1 can:
- Read from GovernanceStore (all 5 artifact types)
- Read from P9.0 builders (re-run on demand)
- Produce `GovernanceRecommendation` artifacts
- Store recommendations in GovernanceStore (`recommendations.jsonl`)

P9.1 cannot:
- Create proposals (no ProposalStore, no `governance_change`)
- Call ApprovalGate, appliers, or AutomaticProposalGenerator
- Mutate policies or governance mechanisms
- Import any P9.2 or P5 lifecycle symbols

Sentinel-enforced — `tests/governance/governance-sentinels.vitest.ts` must be extended to forbid ProposalStore, `approve(`, `apply(`, `createProposal`, `governance_change` in all P9.1 files.

## Data model

```ts
export interface GovernanceRecommendation extends DecisionArtifact {
  reportType: "governance_recommendation";
  recommendations: Recommendation[];
}

export interface Recommendation {
  id: string;
  source: "health" | "drift" | "lens-review" | "integrity";
  sourceArtifactId: string;    // the P9.0 artifact this derives from
  priority: "low" | "medium" | "high" | "critical";
  /** How certain the generator is about this recommendation (0-1). */
  confidence: number;
  /** Operator triage lifecycle — advisory only, no mutation. */
  status: "open" | "acknowledged" | "dismissed";
  category:
    | "lens_adjustment"
    | "chain_restoration"
    | "policy_coverage"
    | "confidence_calibration"
    | "governance_integrity";
  title: string;
  description: string;
  evidenceRefs: string[];
  /** Human-readable advisory guidance — NOT an executable action. Named
   * `operatorGuidance` (not `suggestedAction`) to emphasize that P9.1
   * advises; it does not prepare executable changes. That distinction
   * belongs to P9.2. */
  operatorGuidance: string;
  expectedBenefit: string;
  risks: string[];
  /**
   * Structured, category-specific metadata populated directly by the P9.1
   * generator. The shape is a discriminated union keyed on `category`.
   * Each variant mirrors the corresponding P9.2 `governance_change`
   * payload variant field-for-field, with one key rename
   * (`category` → `kind`). P9.2's translation is a 1:1 projection: no
   * text parsing, no heuristics, no nullable fields. See
   * `RecommendationMetadata` below.
   */
  metadata: RecommendationMetadata;
}

/**
 * Discriminated union over the 5 P9.1 recommendation categories.
 * Each variant carries the operation-specific fields that P9.2
 * needs to construct a `governance_change` proposal payload. The
 * shape is populated at generation time (P9.1) and consumed at
 * translation time (P9.2). No string parsing, no re-derivation.
 */
export type RecommendationMetadata =
  | {
      category: "lens_adjustment";
      operation: "promote" | "demote" | "retire";
      lens: string;
      currentPV: number;
      reviewsAnalyzed: number;
    }
  | {
      category: "chain_restoration";
      targetArtifactId: string;
      currentRate: number;
      targetRate: number;
    }
  | {
      category: "policy_coverage";
      currentCoverage: number;
      targetCoverage: number;
    }
  | {
      category: "confidence_calibration";
      target: string;
      currentCalibration: number;
      suggestedCalibration: number;
    }
  | {
      category: "governance_integrity";
      issue: string;
      recommendationId: string;
    };
```

## How recommendations are produced

Each P9.0 artifact type maps to specific recommendation generators:

| P9.0 source | Recommendation generator | Example output |
|---|---|---|
| LensLifecycleReview | For each lens marked `demote`/`retire` | "Demote policy_auditor: PV 0.31, 14 false alarms" |
| GovernanceDriftReport | For each finding with severity ≥ high | "Confidence drift: overconfidence ratio 0.73 — consider recalibration" |
| GovernanceIntegrityReport | For metrics where rate < 60% | "Chain coverage at 45% — investigate missing provenance links" |
| GovernanceHealthReport | For weakest layer with < 50% availability | "Governance layer at 35% availability — investigate coverage gap" |

## CLI

```bash
alix governance recommend [--window <days>] [--json] [--priority <level>] [--source <source>]
```

- `--priority` filter (default: all priorities)
- `--source` filter (default: all sources)
- `--json` for machine output
- Results stored in GovernanceStore (`recommendations.jsonl`) — add to the store's file map: `recommendations: "recommendations.jsonl"`
- The store's `append`, `list`, and `queryByWindow` methods gain a 6th typed overload for `"recommendations"`
- Filtering by `--priority` and `--source` is done client-side after loading from the store

## Acceptance criteria

```text
Given P9.0 analysis artifacts in GovernanceStore:

alix governance recommend

Returns at least one Recommendation per P9.0 source that has actionable findings.
Recommendations have priority, confidence, status, evidenceRefs, and operatorGuidance.
No proposals created.
```

## Out of scope (P9.2)

```text
Proposal generation from recommendations
Approval lifecycle integration
Automatic governance changes
Policy mutation
```
