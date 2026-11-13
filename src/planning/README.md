# Strategic Planning

## Overview
The P11.3 strategic planning layer sits above root-cause reasoning and below forecasting. `PlanningEngine` wires the pipeline as load → pure transform → persist → return: it reads the latest `RootCauseAnalysis` from `RootCauseStore`, calls the deterministic `buildStrategicPlan` transform to rank degraded subsystems into advisorily-scoped objectives, and appends the result to a JSONL store. Two concerns live alongside that pipeline: append-only plan persistence with fail-closed validation (`StrategicPlanStore`), and a separate pure markdown parser that turns a planner's `## Changes` / `## Verification` blocks into structured `PlanTask` records. Planning output is advisory — the objectives carry effort, impact, and prerequisite metadata but apply no mutations themselves.

## Interface
- `PlanningEngine` with `run()` (load → build → save → return) and `loadLatest()` [planning-engine.ts:PlanningEngine]
- `buildStrategicPlan(analysis, config)` — pure `RootCauseAnalysis` → `StrategicPlan` transform [build-strategic-plan.ts:buildStrategicPlan]
- `computeUrgencyScore`, `estimateEffort`, and the internal `buildEarlyReturnPlan` early-exit builder [build-strategic-plan.ts:computeUrgencyScore]
- `DEFAULT_MAX_OBJECTIVES = 8` and `DEFAULT_MIN_URGENCY_SCORE = 15` fallbacks used when config fields are absent [build-strategic-plan.ts:DEFAULT_MAX_OBJECTIVES]
- `PlanningObjective` — `targetSubsystem`, `targetMetric`, `topCauseSubsystem`, `currentScore`, `urgencyScore`, `expectedImpact`, `improvesSubsystems`, `estimatedEffort`, `effortRationale`, `prerequisites`, `confidence`, `mechanism`, `sourceFindingSubsystem`, `rationale` [planning-types.ts:PlanningObjective]
- `StrategicPlan` with `schemaVersion: "p11.3.0"`, `planId`, `generatedAt`, `rootCauseAnalysisId`, `correlationGraphId`, `status`, `objectives`, and `meta` bucket counts [planning-types.ts:StrategicPlan]
- `PlanStatus` union `ok` | `no_degradation` | `insufficient_analysis` | `no_objectives`; `EffortEstimate` union `low` | `medium` | `high`; `StrategicImpact` union `direct` | `indirect` | `compound` [planning-types.ts:PlanStatus]
- `PlanningEngineConfig` (`maxObjectives`, `minUrgencyScore`, optional per-mechanism `effortOverrides`) and `DEFAULT_PLANNING_CONFIG` [planning-config.ts:DEFAULT_PLANNING_CONFIG]
- `StrategicPlanSummary` for list operations, with `objectives`/`objectivesHigh`/`objectivesMedium`/`objectivesLow` counts [planning-types.ts:StrategicPlanSummary]
- `PlanningEngineError` — the single error type raised by the engine, store, and validator, with `code = "PLANNING_ENGINE_ERROR"` [planning-types.ts:PlanningEngineError]
- `StrategicPlanStore` (`save`/`loadLatest`/`loadById`/`list`) over `strategic-plans.jsonl`, plus the standalone `validatePlan` [strategic-plan-store.ts:StrategicPlanStore]
- `PlanTask`, `PlanTaskList`, and `PlanTaskStatus` (`pending` | `in_progress` | `completed` | `skipped`) [plan-task.ts:PlanTask]
- `parsePlanTasks(planContent, sessionId)` and `buildPlanTaskList(sessionId, tasks)` — pure parsers/builders for plan markdown [plan-task.ts:parsePlanTasks]
- Child contracts with their entry symbols: [adaptation](./adaptation/README.md) `ProposalAction` [adaptation/adaptation-types.ts:ProposalAction]; [adaptive](./adaptive/README.md) `ContextMode` [adaptive/policy.ts:ContextMode]; [autonomy](./autonomy/README.md) `RunLimits` [autonomy/state-machine.ts:RunLimits]; [decision](./decision/README.md) `DecisionType` [decision/contracts.ts:DecisionType]; [evolution](./evolution/README.md) `EvolutionTransitionEvent` [evolution/evolution-state-machine.ts:EvolutionTransitionEvent]; [forecasting](./forecasting/README.md) `ForecastingEngine` [forecasting/forecasting-engine.ts:ForecastingEngine]; [learning](./learning/README.md) `LearningSignal` [learning/learning-types.ts:LearningSignal]; [reasoning](./reasoning/README.md) `CausalMechanism` [reasoning/reasoning-types.ts:CausalMechanism]; [reflection](./reflection/README.md) `ObservationType` [reflection/reflection-types.ts:ObservationType]

## Invariants
- `buildStrategicPlan` is fully deterministic: it performs no I/O, reads no clock or randomness, and derives both `generatedAt` and `planId` from the input analysis via `sanitizeTimestamp` rather than the current time [build-strategic-plan.ts:buildStrategicPlan]
- Status mapping is fixed: `insufficient_history` and `stale` analyses become `insufficient_analysis`, `no_degradation` becomes `no_degradation`, and a degradation with no candidate passing the threshold becomes `no_objectives` [build-strategic-plan.ts:buildStrategicPlan]
- `urgencyScore` is an integer in 0–100; with a top cause it is `floor(severity*40 + confidence*35 + min(downstreamCount/3,1)*25)`, and a no-cause finding is severity-only and capped at 25 [build-strategic-plan.ts:computeUrgencyScore]
- Candidate selection is ordered: sort descending by urgency score, drop scores below `minUrgencyScore`, then take at most `maxObjectives` [build-strategic-plan.ts:buildStrategicPlan]
- `expectedImpact` is derived from downstream breadth: 0 dependents → `direct`, 1 → `indirect`, 2+ → `compound`; `improvesSubsystems` is the downstream list for the target subsystem [build-strategic-plan.ts:buildStrategicPlan]
- `confidence` is `null` (never `0`) when no top cause exists, and `mechanism` is likewise `null` in that case [build-strategic-plan.ts:buildStrategicPlan]
- `effortOverrides` change only `estimatedEffort`; `effortRationale` always stays mechanism-specific [build-strategic-plan.ts:estimateEffort]
- A plan objective may list neither itself nor an ID absent from the same plan as a prerequisite [strategic-plan-store.ts:validatePlan]
- `validatePlan` is fail-closed and runs on both write and read: `schemaVersion` must be exactly `"p11.3.0"`, `status` must be one of the four known values, `urgencyScore` must be an integer 0–100, and `confidence` must be `null` or a number 0–1 [strategic-plan-store.ts:validatePlan]
- Validation composes the manual field checks with the Effect `StrategicPlanSchema` decode, so an invalid subsystem or mechanism literal is rejected even when the manual checks pass [strategic-plan-store.ts:validatePlan]
- Storage is append-only JSONL at `strategic-plans.jsonl`; `save` never rewrites earlier lines [strategic-plan-store.ts:STRATEGIC_PLANS_FILE]
- `loadLatest` returns `null` — it does not throw — when the file is missing, empty, or the last line fails validation [strategic-plan-store.ts:loadLatest]
- `loadById` and `list` skip blank and malformed lines instead of aborting the scan, returning `null` / `[]` when nothing valid matches [strategic-plan-store.ts:list]
- `PlanningEngine.run` raises `PlanningEngineError` when no analysis is stored, and wraps a failed load in the same error type; a `stale`/`insufficient_analysis` analysis is still persisted as a valid plan artifact rather than treated as an error [planning-engine.ts:run]
- `DEFAULT_PLANNING_CONFIG` is `maxObjectives: 8`, `minUrgencyScore: 15`, and is the constructor default for `PlanningEngine` [planning-config.ts:DEFAULT_PLANNING_CONFIG]
- `parsePlanTasks` is section-scoped: only `## Changes` (one task per top-level bullet) and `## Verification` (one synthetic `Verify: …` task) produce tasks; `## Summary`, `## Risk Assessment`, and every other section are ignored [plan-task.ts:parsePlanTasks]
- Task IDs are `${sessionId}:task:${index}` with a 1-based index, and every parsed task starts in `pending` [plan-task.ts:parsePlanTasks]
- `buildPlanTaskList` always emits `schemaVersion: 1` with an empty `summary` and a copied task array [plan-task.ts:buildPlanTaskList]

## Side Effects
- `StrategicPlanStore.save` creates the store directory recursively when absent and appends one JSON line to `strategic-plans.jsonl` on disk [strategic-plan-store.ts:save]
- `StrategicPlanStore.save` validates before the append; a validation `PlanningEngineError` is reported to the injected `onDiagnostic` as a `planning` / `plan.save` diagnostic and then rethrown, and no line is appended [strategic-plan-store.ts:save]
- `loadLatest`, `loadById`, and `list` read the JSONL file synchronously from disk and return empty results rather than mutating or repairing it [strategic-plan-store.ts:loadLatest]
- `PlanningEngine.run` reads the latest analysis from `RootCauseStore` and persists the produced plan through `StrategicPlanStore`; `loadLatest` is a pure delegation with no write [planning-engine.ts:run]
- No network, lock, or process effects are performed here; the only mutations are the directory creation and JSONL append in `StrategicPlanStore.save`, and `buildStrategicPlan` and `parsePlanTasks` are side-effect-free [strategic-plan-store.ts:save]

## Verification
- Run: `pnpm test`
- Focused suites: `tests/planning/build-strategic-plan.vitest.ts`, `tests/planning/planning-engine.vitest.ts`, `tests/planning/strategic-plan-store.vitest.ts`, `tests/planning/plan-task.test.ts`
