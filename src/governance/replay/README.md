# Governance Counterfactual Replay (P23)

## Overview

`src/governance/replay` implements the P23 read-only counterfactual replay
pipeline for governance lifecycles. It assembles a deterministic
`GovernanceReplayDataset` from lifecycle source records (approvals, lifecycle
traces, readiness projections, handoffs, closure reviews, and closure
intelligence), evaluates a hypothetical policy/scenario against that dataset,
computes a structured diff against the original outcome, and renders an
advisory report.

The subsystem never mutates governance state. Its outputs are explicitly
advisory, carry literal `readOnly: true` / `requiresHumanReview: true`
contract fields, and are intended to inform governed human review rather than
to authorize execution.

## Interface

- `ReplayInputSources` input shape and `assembleReplayDataset(sourceLifecycleId, sources, { now })` dataset builder `[replay-input-assembler.ts:assembleReplayDataset]` `[replay-input-assembler.ts:ReplayInputSources]`.
- Dataset and outcome contracts: `GovernanceReplayDataset`, `ReplaySourceSummary`, `ReplayApprovalRecord`, `ReplayLifecycleTraceRecord`, `ReplayReadinessProjectionRecord`, `ReplayHandoffRecord`, `ReplayClosureReviewRecord`, `ReplayClosureIntelligenceRecord` `[types.ts:GovernanceReplayDataset]`.
- Scenario and assumption contracts: `CounterfactualScenario`, `CounterfactualReadinessAssumptions`, `CounterfactualEvidenceAssumptions`, `CounterfactualHandoffAssumptions`, `CounterfactualClosureAssumptions` `[types.ts:CounterfactualScenario]`.
- Outcome and diff contracts: `ReplayOriginalOutcome`, `ReplayCounterfactualOutcome`, `ReplayDiff`, `ReplayDiffDetail`, `ReplayRiskDelta`, `ReplayCandidateLesson`, `CounterfactualReplayOutcome` `[types.ts:CounterfactualReplayOutcome]`.
- `evaluateCounterfactual(dataset, scenario)` — the evaluation entry point that produces readiness, evidence, handoff, closure, risk, diff, and lessons `[counterfactual-readiness-evaluator.ts:evaluateCounterfactual]`.
- `computeReplayDiff(original, counterfactual)` — category-level diff derivation `[replay-diff-model.ts:computeReplayDiff]`.
- `ReplayReport`, `buildReplayReport`, `renderReportText`, `renderReportJson`, `formatReplayReport` — report assembly and text/JSON rendering `[replay-report.ts:buildReplayReport]` `[replay-report.ts:formatReplayReport]`.

## Invariants

- Assembly normalizes optional P17–P22 source records and sorts deterministically: approvals by `createdAt` then `approvalId`; lifecycle traces by `remediationId`; readiness projections by `assessedAt` then `assessmentId`; handoffs by `generatedAt` then `handoffId`; closure reviews by `reviewedAt` then `closureReviewId`; closure intelligence by `handoffId` `[replay-input-assembler.ts:assembleReplayDataset]`.
- Assembled arrays and nested record arrays are `Object.freeze`d; source records are copied, never mutated `[replay-input-assembler.ts:assembleReplayDataset]`.
- `replayId` is the SHA-256 of `"p23.1" | sourceLifecycleId | assembledAt`, truncated to 16 hex characters `[replay-input-assembler.ts:buildReplayId]`.
- `assembledAt` defaults to `new Date().toISOString()`; an explicit `options.now` makes assembly reproducible `[replay-input-assembler.ts:assembleReplayDataset]`.
- `CounterfactualReplayOutcome.readOnly` and `ReplayCandidateLesson.requiresHumanReview` are literal `true` contract fields — the output can never claim execution authority `[types.ts:CounterfactualReplayOutcome]` `[types.ts:ReplayCandidateLesson]`.
- Counterfactual quality-signal count is intentionally held equal to the original count so the diff cannot invent or drop signals `[counterfactual-readiness-evaluator.ts:evaluateCounterfactual]`.
- Strict evidence and handoff assumptions downgrade readiness; a missing original readiness assessment under assumptions is blocked with the reason `"No original readiness assessment"` `[counterfactual-readiness-evaluator.ts:evaluateCounterfactual]` `[counterfactual-readiness-evaluator.ts:applyReadinessAssumptions]`.
- `requireHumanReviewBeforeStable` adds a block reason whenever the resulting level is not `manual_only` `[counterfactual-readiness-evaluator.ts:applyReadinessAssumptions]`.
- `downgradeOnHighClosureRisk` escalates a high risk to critical and downgrades readiness accordingly; a critical closure quality signal forces `critical` `[counterfactual-readiness-evaluator.ts:applyRiskAssumptions]` `[counterfactual-readiness-evaluator.ts:computeRiskLevel]`.
- Diff categories are `unchanged`, `readiness_changed`, `evidence_gap_changed`, `handoff_quality_changed`, `closure_risk_changed`, `review_path_changed`, `blocked_in_counterfactual`, and `advanced_in_counterfactual` `[replay-diff-model.ts:computeReplayDiff]`.
- `blocked_in_counterfactual` fires only when the original did not already `requiresAttention` — equal stuck states are not reported as a new regression `[replay-diff-model.ts:detectBlockedInCounterfactual]`.
- Diff details sort by category then source id, and the primary category priority order begins with `blocked_in_counterfactual` `[replay-diff-model.ts:detailSorter]` `[replay-diff-model.ts:computePrimaryCategory]`.
- Text reports are wrapped in `P23-REPLAY-START` / `P23-REPLAY-END` markers; JSON reports are `JSON.stringify(report, null, 2) + "\n"` `[replay-report.ts:formatReplayReport]` `[replay-report.ts:REPLAY_START]`.
- The report footer states the report is read-only, that no governance state was mutated, and that counterfactual output is advisory pending governed human review `[replay-report.ts:FOOTER]`.

## Side Effects

- Pure in-process computation with `node:crypto` hashing only; there are no store, filesystem, audit, CLI, or execution writes `[replay-input-assembler.ts:buildReplayId]` `[counterfactual-readiness-evaluator.ts:evaluateCounterfactual]`.
- The only ambient effect is reading the default clock when `options.now` is omitted `[replay-input-assembler.ts:assembleReplayDataset]`.

## Verification

- Run: `pnpm test`
