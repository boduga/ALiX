# Adaptation & Governance Review

## Overview

This package implements ALiX's P6 deterministic governance pipeline and the
P6.5 governance-review council. The pipeline turns a pending adaptation proposal
into a decision artifact chain — `DecisionContext` → `RiskScore` →
`Recommendation` → `OperatorQueue` position → `StrategicBrief` — from evidence and
historical intelligence. The council sits beside that chain: four independent
lenses review a recommendation and return a `GovernanceReview` that argues,
warns, and records disagreement, but never authorizes anything.

Mutation is a separate path from analysis. `ApprovalGate` is the single
transition authority for proposals (`pending → approved|rejected →
applied|failed`), and appliers perform only the file writes for already-approved
proposals. `ProposalScorer` and the analyzers/reporters are deliberately
read-only. Snapshots and append-only JSONL artifact stores under `.alix/` make
each decision and revert auditable.

## Interface

- **Decision context** — `DecisionContextBuilder`, `DecisionContext`
  [decision-context-builder.ts:DecisionContextBuilder];
  `computeDecisionConfidence`, `STALE_THRESHOLD_DAYS`
  [decision-confidence.ts:computeDecisionConfidence],
  [decision-confidence.ts:STALE_THRESHOLD_DAYS].
- **Risk scoring** — `RiskScoreBuilder` plus the pure component scorers
  `scoreGovernance`, `scoreOperational`, `scoreCapability`, `scoreRevertability`,
  `scoreEvidenceQuality` [risk-score-builder.ts:RiskScoreBuilder],
  [risk-score-builder.ts:scoreGovernance], [risk-score-builder.ts:scoreOperational],
  [risk-score-builder.ts:scoreCapability], [risk-score-builder.ts:scoreRevertability],
  [risk-score-builder.ts:scoreEvidenceQuality].
- **Recommendation** — `RecommendationEngine`, `computeSignalCoherence`
  [recommendation-engine.ts:RecommendationEngine],
  [recommendation-engine.ts:computeSignalCoherence]; artifact types in
  [recommendation-types.ts:Recommendation].
- **Operator queue and brief** — `OperatorQueue`, `BuildOptions`
  [operator-queue.ts:OperatorQueue], [operator-queue.ts:BuildOptions];
  `StrategicBriefBuilder` [strategic-brief.ts:StrategicBriefBuilder];
  queue/brief shapes in [operator-queue-types.ts:QueueItem],
  [strategic-brief-types.ts:StrategicBrief].
- **Governance review** — `LensAgent`, `LENS_PROMPTS`, `LENS_JSON_SUFFIX`
  [lens-agent.ts:LensAgent], [lens-agent.ts:LENS_PROMPTS],
  [lens-agent.ts:LENS_JSON_SUFFIX]; `LLMLensAgent`
  [llm-lens-agent.ts:LLMLensAgent]; `LLMAdapter`/`LLMCompletion`
  [llm-adapter.ts:LLMAdapter], [llm-adapter.ts:LLMCompletion];
  `ProviderCatalogAdapter` [provider-catalog-adapter.ts:ProviderCatalogAdapter];
  `GovernanceReviewCouncil` [governance-review-council.ts:GovernanceReviewCouncil];
  `GovernanceReviewStore` [governance-review-store.ts:GovernanceReviewStore];
  `LensScore`, `CouncilVote`, `GovernanceVerdict`,
  `GOVERNANCE_VERDICT_SEVERITY` [governance-review-types.ts:LensScore],
  [governance-review-types.ts:CouncilVote],
  [governance-review-types.ts:GovernanceVerdict],
  [governance-review-types.ts:GOVERNANCE_VERDICT_SEVERITY].
- **Proposal vocabulary and approval** — `AdaptationProposal`, `ProposalStatus`,
  `ProposalAction`, `ProposalTarget` [adaptation-types.ts:AdaptationProposal],
  [adaptation-types.ts:ProposalStatus]; `ApprovalGate`, `Applier`, `Actor`,
  `GovernanceCriteriaFn`, `ApprovalBatchError` [approval-gate.ts:ApprovalGate],
  [approval-gate.ts:Applier], [approval-gate.ts:Actor],
  [approval-gate.ts:GovernanceCriteriaFn], [approval-gate.ts:ApprovalBatchError].
- **Proposal lifecycle and readiness** — `AdaptationProposalStore`
  [adaptation-proposal-store.ts:AdaptationProposalStore]; `getApplySupport`,
  `computeProposalReadiness`, `ProposalReadinessInfo`
  [proposal-readiness.ts:getApplySupport],
  [proposal-readiness.ts:computeProposalReadiness],
  [proposal-readiness.ts:ProposalReadinessInfo]; `ProposalScorer`
  [proposal-scorer.ts:ProposalScorer]; `PriorityStore`
  [priority-store.ts:PriorityStore]; `SnapshotStore`, `AdaptationSnapshot`
  [snapshot-store.ts:SnapshotStore], [snapshot-store.ts:AdaptationSnapshot];
  `RevertApplier` [revert-applier.ts:RevertApplier].
- **Generators, analyzers, and reporters** — `CapabilityEvolutionProposalGenerator`
  [capability-evolution-proposal-generator.ts:CapabilityEvolutionProposalGenerator];
  `CapabilityEvolutionReporter`
  [capability-evolution-reporter.ts:CapabilityEvolutionReporter];
  `AutomaticProposalGenerator`, `DEFAULT_MIN_REFLECTION_CONFIDENCE`
  [auto-proposal-generator.ts:AutomaticProposalGenerator],
  [auto-proposal-generator.ts:DEFAULT_MIN_REFLECTION_CONFIDENCE];
  `IntentProposalMapper` [intent-proposal-mapper.ts:IntentProposalMapper];
  `LensCalibrationBuilder`, `LensObservation`
  [lens-calibration-builder.ts:LensCalibrationBuilder],
  [lens-calibration-builder.ts:LensObservation]; capability
  drift/gap/health/overlap analyzers, effectiveness reporter and trend analyzer,
  revert-signal and proposal-lifecycle analyzers, intelligence/reporting, lineage,
  and pipeline health builders in their sibling modules; `MINIMUM_BUCKET_SIZE`
  [intelligence-types.ts:MINIMUM_BUCKET_SIZE].
- **Appliers** ([./appliers/README.md](./appliers/README.md)) — `AgentCardApplier`,
  `SkillApplier`, `GovernanceChangeApplier`
  [appliers/agent-card-applier.ts:AgentCardApplier],
  [appliers/skill-applier.ts:SkillApplier],
  [appliers/governance-change-applier.ts:GovernanceChangeApplier].

## Invariants

- **The council has no decision authority.** Lenses are told to critique only,
  and `FORBIDDEN_PHRASES` is scanned across the entire parsed lens payload — a
  phrase such as `"must approve"` in any field, not just `rationale`, converts
  the lens to `insufficient_information` [llm-lens-agent.ts:LLMLensAgent],
  [lens-agent.ts:LENS_PROMPTS].
- **Lens output must be JSON matching the stated schema.**
  `recommendedVerdict`, `confidence` (finite, `0..1`), and non-empty `rationale`
  are strictly validated; parse, validation, timeout, or adapter failure falls
  back to `insufficient_information` with confidence `0`
  [lens-agent.ts:LENS_JSON_SUFFIX], [llm-lens-agent.ts:LLMLensAgent].
- **Enrichment is fail-soft and bounded.** `blindSpots` and
  `historicalAnalogies` are normalized rather than validated: malformed entries
  are dropped, arrays are capped at 10 entries of 300 characters, and an empty
  array omits the field so older persisted reviews still deserialize
  [llm-lens-agent.ts:LLMLensAgent].
- **Council aggregation is pure and deterministic.** Verdict is the plurality of
  lens verdicts; a tie resolves to the most severe verdict via
  `GOVERNANCE_VERDICT_SEVERITY` (`insufficient_information` > `challenge` >
  `agree_with_concerns` > `agree`), and `generatedAt` accepts an explicit
  override for reproducibility [governance-review-council.ts:GovernanceReviewCouncil],
  [governance-review-types.ts:GOVERNANCE_VERDICT_SEVERITY].
- **No mutation without approval.** `apply` requires status `approved`; an
  applier error transitions the proposal to `failed`, records the error, and
  rethrows [approval-gate.ts:ApprovalGate].
- **Approval and rejection require `pending`.** Any other status is rejected
  before any transition [approval-gate.ts:ApprovalGate].
- **Governance criteria fail closed.** For `governance_change` targets the gate
  evaluates `GovernanceCriteriaFn`; a denied criterion records
  `governance_approval_denied` without transitioning, and a failure to record the
  decision aborts before approval. The recorded threshold is the literal `60`
  [approval-gate.ts:ApprovalGate].
- **Batch approval is best-effort.** `approveBatch` never throws, collects
  per-id errors, and treats an empty id list as a no-op [approval-gate.ts:ApprovalGate].
- **Appliers own only their file write.** They require `approved`, do not set
  proposal status, but configured instances snapshot first and record
  `recordSnapshotTaken` — `AgentCardApplier` snapshots update/add but not create,
  `SkillApplier` snapshots the pre-image, and `GovernanceChangeApplier` also
  records `recordGovernanceMutationApplied`
  [appliers/agent-card-applier.ts:AgentCardApplier],
  [appliers/skill-applier.ts:SkillApplier],
  [appliers/governance-change-applier.ts:GovernanceChangeApplier].
- **Governance mutations are ordered and drift-checked.** Validate → snapshot →
  pre-write hash check → atomic write → evidence; a hash mismatch aborts before
  writing [appliers/governance-change-applier.ts:GovernanceChangeApplier].
- **Governance applier kinds are closed.** `SUPPORTED_KINDS` is exactly
  `confidence_calibration`, `lens_adjustment`, and `policy_coverage`
  [appliers/governance-change-applier.ts:GovernanceChangeApplier].
- **Revert is narrow and integrity-checked.** `RevertApplier` accepts only
  `revert_proposal` action with `{ kind: "revert", sourceProposalId }`, requires
  `approved`, verifies the snapshot content hash, and records
  `adaptation_revert_failed` before throwing [revert-applier.ts:RevertApplier].
- **Proposal lifecycle is closed.** `pending → approved|rejected → applied|failed`,
  and the store validates the status set plus the proposal shape before writing
  [adaptation-proposal-store.ts:AdaptationProposalStore].
- **Proposal reads are cached safely.** Decoded records are cached by
  `(mtime, size)` and corrupt files are never cached
  [adaptation-proposal-store.ts:AdaptationProposalStore].
- **Prioritization is read-only and weighted.** `ProposalScorer` creates no
  proposals and writes no evidence; weights are 0.3 confidence, 0.3 historical
  success, 0.15 approval, 0.15 revert penalty, with a default revert penalty of
  0.5 [proposal-scorer.ts:ProposalScorer].
- **Queue ordering is five-tier and stable.** Risk descending → recommendation
  rank descending → age descending → review severity descending → `proposalId`
  ascending; `limit` applies only after sorting and positions are 1-indexed
  [operator-queue.ts:OperatorQueue].
- **Readiness routing is explicit.** Registered appliers are
  `{agent_card, skill, revert, governance}`; manual kinds are
  `{capability, issue, routing_weight}`; `executive_remediation` and `learning`
  are unsupported [proposal-readiness.ts:getApplySupport].
- **Decision confidence is bounded.** It measures evidence completeness, is
  clamped to `[0, 1]`, rounded to two decimals, and applies a stale penalty past
  30 days [decision-confidence.ts:computeDecisionConfidence],
  [decision-confidence.ts:STALE_THRESHOLD_DAYS].
- **Snapshots are durable and verifiable.** Writes go to a temp file with
  `fsync` then rename; content is SHA-256 hashed; `proposalId` passes
  `assertSafePathComponent` before any path is built
  [snapshot-store.ts:SnapshotStore].
- **Capability-evolution thresholds have defaults.** Minimum gap signal strength
  2, minimum drift magnitude 0.5, minimum capability usage 5, and at most 10
  proposals per run [capability-evolution-proposal-generator.ts:CapabilityEvolutionProposalGenerator].
- **Intelligence suppresses small samples.** `MINIMUM_BUCKET_SIZE` is 5
  [intelligence-types.ts:MINIMUM_BUCKET_SIZE].

## Side Effects

- **Append-only decision artifacts**: `.alix/recommendations/recommendations.jsonl`
  [approval-recommendation-store.ts:ApprovalRecommendationStore],
  `.alix/governance-reviews/governance-reviews.jsonl`
  [governance-review-store.ts:GovernanceReviewStore],
  `.alix/risk-scores/risk-scores.jsonl` [risk-score-store.ts:RiskScoreStore].
- **Timestamp-keyed report files**: `.alix/adaptation/intelligence/`
  [intelligence-store.ts:IntelligenceStore] and `.alix/adaptation/priorities/`
  [priority-store.ts:PriorityStore].
- **Proposal store**: one JSON file per proposal with atomic writes
  [adaptation-proposal-store.ts:AdaptationProposalStore].
- **Applier writes**: agent card JSON, skill definition JSON, and governance
  target files [appliers/agent-card-applier.ts:AgentCardApplier],
  [appliers/skill-applier.ts:SkillApplier],
  [appliers/governance-change-applier.ts:GovernanceChangeApplier].
- **Governance targets**: `.alix/governance/calibration.json`,
  `.alix/governance/lens-registry.json`, `.alix/governance/policy-coverage.json`
  [appliers/governance-change-applier.ts:GovernanceChangeApplier].
- **Revert writes**: restores the snapshot's `filePath` from its base64 content
  [revert-applier.ts:RevertApplier].
- **Evidence chain**: the gate records `adaptation_approved`,
  `adaptation_rejected`, `adaptation_applied`, and `adaptation_failed`, plus
  governance approval decision/denial events [approval-gate.ts:ApprovalGate].
- **Network and model calls**: lens review goes through the injected
  `LLMAdapter`; `ProviderCatalogAdapter` resolves the provider/model, and the
  default per-lens call timeout is 30 seconds [llm-lens-agent.ts:LLMLensAgent],
  [provider-catalog-adapter.ts:ProviderCatalogAdapter].
- **Snapshots on disk**: `SnapshotStore.save` creates the snapshot directory and
  writes `<proposalId>.json` under the configured directory
  [snapshot-store.ts:SnapshotStore].

## Verification

- Run: `pnpm test`
