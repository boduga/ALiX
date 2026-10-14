# DOX — Adaptation & Governance Review

**Purpose:** The P6 deterministic governance pipeline (Context → Risk →
Recommendation → Queue → Brief), the proposal/adaptation stores it reads, and
the P6.5 governance-review council that critiques a recommendation from four
independent lenses **without ever deciding**.

**Ownership:**
- Pipeline stage — `decision-context-builder.ts` (`DecisionContextBuilder` →
  `DecisionContext`), `risk-score-builder.ts` (`scoreGovernance`/`scoreOperational`/
  `scoreCapability`/`scoreRevertability`/`scoreEvidenceQuality`, `RiskScoreBuilder`),
  `recommendation-engine.ts` (`RecommendationEngine`, `computeSignalCoherence`),
  `operator-queue.ts` (`OperatorQueue`, `BuildOptions`).
- Governance review — `governance-review-types.ts` (`LensScore`, `CouncilVote`,
  `GovernanceReview`, `GovernanceVerdict` + severity map), `lens-agent.ts`
  (`LensAgent`, `LENS_PROMPTS`, `LENS_JSON_SUFFIX`), `llm-lens-agent.ts`
  (`LLMLensAgent` — real LLM execution), `provider-catalog-adapter.ts`
  (`ProviderCatalogAdapter` → `LLMAdapter`), `governance-review-council.ts`
  (`GovernanceReviewCouncil.aggregate`), `governance-review-store.ts`
  (`GovernanceReviewStore`).
- Lens calibration — `lens-calibration-builder.ts` (`LensObservation`,
  `isWarningVerdict`, `LensCalibrationBuilder`); `src/planning/learning` derives
  observations from stored reviews.
- Stores — `adaptation-proposal-store.ts`, `approval-recommendation-store.ts`,
  `risk-score-store.ts`, `outcome-store.ts`, `intent-store.ts`, `priority-store.ts`,
  `effectiveness-store.ts`, `intelligence-store.ts`, `snapshot-store.ts`,
  `capability-evolution-store.ts`.
- Analyzers/reports — `capability-{drift,gap,health,overlap}-analyzer.ts`,
  `effectiveness-{reporter,trend-analyzer}.ts`, `revert-signal-analyzer.ts`,
  `proposal-lifecycle-analyzer.ts`, `confidence-calibration-analyzer.ts`,
  `pipeline-health-{builder,collector}.ts`, `recommendation-accuracy-builder.ts`,
  `capability-evolution-{proposal-generator,reporter}.ts`, `strategic-brief.ts`.
- Application — `approval-gate.ts` (`ApprovalGate`, `Applier`, `Actor`,
  `GovernanceCriteriaFn`), `appliers/{agent-card,skill,governance-change}-applier.ts`,
  `revert-applier.ts`, `recommendation-to-proposal.ts`,
  `intent-proposal-mapper.ts`, `auto-proposal-generator.ts`.

**Local Contracts:**
- **No decision authority.** The council and its lenses critique; the approval
  gate and the operator queue decide. A lens may never emit approval language
  (`FORBIDDEN_PHRASES` in `llm-lens-agent.ts`) — an authority phrase anywhere in
  the lens payload converts the lens to `insufficient_information`.
- **Lens output is JSON against a stated schema.** `LENS_JSON_SUFFIX` names every
  field the parser validates; required fields (`recommendedVerdict`, `confidence`,
  `rationale`) are strict — a violation is an `insufficient_information` lens.
- **Lens enrichment is structured and fail-soft.** `LensScore.blindSpots` and
  `LensScore.historicalAnalogies` are optional, lens-authored arrays. A malformed
  entry is dropped and an empty result omits the field entirely; it never
  invalidates a lens verdict. Bounds: 10 entries per array, 300 chars per entry.
  The council merges those arrays (`#mergeFindings`, case-insensitive dedup) —
  it never re-parses prose to invent blind spots or analogies.
- **Council aggregation is pure and deterministic.** No `Math.random`, no
  argument-less `new Date()`, no `LensAgent` import, no store access. Same lens
  scores in, same `GovernanceReview` out.
- **`governance-review-types.ts` is hash-protected.** `tests/learning/
  unchanged-types-invariance.vitest.ts` pins the strict-protected type files; a
  change there is intentional by definition and must bump the baseline plus the
  recorded rationale in that test's header.

**Work Guidance:**
- A new lens, verdict value, or enrichment field changes `LensScore` and therefore
  the protected types file — plan the baseline bump with the change.
- Keep prompts critique-only. Prompt text is sentinel-scanned for authority
  language in `tests/adaptation/governance-review-sentinels.vitest.ts`.
- Enrichment is additive by design: persisted reviews written before a field
  existed must still deserialize, so never make a review field required.

**Verification:**
- `tests/adaptation/governance-review-council.vitest.ts` — aggregation, vote
  counting, confidence, dedup.
- `tests/adaptation/llm-lens-agent.vitest.ts` — parse, validation, authority
  scan, enrichment normalization and bounds.
- `tests/adaptation/governance-review-sentinels.vitest.ts` — prompt/purity
  sentinels.
- `tests/adaptation/governance-review-types.vitest.ts`,
  `tests/adaptation/lens-calibration-builder.vitest.ts`.
- `tests/learning/unchanged-types-invariance.vitest.ts` — protected types.
- `tests/cli/commands/decision-review-persistence.vitest.ts` — the
  `alix decision review` path that consumes the council.

**Child DOX Index:** none.