# Reflection

## Overview
Reflection phase of the autonomous execution pipeline. `ReflectionAgent` composes any number of `Analyzer` plugins, runs them in parallel, and assembles a typed `ReflectionReport` of observations, recommendations, and evidence-store metrics. Four analyzers cover evidence patterns, workflow stalls/backlog, unresolved capability routing, and review-quality trends. Analysis is read-only: analyzers query the `EvidenceStore` and a workflow-state reader, and this package never mutates either.

## Interface
- `Observation`, `ObservationType`, `ObservationSeverity` [reflection-types.ts:Observation]
- `Recommendation`, `RecommendationType` [reflection-types.ts:Recommendation]
- `ReflectionMetrics`, `ReflectionReport`, `AnalysisResult`, `Analyzer` [reflection-types.ts:ReflectionReport], [reflection-types.ts:Analyzer]
- `ReflectionAgent(analyzers, storeForMetrics).generateReport()` [reflection-agent.ts:ReflectionAgent]
- `MetricsWindow` and `computeMetricsSnapshot(store, window?)` [metrics-snapshot.ts:computeMetricsSnapshot]
- `WorkflowStateReader` and `WorkflowAnalyzer` [workflow-analyzer.ts:WorkflowStateReader], [workflow-analyzer.ts:WorkflowAnalyzer]
- `EvidenceAnalyzer(store, threshold?)` [evidence-analyzer.ts:EvidenceAnalyzer]
- `CapabilityAnalyzer(store)` [capability-analyzer.ts:CapabilityAnalyzer]
- `QualityAnalyzer(store)` [quality-analyzer.ts:QualityAnalyzer]

## Invariants
- `generateReport` runs every analyzer in parallel with `Promise.all`, then flattens observations/recommendations and derives metrics [reflection-agent.ts:generateReport]
- `generatedAt` is an ISO timestamp; `summary.highSeverityCount` counts only `severity === "high"` [reflection-agent.ts:generateReport]
- Metrics are type-targeted, never a full scan: `merge_completed`, `workflow_blocked`, `workflow_aborted`, `capability_routed`, `review_completed` [metrics-snapshot.ts:computeMetricsSnapshot]
- Window bounds are exclusive on both ends: only `timestamp > after` and `< before` count [metrics-snapshot.ts:MetricsWindow]
- `reviewApprovalRate` defaults to `1` when there are no reviews [metrics-snapshot.ts:computeMetricsSnapshot]
- Unresolved capabilities count only routed records whose `payload.candidates === 0`, capped at 5000 payload-inspected records [metrics-snapshot.ts:PAYLOAD_LIMIT]
- Workflow stalls use a 24-hour threshold; bottleneck states are `BLOCKED`, `EXECUTING`, `UNDER_REVIEW` with a backlog threshold of 3 [workflow-analyzer.ts:WorkflowAnalyzer]
- Stall severity is `high` at 3+ stalled workflows, otherwise `medium` [workflow-analyzer.ts:WorkflowAnalyzer]
- Evidence patterns emit only when count meets the threshold (default 3), mapped as `workflow_aborted`→failure/high, `workflow_blocked`→stall/medium, `execution_test_failed`→test gap/medium [evidence-analyzer.ts:EVIDENCE_TO_OBSERVATION]
- Evidence recommendations are fixed: process_change 0.9 (failure), process_change 0.8 (stall), skill_revision 0.8 (test gap) [evidence-analyzer.ts:buildRecommendations]
- Capability gaps require at least 2 requests with zero candidates; severity escalates to `high` at 5 [capability-analyzer.ts:CapabilityAnalyzer]
- Capability confidence is `min(0.5 + count * 0.1, 0.95)`, and a malformed `candidates` field coerces to `-1` so it is never mistaken for a genuine zero [capability-analyzer.ts:computeConfidence], [capability-analyzer.ts:coerceCandidates]
- Quality emits `high` below 50% approval, `medium` below 75%, and a separate `medium` observation when average findings exceed 5 [quality-analyzer.ts:QualityAnalyzer]
- An empty review set returns no observations rather than a zero-rate observation [quality-analyzer.ts:QualityAnalyzer]
- `WorkflowAnalyzer` and `QualityAnalyzer` emit no recommendations; only `EvidenceAnalyzer` and `CapabilityAnalyzer` do [workflow-analyzer.ts:WorkflowAnalyzer], [evidence-analyzer.ts:EvidenceAnalyzer]

## Side Effects
- Read-only `EvidenceStore.query()` calls per analyzer; no evidence writes [metrics-snapshot.ts:computeMetricsSnapshot]
- `WorkflowAnalyzer` calls `WorkflowStateReader.listActive()`; it does not mutate workflow state [workflow-analyzer.ts:WorkflowAnalyzer]
- Reads wall-clock time via `Date.now()` for stall age and `new Date()` for `generatedAt` [workflow-analyzer.ts:WorkflowAnalyzer], [reflection-agent.ts:generateReport]
- No network access, disk writes, locks, or process spawning [reflection-agent.ts:generateReport]

## Verification
- Run: `pnpm test`
