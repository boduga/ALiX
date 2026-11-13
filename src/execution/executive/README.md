# Executive Execution System

## Overview
Plan-and-execute layer for subsystem health. It aggregates health reports, ranks priorities, derives objectives, compiles a deterministic step plan, gates approval, runs steps against a dependency DAG, and bridges investigation/mutation steps to human-specified remediation proposals. Health, prioritisation, objective derivation, plan building, outcome evaluation, trends, recommendations, and dashboards are pure; persistence, execution, and bridge reconciliation are the effecting seams. Plan execution is one-shot: a plan is approved once, then runs to a terminal status.

## Interface
- `buildExecutiveHealthReport()` aggregates eight subsystem scores into one report; scores below 60 are `critical` and below 80 `warning` `[executive-health.ts:buildExecutiveHealthReport]` `[executive-health.ts:STATUS_BOUNDARY_CRITICAL]` `[executive-health.ts:STATUS_BOUNDARY_WARNING]`.
- `buildPriorityReport()` weights Health Deficit 0.60, Trend 0.25, and Blast Radius 0.15, and sorts descending `[priority-engine.ts:buildPriorityReport]`.
- `buildObjectiveReport()` emits at most one objective per subsystem, scored 0.40 priority + 0.30 health impact + 0.20 persistence + 0.10 investigation pressure and sorted descending `[objective-engine.ts:buildObjectiveReport]`.
- `buildExecutionPlan()` is the pure plan compiler; `PLANNER_VERSION = "1.0"` and `PLANNING_ALGORITHM = "template-v1"` pin the output contract `[execution-plan-builder.ts:buildExecutionPlan]` `[execution-plan-builder.ts:PLANNER_VERSION]` `[execution-plan-builder.ts:PLANNING_ALGORITHM]`.
- `SUBSYSTEM_DEPENDENCY_RULES` and `resolveLocalDependencies()` derive the intra-subsystem step DAG (e.g. `apply_remediation` before `implement_improvements`/`review_baseline_metrics`) `[execution-plan-builder.ts:SUBSYSTEM_DEPENDENCY_RULES]` `[execution-plan-builder.ts:resolveLocalDependencies]`.
- `PlanStore` persists immutable plans with a SHA-256 `contentHash`; `PersistedExecutionPlan` is the on-disk shape `[plan-store.ts:PlanStore]` `[executive-plan-types.ts:PersistedExecutionPlan]`.
- `PlanApprovalGate` is the approve/reject authority over `draft` plans with a `pending` approval `[plan-approval-gate.ts:PlanApprovalGate]`.
- `ExecutionStateStore` owns per-plan runtime state and monotonic `sequence`-numbered transitions `[execution-state-store.ts:ExecutionStateStore]`.
- `ExecutionEngine` starts approved plans, queries runnable steps, and executes steps singly or as a batch `[execution-engine.ts:ExecutionEngine]`.
- `StepRunner` executes one step according to its behavior class and never mints an execution id `[step-runner.ts:StepRunner]`.
- `STEP_BEHAVIOR` classifies 12 actions as read-only (6), investigation (3), or mutation (3) `[step-behavior.ts:STEP_BEHAVIOR]`.
- `buildExecutiveRemediationProposal()` and `bridgeCreateRemediationProposal()` produce the human-specification handoff to the adaptation proposal store `[executive-bridge.ts:buildExecutiveRemediationProposal]` `[executive-bridge.ts:bridgeCreateRemediationProposal]`.
- `reconcileApplyStep()` completes an `apply_remediation` step only when its sibling create-step proposal is `applied` `[executive-apply-reconciler.ts:reconcileApplyStep]`.
- `ExecutiveOrchestrator` extracts child lineage and transitions bridge-waiting steps on proposal terminal status `[executive-orchestrator.ts:ExecutiveOrchestrator]` `[executive-orchestrator.ts:extractChildLineage]` `[executive-orchestrator.ts:computeStepTransition]`.
- `computeExecutiveProposals()` drafts improvement issues from actionable learning recommendations `[executive-bridge-recommendations.ts:computeExecutiveProposals]`.
- `RemediatorRegistry`, `validateRemediationParent()`, `validatePayload()`, `validateSpecification()`, and `createDefaultRegistry()` form the remediation wizard `[executive-remediate.ts:RemediatorRegistry]` `[executive-remediate.ts:validateRemediationParent]` `[executive-remediate.ts:validatePayload]` `[executive-remediate.ts:validateSpecification]` `[executive-remediate.ts:createDefaultRegistry]`.
- `ExecutiveSnapshotStore`, `DefaultExecutiveSnapshotProvider`, and `DefaultExecutiveObservationProvider` capture and read plan-scoped before/after observations `[executive-snapshot-store.ts:ExecutiveSnapshotStore]` `[executive-snapshot-provider.ts:DefaultExecutiveSnapshotProvider]` `[executive-observation-provider.ts:DefaultExecutiveObservationProvider]`.
- `AutomaticOutcomeEvaluator`, `buildOutcomeReportId()`, `evaluatePlanOutcome()`, and `OutcomeReportStore` evaluate and persist terminal-plan outcomes `[automatic-outcome-hook.ts:AutomaticOutcomeEvaluator]` `[outcome-report-id.ts:buildOutcomeReportId]` `[outcome-evaluator.ts:evaluatePlanOutcome]` `[outcome-store.ts:OutcomeReportStore]`.
- `ExecutiveTrendStore`, `computeLearningTrends()`, and `computeRecommendations()` derive trends and recommendations from outcome history `[trend-store.ts:ExecutiveTrendStore]` `[learning-trends.ts:computeLearningTrends]` `[recommendation-engine.ts:computeRecommendations]`.
- `RecommendationReportStore`, `classifyRecommendation()`, `applyEffectivenessData()`, and `computeRecommendationEffectiveness()` persist recommendations and measure their disposition `[recommendation-report-store.ts:RecommendationReportStore]` `[recommendation-effectiveness.ts:classifyRecommendation]` `[recommendation-effectiveness.ts:applyEffectivenessData]` `[recommendation-effectiveness.ts:computeRecommendationEffectiveness]`.
- `SubsystemTimeMatcher` and `computeSubsystemCorrelation()` correlate recommendations with later subsystem deltas `[subsystem-correlation.ts:SubsystemTimeMatcher]` `[subsystem-correlation.ts:computeSubsystemCorrelation]`.
- `buildDashboardReport()` and `loadDashboardSnapshot()` assemble the read-only executive dashboard `[executive-dashboard.ts:buildDashboardReport]` `[executive-dashboard-loader.ts:loadDashboardSnapshot]`.
- `executiveDir()`, `executivePlansDir()`, `createExecutiveStores()`, and `loadExecutiveState()` are the state-path and store construction seam `[executive-context.ts:executiveDir]` `[executive-context.ts:executivePlansDir]` `[executive-context.ts:createExecutiveStores]` `[executive-context.ts:loadExecutiveState]`.
- Subdirectory: [adapters](./adapters/README.md) - read-only Tier-2 subsystem health adapters.

## Invariants
- Plan status vocabulary is `draft | approved | running | completed | failed | blocked | cancelled | rejected`; it is distinct from the builder's `draft | ready | blocked` plan status `[executive-plan-types.ts:PlanStatus]` `[execution-plan-builder.ts:PlanStatus]`.
- The plan builder emits `blocked` when there are no objectives and `draft` otherwise `[execution-plan-builder.ts:buildExecutionPlan]`.
- Plan persistence is append-once: `PlanStore.load` re-verifies `contentHash` on every read and fails on mismatch `[plan-store.ts:PlanStore]`.
- Approval and rejection are legal only from `draft` and require `approval.status === "pending"` `[plan-approval-gate.ts:PlanApprovalGate]`.
- A plan-to-state mismatch is rejected: `validateStateStepIds` enforces exact 1:1 step-ID correspondence `[executive-plan-types.ts:validateStateStepIds]`.
- Only `ExecutionEngine` mints execution ids via `randomUUID()`; `runStep` uses one id per invocation and `runReadySteps` shares ONE id per batch `[execution-engine.ts:generateExecutionId]` `[execution-engine.ts:runReadySteps]`.
- `startPlan` requires `approved` and moves one-shot to `running`; `runStep`/`runReadySteps` require `running` `[execution-engine.ts:ExecutionEngine]`.
- A step is runnable only when it is `pending` and all `dependsOn` entries are `completed` `[execution-engine.ts:computeNextRunnableIds]`.
- Read-only steps complete immediately with evidence; investigation and mutation steps record intent and enter `waiting_for_bridge` `[step-behavior.ts:STEP_BEHAVIOR]` `[step-runner.ts:StepRunner]`.
- Remediation proposals always start `pending` with `action: "executive_remediation_request"`, `requiresHumanSpecification: true`, and `requestedFields: ["action","target","payload"]` `[executive-bridge.ts:buildExecutiveRemediationProposal]`.
- Child lineage is recognized only when `payload.source === "executive_remediate"`; transitions occur only from `waiting_for_bridge`, mapping `applied → completed` and `failed → blocked` `[executive-orchestrator.ts:extractChildLineage]` `[executive-orchestrator.ts:computeStepTransition]`.
- `apply_remediation` stays incomplete until the linked proposal is `applied` `[executive-apply-reconciler.ts:reconcileApplyStep]`.
- Recommendation bridging admits only `degrading_trend`/`persistent_instability` recommendations that have no `proposalId` `[executive-bridge-recommendations.ts:computeExecutiveProposals]`.
- Remediator lookup requires exactly one match; an unambiguous lowest-priority match wins and ties throw `[executive-remediate.ts:RemediatorRegistry]`.
- Parent validation rejects non-executive parents and parents not in `needs_specification` readiness, with `NOT_FOUND`/`NOT_APPROVED`/`NOT_EXECUTIVE`/`WRONG_READINESS` reasons `[executive-remediate.ts:validateRemediationParent]`.
- Reserved payload keys are refused, specification reasons must be at least 10 characters, and governance kind is limited to `confidence_calibration`, `lens_adjustment`, or `policy_coverage` `[executive-remediate.ts:RESERVED_PAYLOAD_KEYS]` `[executive-remediate.ts:validateSpecification]`.
- Child drafts are pure (no ids or timestamps), and lineage fields always win during payload merge `[executive-remediate.ts:buildRemediationChildDraft]` `[executive-remediate.ts:mergeLineagePayload]`.
- Baselines are write-once per plan id; a second capture raises `BaselineAlreadyCapturedError`, while current snapshots stay replaceable `[executive-snapshot-store.ts:ExecutiveSnapshotStore]` `[executive-snapshot-store.ts:BaselineAlreadyCapturedError]`.
- Outcome evaluation is idempotent on `(planId, terminalTimestamp)` and never throws upward `[automatic-outcome-hook.ts:AutomaticOutcomeEvaluator]` `[outcome-report-id.ts:buildOutcomeReportId]`.
- Outcome classification is pure: improvement at delta ≥ 5, degradation at ≤ −5, `mixed` when both occur, and `plan_not_executed` for non-terminal plans `[outcome-evaluator.ts:evaluatePlanOutcome]` `[outcome-evaluator.ts:IMPROVE_THRESHOLD]` `[outcome-evaluator.ts:DEGRADE_THRESHOLD]`.
- Trend state is derived cache: a missing `trends.jsonl` degrades priority trend to 25 rather than failing `[trend-store.ts:ExecutiveTrendStore]` `[priority-engine.ts:computeTrendScore]`.
- Recommendation precedence is low confidence → degrading → instability → improving, with confidence caps 0.3/0.9/0.95 `[recommendation-engine.ts:computeRecommendations]`.
- Effectiveness rates are rounded to two decimals and report `no_data` when there is nothing to measure `[recommendation-effectiveness.ts:computeRecommendationEffectiveness]`.
- Strict correlation only matches outcomes after the recommendation and within 30 days, and only for completed plans; `partial` applies when fewer than half correlate `[subsystem-correlation.ts:SubsystemTimeMatcher]` `[subsystem-correlation.ts:computeSubsystemCorrelation]`.
- Dashboard alert ordering is critical → warning → ok and the list is capped at 10 `[executive-dashboard.ts:buildDashboardReport]`.
- All executive state is cwd-scoped under `<cwd>/.alix/executive` `[executive-context.ts:executiveDir]`.

## Side Effects
- Writes plans under `<cwd>/.alix/executive/plans` using `.tmp` → `fsync` → `renameSync` `[executive-context.ts:executivePlansDir]` `[plan-store.ts:PlanStore]`.
- Writes per-plan `-baseline.json` and `-current.json` snapshots atomically under `<cwd>/.alix/executive/snapshots` `[executive-snapshot-store.ts:ExecutiveSnapshotStore]`.
- Appends outcome reports, recommendation reports, and `trends.jsonl` under `.alix/executive`, skipping corrupt entries on read `[outcome-store.ts:OutcomeReportStore]` `[recommendation-report-store.ts:RecommendationReportStore]` `[trend-store.ts:ExecutiveTrendStore]`.
- Reads `.alix/adaptation/{proposals,effectiveness}` for correlation and effectiveness, tolerating per-source failures `[executive-dashboard-loader.ts:loadDashboardSnapshot]`.
- Emits executive evidence events (plan saved/approved/started/step executed/intent/blocked/completed/failed/bridged/applied/orchestrated) fire-and-forget `[execution-engine.ts:ExecutionEngine]` `[executive-orchestrator.ts:ExecutiveOrchestrator]`.
- Writes no network traffic and takes no locks; corrupt artifacts degrade to warnings instead of failing the read path `[executive-dashboard-loader.ts:loadDashboardSnapshot]` `[automatic-outcome-hook.ts:AutomaticOutcomeEvaluator]`.

## Verification
- Run: `pnpm test`
