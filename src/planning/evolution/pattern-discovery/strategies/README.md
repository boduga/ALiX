# Pattern Discovery Strategies

## Overview
Stateless detection strategies for A1 pattern discovery. Each strategy receives a `DiscoveryContext` and returns zero or more `PatternObservation` records when a configured threshold is crossed; none reaches into a store or performs I/O itself.

## Interface
- `ApprovalFrictionStrategy` (`approval_friction`) — measures denied-vs-approved governance decisions over a lookback window [approval-friction-strategy.ts:ApprovalFrictionStrategy].
- `PerformanceDegradationStrategy` (`performance_degradation`) — compares average latency in the first and second halves of each normalized intent group's successful executions [performance-degradation-strategy.ts:PerformanceDegradationStrategy].
- `ExecutionFailureStrategy` (`execution_failure`) — groups failed executions by normalized intent ID and emits when a group reaches `minimumOccurrences` [execution-failure-strategy.ts:ExecutionFailureStrategy].
- `GovernanceGapStrategy` (`governance_gap`) — finds escalations with no later resolution, optionally counting overrides as unresolved [governance-gap-strategy.ts:GovernanceGapStrategy].
- Config types and defaults: `ApprovalFrictionConfig` / `DEFAULT_APPROVAL_FRICTION_CONFIG`, `PerformanceDegradationConfig` / `DEFAULT_PERFORMANCE_DEGRADATION_CONFIG`, `ExecutionFailureConfig` / `DEFAULT_EXECUTION_FAILURE_CONFIG`, `GovernanceGapConfig` / `DEFAULT_GOVERNANCE_GAP_CONFIG`.
- `normalizeIntentId(intentId)` — strips the final `/` path segment so sibling runs aggregate together [strategy-utils.ts:normalizeIntentId].
- Implements the parent `DetectionStrategy` contract [../detection-strategy.ts:DetectionStrategy].

## Invariants
- Strategies are stateless between runs and receive all data through `DiscoveryContext`; no store access [approval-friction-strategy.ts:ApprovalFrictionStrategy].
- Constructor configuration is merged over the exported defaults (`{ ...DEFAULT_*, ...config }`) [execution-failure-strategy.ts:DEFAULT_EXECUTION_FAILURE_CONFIG].
- A strategy returns an empty array when the event/evidence count is below its minimum; it does not emit a low-confidence placeholder [approval-friction-strategy.ts:ApprovalFrictionStrategy].
- Approval friction counts only `runtime.blocked`/`approval.denied` against `runtime.allowed`/`approval.approved`; the threshold test uses `>=` [approval-friction-strategy.ts:ApprovalFrictionStrategy].
- Performance degradation skips a group when the first-half average latency is zero and emits only when the increase ratio meets `degradationThreshold` [performance-degradation-strategy.ts:PerformanceDegradationStrategy].
- Governance gap treats a resolution that predates its escalation as unresolved, and checks a fallback correlation key when the primary key differs [governance-gap-strategy.ts:GovernanceGapStrategy].
- Only `runtime.requires_approval` is an escalation, and only `runtime.allowed`/`runtime.blocked` are resolutions [governance-gap-strategy.ts:GovernanceGapStrategy].
- Pattern IDs are deterministic (`<category>:<normalizedId>` or a fixed suffix) [performance-degradation-strategy.ts:PerformanceDegradationStrategy].

## Side Effects
- ["None"] — pure detection over the supplied context; no disk, network, or store mutation [approval-friction-strategy.ts:ApprovalFrictionStrategy].

## Verification
- Run: `pnpm test`
